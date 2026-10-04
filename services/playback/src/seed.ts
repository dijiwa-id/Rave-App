import { SEED, SEED_CITIES, SEED_TRACKS } from '@gema/domain';
import type { ServiceContext } from '@gema/service-kit';
import { todayWib } from './util.js';

// Harus selaras dengan services/catalog/src/seed-data.ts (MONTHLY_LISTENERS).
const MONTHLY: Record<string, number> = {
  'senja-kolektif': 128_400,
  arunika: 64_200,
  'kota-mati': 211_900,
  'lalu-lintas': 38_700,
  'dara-laut': 97_300,
  'gelombang-pagi': 12_800,
  'mc-rantau': 45_600,
  nirmala: 246_100,
};

const AGES = ['18-24', '25-34', '35-44', '45+'];
const SOURCES = ['editorial', 'search', 'profile', 'library'];
const DAYS = 90;

/** PRNG deterministik (mulberry32) agar seed idempoten & stabil. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dateMinus(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Data analitik sintetis 90 hari untuk 8 artis demo, langsung ke tabel agregat.
 * Hari ini tidak diisi stream sintetis (diisi play event nyata); snapshot unik 28 hari diisi sampai hari ini.
 */
export async function seed({ db, log }: ServiceContext) {
  const today = todayWib();
  await db.tx(async (tx) => {
    for (const [ai, a] of SEED.artists.entries()) {
      const r = rng(ai * 7919 + 17);
      const M = MONTHLY[a.slug] ?? 10_000;
      const growing = a.slug === 'senja-kolektif';
      // Bobot kota: kota asal dominan, Jakarta kuat, sisanya menyebar.
      const cw = SEED_CITIES.map((c) => (c === a.city ? 38 : c === 'Jakarta' ? 18 : 2 + r() * 8));
      const cwSum = cw.reduce((s, x) => s + x, 0);
      const youngBias = a.genres.some((g) => ['hip-hop', 'pop', 'electronic', 'indie-pop'].includes(g)) ? 8 : 0;
      const aw = [38 + youngBias, 34, 17 - youngBias / 2, 11 - youngBias / 2];
      const sw = [30 + r() * 10, 15 + r() * 8, 20 + r() * 6, 28 + r() * 6];
      const tracks = SEED_TRACKS.filter((t) => t.artistId === a.id);
      const tw = tracks.map((t, i) => (t.trackNumber === 1 && i === tracks.length - 1 ? 3 : 1 + r() * 2)); // single terbaru lebih tinggi

      const rows = { artist: [] as any[], city: [] as any[], age: [] as any[], src: [] as any[], track: [] as any[], uniq: [] as any[] };
      for (let back = DAYS; back >= 0; back--) {
        const date = dateMinus(today, back);
        const t = (DAYS - back) / DAYS; // 0 → 1
        const U = Math.round(M * (growing ? 0.55 + 0.45 * t : 0.86 + 0.14 * t) * (0.97 + r() * 0.06));
        rows.uniq.push([date, U]);
        if (back === 0) continue;
        const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
        const L = Math.max(1, Math.round(U * 0.11 * (dow === 0 || dow === 6 ? 1.2 : 1) * (0.9 + r() * 0.2)));
        const S = Math.round(L * (2.1 + r() * 0.6));
        const starts = Math.round(S * 1.3);
        rows.artist.push([date, S, L, starts, Math.round(starts * (0.18 + r() * 0.08)), Math.round(S * 0.62), Math.round(S * (0.03 + r() * 0.015)), Math.round(L * 0.012)]);
        SEED_CITIES.forEach((c, i) => {
          const f = cw[i] / cwSum;
          rows.city.push([date, c, Math.round(L * f), Math.round(S * f)]);
        });
        AGES.forEach((g, i) => rows.age.push([date, g, Math.round((S * aw[i]) / 100)]));
        const swSum = sw.reduce((x, y) => x + y, 0);
        SOURCES.forEach((src, i) => rows.src.push([date, src, Math.round((S * sw[i]) / swSum)]));
        const twSum = tw.reduce((x, y) => x + y, 0);
        tracks.forEach((tr, i) => rows.track.push([date, tr.id, Math.round((S * tw[i]) / twSum)]));
      }

      const col = (arr: any[][], i: number) => arr.map((x) => x[i]);
      await tx.query(
        `INSERT INTO agg_artist_daily (artist_id, date, streams, listeners, starts, skips, completes, saves, followers_gained)
         SELECT $1, d, s, l, st, sk, c, sv, f FROM unnest($2::date[], $3::int[], $4::int[], $5::int[], $6::int[], $7::int[], $8::int[], $9::int[]) AS x(d, s, l, st, sk, c, sv, f)
         ON CONFLICT (artist_id, date) DO UPDATE SET streams = EXCLUDED.streams, listeners = EXCLUDED.listeners, starts = EXCLUDED.starts,
           skips = EXCLUDED.skips, completes = EXCLUDED.completes, saves = EXCLUDED.saves, followers_gained = EXCLUDED.followers_gained`,
        [a.id, ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => col(rows.artist, i))],
      );
      await tx.query(
        `INSERT INTO agg_city_daily (artist_id, date, city, listeners, streams)
         SELECT $1, d, c, l, s FROM unnest($2::date[], $3::text[], $4::int[], $5::int[]) AS x(d, c, l, s)
         ON CONFLICT (artist_id, date, city) DO UPDATE SET listeners = EXCLUDED.listeners, streams = EXCLUDED.streams`,
        [a.id, ...[0, 1, 2, 3].map((i) => col(rows.city, i))],
      );
      await tx.query(
        `INSERT INTO agg_age_daily (artist_id, date, age_group, streams)
         SELECT $1, d, g, s FROM unnest($2::date[], $3::text[], $4::int[]) AS x(d, g, s)
         ON CONFLICT (artist_id, date, age_group) DO UPDATE SET streams = EXCLUDED.streams`,
        [a.id, ...[0, 1, 2].map((i) => col(rows.age, i))],
      );
      await tx.query(
        `INSERT INTO agg_source_daily (artist_id, date, source, streams)
         SELECT $1, d, s, n FROM unnest($2::date[], $3::text[], $4::int[]) AS x(d, s, n)
         ON CONFLICT (artist_id, date, source) DO UPDATE SET streams = EXCLUDED.streams`,
        [a.id, ...[0, 1, 2].map((i) => col(rows.src, i))],
      );
      await tx.query(
        `INSERT INTO agg_track_daily (artist_id, date, track_id, streams)
         SELECT $1, d, t, n FROM unnest($2::date[], $3::uuid[], $4::int[]) AS x(d, t, n)
         ON CONFLICT (track_id, date) DO UPDATE SET streams = EXCLUDED.streams`,
        [a.id, ...[0, 1, 2].map((i) => col(rows.track, i))],
      );
      await tx.query(
        `INSERT INTO agg_uniques_28d (artist_id, date, base)
         SELECT $1, d, b FROM unnest($2::date[], $3::int[]) AS x(d, b)
         ON CONFLICT (artist_id, date) DO UPDATE SET base = EXCLUDED.base`,
        [a.id, col(rows.uniq, 0), col(rows.uniq, 1)],
      );
      for (const t of tracks) {
        await tx.query(`INSERT INTO track_artists (track_id, artist_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [t.id, a.id]);
      }
    }
  });
  log.info(`seed playback: analitik sintetis ${DAYS} hari untuk ${SEED.artists.length} artis`);
}
