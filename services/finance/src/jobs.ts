import { config, publish, type Job } from '@gema/service-kit';
import { releaseEscrow } from './escrow.js';
import { C, D, post, serial } from './ledger.js';

/** Fast clock dev (GEMA_FAST_CLOCK, default aktif di non-produksi): jendela dispute 30 dtk, bukan 24 jam. */
export const FAST_CLOCK = (process.env.GEMA_FAST_CLOCK ?? (config.isDev ? '1' : '0')) === '1';
export const DISPUTE_WINDOW_MS = FAST_CLOCK ? 30_000 : 24 * 3600_000;

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
