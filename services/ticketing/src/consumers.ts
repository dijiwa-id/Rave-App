import { randomBytes } from 'node:crypto';
import { publish, settings, uuidv7, type Client, type Consumers, type Job, type ServiceContext } from '@gema/service-kit';
import { refundCancelledOrders, releasePendingOrder, releaseReservation, requestInvoice, requestRefund, type Q } from './shared.js';

export function consumers({ log }: ServiceContext): Consumers {
  return {
    'catalog.artist.upserted': async (e, tx) => {
      const p = e.payload;
      await tx.query(`INSERT INTO artists (id, name, slug) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name = $2, slug = $3`, [p.artistId, p.name, p.slug]);
    },

    // Pembayaran order tiket berhasil → terbitkan e-ticket (idempoten per order).
    // Pembayaran yang tidak bisa dipenuhi (event batal/selesai, atau reservasi habis & kuota penuh) → refund, bukan ditahan.
    'finance.payment.succeeded': async (e, tx) => {
      const p = e.payload;
      if (p.purpose !== 'TICKET_ORDER') return;
      const o = (await tx.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [p.referenceId])).rows[0];
      if (!o || o.status === 'PAID' || o.status === 'REFUNDED' || o.refund_status) return;
      const ev = (await tx.query(`SELECT status, ends_at FROM events WHERE id = $1`, [o.event_id])).rows[0];
      if (ev?.status === 'CANCELLED') return unfulfillable(tx, o, 'event_cancelled', 'Event sudah dibatalkan saat pembayaran diterima');
      if (!ev || ev.status === 'COMPLETED' || new Date(ev.ends_at) < new Date()) return unfulfillable(tx, o, 'late_payment', 'Event sudah selesai saat pembayaran diterima');
      const items = (await tx.query(`SELECT * FROM order_items WHERE order_id = $1 ORDER BY ticket_type_id`, [o.id])).rows;
      if (o.status === 'RESERVED') {
        for (const it of items)
          await tx.query(`UPDATE ticket_types SET reserved = greatest(reserved - $2, 0), sold = sold + $2 WHERE id = $1`, [it.ticket_type_id, it.quantity]);
      } else {
        // Bayar setelah reservasi kedaluwarsa: coba ambil ulang kuota secara atomik — semua kategori atau tidak sama sekali.
        await tx.query('SAVEPOINT late_quota');
        for (const it of items) {
          const ok = await tx.query(`UPDATE ticket_types SET sold = sold + $2 WHERE id = $1 AND sold + reserved + $2 <= quota RETURNING id`, [it.ticket_type_id, it.quantity]);
          if (!ok.rowCount) {
            await tx.query('ROLLBACK TO SAVEPOINT late_quota');
            log.warn({ orderId: o.id }, 'pembayaran diterima setelah reservasi habis & kuota penuh — refund');
            return unfulfillable(tx, o, 'late_payment', 'Kuota habis setelah reservasi berakhir');
          }
        }
        await tx.query('RELEASE SAVEPOINT late_quota');
      }
      let n = 0;
      for (const it of items)
        for (let i = 0; i < it.quantity; i++, n++)
          await tx.query(
            `INSERT INTO tickets (id, order_id, event_id, ticket_type_id, user_id, holder_name, secret) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [uuidv7(), o.id, o.event_id, it.ticket_type_id, o.user_id, o.holder_name, randomBytes(20).toString('hex')],
          );
      await tx.query(`UPDATE orders SET status = 'PAID', paid_at = now() WHERE id = $1`, [o.id]);
      await publish(tx, 'ticketing.order.paid', o.id, { orderId: o.id, eventId: o.event_id, userId: o.user_id, quantity: n, amount: Number(o.total) });
    },

    // Dana sudah kembali ke pembeli (nominal pasti dari finance).
    'finance.refund.completed': async (e, tx) => {
      const p = e.payload;
      if (p.purpose !== 'TICKET_ORDER') return;
      await tx.query(`UPDATE orders SET refund_status = 'COMPLETED', refund_amount = $2, refunded_at = now() WHERE id = $1`, [p.referenceId, p.amount]);
    },
    'finance.refund.failed': async (e, tx) => {
      const p = e.payload;
      if (p.purpose !== 'TICKET_ORDER') return;
      log.error({ orderId: p.referenceId, error: p.error }, 'refund tiket gagal — perlu tindakan admin');
      await tx.query(`UPDATE orders SET refund_status = 'FAILED', refund_note = $2 WHERE id = $1`, [p.referenceId, p.error]);
    },

    'finance.payment.failed': async (e, tx) => {
      const p = e.payload;
      if (p.purpose !== 'TICKET_ORDER') return;
      const o = (await tx.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [p.referenceId])).rows[0];
      if (!o || o.status !== 'RESERVED') return;
      await releaseReservation(tx, o.id);
      await tx.query(`UPDATE orders SET status = 'CANCELLED' WHERE id = $1`, [o.id]);
    },
  };
}

/**
 * Pembayaran yang tidak dapat dipenuhi: refund penuh (termasuk biaya layanan — bukan kesalahan pembeli).
 * Pembatalan event selalu direfund; pembayaran terlambat mengikuti `refund.late_payment_auto_refund`
 * (mati → order ditandai REVIEW untuk diputus admin, dana tetap tercatat di escrow event).
 */
async function unfulfillable(tx: Client, o: any, reason: 'event_cancelled' | 'late_payment', note: string) {
  if (o.status === 'RESERVED') await releaseReservation(tx, o.id); // kuota yang masih dipegang reservasi ini dilepas
  if (reason === 'late_payment' && !settings.bool('refund.late_payment_auto_refund')) {
    await tx.query(`UPDATE orders SET refund_status = 'REVIEW', refund_reason = $2, refund_note = $3, refund_requested_at = now() WHERE id = $1`, [o.id, reason, note]);
    return;
  }
  await requestRefund(tx, o, { escrowPct: 100, refundFee: true, reason, note });
}

/** Refund order PAID dari event yang dibatalkan, per batch (pembatalan event besar tidak dikerjakan dalam satu request). */
export const refundCancelledJob: Job = {
  name: 'refund-cancelled-events',
  everyMs: 30_000,
  async run({ db, log }) {
    const n = await db.tx((tx) => refundCancelledOrders(tx, null, 200));
    if (n) log.info({ n }, 'refund order event batal diajukan');
  },
};

/** Event PUBLISHED yang sudah lewat ends_at → COMPLETED (tiket tak bisa check-in lagi; escrow tiket dicairkan finance). */
export const completeEventsJob: Job = {
  name: 'complete-events',
  everyMs: 60_000,
  async run({ db, log }) {
    await db.tx(async (tx) => {
      const r = await tx.query(
        `UPDATE events SET status = 'COMPLETED'
         WHERE id IN (SELECT id FROM events WHERE status = 'PUBLISHED' AND ends_at < now() ORDER BY ends_at LIMIT 100 FOR UPDATE SKIP LOCKED)
         RETURNING id, org_id, ends_at`,
      );
      for (const e of r.rows) await publish(tx, 'ticketing.event.completed', e.id, { eventId: e.id, orgId: e.org_id, endedAt: new Date(e.ends_at).toISOString() });
      if (r.rows.length) log.info({ n: r.rows.length }, 'event selesai');
    });
  },
};

/** Order RESERVED tanpa invoice lebih tua dari ini dianggap yatim (proses mati di antara fase 1 dan 3). */
const ORPHAN_AFTER_S = 60;
/** Bila finance terus gagal, reservasi yatim dilepas setelah sekian detik (tidak menunggu 10 menit). */
const ORPHAN_GIVE_UP_S = 180;

/** Lepas reservasi 10 menit yang tidak dibayar (§7.6) + pulihkan order yang belum sempat dibuatkan invoice. */
export const expireJob: Job = {
  name: 'expire-reservations',
  everyMs: 30_000,
  async run({ db, log }) {
    await db.tx(async (tx) => {
      // UPDATE kondisional pada status → kuota dilepas tepat sekali (bersaing dengan consumer bayar & pembatalan).
      // Order tanpa invoice: Idempotency-Key dikosongkan agar retry klien membuat order baru.
      const r = await tx.query(
        `UPDATE orders SET status = 'EXPIRED', idempotency_key = CASE WHEN invoice_id IS NULL THEN NULL ELSE idempotency_key END
         WHERE id IN (SELECT id FROM orders WHERE status = 'RESERVED' AND reserved_until < now() ORDER BY reserved_until LIMIT 200 FOR UPDATE SKIP LOCKED)
           AND status = 'RESERVED'
         RETURNING id`,
      );
      for (const o of r.rows) await releaseReservation(tx, o.id);
      if (r.rows.length) log.info({ n: r.rows.length }, 'reservasi kedaluwarsa dilepas');
    });

    // Pemulihan (di luar tx): finance idempoten per order id → aman diulang / bersaing dengan request asli.
    const stuck = await db.query(
      `SELECT *, extract(epoch FROM now() - created_at) AS age_s FROM orders
       WHERE status = 'RESERVED' AND invoice_id IS NULL AND created_at < now() - make_interval(secs => $1) AND reserved_until > now()
       ORDER BY created_at LIMIT 50`,
      [ORPHAN_AFTER_S],
    );
    for (const o of stuck) {
      try {
        const inv = await requestInvoice(db.pool as unknown as Q, o);
        await db.query(`UPDATE orders SET invoice_id = $2 WHERE id = $1 AND status = 'RESERVED' AND invoice_id IS NULL`, [o.id, inv.id]);
        log.info({ orderId: o.id, invoiceId: inv.id }, 'invoice order yatim dipulihkan');
      } catch (e: any) {
        if (Number(o.age_s) < ORPHAN_GIVE_UP_S) {
          log.warn({ err: e?.message, orderId: o.id }, 'pemulihan invoice gagal — dicoba lagi');
          continue;
        }
        const released = await db.tx((tx) => releasePendingOrder(tx, o.id, 'EXPIRED'));
        if (released) log.warn({ err: e?.message, orderId: o.id }, 'order yatim dilepas (finance tetap gagal)');
      }
    }
  },
};
