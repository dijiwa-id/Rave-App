import { config, publish, settings, uuidv7, type Job } from '@gema/service-kit';
import { processRefundEvent, releaseEscrow, releaseEventEscrow, settleRefund, signPayload, verifySignature } from './escrow.js';
import { PermanentRefundError, paymentProvider } from './providers.js';
import { C, D, post, serial } from './ledger.js';

/** Fast clock dev (GEMA_FAST_CLOCK, default aktif di non-produksi): jendela dispute 30 dtk, bukan 24 jam. */
export const FAST_CLOCK = (process.env.GEMA_FAST_CLOCK ?? (config.isDev ? '1' : '0')) === '1';
/** Jendela dispute dari pengaturan platform (booking.dispute_window_hours). */
export const disputeWindowMs = () => (FAST_CLOCK ? 30_000 : settings.num('booking.dispute_window_hours') * 3600_000);

/** Pencairan escrow setelah jendela dispute (Temporal di produksi, §10.6). */
export const releaseJob: Job = {
  name: 'escrow-release',
  everyMs: FAST_CLOCK ? 5_000 : 60_000,
  async run({ db, log }) {
    const due = await db.query(`SELECT reference_id FROM escrow_holds WHERE status='PAID_IN_FULL' AND NOT frozen AND release_at <= now() LIMIT 50`);
    for (const { reference_id } of due) {
      await serial(db, async (c) => {
        const h = (await c.query(`SELECT * FROM escrow_holds WHERE reference_id=$1 FOR UPDATE`, [reference_id])).rows[0];
        if (!h || h.frozen || h.status !== 'PAID_IN_FULL' || !h.release_payload) return;
        await releaseEscrow(c, reference_id, h.release_payload);
      }).catch((e) => log.error({ err: e?.message, reference_id }, 'pencairan gagal'));
    }
    const events = await db.query(`SELECT reference_id FROM escrow_holds WHERE kind='EVENT' AND status='HELD' AND NOT frozen AND release_at <= now() LIMIT 50`);
    for (const { reference_id } of events) {
      await serial(db, (c) => releaseEventEscrow(c, reference_id)).catch((e) => log.error({ err: e?.message, reference_id }, 'pencairan tiket gagal'));
    }
  },
};

/** Proses payout ke bank (adapter disbursement PG di produksi). */
export const payoutJob: Job = {
  name: 'payouts',
  everyMs: FAST_CLOCK ? 3_000 : 60_000,
  async run({ db, log }) {
    const rows = await db.query(`SELECT * FROM payouts WHERE status='REQUESTED' ORDER BY created_at LIMIT 20`);
    for (const p of rows) {
      await serial(db, async (c) => {
        const r = await c.query(`UPDATE payouts SET status='COMPLETED', completed_at=now() WHERE id=$1 AND status='REQUESTED' RETURNING id`, [p.id]);
        if (!r.rowCount) return;
        await post(c, {
          key: `payout-complete:${p.id}`,
          kind: 'payout.complete',
          referenceId: p.id,
          description: `Transfer ke ${p.bank_snapshot.bank} ${p.bank_snapshot.number}`,
          lines: [D('asset:payout_clearing', p.amount), C('asset:escrow_bank:mitra-sandbox', p.amount)],
        });
        await publish(c, 'finance.payout.completed', p.id, { payoutId: p.id, partyId: p.party_id, amount: p.amount });
      }).catch((e) => log.error({ err: e?.message, id: p.id }, 'payout gagal'));
    }
  },
};

/** Tagihan tiket yang lewat batas reservasi → EXPIRED (inventori dilepas ticketing). */
export const expiryJob: Job = {
  name: 'invoice-expiry',
  everyMs: 30_000,
  async run({ db }) {
    await db.query(`UPDATE invoices SET status='EXPIRED' WHERE status='PENDING' AND purpose='TICKET_ORDER' AND due_at < now()`);
  },
};

/** Batas percobaan kirim refund ke penyedia sebelum FAILED (admin dapat mencoba ulang atau menyelesaikan manual). */
const REFUND_MAX_ATTEMPTS = 6;

/**
 * Kirim refund REQUESTED ke penyedia pembayaran — di luar transaksi DB (HTTP ke vendor tidak menahan lock).
 * Baris diklaim dulu (attempts+1, next_attempt_at digeser) agar replika lain tidak mengirim bersamaan; penyedia
 * menerima `refundId` sebagai idempotency key sehingga pengiriman ulang tidak menggandakan refund.
 * Gagal sementara → backoff eksponensial (30 dtk, 1, 2, 4, … mnt); penolakan final / melewati batas → FAILED.
 */
export const refundDispatchJob: Job = {
  name: 'refund-dispatch',
  everyMs: FAST_CLOCK ? 2_000 : 15_000,
  async run({ db, log }) {
    const provider = paymentProvider();
    const rows = await db.query(
      `SELECT r.*, i.va_number, i.paid_at,
         (SELECT w.payload->>'method' FROM pg_webhook_events w WHERE w.invoice_id = r.invoice_id AND w.status = 'PAID' ORDER BY w.received_at LIMIT 1) AS method,
         (SELECT w.event_id FROM pg_webhook_events w WHERE w.invoice_id = r.invoice_id AND w.status = 'PAID' ORDER BY w.received_at LIMIT 1) AS payment_ref
       FROM refunds r JOIN invoices i ON i.id = r.invoice_id
       WHERE r.status IN ('REQUESTED','DISPATCHING') AND r.next_attempt_at <= now() ORDER BY r.next_attempt_at LIMIT 20`,
    );
    for (const r of rows) {
      const claim = await db.query(
        // Sewa DISPATCHING 2 menit: admin tidak dapat menyelesaikan manual selama dikirim; sewa kedaluwarsa
        // (proses mati di tengah) diambil ulang — penyedia idempoten per id refund.
        `UPDATE refunds SET status = 'DISPATCHING', attempts = attempts + 1, next_attempt_at = now() + interval '2 minutes'
         WHERE id = $1 AND status IN ('REQUESTED','DISPATCHING') AND next_attempt_at <= now() RETURNING attempts`,
        [r.id],
      );
      if (!claim.length) continue;
      try {
        const d = await provider.requestRefund({
          refundId: r.id,
          invoiceId: r.invoice_id,
          amount: Number(r.amount),
          reason: r.reason,
          payment: { method: r.method ?? null, vaNumber: r.va_number ?? null, paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null, providerPaymentRef: r.payment_ref ?? null },
        });
        await db.tx(async (c) => {
          const up = (
            await c.query(
              `UPDATE refunds SET status = 'PENDING', provider = $2, provider_ref = $3, dispatched_at = now(), error = NULL WHERE id = $1 AND status = 'DISPATCHING' RETURNING *`,
              [r.id, provider.name, d.providerRef],
            )
          ).rows[0];
          if (up && d.status === 'COMPLETED') await settleRefund(c, up, { status: 'COMPLETED', settledBy: 'provider' });
        });
      } catch (e: any) {
        const attempts = Number(claim[0].attempts);
        const msg = String(e?.message ?? e).slice(0, 500);
        if (e instanceof PermanentRefundError || attempts >= REFUND_MAX_ATTEMPTS) {
          await db.tx((c) => settleRefund(c, r, { status: 'FAILED', settledBy: 'provider', error: msg }));
          log.error({ refundId: r.id, attempts, err: msg }, 'refund gagal — perlu tindakan admin');
        } else {
          const backoff = Math.min(30 * 2 ** (attempts - 1), 3600);
          await db.query(`UPDATE refunds SET status = 'REQUESTED', error = $2, next_attempt_at = now() + make_interval(secs => $3) WHERE id = $1 AND status = 'DISPATCHING'`, [r.id, msg, backoff]);
          log.warn({ refundId: r.id, attempts, retryInS: backoff, err: msg }, 'kirim refund gagal — dicoba ulang');
        }
      }
    }
  },
};

/**
 * Sandbox saja: penyedia "mengonfirmasi" refund PENDING lewat webhook bertanda tangan — jalur verifikasi & pemrosesan
 * yang sama dengan webhook vendor nyata. Tidak berjalan bila PAYMENT_PROVIDER bukan sandbox.
 */
export const sandboxRefundSettleJob: Job = {
  name: 'refund-sandbox-settle',
  everyMs: FAST_CLOCK ? 2_000 : 10_000,
  async run({ db }) {
    if (paymentProvider().name !== 'sandbox') return;
    const rows = await db.query(
      `SELECT provider_ref FROM refunds WHERE status = 'PENDING' AND provider = 'sandbox' AND dispatched_at < now() - interval '1 second' ORDER BY dispatched_at LIMIT 50`,
    );
    for (const r of rows) {
      const ev = { event_id: `sbx_rfevt_${uuidv7()}`, refund_ref: r.provider_ref as string, status: 'COMPLETED' as const };
      const raw = JSON.stringify(ev);
      verifySignature(raw, signPayload(raw));
      await serial(db, (c) => processRefundEvent(c, 'sandbox', ev));
    }
  },
};
