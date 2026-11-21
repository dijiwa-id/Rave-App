// RAVE Pro — langganan B2B organisasi (BRD v3.0 §4.1, REQ-PAY-03). Pemilik data: finance (tagihan, ledger, siklus hidup).
// Alur: checkout → pesanan + invoice SUBSCRIPTION → bayar (sandbox/Midtrans) → processPgEvent → applyPaidProOrder →
// event finance.pro.changed (booking: take rate, iam: roster & profil org, notification: pemberitahuan).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  BILLING_CYCLES,
  PLAN_LABEL,
  PLAN_RANK,
  PRO_FEATURES,
  PRO_PLANS,
  PRO_SETTING,
  cycleEnd,
  isEntitled,
  isProEligible,
  lifecycleAction,
  plansFor,
  planPrice,
  prorationCredit,
  quote,
  type BillingCycle,
  type ProPlan,
  type ProStatus,
} from '@rave/domain';
import { L, type ServiceReport } from '@rave/domain/reports';
import {
  callService,
  conflict,
  forbidden,
  notFound,
  orgMembership,
  publish,
  requireAuth,
  requirePermission,
  requireSuperAdmin,
  settings,
  unprocessable,
  uuidv7,
  type AuthUser,
  type Client,
  type Db,
  type Job,
  type ServiceContext,
} from '@rave/service-kit';
import { createInvoice, invoiceView } from './escrow.js';
import { serial } from './ledger.js';

export const PRO_PRODUCT = 'rave_pro';
const num = (k: string) => settings.num(k);
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const DAY = 86_400_000;
type Reason = 'ACTIVATED' | 'RENEWED' | 'UPGRADED' | 'GRACE' | 'EXPIRED' | 'CANCEL_SCHEDULED' | 'RESUMED' | 'COMPLIMENTARY' | 'REVOKED' | 'PLAN_SCHEDULED';

interface OrgInfo {
  id: string;
  type: string;
  name: string;
}

export function subView(s: any) {
  if (!s) return null;
  const entitled = isEntitled(s);
  return {
    org_id: s.org_id,
    org_name: s.org_name,
    org_type: s.org_type,
    plan: s.plan as ProPlan,
    plan_label: PLAN_LABEL[s.plan as ProPlan],
    cycle: s.cycle as BillingCycle,
    status: s.status as ProStatus,
    source: s.source,
    entitled,
    current_period_start: s.current_period_start,
    current_period_end: s.current_period_end,
    grace_until: s.grace_until,
    auto_renew: s.auto_renew,
    cancel_at_period_end: !s.auto_renew && s.status === 'ACTIVE',
    next_plan: s.next_plan,
    next_cycle: s.next_cycle,
    started_at: s.started_at,
    features: entitled ? PRO_FEATURES[s.plan as ProPlan] : null,
  };
}

function orderView(o: any, inv?: any) {
  return {
    id: o.id,
    kind: o.kind,
    plan: o.plan,
    cycle: o.cycle,
    status: o.status,
    subtotal: Number(o.subtotal),
    credit: Number(o.credit),
    ppn_pct: Number(o.ppn_pct),
    ppn: Number(o.ppn),
    total: Number(o.total),
    period_start: o.period_start,
    period_end: o.period_end,
    created_at: o.created_at,
    paid_at: o.paid_at,
    note: o.note,
    invoice: inv ? invoiceView(inv) : null,
  };
}

async function publishChange(c: Client, s: any, reason: Reason) {
  await publish(c, 'finance.pro.changed', s.org_id, {
    orgId: s.org_id,
    plan: isEntitled(s) ? s.plan : null,
    status: s.status,
    entitled: isEntitled(s),
    periodEnd: s.current_period_end ? new Date(s.current_period_end).toISOString() : null,
    graceUntil: s.grace_until ? new Date(s.grace_until).toISOString() : null,
    cancelAtPeriodEnd: !s.auto_renew && s.status === 'ACTIVE',
    reason,
  });
}

/** Rangkuman untuk kartu harga: harga dasar, PPN, fitur & batas roster (dari pengaturan Super Admin). */
export function planCatalog(orgType?: string) {
  const ppnPct = num(PRO_SETTING.ppn);
  const offered = orgType ? plansFor(orgType) : [...PRO_PLANS];
  return {
    enabled: settings.bool(PRO_SETTING.enabled),
    currency: 'IDR',
    ppn_pct: ppnPct,
    yearly_discount_pct: num(PRO_SETTING.yearlyDiscount),
    grace_days: num(PRO_SETTING.graceDays),
    renewal_invoice_days: num(PRO_SETTING.renewalLeadDays),
    take_rate: {
      standard: { promotor_service_fee_pct: num('commission.promotor_service_fee_pct'), artist_commission_pct: num('commission.artist_commission_pct') },
      pro: { promotor_service_fee_pct: num(PRO_SETTING.promotorFee), artist_commission_pct: num(PRO_SETTING.artistCommission) },
    },
    free_roster: num(PRO_SETTING.freeRoster),
    plans: offered.map((p) => ({
      plan: p,
      label: PLAN_LABEL[p],
      monthly: planPrice(p, 'MONTHLY', num),
      yearly: planPrice(p, 'YEARLY', num),
      roster_limit: num(PRO_SETTING.roster(p)),
      features: PRO_FEATURES[p],
    })),
  };
}

async function orgInfo(id: string): Promise<OrgInfo> {
  const o = await callService<OrgInfo>('finance', 'iam', `/internal/orgs/${id}`).catch(() => null);
  if (!o) throw notFound('Organisasi');
  return o;
}

async function loadSub(c: Client | Db, orgId: string, lock = false) {
  const q = `SELECT * FROM pro_subscriptions WHERE org_id=$1${lock ? ' FOR UPDATE' : ''}`;
  return 'one' in c ? (c as Db).one(q, [orgId]) : (await (c as Client).query(q, [orgId])).rows[0];
}

/** Batalkan pesanan menunggu (checkout baru / pencabutan): pesanan VOID, invoice EXPIRED agar tidak dapat dibayar lagi. */
async function voidPending(c: Client, orgId: string, note: string) {
  const rows = (await c.query(`UPDATE pro_orders SET status='VOID', note=coalesce(note,'') || $2 WHERE org_id=$1 AND status='PENDING' RETURNING invoice_id`, [orgId, note])).rows;
  for (const r of rows) if (r.invoice_id) await c.query(`UPDATE invoices SET status='EXPIRED' WHERE id=$1 AND status='PENDING'`, [r.invoice_id]);
}

async function createOrder(
  c: Client,
  o: { org: OrgInfo; kind: 'NEW' | 'RENEWAL' | 'UPGRADE'; plan: ProPlan; cycle: BillingCycle; credit?: number; payerUserId: string; dueAt: Date },
) {
  const q = quote(o.plan, o.cycle, num, o.credit ?? 0);
  if (q.total <= 0) throw unprocessable('Harga paket belum diatur — hubungi tim RAVE');
  const id = uuidv7();
  const kindLabel = { NEW: 'Langganan', RENEWAL: 'Perpanjangan', UPGRADE: 'Upgrade' }[o.kind];
  const inv = await createInvoice(c, {
    purpose: 'SUBSCRIPTION',
    referenceId: `pro:${id}`,
    escrowAmount: 0,
    feeAmount: q.total,
    payerUserId: o.payerUserId,
    payerOrgId: o.org.id,
    description: `${kindLabel} RAVE Pro ${PLAN_LABEL[o.plan]} (${o.cycle === 'YEARLY' ? 'tahunan' : 'bulanan'}) — ${o.org.name}`,
    dueAt: o.dueAt,
    metadata: { product: PRO_PRODUCT, order_id: id, org_id: o.org.id, plan: o.plan, cycle: o.cycle, subtotal: q.subtotal, credit: q.credit, ppn: q.ppn, ppn_pct: q.ppn_pct },
  });
  const order = (
    await c.query(
      `INSERT INTO pro_orders (id, org_id, kind, plan, cycle, subtotal, credit, ppn_pct, ppn, total, invoice_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [id, o.org.id, o.kind, o.plan, o.cycle, q.subtotal, q.credit, q.ppn_pct, q.ppn, q.total, inv.id, o.payerUserId],
    )
  ).rows[0];
  return { order, inv };
}

/**
 * Invoice SUBSCRIPTION RAVE Pro lunas (dipanggil dalam transaksi processPgEvent, setelah jurnal & status PAID).
 * NEW → periode baru mulai sekarang; UPGRADE → paket baru, periode baru mulai sekarang (sisa periode lama sudah dikreditkan);
 * RENEWAL → periode diperpanjang dari akhir periode berjalan (bukan dari tanggal bayar), masa tenggang dihapus.
 */
export async function applyPaidProOrder(c: Client, inv: any) {
  const order = (await c.query(`SELECT * FROM pro_orders WHERE invoice_id=$1 FOR UPDATE`, [inv.id])).rows[0];
  if (!order || order.status === 'PAID') return;
  const now = new Date();
  const sub = await loadSub(c, order.org_id, true);
  const meta = inv.metadata ?? {};
  let start = now;
  if (order.kind === 'RENEWAL' && sub && isEntitled(sub, now)) start = new Date(Math.max(now.getTime(), new Date(sub.current_period_end).getTime()));
  const end = cycleEnd(start, order.cycle);
  const org = { type: sub?.org_type ?? meta.org_type ?? 'PROMOTOR', name: sub?.org_name ?? meta.org_name ?? 'Organisasi' };
  if (!sub) {
    const info = await orgInfo(order.org_id).catch(() => null);
    if (info) Object.assign(org, { type: info.type, name: info.name });
  }
  const row = (
    await c.query(
      `INSERT INTO pro_subscriptions (org_id, org_type, org_name, plan, cycle, status, source, current_period_start, current_period_end, grace_until, auto_renew, paid_subtotal, started_at)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE','PAID',$6,$7,NULL,true,$8,$6)
       ON CONFLICT (org_id) DO UPDATE SET plan=EXCLUDED.plan, cycle=EXCLUDED.cycle, status='ACTIVE', source='PAID',
         current_period_start=EXCLUDED.current_period_start, current_period_end=EXCLUDED.current_period_end, grace_until=NULL,
         auto_renew=true, next_plan=NULL, next_cycle=NULL, paid_subtotal=EXCLUDED.paid_subtotal, cancelled_at=NULL, cancel_reason=NULL,
         started_at=CASE WHEN pro_subscriptions.status IN ('EXPIRED','CANCELLED') THEN EXCLUDED.started_at ELSE pro_subscriptions.started_at END,
         updated_at=now()
       RETURNING *`,
      [order.org_id, org.type, org.name, order.plan, order.cycle, start, end, Number(order.subtotal)],
    )
  ).rows[0];
  await c.query(`UPDATE pro_orders SET status='PAID', paid_at=now(), period_start=$2, period_end=$3 WHERE id=$1`, [order.id, start, end]);
  const reason: Reason = order.kind === 'RENEWAL' ? 'RENEWED' : order.kind === 'UPGRADE' ? 'UPGRADED' : 'ACTIVATED';
  await publishChange(c, row, reason);
}

/**
 * Pembayaran untuk pesanan RAVE Pro yang sudah tidak berlaku (A1 audit pra-penjualan): halaman bayar Midtrans yang masih
 * terbuka tetap bisa dilunasi setelah pesanan dibatalkan/diganti, atau dibayar dua kali. Aturan:
 * - pesanan PENDING → diterapkan seperti biasa;
 * - pesanan EXPIRED (batas bayar checkout lewat) DAN org belum punya hak Pro DAN tidak ada pesanan lain menunggu
 *   → tetap diaktifkan (niat pelanggan jelas, tidak ada keadaan yang tertimpa);
 * - selain itu (VOID karena diganti checkout/komplimen/pencabutan, sudah lunas, atau org sudah berubah keadaan)
 *   → TIDAK mengubah langganan; dana dikembalikan penuh ke pembayar.
 */
export async function proPaymentDecision(c: Client, inv: any): Promise<{ apply: true } | { apply: false; reason: string }> {
  const order = (await c.query(`SELECT * FROM pro_orders WHERE invoice_id=$1 FOR UPDATE`, [inv.id])).rows[0];
  if (!order) return { apply: false, reason: 'Pesanan RAVE Pro tidak ditemukan' };
  if (order.status === 'PENDING') return { apply: true };
  if (order.status === 'PAID') return { apply: false, reason: 'Pembayaran ganda untuk tagihan RAVE Pro yang sudah lunas' };
  if (order.status === 'EXPIRED' && order.kind !== 'RENEWAL') {
    const sub = await loadSub(c, order.org_id, true);
    const other = (await c.query(`SELECT 1 FROM pro_orders WHERE org_id=$1 AND status='PENDING' AND id<>$2`, [order.org_id, order.id])).rowCount;
    if (!isEntitled(sub) && !other) {
      await c.query(`UPDATE pro_orders SET status='PENDING', note=coalesce(note,'') || ' · dibayar setelah batas waktu, tetap diaktifkan' WHERE id=$1`, [order.id]);
      return { apply: true };
    }
  }
  return { apply: false, reason: order.status === 'VOID' ? 'Tagihan RAVE Pro sudah dibatalkan/diganti saat dibayar' : 'Tagihan RAVE Pro sudah kedaluwarsa saat dibayar' };
}

/** Jurnal invoice RAVE Pro: kas masuk = pendapatan langganan (DPP) + utang PPN keluaran. */
export function proRevenueLines(inv: any): { account: string; amount: number }[] {
  const ppn = Math.max(0, Math.min(Number(inv.metadata?.ppn ?? 0), Number(inv.amount)));
  const out = [{ account: 'revenue:subscription:pro', amount: Number(inv.amount) - ppn }];
  if (ppn) out.push({ account: 'liability:tax:ppn_out', amount: ppn });
  return out;
}

function assertManager(u: AuthUser, orgId: string) {
  if (!orgMembership(u, orgId, ['OWNER', 'ADMIN'])) throw forbidden('Hanya OWNER/ADMIN organisasi yang dapat mengelola langganan RAVE Pro');
}
function assertMember(u: AuthUser, orgId: string) {
  if (!orgMembership(u, orgId)) throw forbidden('Bukan anggota organisasi ini');
}

async function orgState(db: Db, orgId: string) {
  const sub = await db.one(`SELECT * FROM pro_subscriptions WHERE org_id=$1`, [orgId]);
  const orders = await db.query(
    `SELECT o.*, row_to_json(i) AS inv FROM pro_orders o LEFT JOIN invoices i ON i.id = o.invoice_id WHERE o.org_id=$1 ORDER BY o.created_at DESC LIMIT 24`,
    [orgId],
  );
  const pending = orders.find((o) => o.status === 'PENDING');
  return {
    subscription: subView(sub),
    pending_order: pending ? orderView(pending, pending.inv) : null,
    orders: orders.map((o) => orderView(o, o.inv)),
  };
}

export async function proRoutes(app: FastifyInstance, { db }: ServiceContext) {
  // Katalog paket (publik: halaman harga & landing B2B).
  app.get('/v1/pro/plans', async (req) => {
    const { org_type } = z.object({ org_type: z.string().max(20).optional() }).parse(req.query ?? {});
    return planCatalog(org_type);
  });

  await app.register(async (s) => {
    s.addHook('preHandler', requireAuth);

    // Status langganan organisasi + pesanan menunggu + riwayat tagihan.
    s.get('/v1/pro/orgs/:orgId', async (req) => {
      const { orgId } = req.params as { orgId: string };
      if (!isUuid(orgId)) throw notFound('Organisasi');
      assertMember(req.user!, orgId);
      const claim = orgMembership(req.user!, orgId)!;
      return { org_id: orgId, eligible: isProEligible(claim.type), can_manage: !!orgMembership(req.user!, orgId, ['OWNER', 'ADMIN']), ...(await orgState(db, orgId)), catalog: planCatalog(claim.type) };
    });

    // Pratinjau harga (termasuk kredit prorata upgrade) sebelum checkout.
    s.post('/v1/pro/orgs/:orgId/quote', async (req) => {
      const { orgId } = req.params as { orgId: string };
      const b = z.object({ plan: z.enum(PRO_PLANS), cycle: z.enum(BILLING_CYCLES) }).parse(req.body);
      assertMember(req.user!, orgId);
      const sub = await db.one(`SELECT * FROM pro_subscriptions WHERE org_id=$1`, [orgId]);
      return { ...quote(b.plan, b.cycle, num, upgradeCredit(sub, b.plan, b.cycle)), mode: changeMode(sub, b.plan, b.cycle) };
    });

    // Checkout: langganan baru / upgrade (prorata) → invoice; downgrade & ganti siklus dijadwalkan ke perpanjangan berikutnya.
    s.post('/v1/pro/orgs/:orgId/checkout', async (req, reply) => {
      const { orgId } = req.params as { orgId: string };
      if (!isUuid(orgId)) throw notFound('Organisasi');
      const b = z.object({ plan: z.enum(PRO_PLANS), cycle: z.enum(BILLING_CYCLES) }).parse(req.body);
      const u = req.user!;
      assertManager(u, orgId);
      if (!settings.bool(PRO_SETTING.enabled)) throw conflict('Penjualan RAVE Pro sedang ditutup sementara');
      const org = await orgInfo(orgId);
      if (!isProEligible(org.type)) throw unprocessable('Jenis organisasi ini tidak dapat berlangganan RAVE Pro');
      if (!plansFor(org.type).includes(b.plan)) throw unprocessable(`Paket ${PLAN_LABEL[b.plan]} tidak tersedia untuk organisasi ${org.type}`);
      const r = await serial(db, async (c) => {
        await c.query(`SELECT pg_advisory_xact_lock(hashtext('pro'), hashtext($1))`, [orgId]);
        const sub = await loadSub(c, orgId, true);
        const mode = changeMode(sub, b.plan, b.cycle);
        if (mode === 'CURRENT') throw conflict('Paket ini sudah aktif untuk organisasi Anda');
        if (mode === 'SCHEDULE') {
          const up = (await c.query(`UPDATE pro_subscriptions SET next_plan=$2, next_cycle=$3, updated_at=now() WHERE org_id=$1 RETURNING *`, [orgId, b.plan, b.cycle])).rows[0];
          await voidPending(c, orgId, ' · diganti jadwal perubahan paket');
          await publishChange(c, up, 'PLAN_SCHEDULED');
          return { scheduled: true as const };
        }
        // Pesanan menunggu dengan paket & siklus sama dipakai ulang (idempoten untuk klik ganda / kembali dari halaman bayar).
        const pend = (await c.query(`SELECT o.*, row_to_json(i) AS inv FROM pro_orders o LEFT JOIN invoices i ON i.id=o.invoice_id WHERE o.org_id=$1 AND o.status='PENDING'`, [orgId])).rows[0];
        if (pend && pend.plan === b.plan && pend.cycle === b.cycle && pend.kind !== 'RENEWAL' && pend.inv?.status === 'PENDING' && new Date(pend.inv.due_at).getTime() > Date.now())
          return { scheduled: false as const, order: pend, inv: pend.inv, created: false };
        await voidPending(c, orgId, ' · diganti checkout baru');
        const kind = mode === 'UPGRADE' ? 'UPGRADE' : 'NEW';
        const credit = mode === 'UPGRADE' ? upgradeCredit(sub, b.plan, b.cycle) : 0;
        const due = new Date(Date.now() + num(PRO_SETTING.checkoutHours) * 3600_000);
        const { order, inv } = await createOrder(c, { org, kind, plan: b.plan, cycle: b.cycle, credit, payerUserId: u.sub, dueAt: due });
        return { scheduled: false as const, order, inv, created: true };
      });
      if (r.scheduled) return { scheduled: true, ...(await orgState(db, orgId)) };
      reply.status(r.created ? 201 : 200);
      return { scheduled: false, order: orderView(r.order, r.inv), invoice: invoiceView(r.inv) };
    });

    // Berhenti berlangganan: tetap aktif sampai akhir periode, tanpa perpanjangan otomatis (pembatalan mandiri, REQ-PAY-03).
    s.post('/v1/pro/orgs/:orgId/cancel', async (req) => {
      const { orgId } = req.params as { orgId: string };
      const b = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {});
      assertManager(req.user!, orgId);
      await serial(db, async (c) => {
        const sub = await loadSub(c, orgId, true);
        if (!sub || !isEntitled(sub)) throw conflict('Tidak ada langganan RAVE Pro yang aktif');
        if (sub.source !== 'PAID') throw conflict('Paket komplimen dikelola tim RAVE');
        if (sub.status === 'PAST_DUE') {
          // Dalam masa tenggang: berhenti = berakhir sekarang (tidak ada periode berbayar tersisa).
          const up = (await c.query(`UPDATE pro_subscriptions SET status='CANCELLED', auto_renew=false, grace_until=NULL, cancelled_at=now(), cancel_reason=$2, updated_at=now() WHERE org_id=$1 RETURNING *`, [orgId, b.reason ?? null])).rows[0];
          await voidPending(c, orgId, ' · langganan dihentikan');
          await publishChange(c, up, 'EXPIRED');
          return;
        }
        const up = (await c.query(`UPDATE pro_subscriptions SET auto_renew=false, next_plan=NULL, next_cycle=NULL, cancelled_at=now(), cancel_reason=$2, updated_at=now() WHERE org_id=$1 RETURNING *`, [orgId, b.reason ?? null])).rows[0];
        await voidPending(c, orgId, ' · langganan dihentikan');
        await publishChange(c, up, 'CANCEL_SCHEDULED');
      });
      return orgState(db, orgId);
    });

    s.post('/v1/pro/orgs/:orgId/resume', async (req) => {
      const { orgId } = req.params as { orgId: string };
      assertManager(req.user!, orgId);
      await serial(db, async (c) => {
        const sub = await loadSub(c, orgId, true);
        if (!sub || sub.status !== 'ACTIVE' || !isEntitled(sub)) throw conflict('Langganan sudah berakhir — silakan berlangganan kembali');
        if (sub.auto_renew) return;
        const up = (await c.query(`UPDATE pro_subscriptions SET auto_renew=true, cancelled_at=NULL, cancel_reason=NULL, updated_at=now() WHERE org_id=$1 RETURNING *`, [orgId])).rows[0];
        await publishChange(c, up, 'RESUMED');
      });
      return orgState(db, orgId);
    });

    // Batalkan perubahan paket terjadwal.
    s.delete('/v1/pro/orgs/:orgId/scheduled-change', async (req) => {
      const { orgId } = req.params as { orgId: string };
      assertManager(req.user!, orgId);
      await db.query(`UPDATE pro_subscriptions SET next_plan=NULL, next_cycle=NULL, updated_at=now() WHERE org_id=$1`, [orgId]);
      return orgState(db, orgId);
    });
  });

  // ---------- Back Office ----------
  app.get('/v1/admin/pro/subscriptions', { preHandler: [requireAuth, requirePermission(['finance.view', 'billing.manage'])] }, async (req) => {
    const q = z.object({ status: z.enum(['ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED', 'ALL']).default('ALL'), q: z.string().max(80).optional() }).parse(req.query ?? {});
    const rows = await db.query(
      `SELECT s.*, (SELECT count(*) FROM pro_orders o WHERE o.org_id=s.org_id AND o.status='PAID')::int AS paid_orders,
              (SELECT coalesce(sum(total),0) FROM pro_orders o WHERE o.org_id=s.org_id AND o.status='PAID')::bigint AS lifetime_value
         FROM pro_subscriptions s
        WHERE ($1 = 'ALL' OR s.status = $1) AND ($2::text IS NULL OR s.org_name ILIKE '%' || $2 || '%')
        ORDER BY (s.status IN ('ACTIVE','PAST_DUE')) DESC, s.current_period_end ASC LIMIT 300`,
      [q.status, q.q?.trim() || null],
    );
    return { summary: await adminSummary(db), data: rows.map((r) => ({ ...subView(r), paid_orders: r.paid_orders, lifetime_value: Number(r.lifetime_value), paid_subtotal: Number(r.paid_subtotal), cancel_reason: r.cancel_reason })) };
  });

  app.get('/v1/admin/pro/orgs/:orgId', { preHandler: [requireAuth, requirePermission(['finance.view', 'billing.manage'])] }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    if (!isUuid(orgId)) throw notFound('Organisasi');
    return { org_id: orgId, ...(await orgState(db, orgId)) };
  });

  // Paket komplimen (mitra, kompensasi, uji coba B2B) — tanpa tagihan, tidak diperpanjang otomatis, teraudit lewat catatan.
  app.post('/v1/admin/pro/orgs/:orgId/grant', { preHandler: [requireAuth, requirePermission('billing.manage')] }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    if (!isUuid(orgId)) throw notFound('Organisasi');
    const b = z.object({ plan: z.enum(PRO_PLANS), months: z.number().int().min(1).max(24), reason: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(500) }).parse(req.body);
    const org = await orgInfo(orgId);
    if (!isProEligible(org.type)) throw unprocessable('Jenis organisasi ini tidak dapat berlangganan RAVE Pro');
    await serial(db, async (c) => {
      const sub = await loadSub(c, orgId, true);
      if (sub && isEntitled(sub) && sub.source === 'PAID') throw conflict('Organisasi ini sudah berlangganan berbayar — paket komplimen tidak menimpa langganan berbayar');
      const now = new Date();
      const end = new Date(now);
      end.setUTCMonth(end.getUTCMonth() + b.months);
      const row = (
        await c.query(
          `INSERT INTO pro_subscriptions (org_id, org_type, org_name, plan, cycle, status, source, current_period_start, current_period_end, auto_renew, paid_subtotal)
           VALUES ($1,$2,$3,$4,'MONTHLY','ACTIVE','COMPLIMENTARY',$5,$6,false,0)
           ON CONFLICT (org_id) DO UPDATE SET org_type=EXCLUDED.org_type, org_name=EXCLUDED.org_name, plan=EXCLUDED.plan, cycle='MONTHLY', status='ACTIVE',
             source='COMPLIMENTARY', current_period_start=EXCLUDED.current_period_start, current_period_end=EXCLUDED.current_period_end, grace_until=NULL,
             auto_renew=false, next_plan=NULL, next_cycle=NULL, paid_subtotal=0, cancelled_at=NULL, cancel_reason=NULL, updated_at=now()
           RETURNING *`,
          [orgId, org.type, org.name, b.plan, now, end],
        )
      ).rows[0];
      await voidPending(c, orgId, ' · diganti paket komplimen');
      await c.query(
        `INSERT INTO pro_orders (id, org_id, kind, plan, cycle, status, subtotal, total, period_start, period_end, created_by, note, paid_at)
         VALUES ($1,$2,'COMPLIMENTARY',$3,'MONTHLY','PAID',0,0,$4,$5,$6,$7,now())`,
        [uuidv7(), orgId, b.plan, now, end, req.user!.sub, `Komplimen ${b.months} bln: ${b.reason}`],
      );
      await publishChange(c, row, 'COMPLIMENTARY');
    });
    return { org_id: orgId, ...(await orgState(db, orgId)) };
  });

  app.post('/v1/admin/pro/orgs/:orgId/revoke', { preHandler: [requireAuth, requirePermission('billing.manage')] }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const b = z.object({ reason: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(500) }).parse(req.body);
    await serial(db, async (c) => {
      const sub = await loadSub(c, orgId, true);
      if (!sub || !isEntitled(sub)) throw conflict('Tidak ada langganan aktif untuk dicabut');
      const row = (await c.query(`UPDATE pro_subscriptions SET status='CANCELLED', auto_renew=false, grace_until=NULL, cancelled_at=now(), cancel_reason=$2, updated_at=now() WHERE org_id=$1 RETURNING *`, [orgId, `Dicabut admin: ${b.reason}`])).rows[0];
      await voidPending(c, orgId, ' · langganan dicabut admin');
      await publishChange(c, row, 'REVOKED');
    });
    return { org_id: orgId, ...(await orgState(db, orgId)) };
  });

  // Laporan layanan (Super Admin → Pengaturan Layanan → RAVE Pro → Laporan).
  app.get('/v1/admin/reports/pro', { preHandler: requireSuperAdmin }, async (): Promise<ServiceReport> => {
    const k = await adminSummary(db);
    const series = await db.query(
      `SELECT to_char((paid_at AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD') AS date, sum(total - ppn)::bigint AS value
         FROM pro_orders WHERE status='PAID' AND paid_at >= now() - interval '14 days' GROUP BY 1`,
    );
    const { fillDaily } = await import('@rave/domain/reports');
    const rows = await db.query(`SELECT org_name, org_type, plan, cycle, status, source, current_period_end FROM pro_subscriptions ORDER BY updated_at DESC LIMIT 50`);
    return {
      kpis: [
        { label: L('MRR (tanpa PPN)', 'MRR (excl. VAT)'), value: k.mrr, format: 'idr', tone: 'good' },
        { label: L('Organisasi Pro aktif', 'Active Pro organizations'), value: k.active, format: 'num' },
        { label: L('Masa tenggang', 'In grace period'), value: k.past_due, format: 'num', tone: k.past_due ? 'warn' : 'neutral' },
        { label: L('Berakhir ≤ 14 hari', 'Ending ≤ 14 days'), value: k.ending_soon, format: 'num', tone: k.ending_soon ? 'warn' : 'neutral' },
        { label: L('Churn 30 hari', 'Churn 30 days'), value: k.churn_30d, format: 'num', tone: k.churn_30d ? 'bad' : 'neutral' },
      ],
      series: { label: L('Pendapatan RAVE Pro per hari', 'RAVE Pro revenue per day'), format: 'idr', points: fillDaily(series) },
      table: {
        title: L('Langganan RAVE Pro', 'RAVE Pro subscriptions'),
        columns: [
          { key: 'org_name', label: L('Organisasi', 'Organization') },
          { key: 'org_type', label: L('Jenis', 'Type'), format: 'status' },
          { key: 'plan', label: L('Paket', 'Plan'), format: 'status' },
          { key: 'cycle', label: L('Siklus', 'Cycle'), format: 'status' },
          { key: 'status', label: L('Status', 'Status'), format: 'status' },
          { key: 'source', label: L('Sumber', 'Source'), format: 'status' },
          { key: 'current_period_end', label: L('Periode berakhir', 'Period ends'), format: 'date' },
        ],
        rows,
        empty: L('Belum ada organisasi berlangganan', 'No subscribed organizations yet'),
        link: { label: L('Kelola langganan', 'Manage subscriptions'), href: '/admin/pro' },
      },
      generated_at: new Date().toISOString(),
    };
  });
}

/** Mode perubahan dari langganan berjalan ke (plan, cycle) yang dipilih. */
export function changeMode(sub: any, plan: ProPlan, cycle: BillingCycle): 'NEW' | 'UPGRADE' | 'SCHEDULE' | 'CURRENT' {
  if (!sub || !isEntitled(sub) || sub.status === 'PAST_DUE') return 'NEW';
  if (sub.source === 'COMPLIMENTARY') return 'NEW';
  if (sub.plan === plan && sub.cycle === cycle) return 'CURRENT';
  const up = PLAN_RANK[plan] > PLAN_RANK[sub.plan as ProPlan] || (plan === sub.plan && cycle === 'YEARLY' && sub.cycle === 'MONTHLY');
  return up ? 'UPGRADE' : 'SCHEDULE';
}

function upgradeCredit(sub: any, plan: ProPlan, cycle: BillingCycle): number {
  if (changeMode(sub, plan, cycle) !== 'UPGRADE') return 0;
  return prorationCredit(Number(sub.paid_subtotal), new Date(sub.current_period_start), new Date(sub.current_period_end), new Date());
}

async function adminSummary(db: Db) {
  const k = await db.one(
    `SELECT count(*) FILTER (WHERE status IN ('ACTIVE','PAST_DUE'))::int AS active,
            count(*) FILTER (WHERE status='PAST_DUE')::int AS past_due,
            count(*) FILTER (WHERE status='ACTIVE' AND source='COMPLIMENTARY')::int AS complimentary,
            count(*) FILTER (WHERE status='ACTIVE' AND current_period_end < now() + interval '14 days')::int AS ending_soon,
            count(*) FILTER (WHERE status IN ('EXPIRED','CANCELLED') AND updated_at > now() - interval '30 days')::int AS churn_30d,
            coalesce(sum(CASE WHEN status IN ('ACTIVE','PAST_DUE') AND source='PAID' THEN CASE WHEN cycle='YEARLY' THEN paid_subtotal / 12 ELSE paid_subtotal END END), 0)::bigint AS mrr
       FROM pro_subscriptions`,
  );
  const byPlan = await db.query(`SELECT plan, count(*)::int AS n FROM pro_subscriptions WHERE status IN ('ACTIVE','PAST_DUE') GROUP BY plan`);
  const rev = await db.one(`SELECT coalesce(sum(total - ppn),0)::bigint AS revenue_30d FROM pro_orders WHERE status='PAID' AND paid_at > now() - interval '30 days'`);
  return {
    active: k?.active ?? 0,
    past_due: k?.past_due ?? 0,
    complimentary: k?.complimentary ?? 0,
    ending_soon: k?.ending_soon ?? 0,
    churn_30d: k?.churn_30d ?? 0,
    mrr: Number(k?.mrr ?? 0),
    revenue_30d: Number(rev?.revenue_30d ?? 0),
    by_plan: Object.fromEntries(PRO_PLANS.map((p) => [p, byPlan.find((r) => r.plan === p)?.n ?? 0])),
  };
}

/**
 * Siklus hidup (idempoten, tiap menit): terbitkan tagihan perpanjangan N hari sebelum periode berakhir, masuk masa tenggang
 * bila belum dibayar saat periode berakhir, berakhir setelah masa tenggang; checkout yang tidak dibayar kedaluwarsa.
 */
export const proLifecycleJob: Job = {
  name: 'pro-lifecycle',
  everyMs: 60_000,
  async run({ db, log }) {
    // Pesanan checkout/upgrade yang melewati batas bayar.
    await db.query(
      `WITH x AS (UPDATE pro_orders o SET status='EXPIRED' FROM invoices i
                   WHERE i.id=o.invoice_id AND o.status='PENDING' AND o.kind <> 'RENEWAL' AND i.due_at < now() RETURNING o.invoice_id)
       UPDATE invoices SET status='EXPIRED' WHERE id IN (SELECT invoice_id FROM x) AND status='PENDING'`,
    );
    const subs = await db.query(
      `SELECT s.org_id FROM pro_subscriptions s
        WHERE s.status IN ('ACTIVE','PAST_DUE')
          AND (s.current_period_end <= now() + make_interval(days => $1) OR s.status='PAST_DUE') LIMIT 200`,
      [num(PRO_SETTING.renewalLeadDays)],
    );
    for (const { org_id } of subs) {
      await serial(db, (c) => stepSubscription(c, org_id)).catch((e) => log.error({ err: e?.message, org_id }, 'siklus RAVE Pro gagal'));
    }
  },
};

export async function stepSubscription(c: Client, orgId: string, now = new Date()) {
  const s = await loadSub(c, orgId, true);
  if (!s) return 'NONE';
  const open = (await c.query(`SELECT o.*, i.status AS inv_status FROM pro_orders o LEFT JOIN invoices i ON i.id=o.invoice_id WHERE o.org_id=$1 AND o.status='PENDING' AND o.kind='RENEWAL'`, [orgId])).rows[0];
  const action = lifecycleAction(
    {
      status: s.status,
      source: s.source,
      auto_renew: s.auto_renew,
      current_period_end: new Date(s.current_period_end),
      grace_until: s.grace_until ? new Date(s.grace_until) : null,
      has_open_renewal: !!open,
    },
    now,
    { renewalLeadDays: num(PRO_SETTING.renewalLeadDays) },
  );
  if (action === 'ISSUE_RENEWAL') {
    const plan = (s.next_plan ?? s.plan) as ProPlan;
    const cycle = (s.next_cycle ?? s.cycle) as BillingCycle;
    const end = new Date(s.current_period_end);
    const due = new Date(Math.max(end.getTime(), now.getTime()) + num(PRO_SETTING.graceDays) * DAY);
    const payer = (await c.query(`SELECT created_by FROM pro_orders WHERE org_id=$1 AND created_by IS NOT NULL ORDER BY created_at DESC LIMIT 1`, [orgId])).rows[0]?.created_by;
    if (!payer) return 'NONE';
    await voidPending(c, orgId, ' · diganti tagihan perpanjangan');
    const { inv } = await createOrder(c, { org: { id: orgId, type: s.org_type, name: s.org_name }, kind: 'RENEWAL', plan, cycle, payerUserId: payer, dueAt: due });
    await publish(c, 'finance.pro.renewal_due', orgId, { orgId, plan, invoiceId: inv.id, amount: Number(inv.amount), dueAt: due.toISOString(), periodEnd: end.toISOString() });
  } else if (action === 'START_GRACE') {
    const grace = new Date(new Date(s.current_period_end).getTime() + num(PRO_SETTING.graceDays) * DAY);
    const up = (await c.query(`UPDATE pro_subscriptions SET status='PAST_DUE', grace_until=$2, updated_at=now() WHERE org_id=$1 RETURNING *`, [orgId, grace])).rows[0];
    await publishChange(c, up, num(PRO_SETTING.graceDays) > 0 ? 'GRACE' : 'EXPIRED');
    if (num(PRO_SETTING.graceDays) <= 0) return stepSubscription(c, orgId, now);
  } else if (action === 'EXPIRE') {
    const up = (await c.query(`UPDATE pro_subscriptions SET status='EXPIRED', grace_until=NULL, updated_at=now() WHERE org_id=$1 RETURNING *`, [orgId])).rows[0];
    if (open) await voidPending(c, orgId, ' · langganan berakhir');
    await publishChange(c, up, 'EXPIRED');
  }
  return action;
}

