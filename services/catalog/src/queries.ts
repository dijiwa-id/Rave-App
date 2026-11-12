import type { Client, Db } from '@rave/service-kit';

type Q = Pick<Db, 'query'> | Client;
async function rows<T = any>(q: Q, sql: string, params: unknown[] = []): Promise<T[]> {
  const r: any = await (q as any).query(sql, params);
  return Array.isArray(r) ? r : r.rows;
}

/** SELECT standar Track (docs/API.md §2). Alias: t=tracks, a=artists, r=releases. */
export const TRACK_SELECT = `
  SELECT t.id, t.title, t.duration_ms, t.explicit, t.isrc, t.track_number, t.play_count,
         EXISTS (SELECT 1 FROM lyrics l WHERE l.track_id = t.id) AS has_lyrics,
         (SELECT json_build_object(
                   'lossless', coalesce((au.audio_meta->>'lossless')::bool, false),
                   'hires', coalesce((au.audio_meta->>'lossless')::bool AND ((au.audio_meta->>'bit_depth')::int > 16 OR (au.audio_meta->>'sample_rate')::int > 48000), false),
                   'sample_rate', (au.audio_meta->>'sample_rate')::int,
                   'bit_depth', nullif((au.audio_meta->>'bit_depth')::int, 0),
                   'codec', au.audio_meta->>'codec',
                   'transcode_status', au.transcode_status)
            FROM uploads au WHERE au.audio_meta IS NOT NULL AND au.stored_name = split_part(t.audio_url, '/v1/catalog/media/', 2)) AS audio,
         json_build_object('id', a.id, 'name', a.name, 'slug', a.slug) AS artist,
         json_build_object('id', r.id, 'title', r.title, 'cover_url', r.cover_url) AS release
  FROM tracks t JOIN releases r ON r.id = t.release_id JOIN artists a ON a.id = t.artist_id`;

export const ARTIST_SUMMARY_COLS = `a.id, a.slug, a.name, a.image_url, a.city, a.genres, a.verified, a.monthly_listeners`;

export const RELEASE_SUMMARY_SELECT = `
  SELECT r.id, r.title, r.type, r.cover_url, to_char(r.release_date, 'YYYY-MM-DD') AS release_date,
         json_build_object('id', a.id, 'name', a.name, 'slug', a.slug) AS artist
  FROM releases r JOIN artists a ON a.id = r.artist_id`;

export const RELEASE_FULL_COLS = `r.status, r.label, r.genre, r.upc, r.explicit, r.qc_reason`;

export async function tracksOfRelease(q: Q, releaseId: string) {
  return rows(q, `${TRACK_SELECT} WHERE t.release_id = $1 ORDER BY t.track_number`, [releaseId]);
}

/** Release lengkap (semua status) — pemanggil memeriksa hak akses. */
export async function releaseFull(q: Q, id: string) {
  const [r] = await rows(
    q,
    `SELECT r.id, r.title, r.type, r.cover_url, to_char(r.release_date, 'YYYY-MM-DD') AS release_date,
            json_build_object('id', a.id, 'name', a.name, 'slug', a.slug) AS artist, r.artist_id,
            ${RELEASE_FULL_COLS}
     FROM releases r JOIN artists a ON a.id = r.artist_id WHERE r.id = $1`,
    [id],
  );
  if (!r) return null;
  r.tracks = await tracksOfRelease(q, id);
  return r;
}

/**
 * Banyak rilis lengkap sekaligus (2 query, bukan 2×N) — urutan mengikuti `ids`. `extraCols` = kolom tambahan dari
 * `releases r` (mis. kolom tinjauan Studio). Pemanggil memeriksa hak akses.
 */
export async function releasesFull(q: Q, ids: string[], extraCols = ''): Promise<any[]> {
  if (!ids.length) return [];
  const rels = await rows(
    q,
    `SELECT r.id, r.title, r.type, r.cover_url, to_char(r.release_date, 'YYYY-MM-DD') AS release_date,
            json_build_object('id', a.id, 'name', a.name, 'slug', a.slug) AS artist, r.artist_id,
            ${RELEASE_FULL_COLS}${extraCols ? ', ' + extraCols : ''}
     FROM releases r JOIN artists a ON a.id = r.artist_id WHERE r.id = ANY($1::uuid[])`,
    [ids],
  );
  const tracks = await rows(q, `${TRACK_SELECT} WHERE t.release_id = ANY($1::uuid[]) ORDER BY t.track_number`, [ids]);
  const byRelease = new Map<string, any[]>();
  for (const t of tracks) {
    const k = t.release.id;
    if (!byRelease.has(k)) byRelease.set(k, []);
    byRelease.get(k)!.push(t);
  }
  const byId = new Map(rels.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((r) => ({ ...r, tracks: byRelease.get(r.id) ?? [] }));
}

export function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export const SHOW_COLS = `s.id, s.kind, s.title, s.publisher, s.description, s.cover_url, s.category, s.age_rating, s.content_warning`;
export const EPISODE_COLS = `e.id, e.show_id, e.title, e.description, e.duration_ms, e.published_at, e.is_premium, e.season, e.episode_number,
  coalesce(e.cover_url, (SELECT cover_url FROM shows WHERE id = e.show_id)) AS cover_url`;
