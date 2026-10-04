import { randomBytes } from 'node:crypto';
import { publish, uuidv7, type Consumers, type Job, type ServiceContext } from '@gema/service-kit';
import { releaseReservation } from './shared.js';

export function consumers({ log }: ServiceContext): Consumers {
  return {
    'catalog.artist.upserted': async (e, tx) => {
      const p = e.payload;
      await tx.query(`INSERT INTO artists (id, name, slug) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name = $2, slug = $3`, [p.artistId, p.name, p.slug]);
    },

    // Pembayaran order tiket berhasil → terbitkan e-ticket (idempoten per order)
    'finance.payment.succeeded': async (e, tx) => {
      const p = e.payload;
      if (p.purpose !== 'TICKET_ORDER') return;
      const o = (await tx.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [p.referenceId])).rows[0];
      if (!o || o.status === 'PAID') return;
      const items = (await tx.query(`SELECT * FROM order_items WHERE order_id = $1 ORDER BY ticket_type_id`, [o.id])).rows;
      if (o.status === 'RESERVED') {
        for (const it of items)
          await tx.query(`UPDATE ticket_types SET reserved = greatest(reserved - $2, 0), sold = sold + $2 WHERE id = $1`, [it.ticket_type_id, it.quantity]);
      } else {
        // Bayar setelah reservasi kedaluwarsa: coba ambil ulang kuota secara atomik.
        for (const it of items) {
          const ok = await tx.query(`UPDATE ticket_types SET sold = sold + $2 WHERE id = $1 AND sold + reserved + $2 <= quota RETURNING id`, [it.ticket_type_id, it.quantity]);
          if (!ok.rowCount) {
            // TODO(refund): kuota habis → perlu refund otomatis via finance (REQ-TIX-05)
            log.warn({ orderId: o.id }, 'pembayaran diterima setelah reservasi habis & kuota penuh — perlu refund');
            throw new Error('Kuota habis setelah reservasi kedaluwarsa');
          }
        }
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

/** Lepas reservasi 10 menit yang tidak dibayar (§7.6). */
export const expireJob: Job = {
  name: 'expire-reservations',
  everyMs: 30_000,
  async run({ db, log }) {
    await db.tx(async (tx) => {
      const r = await tx.query(`SELECT id FROM orders WHERE status = 'RESERVED' AND reserved_until < now() ORDER BY reserved_until LIMIT 200 FOR UPDATE SKIP LOCKED`);
      for (const o of r.rows) {
        await releaseReservation(tx, o.id);
        await tx.query(`UPDATE orders SET status = 'EXPIRED' WHERE id = $1`, [o.id]);
      }
      if (r.rows.length) log.info({ n: r.rows.length }, 'reservasi kedaluwarsa dilepas');
    });
  },
};
