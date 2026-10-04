import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  assertOrg,
  audit,
  badRequest,
  config,
  conflict,
  forbidden,
  idempotent,
  isAdmin,
  managedArtistIds,
  notFound,
  requireAuth,
  requireRole,
  unprocessable,
  uuidv7,
  z,
  type AuthUser,
  type ServiceContext,
} from '@gema/service-kit';
import { createInvoice, invoiceView, processPgEvent, signPayload, verifySignature, type PgEvent } from './escrow.js';
import { C, D, SOURCES, payableAccount, post, serial, walletBalances } from './ledger.js';

const orgIds = (u: AuthUser) => u.orgs.map((o) => o.id);

function canSeeHold(u: AuthUser, h: any): boolean {
  if (isAdmin(u)) return true;
  const ids = orgIds(u);
  return (
    (h.promotor_org_id && ids.includes(h.promotor_org_id)) ||
    (h.artist_org_id && ids.includes(h.artist_org_id)) ||
    (h.management_org_id && ids.includes(h.management_org_id)) ||
    (h.artist_id && managedArtistIds(u).includes(h.artist_id))
  );
}
function canPayInvoice(u: AuthUser, inv: any): boolean {
  return isAdmin(u) || inv.payer_user_id === u.sub || (!!inv.payer_org_id && orgIds(u).includes(inv.payer_org_id));
}
function canSeeWallet(u: AuthUser, partyId: string): boolean {
  return isAdmin(u) || u.sub === partyId || orgIds(u).includes(partyId);
}

function holdStatus(h: any): string {
  if (h.frozen && !['RELEASED', 'REFUNDED', 'PARTIAL_REFUND'].includes(h.status)) return 'HELD';
  return h.status;
}

export async function routes(app: FastifyInstance, { db }: ServiceContext) {
  // ---------- Webhook PG (raw body untuk verifikasi HMAC) ----------
  await app.register(async (s) => {
    s.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    s.post('/v1/webhooks/pg/:provider', async (req) => {
      const raw = req.body as string;
      verifySignature(raw, req.headers['x-pg-signature'] as string | undefined);
      const ev = z
        .object({ event_id: z.string().min(6), intent_id: z.string().uuid(), status: z.enum(['PAID', 'FAILED']), amount: z.number().int(), paid_at: z.string(), method: z.string().optional() })
        .parse(JSON.parse(raw));
      const r = await serial(db, (c) => processPgEvent(c, (req.params as any).provider, ev));
      return { ok: true, duplicate: r.duplicate };
    });
  });

  // ---------- Internal (ticketing) ----------
  app.post('/internal/invoices', { preHandler: requireRole('service') }, async (req, reply) => {
    if (!req.user!.roles.includes('service')) throw forbidden('Hanya service internal');
    const p = z
      .object({
        purpose: z.enum(['TICKET_ORDER', 'SUBSCRIPTION', 'TIP']),
        reference_id: z.string().min(1),
        amount: z.number().int().positive(),
        payer_user_id: z.string().uuid(),
        payer_org_id: z.string().uuid().nullable().optional(),
        description: z.string().min(1),
        due_at: z.string(),
        metadata: z.object({ event_id: z.string().optional(), promotor_org_id: z.string().optional(), service_fee: z.number().int().min(0).optional() }).passthrough().optional(),
      })
      .parse(req.body);
    const fee = Math.min(p.metadata?.service_fee ?? 0, p.amount);
    const inv = await db.tx((c) =>
      createInvoice(c, {
        purpose: p.purpose,
        referenceId: p.reference_id,
        escrowAmount: p.amount - fee,
        feeAmount: fee,
        payerUserId: p.payer_user_id,
        payerOrgId: p.payer_org_id ?? null,
        description: p.description,
        dueAt: new Date(p.due_at),
        metadata: p.metadata,
      }),
    );
    reply.status(201);
    return invoiceView(inv);
  });

  // ---------- Endpoint pengguna ----------
  await app.register(async (s) => {
    s.addHook('preHandler', requireAuth);

    s.get('/v1/finance/invoices', async (req) => {
      const { reference_id } = req.query as { reference_id?: string };
      const u = req.user!;
      const rows = await db.query(
        `SELECT i.* FROM invoices i LEFT JOIN escrow_holds h ON h.reference_id = i.reference_id
         WHERE ($1::text IS NULL OR i.reference_id = $1)
           AND ($2 OR i.payer_user_id::text = $3 OR i.payer_org_id = ANY($4::uuid[])
                OR h.promotor_org_id = ANY($4::uuid[]) OR h.artist_org_id = ANY($4::uuid[]) OR h.artist_id = ANY($5::uuid[]))
         ORDER BY i.created_at DESC LIMIT 200`,
        [reference_id ?? null, isAdmin(u), u.sub, orgIds(u), managedArtistIds(u)],
      );
      return { data: rows.map(invoiceView), next_cursor: null };
    });

    s.get('/v1/finance/invoices/:id', async (req) => {
      const inv = await db.one(`SELECT * FROM invoices WHERE id=$1`, [(req.params as any).id]);
      if (!inv) throw notFound('Invoice');
      const h = await db.one(`SELECT * FROM escrow_holds WHERE reference_id=$1`, [inv.reference_id]);
      if (!canPayInvoice(req.user!, inv) && !(h && canSeeHold(req.user!, h))) throw forbidden();
      return invoiceView(inv);
    });

    // Sandbox PG: mensimulasikan pembayaran VA/QRIS → webhook bertanda tangan yang sama dengan produksi.
    s.post('/v1/finance/invoices/:id/simulate-pay', async (req, reply) => {
      if (!config.isDev) throw notFound('Endpoint');
      const { id } = req.params as { id: string };
      const { method } = z.object({ method: z.enum(['VA', 'QRIS', 'EWALLET', 'CARD']).default('VA') }).parse(req.body ?? {});
      return idempotent(db, req, reply, `simulate-pay:${id}`, async (c) => {
        const inv = (await c.query(`SELECT * FROM invoices WHERE id=$1`, [id])).rows[0];
        if (!inv) throw notFound('Invoice');
        if (!canPayInvoice(req.user!, inv)) throw forbidden('Bukan pembayar tagihan ini');
        if (inv.status !== 'PENDING') throw conflict(`Invoice berstatus ${inv.status}`);
        if (inv.depends_on) {
          const dep = (await c.query(`SELECT status FROM invoices WHERE id=$1`, [inv.depends_on])).rows[0];
          if (dep?.status !== 'PAID') throw unprocessable('Bayar DP terlebih dahulu');
        }
        const ev: PgEvent = { event_id: `sbx_${uuidv7()}`, intent_id: id, status: 'PAID', amount: inv.amount, paid_at: new Date().toISOString(), method };
        const raw = JSON.stringify(ev);
        const sig = signPayload(raw);
        // Jalur verifikasi yang sama dengan webhook nyata.
        verifySignature(raw, sig);
        await serial(db, (tx) => processPgEvent(tx, 'sandbox', ev));
        const fresh = (await db.query(`SELECT * FROM invoices WHERE id=$1`, [id]))[0];
        return { body: invoiceView(fresh) };
      });
    });

    s.get('/v1/finance/escrow/:referenceId', async (req) => {
      const { referenceId } = req.params as { referenceId: string };
      const h = await db.one(`SELECT * FROM escrow_holds WHERE reference_id=$1`, [referenceId]);
      if (!h) throw notFound('Escrow');
      if (!canSeeHold(req.user!, h)) throw forbidden();
      const invs = await db.query(`SELECT * FROM invoices WHERE reference_id=$1 ORDER BY created_at`, [referenceId]);
      return {
        reference_id: referenceId,
        status: holdStatus(h),
        fee: h.fee,
        held_amount: h.held - h.released - h.refunded,
        released_amount: h.released,
        refunded_amount: h.refunded,
        release_at: h.release_at,
        invoices: invs.map(invoiceView),
      };
    });

    s.get('/v1/finance/wallets/:partyId', async (req) => {
      const { partyId } = req.params as { partyId: string };
      if (!canSeeWallet(req.user!, partyId)) throw forbidden('Bukan wallet Anda');
      const balances = await walletBalances(db, partyId);
      const tx = await db.query(
        `SELECT e.id, split_part(e.account, ':', 4) AS source, CASE e.side WHEN 'CREDIT' THEN e.amount ELSE -e.amount END AS amount,
                t.description, t.created_at
         FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.txn_id
         WHERE e.account LIKE $1 ORDER BY e.id DESC LIMIT 100`,
        [`liability:payable:${partyId}:%`],
      );
      const payouts = await db.query(`SELECT id, party_id, amount, status, created_at, completed_at FROM payouts WHERE party_id=$1 ORDER BY created_at DESC LIMIT 20`, [partyId]);
      const bank = await db.one(`SELECT bank, number_masked, holder FROM bank_accounts WHERE party_id=$1`, [partyId]);
      return { party_id: partyId, balances, transactions: tx.map((t) => ({ ...t, id: String(t.id) })), payouts, bank_account: bank };
    });

    // Penarikan saldo (REQ-PAY-02) — hanya OWNER/FINANCE org, saldo cukup.
    s.post('/v1/finance/payouts', async (req, reply) => {
      const p = z
        .object({
          party_id: z.string().uuid(),
          amount: z.number().int().min(50_000, 'Minimal penarikan Rp 50.000'),
          bank_account: z.object({ bank: z.string().min(2), number: z.string().regex(/^\d{6,20}$/), holder: z.string().min(2) }),
        })
        .parse(req.body);
      const u = req.user!;
      if (p.party_id !== u.sub) assertOrg(u, p.party_id, ['OWNER', 'FINANCE']);
      return idempotent(db, req, reply, 'payout', async (c) => {
        await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`wallet:${p.party_id}`]);
        const bal = await walletBalances(c, p.party_id);
        if (bal.total < p.amount) throw unprocessable(`Saldo tidak cukup (tersedia ${bal.total})`);
        // Rekening: perubahan dicatat audit (produksi: dual control + cooling 24 jam, §11.5).
        const hash = createHash('sha256').update(p.bank_account.number).digest('hex');
        const masked = '****' + p.bank_account.number.slice(-4);
        const prev = (await c.query(`SELECT number_hash FROM bank_accounts WHERE party_id=$1`, [p.party_id])).rows[0];
        if (!prev || prev.number_hash !== hash) {
          await c.query(
            `INSERT INTO bank_accounts (party_id, bank, number_masked, number_hash, holder, verified_at) VALUES ($1,$2,$3,$4,$5, now())
             ON CONFLICT (party_id) DO UPDATE SET bank=$2, number_masked=$3, number_hash=$4, holder=$5, verified_at=now(), updated_at=now()`,
            [p.party_id, p.bank_account.bank, masked, hash, p.bank_account.holder],
          );
          await audit(c, { actorId: u.sub, action: 'bank_account.change', entity: 'party', entityId: p.party_id, data: { bank: p.bank_account.bank, number: masked }, ip: req.ip });
        }
        const id = uuidv7();
        let left = p.amount;
        const lines = [];
        for (const src of ['offair', 'royalty', 'ticket', 'merch', 'tip'] as const) {
          const take = Math.min(left, Math.max(0, bal[src]));
          if (take > 0) lines.push(D(payableAccount(p.party_id, src), take));
          left -= take;
        }
        if (left > 0) throw unprocessable('Saldo tidak cukup');
        lines.push(C('asset:payout_clearing', p.amount));
        await post(c, { key: `payout:${id}`, kind: 'payout.request', referenceId: id, description: `Penarikan ke ${p.bank_account.bank} ${masked}`, lines });
        const r = await c.query(
          `INSERT INTO payouts (id, party_id, amount, bank_snapshot, requested_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, party_id, amount, status, created_at`,
          [id, p.party_id, p.amount, JSON.stringify({ bank: p.bank_account.bank, number: masked, holder: p.bank_account.holder }), u.sub],
        );
        await audit(c, { actorId: u.sub, action: 'payout.request', entity: 'payout', entityId: id, data: { amount: p.amount }, ip: req.ip });
        return { status: 201, body: r.rows[0] };
      });
    });
  });

  // ---------- Admin finance (REQ-PAY-05, REQ-ADM-01) ----------
  app.get('/v1/admin/finance/ledger', { preHandler: requireRole('admin') }, async (req) => {
    const { account, reference_id } = req.query as { account?: string; reference_id?: string };
    const txns = await db.query(
      `SELECT t.* FROM ledger_transactions t
       WHERE ($1::text IS NULL OR EXISTS (SELECT 1 FROM ledger_entries e WHERE e.txn_id=t.id AND e.account LIKE $1 || '%'))
         AND ($2::text IS NULL OR t.reference_id = $2)
       ORDER BY t.created_at DESC LIMIT 100`,
      [account ?? null, reference_id ?? null],
    );
    const entries = txns.length ? await db.query(`SELECT txn_id, account, side, amount FROM ledger_entries WHERE txn_id = ANY($1) ORDER BY id`, [txns.map((t) => t.id)]) : [];
    return { data: txns.map((t) => ({ ...t, entries: entries.filter((e) => e.txn_id === t.id).map(({ txn_id, ...e }) => e) })) };
  });

  app.get('/v1/admin/finance/reconciliation', { preHandler: requireRole('admin') }, async () => {
    const tot = await db.one(
      `SELECT coalesce(sum(amount) FILTER (WHERE side='DEBIT'),0)::bigint AS d, coalesce(sum(amount) FILTER (WHERE side='CREDIT'),0)::bigint AS c FROM ledger_entries`,
    );
    const accounts = await db.query(
      `SELECT account, sum(CASE side WHEN 'DEBIT' THEN amount ELSE -amount END)::bigint AS balance FROM ledger_entries GROUP BY account ORDER BY account`,
    );
    // Saldo akun escrow per booking harus = held - released - refunded di escrow_holds.
    const mismatches = await db.query(
      `SELECT h.reference_id, (h.held - h.released - h.refunded) AS expected,
              coalesce((SELECT sum(CASE side WHEN 'CREDIT' THEN amount ELSE -amount END) FROM ledger_entries
                        WHERE account = CASE h.kind WHEN 'BOOKING' THEN 'liability:escrow:booking:' || h.reference_id
                                                    ELSE 'liability:escrow:event:' || substr(h.reference_id, 7) END), 0)::bigint AS ledger
       FROM escrow_holds h`,
    );
    const bad = mismatches.filter((m) => Number(m.expected) !== Number(m.ledger));
    const paidVsLedger = await db.one(
      `SELECT coalesce(sum(amount),0)::bigint AS paid FROM invoices WHERE status='PAID'`,
    );
    const balanced = tot.d === tot.c && bad.length === 0;
    const details = { escrow_mismatches: bad, invoices_paid_total: paidVsLedger.paid };
    const run = await db.one(`INSERT INTO reconciliation_runs (balanced, total_debit, total_credit, details) VALUES ($1,$2,$3,$4) RETURNING run_at`, [
      balanced, tot.d, tot.c, JSON.stringify(details),
    ]);
    return { balanced, total_debit: tot.d, total_credit: tot.c, accounts, ...details, last_run_at: run.run_at };
  });
}

export { badRequest, SOURCES };
