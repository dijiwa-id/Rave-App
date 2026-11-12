import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  assertOrg,
  audit,
  badRequest,
  config,
  conflict,
  forbidden,
  HttpError,
  idempotent,
  isAdmin,
  managedArtistIds,
  notFound,
  publish,
  requireAuth,
  requirePermission,
  requireRole,
  settings,
  unprocessable,
  uuidv7,
  z,
  unauthorized,
  type AuthUser,
  type ServiceContext,
} from '@rave/service-kit';
import { createInvoice, invoiceView, processPgEvent, processRefundEvent, settleRefund, signPayload, verifySignature, type PgEvent } from './escrow.js';
import { C, D, SOURCES, payableAccount, post, serial, walletBalances } from './ledger.js';
import { activePaymentProvider, mapMidtransStatus, paymentSettings, providerByName, ProviderError, testMidtrans, verifyMidtransSignature, type ProviderPaymentStatus } from './providers.js';

/** Status penyedia → event PG internal (jalur pemrosesan yang sama dengan webhook sandbox). */
const toPgEvent = (s: ProviderPaymentStatus): PgEvent => ({ event_id: s.eventId, intent_id: s.invoiceId, status: s.status, amount: s.amount, paid_at: s.paidAt, method: s.method });

/** URL kembali setelah bayar: hanya ke origin web RAVE sendiri (mencegah open redirect). */
function safeFinishUrl(u: string | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const url = new URL(u);
    const allowed = new Set([new URL(process.env.PUBLIC_WEB_URL ?? 'http://localhost:5173').origin]);
    if (config.isDev) for (const o of ['http://localhost:5173', 'http://127.0.0.1:5173']) allowed.add(o);
    return allowed.has(url.origin) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Kolom payout yang aman ditampilkan ke pemilik wallet (tanpa id pemutus). */
const PAYOUT_COLS = 'id, party_id, amount, status, approval_required, hold_until, decision_note, created_at, decided_at, completed_at';

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

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

const rupiah = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');

export async function routes(app: FastifyInstance, { db }: ServiceContext) {
  // ---------- Webhook PG (raw body untuk verifikasi HMAC) ----------
  await app.register(async (s) => {
    s.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    // Notifikasi HTTP Midtrans (Payment Notification URL di dasbor Midtrans = <PUBLIC_WEB_URL>/v1/webhooks/pg/midtrans).
    // Diverifikasi signature_key SHA-512 dengan server key; selalu 200 untuk event yang bukan pembayaran final.
    s.post('/v1/webhooks/pg/midtrans', async (req, reply) => {
      const n = JSON.parse(req.body as string);
      const ps = await paymentSettings();
      if (!ps.midtrans) throw unauthorized('Midtrans belum dikonfigurasi');
      if (!verifyMidtransSignature(n, ps.midtrans.serverKey)) throw unauthorized('Signature Midtrans tidak valid');
      const st = mapMidtransStatus(n);
      if (!st || !isUuid(st.invoiceId)) {
        req.log.info({ order: n.order_id, status: n.transaction_status }, 'notifikasi Midtrans dicatat (belum final / bukan pembayaran)');
        return { ok: true, ignored: true };
      }
      const exists = await db.one(`SELECT id FROM invoices WHERE id=$1`, [st.invoiceId]);
      if (!exists) {
        reply.status(200);
        return { ok: true, ignored: true, reason: 'invoice tidak dikenal' };
      }
      const r = await serial(db, (c) => processPgEvent(c, 'midtrans', toPgEvent(st)));
      return { ok: true, duplicate: r.duplicate };
    });
    s.post('/v1/webhooks/pg/:provider', async (req) => {
      const raw = req.body as string;
      verifySignature(raw, req.headers['x-pg-signature'] as string | undefined);
      const body = JSON.parse(raw);
      // Event refund dari penyedia (hasil akhir refund yang sebelumnya diterima PENDING).
      if (body && typeof body === 'object' && 'refund_ref' in body) {
        const rev = z
          .object({ event_id: z.string().min(6), refund_ref: z.string().min(3), status: z.enum(['COMPLETED', 'FAILED']), failure_reason: z.string().max(500).optional() })
          .parse(body);
        const r = await serial(db, (c) => processRefundEvent(c, (req.params as any).provider, rev));
        return { ok: true, duplicate: r.duplicate };
      }
      const ev = z
        .object({ event_id: z.string().min(6), intent_id: z.string().uuid(), status: z.enum(['PAID', 'FAILED']), amount: z.number().int(), paid_at: z.string(), method: z.string().optional() })
        .parse(body);
      const r = await serial(db, (c) => processPgEvent(c, (req.params as any).provider, ev));
      return { ok: true, duplicate: r.duplicate };
    });
  });

  // ---------- Internal (platform): uji kredensial payment gateway sebelum/ sesudah disimpan ----------
  app.post('/internal/payment/test', { preHandler: requireRole('service') }, async (req) => {
    const b = z
      .object({ provider: z.enum(['sandbox', 'midtrans']), server_key: z.string().optional(), mode: z.enum(['sandbox', 'production']).optional() })
      .parse(req.body);
    if (b.provider === 'sandbox') return { ok: true, message: 'Sandbox aktif — tidak ada uang yang berpindah (simulasi pembayaran hanya di development).' };
    if (!b.server_key) return { ok: false, message: 'Server key Midtrans belum diisi' };
    return testMidtrans({ serverKey: b.server_key, production: b.mode === 'production' });
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
    // Idempoten per (purpose, reference_id) (UNIQUE di 001_init): retry/pemulihan ticketing menerima invoice yang sama (200).
    const r = await db.tx(async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [p.purpose, p.reference_id]);
      const existing = (await c.query(`SELECT * FROM invoices WHERE purpose = $1 AND reference_id = $2`, [p.purpose, p.reference_id])).rows[0];
      if (existing) {
        if (Number(existing.amount) !== p.amount || existing.payer_user_id !== p.payer_user_id)
          throw conflict('Invoice untuk referensi ini sudah ada dengan nominal/pembayar berbeda');
        return { inv: existing, created: false };
      }
      const inv = await createInvoice(c, {
        purpose: p.purpose,
        referenceId: p.reference_id,
        escrowAmount: p.amount - fee,
        feeAmount: fee,
        payerUserId: p.payer_user_id,
        payerOrgId: p.payer_org_id ?? null,
        description: p.description,
        dueAt: new Date(p.due_at),
        metadata: p.metadata,
      });
      return { inv, created: true };
    });
    reply.status(r.created ? 201 : 200);
    return invoiceView(r.inv);
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
           AND ($2 OR i.payer_user_id = $3::uuid OR i.payer_org_id = ANY($4::uuid[])
                OR h.promotor_org_id = ANY($4::uuid[]) OR h.artist_org_id = ANY($4::uuid[]) OR h.artist_id = ANY($5::uuid[]))
         ORDER BY i.created_at DESC LIMIT 200`,
        [reference_id ?? null, isAdmin(u), isUuid(u.sub) ? u.sub : null, orgIds(u), managedArtistIds(u)],
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

    // Mulai pembayaran lewat penyedia aktif. Midtrans → halaman Snap (redirect); sandbox → simulasi (dev).
    s.post('/v1/finance/invoices/:id/checkout', async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Invoice');
      const b = z.object({ finish_url: z.string().max(2000).optional() }).parse(req.body ?? {});
      const inv = await db.one(`SELECT * FROM invoices WHERE id=$1`, [id]);
      if (!inv) throw notFound('Invoice');
      if (!canPayInvoice(req.user!, inv)) throw forbidden('Bukan pembayar tagihan ini');
      if (inv.status !== 'PENDING') throw conflict(`Invoice berstatus ${inv.status}`);
      if (new Date(inv.due_at).getTime() <= Date.now()) throw conflict('Tagihan sudah melewati batas waktu');
      if (inv.depends_on) {
        const dep = await db.one(`SELECT status FROM invoices WHERE id=$1`, [inv.depends_on]);
        if (dep?.status !== 'PAID') throw unprocessable('Bayar DP terlebih dahulu');
      }
      const ps = await paymentSettings();
      if (ps.provider === 'sandbox') return { provider: 'sandbox', simulate: config.isDev, invoice: invoiceView(inv) };
      // Sesi lama yang masih berlaku dipakai ulang (Midtrans menolak order_id yang sama dibuat dua kali).
      if (inv.provider === 'midtrans' && inv.checkout_url && inv.checkout_expires_at && new Date(inv.checkout_expires_at).getTime() > Date.now() + 60_000)
        return { provider: 'midtrans', redirect_url: inv.checkout_url, token: inv.checkout_token, mode: ps.midtrans?.production ? 'production' : 'sandbox', invoice: invoiceView(inv) };
      const provider = await activePaymentProvider();
      let sess;
      try {
        sess = await provider.createCheckout!({ invoiceId: inv.id, amount: Number(inv.amount), description: inv.description, dueAt: new Date(inv.due_at), finishUrl: safeFinishUrl(b.finish_url) });
      } catch (e) {
        req.log.error({ invoice: inv.id, err: (e as Error).message }, 'checkout payment gateway gagal');
        throw new HttpError(e instanceof ProviderError && e.retryable ? 503 : 502, 'Bad Gateway', 'Halaman pembayaran belum dapat dibuat. Coba lagi sebentar lagi.');
      }
      const up = (
        await db.query(
          `UPDATE invoices SET provider='midtrans', checkout_token=$2, checkout_url=$3, checkout_expires_at=$4 WHERE id=$1 AND status='PENDING' RETURNING *`,
          [inv.id, sess.token, sess.redirectUrl, sess.expiresAt],
        )
      )[0];
      return { provider: 'midtrans', redirect_url: sess.redirectUrl, token: sess.token, mode: ps.midtrans?.production ? 'production' : 'sandbox', invoice: invoiceView(up ?? inv) };
    });

    // Tarik status dari penyedia (pengguna kembali dari halaman bayar, atau webhook terlambat). Idempoten.
    s.post('/v1/finance/invoices/:id/sync', async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Invoice');
      const inv = await db.one(`SELECT * FROM invoices WHERE id=$1`, [id]);
      if (!inv) throw notFound('Invoice');
      if (!canPayInvoice(req.user!, inv)) throw forbidden('Bukan pembayar tagihan ini');
      if (inv.status !== 'PENDING' || inv.provider === 'sandbox') return invoiceView(inv);
      const provider = await providerByName(inv.provider);
      const st = await provider.fetchStatus?.(inv.id).catch((e: Error) => {
        req.log.warn({ invoice: inv.id, err: e.message }, 'cek status penyedia gagal');
        return null;
      });
      if (st) await serial(db, (c) => processPgEvent(c, inv.provider, toPgEvent(st)));
      return invoiceView(await db.one(`SELECT * FROM invoices WHERE id=$1`, [id]));
    });

    // Sandbox PG: mensimulasikan pembayaran VA/QRIS → webhook bertanda tangan yang sama dengan produksi.
    s.post('/v1/finance/invoices/:id/simulate-pay', async (req, reply) => {
      if (!config.isDev) throw notFound('Endpoint');
      const { id } = req.params as { id: string };
      const { method } = z.object({ method: z.enum(['VA', 'QRIS', 'EWALLET', 'CARD']).default('VA') }).parse(req.body ?? {});
      return idempotent(db, req, reply, `simulate-pay:${id}`, async (c) => {
        const inv = (await c.query(`SELECT * FROM invoices WHERE id=$1 FOR UPDATE`, [id])).rows[0];
        if (!inv) throw notFound('Invoice');
        if (!canPayInvoice(req.user!, inv)) throw forbidden('Bukan pembayar tagihan ini');
        if (inv.status !== 'PENDING') throw conflict(`Invoice berstatus ${inv.status}`);
        if (inv.provider !== 'sandbox') throw conflict('Invoice ini dibayar lewat payment gateway nyata, bukan simulasi');
        if (inv.depends_on) {
          const dep = (await c.query(`SELECT status FROM invoices WHERE id=$1`, [inv.depends_on])).rows[0];
          if (dep?.status !== 'PAID') throw unprocessable('Bayar DP terlebih dahulu');
        }
        const ev: PgEvent = { event_id: `sbx_${uuidv7()}`, intent_id: id, status: 'PAID', amount: inv.amount, paid_at: new Date().toISOString(), method };
        const raw = JSON.stringify(ev);
        const sig = signPayload(raw);
        // Jalur verifikasi yang sama dengan webhook nyata.
        verifySignature(raw, sig);
        // Di transaksi idempotensi yang sama: satu koneksi per permintaan (bukan dua yang saling menunggu di pool).
        await processPgEvent(c, 'sandbox', ev);
        const fresh = (await c.query(`SELECT * FROM invoices WHERE id=$1`, [id])).rows[0];
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
      const payouts = await db.query(`SELECT ${PAYOUT_COLS} FROM payouts WHERE party_id=$1 ORDER BY created_at DESC LIMIT 20`, [partyId]);
      const bank = await db.one(`SELECT bank, number_masked, holder FROM bank_accounts WHERE party_id=$1`, [partyId]);
      return { party_id: partyId, balances, transactions: tx.map((t) => ({ ...t, id: String(t.id) })), payouts, bank_account: bank };
    });

    // Penarikan saldo (REQ-PAY-02) — hanya OWNER/FINANCE org, saldo cukup.
    s.post('/v1/finance/payouts', async (req, reply) => {
      const p = z
        .object({
          party_id: z.string().uuid(),
          amount: z.number().int().positive(),
          bank_account: z.object({ bank: z.string().min(2), number: z.string().regex(/^\d{6,20}$/), holder: z.string().min(2) }),
        })
        .parse(req.body);
      const u = req.user!;
      if (p.party_id !== u.sub) assertOrg(u, p.party_id, ['OWNER', 'FINANCE']);
      const minAmount = settings.num('payout.min_amount_idr');
      if (p.amount < minAmount) throw badRequest(`Minimal penarikan ${rupiah(minAmount)}`);
      return idempotent(db, req, reply, 'payout', async (c) => {
        await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`wallet:${p.party_id}`]);
        // Batas harian per wallet (hari kalender WIB), dihitung di dalam kunci wallet agar permintaan paralel tidak lolos bersamaan.
        const dailyLimit = settings.num('payout.daily_limit_idr');
        const today = Number(
          (
            await c.query(
              `SELECT coalesce(sum(amount), 0) AS n FROM payouts
               WHERE party_id=$1 AND status NOT IN ('FAILED','REJECTED') AND (created_at AT TIME ZONE 'Asia/Jakarta')::date = (now() AT TIME ZONE 'Asia/Jakarta')::date`,
              [p.party_id],
            )
          ).rows[0].n,
        );
        if (today + p.amount > dailyLimit)
          throw unprocessable(`Melebihi batas penarikan harian ${rupiah(dailyLimit)} (sisa hari ini ${rupiah(Math.max(0, dailyLimit - today))})`);
        const bal = await walletBalances(c, p.party_id);
        if (bal.total < p.amount) throw unprocessable(`Saldo tidak cukup (tersedia ${bal.total})`);
        // Rekening (§11.5): penggantian nomor dicatat audit dan memulai masa tunggu (payout.bank_change_cooldown_hours) —
        // penarikan ke rekening yang baru diganti ditahan agar pengambilalihan akun tidak langsung menguras saldo.
        const hash = createHash('sha256').update(p.bank_account.number).digest('hex');
        const masked = '****' + p.bank_account.number.slice(-4);
        const prev = (await c.query(`SELECT number_hash, changed_at FROM bank_accounts WHERE party_id=$1`, [p.party_id])).rows[0];
        let changedAt: Date | null = prev?.changed_at ? new Date(prev.changed_at) : null;
        if (!prev || prev.number_hash !== hash) {
          const changed = !!prev; // pendaftaran rekening pertama tidak memicu masa tunggu
          const r = await c.query(
            `INSERT INTO bank_accounts (party_id, bank, number_masked, number_hash, holder, verified_at, changed_at) VALUES ($1,$2,$3,$4,$5, now(), NULL)
             ON CONFLICT (party_id) DO UPDATE SET bank=$2, number_masked=$3, number_hash=$4, holder=$5, verified_at=now(), updated_at=now(),
               changed_at = CASE WHEN $6 THEN now() ELSE bank_accounts.changed_at END
             RETURNING changed_at`,
            [p.party_id, p.bank_account.bank, masked, hash, p.bank_account.holder, changed],
          );
          changedAt = r.rows[0]?.changed_at ? new Date(r.rows[0].changed_at) : null;
          await audit(c, { actorId: u.sub, action: changed ? 'bank_account.change' : 'bank_account.register', entity: 'party', entityId: p.party_id, data: { bank: p.bank_account.bank, number: masked }, ip: req.ip });
        }
        const cooldownH = settings.num('payout.bank_change_cooldown_hours');
        const holdUntil = changedAt && cooldownH > 0 ? new Date(changedAt.getTime() + cooldownH * 3_600_000) : null;
        const hold = holdUntil && holdUntil.getTime() > Date.now() ? holdUntil : null;
        // Dual control: penarikan di atas ambang menunggu persetujuan tim finance (bukan pemohon).
        const approvalRequired = p.amount > settings.num('payout.approval_threshold_idr');
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
          `INSERT INTO payouts (id, party_id, amount, bank_snapshot, requested_by, status, approval_required, hold_until) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING ${PAYOUT_COLS}`,
          [id, p.party_id, p.amount, JSON.stringify({ bank: p.bank_account.bank, number: masked, holder: p.bank_account.holder }), u.sub, approvalRequired ? 'PENDING_APPROVAL' : 'REQUESTED', approvalRequired, hold],
        );
        await audit(c, { actorId: u.sub, action: 'payout.request', entity: 'payout', entityId: id, data: { amount: p.amount, approval_required: approvalRequired, hold_until: hold }, ip: req.ip });
        return { status: 201, body: r.rows[0] };
      });
    });
  });

  // ---------- Admin finance (REQ-PAY-05, REQ-ADM-01) ----------
  // ---------- Persetujuan payout (dual control, §11.5) ----------
  const PAYOUT_STATUSES = ['PENDING_APPROVAL', 'REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED'] as const;
  app.get('/v1/admin/finance/payouts', { preHandler: requirePermission(['finance.view', 'finance.payout']) }, async (req) => {
    const q = z.object({ status: z.enum(PAYOUT_STATUSES).optional() }).parse(req.query);
    const rows = await db.query(
      `SELECT p.*, b.changed_at AS bank_changed_at FROM payouts p LEFT JOIN bank_accounts b ON b.party_id = p.party_id
       ${q.status ? 'WHERE p.status = $1' : ''} ORDER BY (p.status = 'PENDING_APPROVAL') DESC, p.created_at DESC LIMIT 200`,
      q.status ? [q.status] : [],
    );
    const counts = await db.query<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM payouts GROUP BY status`);
    return {
      data: rows.map((p: any) => ({
        id: p.id,
        party_id: p.party_id,
        amount: Number(p.amount),
        status: p.status,
        bank: p.bank_snapshot,
        requested_by: p.requested_by,
        approval_required: p.approval_required,
        hold_until: p.hold_until,
        bank_changed_at: p.bank_changed_at,
        decided_by: p.decided_by,
        decided_at: p.decided_at,
        decision_note: p.decision_note,
        created_at: p.created_at,
        completed_at: p.completed_at,
      })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
      threshold_idr: settings.num('payout.approval_threshold_idr'),
      cooldown_hours: settings.num('payout.bank_change_cooldown_hours'),
    };
  });

  /** Pemutus tidak boleh pemohon sendiri atau anggota wallet yang ditarik (empat mata). */
  function assertNotRequester(u: AuthUser, p: any) {
    if (p.requested_by === u.sub || p.party_id === u.sub || orgIds(u).includes(p.party_id))
      throw forbidden('Dual control: penarikan harus diputuskan admin lain, bukan pemohon atau anggota wallet ini');
  }

  app.post('/v1/admin/finance/payouts/:id/approve', { preHandler: requirePermission('finance.payout') }, async (req) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound('Payout');
    const b = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    const u = req.user!;
    return db.tx(async (c) => {
      const p = (await c.query(`SELECT * FROM payouts WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!p) throw notFound('Payout');
      assertNotRequester(u, p);
      if (p.status !== 'PENDING_APPROVAL') throw conflict(`Payout berstatus ${p.status}`);
      const r = await c.query(
        `UPDATE payouts SET status='REQUESTED', decided_by=$2, decided_at=now(), decision_note=$3 WHERE id=$1 RETURNING ${PAYOUT_COLS}`,
        [id, u.sub, b.note || null],
      );
      await audit(c, { actorId: u.sub, action: 'payout.approve', entity: 'payout', entityId: id, data: { amount: Number(p.amount), note: b.note ?? null }, ip: req.ip });
      return r.rows[0];
    });
  });

  app.post('/v1/admin/finance/payouts/:id/reject', { preHandler: requirePermission('finance.payout') }, async (req) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound('Payout');
    const b = z.object({ reason: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(500) }).parse(req.body);
    const u = req.user!;
    return serial(db, async (c) => {
      const p = (await c.query(`SELECT * FROM payouts WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!p) throw notFound('Payout');
      assertNotRequester(u, p);
      // Hanya yang belum dikirim ke bank: menunggu persetujuan, atau antre (termasuk yang tertahan masa tunggu rekening).
      if (p.status !== 'PENDING_APPROVAL' && p.status !== 'REQUESTED') throw conflict(`Payout berstatus ${p.status}`);
      // Jurnal pembalik: kembalikan dana dari kliring payout ke sumber saldo semula.
      const orig = await c.query(
        `SELECT e.account, e.side, e.amount FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.txn_id WHERE t.idempotency_key = $1`,
        [`payout:${id}`],
      );
      const lines = orig.rows.map((e: any) => (e.side === 'DEBIT' ? C(e.account, Number(e.amount)) : D(e.account, Number(e.amount))));
      if (!lines.length) throw conflict('Jurnal penarikan tidak ditemukan');
      await post(c, { key: `payout-reject:${id}`, kind: 'payout.reject', referenceId: id, description: `Penarikan ditolak: ${b.reason}`, lines });
      const r = await c.query(
        `UPDATE payouts SET status='REJECTED', decided_by=$2, decided_at=now(), decision_note=$3 WHERE id=$1 RETURNING ${PAYOUT_COLS}`,
        [id, u.sub, b.reason],
      );
      await publish(c, 'finance.payout.rejected', id, { payoutId: id, partyId: p.party_id, amount: Number(p.amount), reason: b.reason });
      await audit(c, { actorId: u.sub, action: 'payout.reject', entity: 'payout', entityId: id, data: { amount: Number(p.amount), reason: b.reason }, ip: req.ip });
      return r.rows[0];
    });
  });

  // ---------- Refund (back office) ----------
  const refundOut = (r: any) => ({
    id: r.id,
    reference_id: r.reference_id,
    purpose: r.purpose,
    amount: Number(r.amount),
    reason: r.reason,
    status: r.status,
    provider: r.provider,
    provider_ref: r.provider_ref,
    attempts: r.attempts,
    error: r.error,
    created_at: r.created_at,
    dispatched_at: r.dispatched_at,
    completed_at: r.completed_at,
    settled_by: r.settled_by,
    manual_ref: r.manual_ref,
  });
  app.get('/v1/admin/finance/refunds', { preHandler: requirePermission('finance.view') }, async (req) => {
    const q = z.object({ status: z.enum(['REQUESTED', 'DISPATCHING', 'PENDING', 'COMPLETED', 'FAILED']).optional(), reference_id: z.string().optional() }).parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) where.push(`status = $${params.push(q.status)}`);
    if (q.reference_id) where.push(`reference_id = $${params.push(q.reference_id)}`);
    const rows = await db.query(`SELECT * FROM refunds ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`, params);
    return { data: rows.map(refundOut) };
  });
  /** Kirim ulang refund FAILED ke penyedia (dana masih tercatat sebagai utang ke pembeli). */
  app.post('/v1/admin/finance/refunds/:referenceId/retry', { preHandler: requirePermission('finance.refund') }, async (req) => {
    const { referenceId } = req.params as { referenceId: string };
    return db.tx(async (c) => {
      const r = (await c.query(`UPDATE refunds SET status = 'REQUESTED', attempts = 0, next_attempt_at = now(), error = NULL WHERE reference_id = $1 AND status = 'FAILED' RETURNING *`, [referenceId])).rows[0];
      if (!r) throw conflict('Tidak ada refund gagal untuk referensi ini');
      await audit(c, { actorId: req.user!.sub, action: 'refund.retry', entity: 'refund', entityId: r.id, data: { reference_id: referenceId }, ip: req.ip });
      return refundOut(r);
    });
  });
  /** Tandai selesai lewat transfer manual (mis. metode pembayaran asal tidak mendukung refund). Wajib nomor bukti transfer. */
  app.post('/v1/admin/finance/refunds/:referenceId/complete-manual', { preHandler: requirePermission('finance.refund') }, async (req) => {
    const { referenceId } = req.params as { referenceId: string };
    const b = z.object({ transfer_ref: z.string().trim().min(4, 'Isi nomor/bukti transfer').max(120), note: z.string().trim().min(5).max(1000) }).parse(req.body);
    return db.tx(async (c) => {
      // Hanya FAILED, atau REQUESTED yang belum pernah dikirim ke penyedia — refund yang pernah dikirim (bisa saja
      // berhasil di penyedia walau responsnya hilang) tidak boleh ditransfer manual lagi: refund ganda.
      const r = (
        await c.query(
          `SELECT * FROM refunds WHERE reference_id = $1 AND (status = 'FAILED' OR (status = 'REQUESTED' AND attempts = 0 AND provider_ref IS NULL)) FOR UPDATE`,
          [referenceId],
        )
      ).rows[0];
      if (!r) throw conflict('Refund ini tidak dapat diselesaikan manual (sedang/pernah dikirim ke penyedia, atau sudah selesai)');
      const done = await settleRefund(c, r, { status: 'COMPLETED', settledBy: `manual:${req.user!.sub}`, manualRef: b.transfer_ref });
      await audit(c, { actorId: req.user!.sub, action: 'refund.complete_manual', entity: 'refund', entityId: r.id, data: { reference_id: referenceId, ...b }, ip: req.ip });
      return refundOut(done);
    });
  });

  app.get('/v1/admin/finance/ledger', { preHandler: requirePermission('finance.view') }, async (req) => {
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

  app.get('/v1/admin/finance/reconciliation', { preHandler: requirePermission('finance.view') }, async () => {
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
