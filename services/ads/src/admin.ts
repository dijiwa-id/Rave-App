import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AD_CATEGORIES, AD_FIXED_RULES, AD_OUTCOME_LABEL, categoryViolation, evaluateAdBreak, type AdBreakOutcome } from '@rave/domain/ads';
import { audit, badRequest, conflict, forbidden, hasPermission, HttpError, isSuperAdmin, notFound, requirePermission, requireRole, settings, uuidv7, z, type Db, type ServiceContext } from '@rave/service-kit';
import { currentPolicy, eligibility, isUuid } from './serving.js';

const STATUSES = ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'PAUSED', 'ENDED'] as const;

const urlField = z.string().trim().max(500).nullable().optional();
const campaignBody = z.object({
  advertiser: z.string().trim().min(2).max(120),
  name: z.string().trim().min(3).max(120),
  category: z.string(),
  license_ref: z.string().trim().max(120).nullable().optional(),
  type: z.enum(['audio', 'display']),
  title: z.string().trim().min(3).max(90),
  body: z.string().trim().max(240).nullable().optional(),
  image_url: urlField,
  audio_url: urlField,
  click_url: urlField,
  cta_label: z.string().trim().max(30).nullable().optional(),
  theme_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Warna hex, mis. #7c3aed')
    .nullable()
    .optional(),
  duration_s: z.number().int().min(3).max(120),
  target_genres: z.array(z.string().trim().toLowerCase()).max(20).default([]),
  target_cities: z.array(z.string().trim()).max(30).default([]),
  start_at: z.string().datetime({ offset: true }).nullable().optional(),
  end_at: z.string().datetime({ offset: true }).nullable().optional(),
  max_impressions: z.number().int().positive().nullable().optional(),
  priority: z.number().int().min(1).max(10).default(5),
  is_house: z.boolean().default(false),
});
type CampaignInput = z.infer<typeof campaignBody>;

/** Validasi terhadap kebijakan penayangan (kategori, durasi, aset, URL, masa tayang). */
function policyErrors(c: CampaignInput): { path: string; message: string }[] {
  const e: { path: string; message: string }[] = [];
  if (!c.is_house) {
    const v = categoryViolation(c.category, settings.get<string[]>('ads.blocked_categories'), c.license_ref);
    if (v) e.push({ path: v.includes('wajib') ? 'license_ref' : 'category', message: v });
  } else if (!(c.category in AD_CATEGORIES)) e.push({ path: 'category', message: `Kategori tidak dikenal: ${c.category}` });
  const max = c.type === 'audio' ? settings.num('ads.max_audio_seconds') : settings.num('ads.max_display_seconds');
  if (c.duration_s > max) e.push({ path: 'duration_s', message: `Maksimal ${max} detik untuk iklan ${c.type}` });
  if (c.type === 'audio' && !c.audio_url) e.push({ path: 'audio_url', message: 'Iklan audio wajib berkas audio' });
  for (const k of ['image_url', 'audio_url', 'click_url'] as const) {
    const u = c[k];
    // Tautan internal ("/premium", "/app/live") diizinkan untuk promosi RAVE; tautan luar wajib HTTPS.
    if (u && !u.startsWith('https://') && !(c.is_house && u.startsWith('/'))) e.push({ path: k, message: 'Wajib URL HTTPS' });
  }
  if (c.end_at && c.start_at && new Date(c.end_at) <= new Date(c.start_at)) e.push({ path: 'end_at', message: 'Harus setelah tanggal mulai' });
  return e;
}

// Statistik via satu agregat LATERAL per kampanye (satu scan indeks campaign_id, bukan empat subquery).
const CAMPAIGN_SQL = `SELECT c.*, s.s_impressions, s.s_completes, s.s_skips, s.s_clicks
  FROM campaigns c
  LEFT JOIN LATERAL (SELECT count(*)::int AS s_impressions,
                            count(*) FILTER (WHERE i.completed_at IS NOT NULL)::int AS s_completes,
                            count(*) FILTER (WHERE i.skipped_at IS NOT NULL)::int AS s_skips,
                            count(*) FILTER (WHERE i.clicked_at IS NOT NULL)::int AS s_clicks
                       FROM impressions i WHERE i.campaign_id = c.id) s ON true`;

function campaignOut(r: any) {
  const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  return {
    id: r.id,
    advertiser: r.advertiser,
    name: r.name,
    category: r.category,
    license_ref: r.license_ref,
    type: r.type,
    title: r.title,
    body: r.body,
    image_url: r.image_url,
    audio_url: r.audio_url,
    click_url: r.click_url,
    cta_label: r.cta_label,
    theme_color: r.theme_color,
    duration_s: r.duration_s,
    target_genres: r.target_genres,
    target_cities: r.target_cities,
    start_at: r.start_at,
    end_at: r.end_at,
    max_impressions: r.max_impressions,
    priority: r.priority,
    is_house: r.is_house,
    status: r.status,
    review_note: r.review_note,
    reviewed_by_name: r.reviewed_by_name,
    reviewed_at: r.reviewed_at,
    created_by_name: r.created_by_name,
    created_at: r.created_at,
    stats: {
      impressions: r.s_impressions ?? 0,
      completes: r.s_completes ?? 0,
      skips: r.s_skips ?? 0,
      clicks: r.s_clicks ?? 0,
      ctr: ratio(r.s_clicks ?? 0, r.s_impressions ?? 0),
      completion_rate: ratio(r.s_completes ?? 0, r.s_impressions ?? 0),
    },
  };
}

const actorName = (req: FastifyRequest) => req.user?.name ?? req.user?.email ?? null;

export async function adminRoutes(app: FastifyInstance, { db }: ServiceContext) {
  async function load(id: string) {
    if (!isUuid(id)) throw notFound('Kampanye');
    const r = await db.one(`${CAMPAIGN_SQL} WHERE c.id = $1`, [id]);
    if (!r) throw notFound('Kampanye');
    return r;
  }
  const reject422 = (errors: { path: string; message: string }[]) =>
    new HttpError(422, 'Unprocessable Entity', errors[0].message, { type: 'https://rave.id/problems/ad-policy', errors });

  async function save(db: Db, id: string, c: CampaignInput, status: string, req: FastifyRequest, insert: boolean) {
    const vals = [
      id, c.advertiser, c.name, c.category, c.license_ref ?? null, c.type, c.title, c.body ?? null, c.image_url ?? null, c.audio_url ?? null,
      c.click_url ?? null, c.cta_label ?? null, c.theme_color ?? null, c.duration_s, c.target_genres, c.target_cities,
      c.start_at ?? new Date().toISOString(), c.end_at ?? null, c.max_impressions ?? null, c.priority, c.is_house, status,
    ];
    if (insert)
      await db.query(
        `INSERT INTO campaigns (id, advertiser, name, category, license_ref, type, title, body, image_url, audio_url, click_url, cta_label, theme_color,
           duration_s, target_genres, target_cities, start_at, end_at, max_impressions, priority, is_house, status, created_by, created_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
        [...vals, req.user!.sub, actorName(req)],
      );
    else
      await db.query(
        `UPDATE campaigns SET advertiser=$2, name=$3, category=$4, license_ref=$5, type=$6, title=$7, body=$8, image_url=$9, audio_url=$10, click_url=$11,
           cta_label=$12, theme_color=$13, duration_s=$14, target_genres=$15, target_cities=$16, start_at=$17, end_at=$18, max_impressions=$19,
           priority=$20, is_house=$21, status=$22, updated_at=now() WHERE id=$1`,
        vals,
      );
  }

  app.register(async (a) => {
    a.addHook('preHandler', requireRole('admin'));
    // Membaca area iklan: pengelola atau peninjau (izin per peran, "Peran & Akses").
    a.addHook('preHandler', async (req) => {
      if (!hasPermission(req.user, 'ads.manage') && !hasPermission(req.user, 'ads.review')) throw forbidden('Peran Anda tidak memiliki akses ke area iklan');
    });
    const manage = { preHandler: requirePermission('ads.manage') };

    a.get('/v1/admin/ads/overview', async (req) => {
      const days = Math.min(Math.max(Number((req.query as { days?: string }).days) || 7, 1), 90);
      const k = (await db.one(
        `SELECT count(*)::int AS impressions,
                count(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completes,
                count(*) FILTER (WHERE clicked_at IS NOT NULL)::int AS clicks
           FROM impressions WHERE served_at > now() - make_interval(days => $1)`,
        [days],
      ))!;
      const outcomes = await db.query(
        `SELECT outcome, sum(n)::int AS n FROM break_outcomes WHERE day > (now() AT TIME ZONE 'Asia/Jakarta')::date - $1::int GROUP BY outcome ORDER BY n DESC`,
        [days],
      );
      const breaks = outcomes.reduce((s, o) => s + o.n, 0);
      const served = outcomes.find((o) => o.outcome === 'serve')?.n ?? 0;
      const noFill = outcomes.find((o) => o.outcome === 'no_fill')?.n ?? 0;
      // Satu pass teragregasi per hari WIB; rentang served_at sargable (indeks BRIN served_at).
      const byDay = await db.query(
        `WITH r AS (SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date - ($1::int - 1) AS d0),
              imp AS (SELECT (i.served_at AT TIME ZONE 'Asia/Jakarta')::date AS day, count(*) AS n, count(*) FILTER (WHERE i.clicked_at IS NOT NULL) AS clicks
                        FROM impressions i, r WHERE i.served_at >= (r.d0::timestamp AT TIME ZONE 'Asia/Jakarta') GROUP BY 1),
              brk AS (SELECT b.day, sum(b.n) AS n FROM break_outcomes b, r WHERE b.day >= r.d0 GROUP BY 1)
         SELECT d::date AS date, coalesce(imp.n, 0)::int AS impressions, coalesce(imp.clicks, 0)::int AS clicks, coalesce(brk.n, 0)::int AS breaks
           FROM r, generate_series(r.d0, (now() AT TIME ZONE 'Asia/Jakarta')::date, interval '1 day') d
           LEFT JOIN imp ON imp.day = d::date LEFT JOIN brk ON brk.day = d::date
          ORDER BY d`,
        [days],
      );
      const counts = (await db.one(
        `SELECT count(*) FILTER (WHERE status = 'APPROVED')::int AS active, count(*) FILTER (WHERE status = 'PENDING_REVIEW')::int AS pending FROM campaigns`,
      ))!;
      const top = await db.query(`${CAMPAIGN_SQL} ORDER BY s_impressions DESC, c.created_at DESC LIMIT 5`);
      const blocked = settings.get<string[]>('ads.blocked_categories');
      const ratio = (x: number, y: number) => (y ? Math.round((x / y) * 1000) / 10 : 0);
      return {
        kpis: {
          impressions: k.impressions,
          completes: k.completes,
          clicks: k.clicks,
          ctr: ratio(k.clicks, k.impressions),
          completion_rate: ratio(k.completes, k.impressions),
          // Fill rate = jeda yang lolos kebijakan & terisi kampanye / jeda yang lolos kebijakan.
          fill_rate: ratio(served, served + noFill),
          breaks,
          active_campaigns: counts.active,
          pending_review: counts.pending,
        },
        by_day: byDay,
        outcomes: outcomes.map((o) => ({ ...o, label: o.outcome === 'no_fill' ? 'Tidak ada kampanye cocok' : (AD_OUTCOME_LABEL[o.outcome as AdBreakOutcome] ?? o.outcome) })),
        top_campaigns: top.map(campaignOut),
        policy: {
          fixed_rules: AD_FIXED_RULES,
          categories: Object.entries(AD_CATEGORIES).map(([key, d]) => ({ key, label: d.label, tier: d.tier, license: 'license' in d ? d.license : null, blocked: d.tier === 'prohibited' || blocked.includes(key) })),
        },
      };
    });

    a.get('/v1/admin/ads/campaigns', async (req) => {
      const { status } = req.query as { status?: string };
      if (status && !STATUSES.includes(status as any)) throw badRequest('status tidak valid');
      const rows = await db.query(
        `${CAMPAIGN_SQL} WHERE ($1::text IS NULL OR c.status = $1) ORDER BY (c.status = 'PENDING_REVIEW') DESC, c.is_house, c.created_at DESC`,
        [status || null],
      );
      return { data: rows.map(campaignOut) };
    });

    a.post('/v1/admin/ads/campaigns', manage, async (req, reply) => {
      const { submit, ...rest } = z.object({ submit: z.boolean().optional() }).passthrough().parse(req.body ?? {});
      const c = campaignBody.parse(rest);
      // Draf boleh tidak lengkap secara kebijakan; pengajuan wajib lolos.
      const errors = policyErrors(c).filter((e) => submit || e.path === 'category');
      if (errors.length) throw reject422(errors);
      const id = uuidv7();
      await save(db, id, c, submit ? 'PENDING_REVIEW' : 'DRAFT', req, true);
      await audit(db, { actorId: req.user!.sub, action: 'ads.campaign.create', entity: 'campaign', entityId: id, data: { name: c.name, category: c.category, submit } });
      reply.status(201);
      return campaignOut(await load(id));
    });

    a.patch('/v1/admin/ads/campaigns/:id', manage, async (req) => {
      const r = await load((req.params as { id: string }).id);
      if (r.status === 'ENDED') throw conflict('Kampanye sudah berakhir');
      const merged = campaignBody.parse({ ...campaignOut(r), ...(req.body as object), start_at: (req.body as any)?.start_at ?? new Date(r.start_at).toISOString(), end_at: (req.body as any)?.end_at === undefined ? (r.end_at ? new Date(r.end_at).toISOString() : null) : (req.body as any).end_at });
      const errors = policyErrors(merged).filter((e) => r.status !== 'DRAFT' || e.path === 'category');
      if (errors.length) throw reject422(errors);
      // Perubahan pada kampanye yang sudah disetujui/ditayangkan wajib ditinjau ulang.
      const status = ['APPROVED', 'PAUSED'].includes(r.status) ? 'PENDING_REVIEW' : r.status === 'REJECTED' ? 'DRAFT' : r.status;
      await save(db, r.id, merged, status, req, false);
      await audit(db, { actorId: req.user!.sub, action: 'ads.campaign.update', entity: 'campaign', entityId: r.id, data: { status } });
      return campaignOut(await load(r.id));
    });

    a.post('/v1/admin/ads/campaigns/:id/submit', manage, async (req) => {
      const r = await load((req.params as { id: string }).id);
      if (!['DRAFT', 'REJECTED'].includes(r.status)) throw conflict(`Kampanye berstatus ${r.status}`);
      const errors = policyErrors(campaignBody.parse({ ...campaignOut(r), start_at: new Date(r.start_at).toISOString(), end_at: r.end_at ? new Date(r.end_at).toISOString() : null }));
      if (errors.length) throw reject422(errors);
      await db.query(`UPDATE campaigns SET status='PENDING_REVIEW', review_note=NULL, updated_at=now() WHERE id=$1`, [r.id]);
      return campaignOut(await load(r.id));
    });

    a.post('/v1/admin/ads/campaigns/:id/review', async (req) => {
      const u = req.user!;
      if (!hasPermission(u, 'ads.review')) throw forbidden('Peran Anda tidak memiliki akses: tinjau kampanye iklan');
      const r = await load((req.params as { id: string }).id);
      if (r.status !== 'PENDING_REVIEW') throw conflict('Kampanye tidak menunggu tinjauan');
      // Prinsip empat mata: pembuat tidak meninjau kampanyenya sendiri (kecuali Super Admin).
      if (r.created_by === u.sub && !isSuperAdmin(u)) throw forbidden('Pembuat kampanye tidak boleh meninjau kampanyenya sendiri');
      const b = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional().nullable() }).parse(req.body);
      if (!b.approve && !b.note) throw badRequest('Alasan penolakan wajib diisi');
      if (b.approve) {
        const errors = policyErrors(campaignBody.parse({ ...campaignOut(r), start_at: new Date(r.start_at).toISOString(), end_at: r.end_at ? new Date(r.end_at).toISOString() : null }));
        if (errors.length) throw reject422(errors);
      }
      // Kondisional pada status → aman dari balapan dua peninjau.
      const upd = await db.query(
        `UPDATE campaigns SET status=$2, review_note=$3, reviewed_by=$4, reviewed_by_name=$5, reviewed_at=now(), updated_at=now()
          WHERE id=$1 AND status='PENDING_REVIEW' RETURNING id`,
        [r.id, b.approve ? 'APPROVED' : 'REJECTED', b.note ?? null, u.sub, actorName(req)],
      );
      if (!upd.length) throw conflict('Kampanye tidak menunggu tinjauan');
      await audit(db, { actorId: u.sub, action: b.approve ? 'ads.campaign.approve' : 'ads.campaign.reject', entity: 'campaign', entityId: r.id, data: { note: b.note } });
      return campaignOut(await load(r.id));
    });

    for (const [action, from, to] of [
      ['pause', ['APPROVED'], 'PAUSED'],
      ['resume', ['PAUSED'], 'APPROVED'],
    ] as const) {
      a.post(`/v1/admin/ads/campaigns/:id/${action}`, async (req) => {
        const r = await load((req.params as { id: string }).id);
        if (!(from as readonly string[]).includes(r.status)) throw conflict(`Tidak bisa ${action === 'pause' ? 'menjeda' : 'melanjutkan'} kampanye berstatus ${r.status}`);
        const upd = await db.query(`UPDATE campaigns SET status=$2, updated_at=now() WHERE id=$1 AND status = ANY($3::text[]) RETURNING id`, [r.id, to, from]);
        if (!upd.length) throw conflict('Status kampanye berubah — muat ulang');
        await audit(db, { actorId: req.user!.sub, action: `ads.campaign.${action}`, entity: 'campaign', entityId: r.id });
        return campaignOut(await load(r.id));
      });
    }

    a.delete('/v1/admin/ads/campaigns/:id', manage, async (req) => {
      const r = await load((req.params as { id: string }).id);
      if (!['DRAFT', 'REJECTED'].includes(r.status) || r.s_impressions > 0) throw conflict('Hanya draf/ditolak tanpa impresi yang dapat dihapus — gunakan Jeda');
      await db.query(`DELETE FROM campaigns WHERE id=$1`, [r.id]);
      await audit(db, { actorId: req.user!.sub, action: 'ads.campaign.delete', entity: 'campaign', entityId: r.id, data: { name: r.name } });
      return { deleted: true };
    });

    // Simulator kebijakan: jalankan aturan dengan pengaturan saat ini untuk keadaan pendengar hipotetis.
    a.post('/v1/admin/ads/simulate', manage, async (req) => {
      const b = z
        .object({
          premium: z.boolean().default(false),
          anonymous: z.boolean().default(false),
          consent: z.boolean().default(false),
          placement: z.enum(['between_tracks', 'podcast_preroll']).default('between_tracks'),
          premium_content: z.boolean().default(false),
          content_warning: z.boolean().default(false),
          streams_today: z.number().int().min(0).default(10),
          streams_since_break: z.number().int().min(0).default(3),
          minutes_since_break: z.number().min(0).nullable().default(null),
          ads_last_hour: z.number().int().min(0).default(0),
          city: z.string().nullable().optional(),
          genres: z.array(z.string().trim().toLowerCase()).default([]),
        })
        .parse(req.body ?? {});
      const d = evaluateAdBreak(currentPolicy(), {
        anonymous: b.anonymous,
        premium: b.premium,
        placement: b.placement,
        premiumContent: b.premium_content,
        streamsToday: b.streams_today,
        streamsSinceBreak: b.streams_since_break,
        minutesSinceBreak: b.minutes_since_break,
        adsLastHour: b.ads_last_hour,
      });
      const el = await eligibility(db, { userId: null, city: b.city ?? null, consent: b.consent, genres: b.genres, contentWarning: b.content_warning });
      return {
        outcome: d.outcome,
        label: AD_OUTCOME_LABEL[d.outcome],
        slots: d.slots,
        trace: d.trace,
        eligible_campaigns: el.map((e) => ({ id: e.id, name: e.name, advertiser: e.advertiser, is_house: e.is_house, reason: e.reason })),
      };
    });
  });
}
