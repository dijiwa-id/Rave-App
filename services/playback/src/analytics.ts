import type { FastifyInstance } from 'fastify';
import { kSafe } from '@rave/domain';
import { callService, forbidden, isAdmin, managedArtistIds, requireAuth, unauthorized, z, type Db, type Job, type ServiceContext } from '@rave/service-kit';
import { todayWib, UNKNOWN } from './util.js';

const OTHERS = 'Lainnya';
/** Batas id per panggilan batch EPK (selaras batas kandidat discovery di booking). */
export const EPK_BATCH_MAX = 200;

function dateMinus(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Pendengar unik 28 hari (base impor/sintetis + real) pada tanggal tertentu. */
async function uniquesAt(db: Db, artistId: string, date: string): Promise<number> {
  return (await uniquesAtMany(db, [artistId], date)).get(artistId) ?? 0;
}

/** Versi batch: satu query DISTINCT ON untuk banyak artis. */
async function uniquesAtMany(db: Db, artistIds: string[], date: string): Promise<Map<string, number>> {
  const rows = await db.query(
    `SELECT DISTINCT ON (artist_id) artist_id, base + real AS n FROM agg_uniques_28d
     WHERE artist_id = ANY($1::uuid[]) AND date <= $2 ORDER BY artist_id, date DESC`,
    [artistIds, date],
  );
  return new Map(rows.map((r) => [r.artist_id, r.n]));
}

/** Kelompokkan baris hasil GROUP BY artist_id menjadi Map per artis (urutan baris dipertahankan). */
function byArtist<T extends { artist_id: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const arr = m.get(r.artist_id);
    if (arr) arr.push(r);
    else m.set(r.artist_id, [r]);
  }
  return m;
}

/**
 * Estimasi pendengar unik per kota: distribusi pendengar harian per kota diskalakan ke total unik.
 * k-anonimitas (UU PDP §8.2): kota < K_ANONYMITY_MIN digabung ke "Lainnya".
 * `rows` harus terurut listeners menurun.
 */
function cityShares(rows: { city: string; l: number }[], uniques: number, limit = 10) {
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

/** Baris kota per artis (agregat rentang tanggal), terurut listeners menurun. */
async function cityRows(db: Db, artistIds: string[], from: string, to: string) {
  return byArtist(
    await db.query<{ artist_id: string; city: string; l: number }>(
      `SELECT artist_id, city, sum(listeners)::int AS l FROM agg_city_daily
       WHERE artist_id = ANY($1::uuid[]) AND date BETWEEN $2 AND $3 GROUP BY artist_id, city ORDER BY artist_id, l DESC, city`,
      [artistIds, from, to],
    ),
  );
}

async function topCities(db: Db, artistId: string, from: string, to: string, uniques: number, limit = 10) {
  return cityShares((await cityRows(db, [artistId], from, to)).get(artistId) ?? [], uniques, limit);
}

const pcts = (rows: { k: string; n: number }[]) => {
  const total = rows.reduce((s, r) => s + r.n, 0);
  return rows.map((r) => ({ k: r.k, pct: total ? Math.round((r.n / total) * 1000) / 10 : 0 }));
};

async function pctBreakdownMany(db: Db, table: 'agg_age_daily' | 'agg_source_daily', col: 'age_group' | 'source', artistIds: string[], from: string, to: string) {
  const rows = await db.query<{ artist_id: string; k: string; n: number }>(
    `SELECT artist_id, ${col} AS k, sum(streams)::int AS n FROM ${table}
     WHERE artist_id = ANY($1::uuid[]) AND date BETWEEN $2 AND $3 GROUP BY artist_id, ${col} ORDER BY artist_id, ${col}`,
    [artistIds, from, to],
  );
  return new Map([...byArtist(rows)].map(([id, rs]) => [id, pcts(rs)]));
}

async function pctBreakdown(db: Db, table: 'agg_age_daily' | 'agg_source_daily', col: 'age_group' | 'source', artistId: string, from: string, to: string) {
  return (await pctBreakdownMany(db, table, col, [artistId], from, to)).get(artistId) ?? [];
}

export interface EpkStats {
  monthly_listeners: number;
  growth_90d_pct: number;
  top_cities: { city: string; listeners: number }[];
  age_groups: { group: string; pct: number }[];
  engagement_rate: number;
  streams_28d: number;
}

/** Statistik EPK untuk banyak artis sekaligus (query ber-GROUP BY, bukan N×6 query). Hasil per artis identik dengan versi tunggal. */
export async function epkStatsMany(db: Db, artistIds: string[]): Promise<Map<string, EpkStats>> {
  const ids = [...new Set(artistIds)];
  const out = new Map<string, EpkStats>();
  if (!ids.length) return out;
  const to = todayWib();
  const from28 = dateMinus(to, 27);
  const [now, then, aggRows, cities, ages] = await Promise.all([
    uniquesAtMany(db, ids, to),
    uniquesAtMany(db, ids, dateMinus(to, 90)),
    db.query(
      `SELECT artist_id, coalesce(sum(streams),0)::int AS streams, coalesce(sum(starts),0)::int AS starts, coalesce(sum(completes),0)::int AS completes
       FROM agg_artist_daily WHERE artist_id = ANY($1::uuid[]) AND date BETWEEN $2 AND $3 GROUP BY artist_id`,
      [ids, from28, to],
    ),
    cityRows(db, ids, from28, to),
    pctBreakdownMany(db, 'agg_age_daily', 'age_group', ids, from28, to),
  ]);
  const agg = new Map(aggRows.map((r) => [r.artist_id, r]));
  for (const id of ids) {
    const n = now.get(id) ?? 0;
    const t = then.get(id) ?? 0;
    const a = agg.get(id) ?? { streams: 0, starts: 0, completes: 0 };
    out.set(id, {
      monthly_listeners: n,
      growth_90d_pct: t ? Math.round(((n - t) / t) * 1000) / 10 : 0,
      top_cities: cityShares(cities.get(id) ?? [], n),
      age_groups: (ages.get(id) ?? []).map((x) => ({ group: x.k, pct: x.pct })),
      engagement_rate: a.starts ? Math.round((a.completes / a.starts) * 1000) / 1000 : 0,
      streams_28d: a.streams,
    });
  }
  return out;
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
        .header('content-disposition', `attachment; filename="rave-analitik-${artistId.slice(-6)}-${days}h.csv"`);
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
      const { id } = z.object({ id: z.string().uuid() }).parse({ id: artistId });
      return (await epkStatsMany(db, [id])).get(id)!;
    });

    // Batch EPK (discovery booking): `?ids=a,b,c` → { data: (EpkStats & { artist_id })[] } sesuai urutan ids.
    s.get('/internal/analytics/epk', async (req) => {
      const { ids } = z
        .object({ ids: z.string().transform((v) => v.split(',').filter(Boolean)).pipe(z.array(z.string().uuid()).max(EPK_BATCH_MAX)) })
        .parse(req.query);
      const stats = await epkStatsMany(db, ids);
      return { data: [...new Set(ids)].map((id) => ({ artist_id: id, ...stats.get(id)! })) };
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

/** Rekomputasi penuh berkala sebagai jaring pengaman (mis. seed/impor yang menulis agg_uniques_28d langsung). */
const UNIQUES_FULL_EVERY_MS = 3600_000;
let uniquesFullDay = '';
let uniquesFullAt = 0;

/**
 * Snapshot pendengar unik 28 hari untuk hari ini (base dibawa dari hari sebelumnya + real terhitung).
 * Inkremental: hanya artis di agg_uniques_dirty (ditandai job flush saat ada pendengar harian baru).
 * Rekomputasi penuh hanya saat start, ganti hari (jendela 28 hari bergeser untuk semua artis) dan tiap jam.
 */
export const uniquesJob: Job = {
  name: 'uniques-28d',
  everyMs: 60_000,
  async run({ db }) {
    const today = todayWib();
    const upsert = (artists: string) => `
      INSERT INTO agg_uniques_28d (artist_id, date, base, real)
      SELECT a.artist_id, $1::date,
        coalesce((SELECT base FROM agg_uniques_28d u WHERE u.artist_id = a.artist_id AND u.date <= $1::date ORDER BY date DESC LIMIT 1), 0),
        (SELECT count(DISTINCT user_id) FROM daily_listeners d WHERE d.artist_id = a.artist_id AND d.date > $1::date - 28)
      FROM (${artists}) a
      ON CONFLICT (artist_id, date) DO UPDATE SET real = EXCLUDED.real`;
    if (today !== uniquesFullDay || Date.now() - uniquesFullAt >= UNIQUES_FULL_EVERY_MS) {
      // Penanda dirty dibersihkan dalam statement yang sama (sudah tercakup rekomputasi penuh).
      // Artis dengan daily_listeners > 28 hari lalu sudah punya baris agg_uniques_28d dari run sebelumnya.
      await db.query(
        `WITH clr AS (DELETE FROM agg_uniques_dirty) ${upsert(
          `SELECT DISTINCT artist_id FROM agg_uniques_28d UNION SELECT DISTINCT artist_id FROM daily_listeners WHERE date > $1::date - 28`,
        )}`,
        [today],
      );
      uniquesFullDay = today;
      uniquesFullAt = Date.now();
      return;
    }
    await db.query(`WITH dirty AS (DELETE FROM agg_uniques_dirty RETURNING artist_id) ${upsert('SELECT artist_id FROM dirty')}`, [today]);
  },
};
