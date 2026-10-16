import type { Client, Job } from '@gema/service-kit';

/**
 * Delta agregat append-only (tabel agg_deltas). Ingest/consumer hanya menulis delta — tidak menyentuh
 * baris agg_* yang panas — lalu `aggFlushJob` melipatnya ke agg_* tiap AGG_FLUSH_MS.
 * Konsekuensi: endpoint analitik (summary, EPK, city-listeners) tertinggal paling lama ±AGG_FLUSH_MS
 * (+ durasi flush) dari event terakhir — "hari ini" tetap near real-time dalam hitungan detik.
 */
export interface AggDelta {
  artist_id: string;
  date: string;
  track_id?: string | null;
  city?: string | null;
  age_group?: string | null;
  source?: string | null;
  streams?: number;
  listeners?: number;
  starts?: number;
  skips?: number;
  completes?: number;
  saves?: number;
  followers_gained?: number;
}

export type ArtistCounter = 'starts' | 'skips' | 'completes' | 'saves' | 'followers_gained';

export const AGG_FLUSH_MS = 5_000;
/** Ukuran klaim per putaran & batas putaran per run (backlog besar dikuras bertahap tanpa tx raksasa). */
const FLUSH_BATCH = 5_000;
const FLUSH_MAX_ROUNDS = 20;

/** Tulis banyak delta dalam satu INSERT … unnest (bagian dari tx pemanggil). */
export async function insertDeltas(tx: Client, deltas: AggDelta[]) {
  if (!deltas.length) return;
  const col = <K extends keyof AggDelta>(k: K, dflt: AggDelta[K]) => deltas.map((d) => d[k] ?? dflt);
  await tx.query(
    `INSERT INTO agg_deltas (artist_id, date, track_id, city, age_group, source, streams, listeners, starts, skips, completes, saves, followers_gained)
     SELECT * FROM unnest($1::uuid[], $2::date[], $3::uuid[], $4::text[], $5::text[], $6::text[],
                          $7::int[], $8::int[], $9::int[], $10::int[], $11::int[], $12::int[], $13::int[])`,
    [
      col('artist_id', ''),
      col('date', ''),
      col('track_id', null),
      col('city', null),
      col('age_group', null),
      col('source', null),
      col('streams', 0),
      col('listeners', 0),
      col('starts', 0),
      col('skips', 0),
      col('completes', 0),
      col('saves', 0),
      col('followers_gained', 0),
    ],
  );
}

/** +1 satu counter harian artis (start/skip/complete/save/follow) via delta. */
export async function bumpArtistDaily(tx: Client, artistId: string, date: string, col: ArtistCounter) {
  await insertDeltas(tx, [{ artist_id: artistId, date, [col]: 1 }]);
}

/**
 * Klaim + lipat satu batch dalam SATU statement: DELETE … RETURNING atas id yang dikunci (SKIP LOCKED →
 * aman untuk beberapa instance), GROUP BY per kunci, satu upsert per tabel. Gagal → seluruhnya rollback,
 * delta tetap ada (exactly-once). Upsert diurutkan per kunci agar instance paralel tidak deadlock.
 */
const FLUSH_SQL = `
WITH d AS (
  DELETE FROM agg_deltas WHERE id IN (SELECT id FROM agg_deltas ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
  RETURNING *
), a AS (
  INSERT INTO agg_artist_daily (artist_id, date, streams, listeners, starts, skips, completes, saves, followers_gained)
  SELECT artist_id, date, sum(streams), sum(listeners), sum(starts), sum(skips), sum(completes), sum(saves), sum(followers_gained)
  FROM d GROUP BY artist_id, date ORDER BY artist_id, date
  ON CONFLICT (artist_id, date) DO UPDATE SET
    streams = agg_artist_daily.streams + EXCLUDED.streams,
    listeners = agg_artist_daily.listeners + EXCLUDED.listeners,
    starts = agg_artist_daily.starts + EXCLUDED.starts,
    skips = agg_artist_daily.skips + EXCLUDED.skips,
    completes = agg_artist_daily.completes + EXCLUDED.completes,
    saves = agg_artist_daily.saves + EXCLUDED.saves,
    followers_gained = agg_artist_daily.followers_gained + EXCLUDED.followers_gained
), t AS (
  INSERT INTO agg_track_daily (artist_id, track_id, date, streams)
  SELECT (array_agg(artist_id))[1], track_id, date, sum(streams)
  FROM d WHERE track_id IS NOT NULL GROUP BY track_id, date ORDER BY track_id, date
  ON CONFLICT (track_id, date) DO UPDATE SET streams = agg_track_daily.streams + EXCLUDED.streams
), c AS (
  INSERT INTO agg_city_daily (artist_id, date, city, listeners, streams)
  SELECT artist_id, date, city, sum(listeners), sum(streams)
  FROM d WHERE city IS NOT NULL GROUP BY artist_id, date, city ORDER BY artist_id, date, city
  ON CONFLICT (artist_id, date, city) DO UPDATE SET
    listeners = agg_city_daily.listeners + EXCLUDED.listeners, streams = agg_city_daily.streams + EXCLUDED.streams
), g AS (
  INSERT INTO agg_age_daily (artist_id, date, age_group, streams)
  SELECT artist_id, date, age_group, sum(streams)
  FROM d WHERE age_group IS NOT NULL GROUP BY artist_id, date, age_group ORDER BY artist_id, date, age_group
  ON CONFLICT (artist_id, date, age_group) DO UPDATE SET streams = agg_age_daily.streams + EXCLUDED.streams
), s AS (
  INSERT INTO agg_source_daily (artist_id, date, source, streams)
  SELECT artist_id, date, source, sum(streams)
  FROM d WHERE source IS NOT NULL GROUP BY artist_id, date, source ORDER BY artist_id, date, source
  ON CONFLICT (artist_id, date, source) DO UPDATE SET streams = agg_source_daily.streams + EXCLUDED.streams
), u AS (
  -- Pendengar harian baru → uniques-28d cukup menghitung ulang artis ini.
  INSERT INTO agg_uniques_dirty (artist_id)
  SELECT DISTINCT artist_id FROM d WHERE listeners > 0 ORDER BY artist_id
  ON CONFLICT DO NOTHING
)
SELECT count(*)::int AS n FROM d`;

export const aggFlushJob: Job = {
  name: 'agg-flush',
  everyMs: AGG_FLUSH_MS,
  async run({ db }) {
    for (let i = 0; i < FLUSH_MAX_ROUNDS; i++) {
      const r = await db.one<{ n: number }>(FLUSH_SQL, [FLUSH_BATCH]);
      if ((r?.n ?? 0) < FLUSH_BATCH) return;
    }
  },
};
