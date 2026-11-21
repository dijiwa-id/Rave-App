// Insight Pro — analitik lanjutan off-air untuk organisasi RAVE Pro (BRD §4.1 "analitik lanjutan, multi-roster").
// Sumber: data booking milik service ini (inquiry → negosiasi → kontrak → pencairan). Hak akses: anggota org + langganan aktif.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PLAN_LABEL, PRO_FEATURES, pct, type ProPlan } from '@rave/domain';
import { HttpError, forbidden, notFound, orgMembership, requireAuth, settings, type AuthUser, type Db, type ServiceContext } from '@rave/service-kit';

const WON = ['SIGNED', 'BOOKED', 'BOOKED_AND_SECURED', 'AT_RISK', 'SHOW_DAY', 'COMPLETED', 'SETTLED', 'DISPUTED'];
const LOST = ['DECLINED', 'EXPIRED', 'CANCELLED_BY_PROMOTOR', 'CANCELLED_BY_ARTIST', 'FORCE_MAJEURE'];
const OPEN = ['INQUIRY', 'NEGOTIATING', 'AGREED', 'CONTRACT_SENT'];
const sqlList = (xs: string[]) => xs.map((x) => `'${x}'`).join(',');

export const proRequired = (detail: string) => new HttpError(402, 'Payment Required', detail, { code: 'PRO_REQUIRED' });

interface Scope {
  org: { id: string; type: string; name: string; pro_plan: ProPlan | null };
  side: 'promotor' | 'artist';
  /** Kondisi SQL atas alias `b` (parameter $1 = org id). */
  where: string;
}

async function scopeFor(db: Db, u: AuthUser, orgId: string): Promise<Scope> {
  if (!orgMembership(u, orgId)) throw forbidden('Bukan anggota organisasi ini');
  const org = await db.one(
    `SELECT id, type, name, CASE WHEN pro_plan IS NOT NULL AND (pro_until IS NULL OR pro_until > now()) THEN pro_plan END AS pro_plan FROM orgs WHERE id=$1`,
    [orgId],
  );
  if (!org) throw notFound('Organisasi');
  if (org.type === 'PROMOTOR' || org.type === 'VENUE') return { org, side: 'promotor', where: `b.promotor_org_id = $1` };
  if (org.type === 'ARTIST') return { org, side: 'artist', where: `(b.artist_org_id = $1 OR b.artist_id IN (SELECT id FROM artists WHERE org_id = $1))` };
  if (org.type === 'MANAGEMENT' || org.type === 'LABEL')
    return { org, side: 'artist', where: `b.artist_id IN (SELECT artist_id FROM fee_splits WHERE party_id = $1 UNION SELECT id FROM artists WHERE org_id = $1)` };
  throw forbidden('Insight Pro tersedia untuk promotor, venue, artis, manajemen & label');
}

function assertPro(s: Scope) {
  if (!s.org.pro_plan) throw proRequired('Insight Pro tersedia untuk organisasi berlangganan RAVE Pro');
  return PRO_FEATURES[s.org.pro_plan];
}

const daysQ = z.object({ org_id: z.string().uuid(), days: z.coerce.number().int().min(7).max(730).default(90) });

export async function proRoutes(app: FastifyInstance, { db }: ServiceContext) {
  app.register(async (s) => {
    s.addHook('preHandler', requireAuth);

    s.get('/v1/booking/pro/insights', async (req) => {
      const q = daysQ.parse(req.query);
      const scope = await scopeFor(db, req.user!, q.org_id);
      const f = assertPro(scope);
      const days = Math.min(q.days, f.insightsMaxDays);
      const W = `${scope.where} AND b.status <> 'DRAFT' AND b.created_at >= now() - make_interval(days => $2)`;
      const p = [q.org_id, days];

      const k = await db.one(
        `SELECT count(*)::int AS inquiries,
                count(*) FILTER (WHERE b.status IN (${sqlList(WON)}))::int AS won,
                count(*) FILTER (WHERE b.status IN (${sqlList(LOST)}))::int AS lost,
                count(*) FILTER (WHERE b.status IN (${sqlList(OPEN)}))::int AS open,
                count(*) FILTER (WHERE b.status IN ('CANCELLED_BY_PROMOTOR','CANCELLED_BY_ARTIST'))::int AS cancelled,
                count(*) FILTER (WHERE b.status = 'DISPUTED' OR EXISTS (SELECT 1 FROM disputes d WHERE d.booking_id = b.id))::int AS disputed,
                coalesce(sum(b.agreed_fee) FILTER (WHERE b.status IN (${sqlList(WON)})), 0)::bigint AS gmv,
                coalesce(avg(b.agreed_fee) FILTER (WHERE b.status IN (${sqlList(WON)})), 0)::bigint AS avg_fee,
                coalesce(sum(coalesce(b.latest_fee, b.budget)) FILTER (WHERE b.status IN (${sqlList(OPEN)})), 0)::bigint AS pipeline,
                coalesce(avg(b.budget), 0)::bigint AS avg_budget
           FROM bookings b WHERE ${W}`,
        p,
      );
      // Waktu inquiry → kontrak ditandatangani (median, hari).
      const speed = await db.one(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM e.created_at - b.created_at) / 86400)::float AS median_days_to_sign
           FROM bookings b JOIN LATERAL (SELECT created_at FROM booking_events WHERE booking_id=b.id AND to_status='SIGNED' ORDER BY id LIMIT 1) e ON true
          WHERE ${W}`,
        p,
      );
      // Penghematan take rate dari RAVE Pro pada booking yang tarifnya dikunci Pro.
      const std = side(scope) === 'promotor' ? settings.num('commission.promotor_service_fee_pct') : settings.num('commission.artist_commission_pct');
      const lockedCol = side(scope) === 'promotor' ? 'commission_promotor_pct' : 'commission_artist_pct';
      const proFlag = side(scope) === 'promotor' ? `(b.commission_pro->>'promotor')::boolean` : `(b.commission_pro->>'artist')::boolean`;
      const savedRows = await db.query(
        `SELECT b.agreed_fee, b.${lockedCol} AS pct FROM bookings b WHERE ${W} AND b.status IN (${sqlList(WON)}) AND coalesce(${proFlag}, false) AND b.agreed_fee IS NOT NULL`,
        p,
      );
      const saved = savedRows.reduce((a, r) => a + Math.max(0, pct(Number(r.agreed_fee), std) - pct(Number(r.agreed_fee), Number(r.pct))), 0);

      // Deret bulanan lengkap sepanjang rentang (bulan tanpa booking = 0) agar tren terbaca sebagai garis.
      const monthly = await db.query(
        `WITH m AS (
           SELECT to_char(g, 'YYYY-MM') AS month FROM generate_series(
             date_trunc('month', (now() - make_interval(days => $2)) AT TIME ZONE 'Asia/Jakarta'),
             date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta'), interval '1 month') g),
         x AS (
           SELECT to_char(date_trunc('month', b.created_at AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM') AS month,
                  count(*)::int AS inquiries, count(*) FILTER (WHERE b.status IN (${sqlList(WON)}))::int AS won,
                  coalesce(sum(b.agreed_fee) FILTER (WHERE b.status IN (${sqlList(WON)})), 0)::bigint AS gmv
             FROM bookings b WHERE ${W} GROUP BY 1)
         SELECT m.month, coalesce(x.inquiries, 0)::int AS inquiries, coalesce(x.won, 0)::int AS won, coalesce(x.gmv, 0)::bigint AS gmv
           FROM m LEFT JOIN x USING (month) ORDER BY m.month`,
        p,
      );
      const byCity = await db.query(
        `SELECT b.city, count(*)::int AS inquiries, count(*) FILTER (WHERE b.status IN (${sqlList(WON)}))::int AS won,
                coalesce(sum(b.agreed_fee) FILTER (WHERE b.status IN (${sqlList(WON)})), 0)::bigint AS gmv
           FROM bookings b WHERE ${W} GROUP BY 1 ORDER BY 2 DESC, 4 DESC LIMIT 10`,
        p,
      );
      const byCategory = await db.query(
        `SELECT b.category, count(*)::int AS inquiries, count(*) FILTER (WHERE b.status IN (${sqlList(WON)}))::int AS won,
                coalesce(avg(b.agreed_fee) FILTER (WHERE b.status IN (${sqlList(WON)})), 0)::bigint AS avg_fee
           FROM bookings b WHERE ${W} GROUP BY 1 ORDER BY 2 DESC`,
        p,
      );
      // Multi-roster: performa per artis (manajemen/label/artis) — atau per artis yang dibooking (promotor).
      const roster = await db.query(
        `SELECT a.id AS artist_id, a.name, count(*)::int AS inquiries, count(*) FILTER (WHERE b.status IN (${sqlList(WON)}))::int AS won,
                coalesce(sum(b.agreed_fee) FILTER (WHERE b.status IN (${sqlList(WON)})), 0)::bigint AS gmv,
                coalesce(avg(b.agreed_fee) FILTER (WHERE b.status IN (${sqlList(WON)})), 0)::bigint AS avg_fee
           FROM bookings b JOIN artists a ON a.id = b.artist_id WHERE ${W} GROUP BY a.id, a.name ORDER BY gmv DESC, inquiries DESC LIMIT 50`,
        p,
      );
      // Mitra (paket Pro & Label): promotor terbanyak (sisi artis) — sisi promotor sudah tercakup tabel artis.
      const partners = f.counterpartBreakdown && scope.side === 'artist'
        ? await db.query(
            `SELECT o.id AS org_id, coalesce(o.name, 'Promotor') AS name, count(*)::int AS inquiries,
                    count(*) FILTER (WHERE b.status IN (${sqlList(WON)}))::int AS won,
                    coalesce(sum(b.agreed_fee) FILTER (WHERE b.status IN (${sqlList(WON)})), 0)::bigint AS gmv,
                    count(*) FILTER (WHERE b.status IN ('CANCELLED_BY_PROMOTOR'))::int AS cancelled
               FROM bookings b LEFT JOIN orgs o ON o.id = b.promotor_org_id WHERE ${W} GROUP BY o.id, o.name ORDER BY gmv DESC, inquiries DESC LIMIT 20`,
            p,
          )
        : null;

      const decided = (k?.won ?? 0) + (k?.lost ?? 0);
      return {
        org: { id: scope.org.id, name: scope.org.name, type: scope.org.type, plan: scope.org.pro_plan, plan_label: PLAN_LABEL[scope.org.pro_plan!] },
        side: scope.side,
        days,
        max_days: f.insightsMaxDays,
        features: { csv_export: f.csvExport, partners: f.counterpartBreakdown },
        kpis: {
          inquiries: k?.inquiries ?? 0,
          won: k?.won ?? 0,
          lost: k?.lost ?? 0,
          open: k?.open ?? 0,
          cancelled: k?.cancelled ?? 0,
          disputed: k?.disputed ?? 0,
          win_rate_pct: decided ? Math.round(((k?.won ?? 0) * 1000) / decided) / 10 : null,
          gmv: Number(k?.gmv ?? 0),
          avg_fee: Number(k?.avg_fee ?? 0),
          avg_budget: Number(k?.avg_budget ?? 0),
          pipeline: Number(k?.pipeline ?? 0),
          median_days_to_sign: speed?.median_days_to_sign == null ? null : Math.round(speed.median_days_to_sign * 10) / 10,
          take_rate_saved: saved,
        },
        monthly: monthly.map((r) => ({ ...r, gmv: Number(r.gmv) })),
        by_city: byCity.map((r) => ({ ...r, gmv: Number(r.gmv) })),
        by_category: byCategory.map((r) => ({ ...r, avg_fee: Number(r.avg_fee) })),
        roster: roster.map((r) => ({ ...r, gmv: Number(r.gmv), avg_fee: Number(r.avg_fee), win_rate_pct: r.inquiries ? Math.round((r.won * 1000) / r.inquiries) / 10 : null })),
        partners: partners?.map((r) => ({ ...r, gmv: Number(r.gmv) })) ?? null,
        generated_at: new Date().toISOString(),
      };
    });

    // Ekspor CSV (paket Pro & Label) — satu baris per booking dalam rentang.
    s.get('/v1/booking/pro/insights.csv', async (req, reply) => {
      const q = daysQ.parse(req.query);
      const scope = await scopeFor(db, req.user!, q.org_id);
      const f = assertPro(scope);
      if (!f.csvExport) throw proRequired('Ekspor CSV tersedia di paket Pro & Label');
      const days = Math.min(q.days, f.insightsMaxDays);
      const rows = await db.query(
        `SELECT b.id, to_char(b.created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS created, b.status, a.name AS artist, coalesce(o.name,'') AS promotor,
                b.event_name, b.event_date, b.city, b.category, b.budget, b.latest_fee, b.agreed_fee, b.commission_promotor_pct, b.commission_artist_pct
           FROM bookings b JOIN artists a ON a.id=b.artist_id LEFT JOIN orgs o ON o.id=b.promotor_org_id
          WHERE ${scope.where} AND b.status <> 'DRAFT' AND b.created_at >= now() - make_interval(days => $2) ORDER BY b.created_at`,
        [q.org_id, days],
      );
      const cols = ['id', 'created', 'status', 'artist', 'promotor', 'event_name', 'event_date', 'city', 'category', 'budget', 'latest_fee', 'agreed_fee', 'commission_promotor_pct', 'commission_artist_pct'];
      const esc = (v: unknown) => {
        const t = v == null ? '' : String(v);
        // Cegah formula injection di spreadsheet (=, +, -, @) dan kutip nilai berkoma/berkutip.
        const safe = /^[=+\-@]/.test(t) ? `'${t}` : t;
        return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
      };
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="rave-insight-pro-${days}h.csv"`);
      return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
    });
  });
}

const side = (s: Scope) => s.side;
