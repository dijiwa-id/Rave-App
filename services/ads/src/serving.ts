import type { FastifyInstance } from 'fastify';
import { AD_OUTCOME_LABEL, categoryViolation, evaluateAdBreak, type AdBreakOutcome, type AdPlacement, type AdPolicy, type ListenerAdState } from '@rave/domain/ads';
import { callService, conflict, notFound, requireAuth, settings, uuidv7, z, type AuthUser, type Db, type ServiceContext } from '@rave/service-kit';

/** Kebijakan efektif dari pengaturan platform (Super Admin → Pengaturan → Iklan). */
export function currentPolicy(): AdPolicy {
  return {
    enabled: settings.bool('ads.enabled'),
    breakIntervalMinutes: settings.num('ads.break_interval_minutes'),
    minStreamsBetweenBreaks: settings.num('ads.min_streams_between_breaks'),
    maxAdsPerBreak: settings.num('ads.max_ads_per_break'),
    maxAdsPerHour: settings.num('ads.max_ads_per_hour'),
    dailyGraceStreams: settings.num('ads.daily_grace_streams'),
    podcastPreroll: settings.bool('ads.podcast_preroll'),
  };
}

const TODAY = `(now() AT TIME ZONE 'Asia/Jakarta')::date`;
/** Awal hari ini (WIB) sebagai timestamptz — pembanding sargable untuk served_at. */
export const TODAY_START = `(date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')`;
export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export interface ServeContext {
  userId: string | null;
  city: string | null;
  consent: boolean;
  genres: string[];
  contentWarning: boolean;
}

export interface Eligibility {
  id: string;
  name: string;
  advertiser: string;
  is_house: boolean;
  priority: number;
  reason: string | null;
  row: any;
}

/**
 * Kelayakan setiap kampanye aktif untuk konteks pendengar — dipakai penyajian dan simulator (dengan alasan pengecualian).
 * Urutan cek mengikuti praktik umum: status & masa tayang → kebijakan kategori/durasi → frequency cap → keamanan merek → penargetan.
 */
export async function eligibility(db: Db, ctx: ServeContext): Promise<Eligibility[]> {
  // Satu pass teragregasi: total impresi hanya untuk kampanye berkuota; frekuensi per pengguna hari ini via indeks (user_id, campaign_id, served_at).
  const rows = await db.query(
    `SELECT c.*, coalesce(t.n, 0)::int AS total_impressions, coalesce(u.n, 0)::int AS user_today
       FROM campaigns c
       LEFT JOIN (SELECT i.campaign_id, count(*) AS n FROM impressions i
                   WHERE i.campaign_id IN (SELECT id FROM campaigns WHERE status = 'APPROVED' AND max_impressions IS NOT NULL)
                   GROUP BY 1) t ON t.campaign_id = c.id
       LEFT JOIN (SELECT i.campaign_id, count(*) AS n FROM impressions i
                   WHERE i.user_id = $1::uuid AND i.served_at >= ${TODAY_START} GROUP BY 1) u ON u.campaign_id = c.id
      WHERE c.status = 'APPROVED' ORDER BY c.is_house, c.priority DESC, c.created_at`,
    [ctx.userId && isUuid(ctx.userId) ? ctx.userId : null],
  );
  const blocked = settings.get<string[]>('ads.blocked_categories');
  const cap = settings.num('ads.frequency_cap_per_day');
  const now = Date.now();
  return rows.map((c) => {
    const reason = (() => {
      if (new Date(c.start_at).getTime() > now) return 'Belum mulai tayang';
      if (c.end_at && new Date(c.end_at).getTime() <= now) return 'Masa tayang berakhir';
      if (c.max_impressions != null && c.total_impressions >= c.max_impressions) return 'Kuota impresi habis';
      const v = categoryViolation(c.category, blocked, c.license_ref);
      if (v && !c.is_house) return v;
      const maxDur = c.type === 'audio' ? settings.num('ads.max_audio_seconds') : settings.num('ads.max_display_seconds');
      if (c.duration_s > maxDur) return `Durasi ${c.duration_s} dtk melebihi batas ${maxDur} dtk`;
      if (c.type === 'audio' && !c.audio_url) return 'Iklan audio tanpa berkas audio';
      if (c.user_today >= cap) return `Frequency cap tercapai (${cap}×/hari)`;
      if (ctx.contentWarning && settings.bool('ads.sensitive_adjacency') && !c.is_house) return 'Keamanan merek: setelah konten sensitif hanya promosi internal';
      if (c.target_genres.length && !c.target_genres.some((g: string) => ctx.genres.includes(g))) return 'Genre konten tidak cocok (kontekstual)';
      if (c.target_cities.length) {
        if (!ctx.consent) return 'Penargetan kota butuh persetujuan iklan (UU PDP)';
        if (!ctx.city || !c.target_cities.map((x: string) => x.toLowerCase()).includes(ctx.city.toLowerCase())) return 'Kota pendengar di luar target';
      }
      if (c.is_house && !settings.bool('ads.house_ads_enabled')) return 'Promosi internal dimatikan';
      return null;
    })();
    return { id: c.id, name: c.name, advertiser: c.advertiser, is_house: c.is_house, priority: c.priority, reason, row: c };
  });
}

/** Pilih kampanye: berbayar dulu (acak berbobot prioritas, satu pengiklan per jeda), promosi internal mengisi bila kosong. */
export function pick(eligible: Eligibility[], slots: number) {
  const ok = eligible.filter((e) => !e.reason);
  const paid = ok.filter((e) => !e.is_house);
  const chosen: Eligibility[] = [];
  const pool = [...paid];
  while (chosen.length < slots && pool.length) {
    const total = pool.reduce((s, e) => s + e.priority, 0);
    let r = Math.random() * total;
    const idx = pool.findIndex((e) => (r -= e.priority) <= 0);
    const [e] = pool.splice(idx < 0 ? 0 : idx, 1);
    // Pemisahan kompetitif: pengiklan yang sama tidak muncul dua kali dalam satu jeda.
    if (!chosen.some((c) => c.advertiser === e.advertiser)) chosen.push(e);
  }
  // Inventori tak terjual diisi satu promosi internal saja (tidak menambah ad load hanya demi mengisi slot).
  if (!chosen.length) {
    const house = ok.filter((e) => e.is_house);
    if (house.length) chosen.push(house[Math.floor(Math.random() * house.length)]);
  }
  return chosen;
}

/** Status pendengar hari ini (WIB). */
export async function listenerState(db: Db, userId: string) {
  const s = await db.one(
    `SELECT CASE WHEN day = ${TODAY} THEN streams_today ELSE 0 END AS streams_today,
            CASE WHEN day = ${TODAY} THEN streams_since_break ELSE 0 END AS streams_since_break,
            last_break_at FROM listener_state WHERE user_id = $1`,
    [userId],
  );
  const lastHour = await db.one(`SELECT count(*)::int AS n FROM impressions WHERE user_id = $1 AND served_at > now() - interval '1 hour'`, [userId]);
  return {
    streamsToday: s?.streams_today ?? 0,
    streamsSinceBreak: s?.streams_since_break ?? 0,
    minutesSinceBreak: s?.last_break_at ? (Date.now() - new Date(s.last_break_at).getTime()) / 60_000 : null,
    adsLastHour: lastHour?.n ?? 0,
  };
}

// Cache kecil konteks konten (genre artis, episode premium) dan consent — mengurangi panggilan antar-service.
// fn mengembalikan undefined bila panggilan gagal → hasil tidak di-cache (dicoba lagi pada permintaan berikut).
const cache = new Map<string, { at: number; v: any }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T | undefined>, fallback: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as T;
  const v = await fn();
  if (v === undefined) return fallback;
  if (cache.size > 2000) cache.clear();
  cache.set(key, { at: Date.now(), v });
  return v;
}
const FAILED = Symbol('failed');

async function contentContext(name: string, content?: { kind: 'track' | 'episode'; id: string; genres?: string[]; content_warning?: boolean; premium?: boolean }) {
  if (!content) return { genres: [] as string[], premium: false, contentWarning: false };
  if (content.kind === 'episode') {
    const e = await cached<any>(`ep:${content.id}`, 300_000, () => callService<any>(name, 'catalog', `/internal/episodes/${content.id}/media`).catch(() => undefined), null);
    return { genres: content.genres ?? [], premium: !!(e?.is_premium ?? content.premium), contentWarning: !!content.content_warning };
  }
  // Genre kontekstual = genre artis lagu berikutnya (tidak butuh data pribadi).
  const genres =
    content.genres ??
    (await cached<string[]>(
      `tr:${content.id}`,
      300_000,
      async () => {
        const t = await callService<any>(name, 'catalog', `/internal/tracks/${content.id}/media`).catch(() => FAILED);
        if (t === FAILED) return undefined;
        if (!t?.artist_id) return [];
        const a = await callService<any>(name, 'catalog', `/internal/artists/${t.artist_id}`).catch(() => FAILED);
        if (a === FAILED) return undefined;
        return (a?.genres ?? []) as string[];
      },
      [],
    ));
  return { genres, premium: false, contentWarning: !!content.content_warning };
}

export async function adsConsent(name: string, userId: string): Promise<boolean> {
  return cached<boolean>(
    `consent:${userId}`,
    60_000,
    async () => {
      const r = await callService<{ consents: Record<string, boolean> }>(name, 'iam', `/internal/users/${userId}/consents`).catch(() => undefined);
      return r === undefined ? undefined : !!r?.consents?.ads;
    },
    false,
  );
}

async function recordOutcome(db: Db, outcome: string) {
  await db.query(`INSERT INTO break_outcomes (day, outcome, n) VALUES (${TODAY}, $1, 1) ON CONFLICT (day, outcome) DO UPDATE SET n = break_outcomes.n + 1`, [outcome]);
}

function creativeOut(impressionId: string, c: any) {
  const skippable = c.type === 'audio' ? settings.bool('ads.audio_skippable') : true;
  return {
    impression_id: impressionId,
    campaign_id: c.id,
    type: c.type,
    advertiser: c.advertiser,
    title: c.title,
    body: c.body,
    image_url: c.image_url,
    audio_url: c.audio_url,
    click_url: c.click_url,
    cta_label: c.cta_label,
    theme_color: c.theme_color,
    duration_s: c.duration_s,
    skippable_after_s: skippable ? Math.min(settings.num('ads.skip_after_seconds'), c.duration_s) : null,
    label: c.is_house ? 'Dari RAVE' : 'Iklan',
    is_house: c.is_house,
  };
}

const breakBody = z.object({
  placement: z.enum(['between_tracks', 'podcast_preroll']).default('between_tracks'),
  content: z
    .object({
      kind: z.enum(['track', 'episode']),
      id: z.string().uuid(),
      genres: z.array(z.string()).max(20).optional(),
      content_warning: z.boolean().optional(),
      premium: z.boolean().optional(),
    })
    .optional(),
});

export async function servingRoutes(app: FastifyInstance, { db, name }: ServiceContext) {
  app.post('/v1/ads/break', async (req) => {
    const b = breakBody.parse(req.body ?? {});
    const u: AuthUser | null = req.user && !req.user.roles.includes('service') ? req.user : null;
    const content = await contentContext(name, b.content);
    const st = u ? await listenerState(db, u.sub) : { streamsToday: 0, streamsSinceBreak: 0, minutesSinceBreak: null, adsLastHour: 0 };
    const state: ListenerAdState = { anonymous: !u, premium: !!u?.premium, placement: b.placement as AdPlacement, premiumContent: content.premium, ...st };
    const decision = evaluateAdBreak(currentPolicy(), state);
    let outcome: AdBreakOutcome | 'no_fill' = decision.outcome;
    let ads: ReturnType<typeof creativeOut>[] = [];
    let breakId: string | null = null;
    if (decision.outcome === 'serve' && u) {
      const consent = await adsConsent(name, u.sub);
      const chosen = pick(await eligibility(db, { userId: u.sub, city: u.city ?? null, consent, genres: content.genres, contentWarning: content.contentWarning }), decision.slots);
      if (!chosen.length) outcome = 'no_fill';
      else {
        breakId = uuidv7();
        await db.tx(async (tx) => {
          for (const c of chosen) {
            const id = uuidv7();
            await tx.query(`INSERT INTO impressions (id, break_id, campaign_id, user_id, placement) VALUES ($1,$2,$3,$4,$5)`, [id, breakId, c.id, u.sub, b.placement]);
            ads.push(creativeOut(id, c.row));
          }
          await tx.query(
            `INSERT INTO listener_state (user_id, day, streams_today, streams_since_break, last_break_at) VALUES ($1, ${TODAY}, 0, 0, now())
             ON CONFLICT (user_id) DO UPDATE SET streams_since_break = 0, last_break_at = now(), updated_at = now()`,
            [u.sub],
          );
        });
      }
    }
    // Pengguna anonim tidak dicatat sebagai "jeda" (bukan inventori iklan).
    if (u) await recordOutcome(db, outcome);
    return { break_id: breakId, ads, outcome, reason: outcome === 'no_fill' ? 'Tidak ada kampanye yang cocok' : AD_OUTCOME_LABEL[outcome as AdBreakOutcome] };
  });

  app.post('/v1/ads/impressions/:id/events', { preHandler: requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ event: z.enum(['start', 'complete', 'skip', 'click']) }).parse(req.body);
    if (!isUuid(id)) throw notFound('Impresi');
    const imp = await db.one(
      `SELECT i.*, c.type, c.duration_s FROM impressions i JOIN campaigns c ON c.id = i.campaign_id WHERE i.id = $1 AND i.user_id = $2`,
      [id, req.user!.sub],
    );
    if (!imp) throw notFound('Impresi');
    if (b.event === 'skip') {
      const skippable = imp.type === 'audio' ? settings.bool('ads.audio_skippable') : true;
      if (!skippable) throw conflict('Iklan ini tidak dapat dilewati');
      const after = Math.min(settings.num('ads.skip_after_seconds'), imp.duration_s);
      const since = imp.started_at ? (Date.now() - new Date(imp.started_at).getTime()) / 1000 : 0;
      if (since + 1 < after) throw conflict(`Iklan dapat dilewati setelah ${after} detik`);
    }
    const col = { start: 'started_at', complete: 'completed_at', skip: 'skipped_at', click: 'clicked_at' }[b.event];
    await db.query(`UPDATE impressions SET ${col} = coalesce(${col}, now()) WHERE id = $1`, [imp.id]);
    return { ok: true };
  });
}
