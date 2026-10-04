import type { FastifyInstance } from 'fastify';
import { kSafe } from '@gema/domain';
import { callService, forbidden, isAdmin, managedArtistIds, requireAuth, unauthorized, z, type Db, type Job, type ServiceContext } from '@gema/service-kit';
import { todayWib, UNKNOWN } from './util.js';

const OTHERS = 'Lainnya';

function dateMinus(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Pendengar unik 28 hari (base impor/sintetis + real) pada tanggal tertentu. */
async function uniquesAt(db: Db, artistId: string, date: string): Promise<number> {
  const r = await db.one(`SELECT base + real AS n FROM agg_uniques_28d WHERE artist_id = $1 AND date <= $2 ORDER BY date DESC LIMIT 1`, [artistId, date]);
  return r?.n ?? 0;
}

/**
 * Estimasi pendengar unik per kota: distribusi pendengar harian per kota diskalakan ke total unik.
 * k-anonimitas (UU PDP §8.2): kota < K_ANONYMITY_MIN digabung ke "Lainnya".
 */
async function topCities(db: Db, artistId: string, from: string, to: string, uniques: number, limit = 10) {
  const rows = await db.query(
    `SELECT city, sum(listeners)::int AS l FROM agg_city_daily WHERE artist_id = $1 AND date BETWEEN $2 AND $3 GROUP BY city ORDER BY l DESC`,
    [artistId, from, to],
  );
  const total = rows.reduce((s, r) => s + r.l, 0);
  if (!total) return [];
  const out: { city: string; listeners: number }[] = [];
  let others = 0;
  for (const r of rows) {
    const est = Math.round((r.l / total) * uniques);
    if (r.city === UNKNOWN || kSafe(est) === null || out.length >= limit) others += est;
    else out.push({ city: r.city, listeners: est });
  }
  if (kSafe(others) !== null) out.push({ city: OTHERS, listeners: others });
  return out;
}

async function pctBreakdown(db: Db, table: 'agg_age_daily' | 'agg_source_daily', col: 'age_group' | 'source', artistId: string, from: string, to: string) {
  const rows = await db.query(
    `SELECT ${col} AS k, sum(streams)::int AS n FROM ${table} WHERE artist_id = $1 AND date BETWEEN $2 AND $3 GROUP BY ${col} ORDER BY ${col}`,
    [artistId, from, to],
  );
  const total = rows.reduce((s, r) => s + r.n, 0);
  return rows.map((r) => ({ k: r.k, pct: total ? Math.round((r.n / total) * 1000) / 10 : 0 }));
}

const SOURCE_LABEL: Record<string, string> = {
  editorial: 'Playlist editorial',
  search: 'Pencarian',
  profile: 'Profil artis',
  library: 'Koleksi pendengar',
  playlist: 'Playlist pengguna',
  radio: 'Radio & mix',
  other: 'Lainnya',
};

export async function artistSummary(ctx: ServiceContext, artistId: string, days: number) {
  const { db } = ctx;
  const to = todayWib();
  const from = dateMinus(to, days - 1);
  const daily = await db.query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, streams, listeners, starts, skips, completes, saves, followers_gained
     FROM agg_artist_daily WHERE artist_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date`,
    [artistId, from, to],
  );
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const series: { date: string; streams: number; listeners: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = dateMinus(to, i);
    const r = byDate.get(d);
    series.push({ date: d, streams: r?.streams ?? 0, listeners: r?.listeners ?? 0 });
  }
  const sum = (k: string) => daily.reduce((s, r) => s + r[k], 0);
  const streams = sum('streams');
  const uniques = await uniquesAt(db, artistId, to);

  const tracks = await db.query(
    `SELECT track_id, sum(streams)::int AS streams FROM agg_track_daily WHERE artist_id = $1 AND date BETWEEN $2 AND $3 GROUP BY track_id ORDER BY streams DESC LIMIT 10`,
    [artistId, from, to],
  );
  let titles = new Map<string, string>();
  if (tracks.length) {
    try {
      const r = await callService<{ data: { id: string; title: string }[] }>(ctx.name, 'catalog', `/v1/catalog/tracks?ids=${tracks.map((t) => t.track_id).join(',')}`);
      titles = new Map(r.data.map((t) => [t.id, t.title]));
    } catch (e: any) {
      ctx.log.warn({ err: e?.message }, 'hydrate judul lagu gagal');
    }
  }

  return {
    artist_id: artistId,
    days,
    streams,
    listeners: uniques,
    followers_gained: sum('followers_gained'),
    save_rate: streams ? Math.round((sum('saves') / streams) * 1000) / 1000 : 0,
    skip_rate: sum('starts') ? Math.round((sum('skips') / sum('starts')) * 1000) / 1000 : 0,
    daily: series,
    top_cities: await topCities(db, artistId, from, to, uniques),
    top_tracks: tracks.map((t) => ({ track_id: t.track_id, title: titles.get(t.track_id) ?? '—', streams: t.streams })),
    sources: (await pctBreakdown(db, 'agg_source_daily', 'source', artistId, from, to)).map((x) => ({ source: SOURCE_LABEL[x.k] ?? x.k, pct: x.pct })),
    age_groups: (await pctBreakdown(db, 'agg_age_daily', 'age_group', artistId, from, to)).map((x) => ({ group: x.k, pct: x.pct })),
  };
}

export async function analyticsRoutes(app: FastifyInstance, ctx: ServiceContext) {
  const { db } = ctx;
  const daysQ = z.object({ days: z.coerce.number().int().min(1).max(365).default(28) });

  app.register(async (s) => {
    s.addHook('preHandler', requireAuth);
    const assertArtist = (req: any, artistId: string) => {
      if (!isAdmin(req.user) && !managedArtistIds(req.user).includes(artistId)) throw forbidden('Anda tidak mengelola artis ini');
    };

    // REQ-STU-03: analitik artis (data agregat; diperbarui real-time untuk hari ini).
    s.get('/v1/analytics/artists/:artistId/summary', async (req) => {
      const { artistId } = req.params as { artistId: string };
      assertArtist(req, artistId);
      return artistSummary(ctx, artistId, daysQ.parse(req.query).days);
    });

    s.get('/v1/analytics/artists/:artistId/export.csv', async (req, reply) => {
      const { artistId } = req.params as { artistId: string };
      assertArtist(req, artistId);
      const { days } = daysQ.parse(req.query);
      const to = todayWib();
      const rows = await db.query(
        `SELECT to_char(date, 'YYYY-MM-DD') AS date, streams, listeners, starts, skips, completes, saves, followers_gained
         FROM agg_artist_daily WHERE artist_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date`,
        [artistId, dateMinus(to, days - 1), to],
      );
      const header = 'date,streams,listeners,starts,skips,completes,saves,followers_gained';
      const csv = [header, ...rows.map((r) => [r.date, r.streams, r.listeners, r.starts, r.skips, r.completes, r.saves, r.followers_gained].join(','))].join('\n');
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="gema-analitik-${artistId.slice(-6)}-${days}h.csv"`);
      return csv + '\n';
    });
  });

  // ---------- Internal (booking: EPK & Audience Match) ----------
  app.register(async (s) => {
    s.addHook('preHandler', async (req) => {
      if (!req.user) throw unauthorized();
      if (!req.user.roles.includes('service') && !req.user.roles.includes('admin')) throw forbidden('Khusus service');
    });

    s.get('/internal/analytics/artists/:artistId/epk', async (req) => {
      const { artistId } = req.params as { artistId: string };
      const to = todayWib();
      const now = await uniquesAt(db, artistId, to);
      const then = await uniquesAt(db, artistId, dateMinus(to, 90));
      const from28 = dateMinus(to, 27);
      const agg = await db.one(
        `SELECT coalesce(sum(streams),0)::int AS streams, coalesce(sum(starts),0)::int AS starts, coalesce(sum(completes),0)::int AS completes, coalesce(sum(saves),0)::int AS saves
         FROM agg_artist_daily WHERE artist_id = $1 AND date BETWEEN $2 AND $3`,
        [artistId, from28, to],
      );
      return {
        monthly_listeners: now,
        growth_90d_pct: then ? Math.round(((now - then) / then) * 1000) / 10 : 0,
        top_cities: await topCities(db, artistId, from28, to, now),
        age_groups: (await pctBreakdown(db, 'agg_age_daily', 'age_group', artistId, from28, to)).map((x) => ({ group: x.k, pct: x.pct })),
        engagement_rate: agg.starts ? Math.round((agg.completes / agg.starts) * 1000) / 1000 : 0,
        streams_28d: agg.streams,
      };
    });

    // Estimasi pendengar unik 28 hari per artis di satu kota (bahan Audience Match). Angka mentah — pemanggil wajib kSafe saat menampilkan.
    s.get('/internal/analytics/city-listeners', async (req) => {
      const { city } = z.object({ city: z.string().min(1) }).parse(req.query);
      const to = todayWib();
      const from = dateMinus(to, 27);
      const rows = await db.query(
        `WITH tot AS (
           SELECT artist_id, sum(listeners) AS all_l, sum(listeners) FILTER (WHERE lower(city) = lower($1)) AS city_l
           FROM agg_city_daily WHERE date BETWEEN $2 AND $3 GROUP BY artist_id
         ), u AS (
           SELECT DISTINCT ON (artist_id) artist_id, base + real AS uniques FROM agg_uniques_28d WHERE date <= $3 ORDER BY artist_id, date DESC
         )
         SELECT tot.artist_id, round(coalesce(tot.city_l, 0)::numeric / nullif(tot.all_l, 0) * coalesce(u.uniques, 0))::int AS listeners
         FROM tot LEFT JOIN u USING (artist_id) ORDER BY listeners DESC NULLS LAST`,
        [city, from, to],
      );
      return { data: rows.map((r) => ({ artist_id: r.artist_id, listeners: r.listeners ?? 0 })) };
    });
  });
}

/** Snapshot pendengar unik 28 hari untuk hari ini (base dibawa dari hari sebelumnya + real terhitung). */
export const uniquesJob: Job = {
  name: 'uniques-28d',
  everyMs: 60_000,
  async run({ db }) {
    const today = todayWib();
    await db.query(
      `INSERT INTO agg_uniques_28d (artist_id, date, base, real)
       SELECT a.artist_id, $1::date,
         coalesce((SELECT base FROM agg_uniques_28d u WHERE u.artist_id = a.artist_id AND u.date <= $1::date ORDER BY date DESC LIMIT 1), 0),
         (SELECT count(DISTINCT user_id) FROM daily_listeners d WHERE d.artist_id = a.artist_id AND d.date > $1::date - 28)
       FROM (SELECT DISTINCT artist_id FROM agg_uniques_28d UNION SELECT DISTINCT artist_id FROM daily_listeners) a
       ON CONFLICT (artist_id, date) DO UPDATE SET real = EXCLUDED.real`,
      [today],
    );
  },
};
