import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { isAdmin, managedArtistIds, notFound, z, type AuthUser, type ServiceContext } from '@gema/service-kit';
import { ARTIST_SUMMARY_COLS, EPISODE_COLS, RELEASE_SUMMARY_SELECT, SHOW_COLS, TRACK_SELECT, isUuid, releaseFull } from './queries.js';
import { UPLOAD_DIR } from './storage.js';

export function canManageArtist(u: AuthUser | null, artistId: string) {
  return isAdmin(u) || managedArtistIds(u).includes(artistId);
}

const media = {
  release: (r: any) => ({ id: r.id, kind: 'release', title: r.title, subtitle: `${r.type === 'SINGLE' ? 'Single' : r.type} • ${r.artist_name}`, image_url: r.cover_url, href: `/app/album/${r.id}` }),
  artist: (a: any) => ({ id: a.id, kind: 'artist', title: a.name, subtitle: 'Artis', image_url: a.image_url, href: `/app/artist/${a.slug}` }),
  show: (s: any) => ({ id: s.id, kind: 'show', title: s.title, subtitle: s.publisher, image_url: s.cover_url, href: `/app/show/${s.id}` }),
  episode: (e: any) => ({ id: e.id, kind: 'episode', title: e.title, subtitle: e.show_title, image_url: e.cover_url, href: `/app/episode/${e.id}` }),
};

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
};

export async function publicRoutes(app: FastifyInstance, { db }: ServiceContext) {
  const LIVE = `r.status = 'LIVE'`;

  // ---------- Beranda (REQ-STR-07) ----------
  app.get('/v1/catalog/home', async (req) => {
    const q = req.query as { city?: string };
    const city = q.city || req.user?.city || null;
    const [newReleases, popular, local, shows, episodes] = await Promise.all([
      db.query(
        `SELECT r.id, r.title, r.type, r.cover_url, a.name AS artist_name FROM releases r JOIN artists a ON a.id = r.artist_id
         WHERE ${LIVE} ORDER BY r.release_date DESC, r.created_at DESC LIMIT 10`,
      ),
      db.query(`SELECT id, slug, name, image_url FROM artists ORDER BY monthly_listeners DESC LIMIT 10`),
      city
        ? db.query(`SELECT id, slug, name, image_url FROM artists WHERE lower(city) = lower($1) ORDER BY monthly_listeners DESC LIMIT 10`, [city])
        : Promise.resolve([]),
      db.query(`SELECT s.id, s.title, s.publisher, s.cover_url FROM shows s ORDER BY s.kind, s.created_at LIMIT 10`),
      db.query(
        `SELECT e.id, e.title, coalesce(e.cover_url, s.cover_url) AS cover_url, s.title AS show_title
         FROM episodes e JOIN shows s ON s.id = e.show_id ORDER BY e.published_at DESC LIMIT 10`,
      ),
    ]);
    const quick = [
      ...newReleases.slice(0, 3).map(media.release),
      ...popular.slice(0, 2).map(media.artist),
      ...shows.slice(0, 1).map(media.show),
    ];
    const sections = [
      { id: 'new-releases', title: 'Rilis Baru', kind: 'releases', items: newReleases.map(media.release) },
      ...(local.length ? [{ id: 'local', title: `Indie Kotamu: ${city}`, kind: 'artists', items: local.map(media.artist) }] : []),
      { id: 'popular-artists', title: 'Artis Populer', kind: 'artists', items: popular.map(media.artist) },
      { id: 'shows', title: 'Podcast & Cerita Pilihan', kind: 'shows', items: shows.map(media.show) },
      { id: 'episodes', title: 'Episode Untukmu', kind: 'episodes', items: episodes.map(media.episode) },
    ];
    return { quick_picks: quick, sections };
  });

  // ---------- Browse (mockup Spotify 2) ----------
  app.get('/v1/catalog/browse', async () => ({
    data: await db.query(`SELECT id, name, color, image_url, href FROM categories ORDER BY position`),
  }));

  /** Tambahan (aditif): isi kategori — artis, rilis & lagu berdasar genre kategori. */
  app.get('/v1/catalog/browse/:id', async (req) => {
    const { id } = req.params as { id: string };
    const cat = await db.one(`SELECT id, name, color, image_url, href, genres FROM categories WHERE id = $1`, [id]);
    if (!cat) throw notFound('Kategori');
    const g: string[] = cat.genres ?? [];
    const [artists, releases, tracks] = await Promise.all([
      db.query(`SELECT ${ARTIST_SUMMARY_COLS} FROM artists a WHERE $1::text[] = '{}' OR a.genres && $1 ORDER BY a.monthly_listeners DESC LIMIT 20`, [g]),
      db.query(`${RELEASE_SUMMARY_SELECT} WHERE ${LIVE} AND ($1::text[] = '{}' OR r.genre = ANY($1) OR a.genres && $1) ORDER BY r.release_date DESC LIMIT 20`, [g]),
      db.query(`${TRACK_SELECT} WHERE ${LIVE} AND ($1::text[] = '{}' OR a.genres && $1) ORDER BY t.play_count DESC LIMIT 30`, [g]),
    ]);
    delete cat.genres;
    return { category: cat, artists, releases, tracks };
  });

  app.get('/v1/catalog/genres', async () => ({ data: await db.query(`SELECT id, name FROM genres ORDER BY name`) }));

  // ---------- Pencarian toleran typo (REQ-STR-05) ----------
  app.get('/v1/catalog/search', async (req) => {
    const q = z.object({ q: z.string().trim().min(1).max(100), type: z.string().optional() }).parse(req.query);
    const term = q.q;
    const want = (t: string) => !q.type || q.type.split(',').includes(t);
    const match = (col: string) => `(${col} ILIKE '%' || $1 || '%' OR $1 <% ${col} OR ${col} % $1)`;
    const score = (col: string) => `greatest(similarity(${col}, $1), word_similarity($1, ${col}))`;
    const [artists, tracks, releases, shows, episodes] = await Promise.all([
      want('artist')
        ? db.query(`SELECT ${ARTIST_SUMMARY_COLS} FROM artists a WHERE ${match('a.name')} ORDER BY ${score('a.name')} DESC, a.monthly_listeners DESC LIMIT 10`, [term])
        : [],
      want('track')
        ? db.query(
            `${TRACK_SELECT} LEFT JOIN lyrics ly ON ly.track_id = t.id
             WHERE ${LIVE} AND (${match('t.title')} OR ${match('a.name')} OR ly.plain ILIKE '%' || $1 || '%')
             ORDER BY greatest(${score('t.title')}, ${score('a.name')} * 0.8, CASE WHEN ly.plain ILIKE '%' || $1 || '%' THEN 0.5 ELSE 0 END) DESC, t.play_count DESC
             LIMIT 20`,
            [term],
          )
        : [],
      want('release')
        ? db.query(`${RELEASE_SUMMARY_SELECT} WHERE ${LIVE} AND (${match('r.title')} OR ${match('a.name')}) ORDER BY greatest(${score('r.title')}, ${score('a.name')}) DESC LIMIT 10`, [term])
        : [],
      want('show') ? db.query(`SELECT ${SHOW_COLS} FROM shows s WHERE ${match('s.title')} OR ${match('s.publisher')} ORDER BY ${score('s.title')} DESC LIMIT 10`, [term]) : [],
      want('episode') ? db.query(`SELECT ${EPISODE_COLS} FROM episodes e WHERE ${match('e.title')} ORDER BY ${score('e.title')} DESC LIMIT 10`, [term]) : [],
    ]);
    return { artists, tracks, releases, shows, episodes };
  });

  // ---------- Artis ----------
  app.get('/v1/catalog/artists', async (req) => {
    const q = req.query as { genre?: string; city?: string; ids?: string };
    const ids = q.ids ? q.ids.split(',').filter(isUuid).slice(0, 100) : null;
    const data = await db.query(
      `SELECT ${ARTIST_SUMMARY_COLS} FROM artists a
       WHERE ($1::text IS NULL OR $1 = ANY(a.genres)) AND ($2::text IS NULL OR lower(a.city) = lower($2)) AND ($3::uuid[] IS NULL OR a.id = ANY($3))
       ORDER BY a.monthly_listeners DESC LIMIT 100`,
      [q.genre ?? null, q.city ?? null, ids],
    );
    return { data };
  });

  app.get('/v1/catalog/artists/:idOrSlug', async (req) => {
    const { idOrSlug } = req.params as { idOrSlug: string };
    const a = await db.one(
      `SELECT ${ARTIST_SUMMARY_COLS}, a.bio, a.cover_url, a.followers, a.org_id FROM artists a WHERE ${isUuid(idOrSlug) ? 'a.id' : 'a.slug'} = $1`,
      [idOrSlug],
    );
    if (!a) throw notFound('Artis');
    a.top_tracks = await db.query(`${TRACK_SELECT} WHERE ${LIVE} AND t.artist_id = $1 ORDER BY t.play_count DESC, t.track_number LIMIT 10`, [a.id]);
    a.releases = await db.query(`${RELEASE_SUMMARY_SELECT} WHERE ${LIVE} AND r.artist_id = $1 ORDER BY r.release_date DESC`, [a.id]);
    return a;
  });

  // ---------- Rilis & lagu ----------
  app.get('/v1/catalog/releases/:id', async (req) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound('Rilis');
    const r = await releaseFull(db, id);
    if (!r || (r.status !== 'LIVE' && !canManageArtist(req.user, r.artist_id))) throw notFound('Rilis');
    delete r.artist_id;
    return r;
  });

  app.get('/v1/catalog/tracks', async (req) => {
    const { ids } = req.query as { ids?: string };
    const list = (ids ?? '').split(',').filter(isUuid).slice(0, 200);
    if (!list.length) return { data: [] };
    const rows = await db.query(`${TRACK_SELECT} WHERE ${LIVE} AND t.id = ANY($1)`, [list]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return { data: list.map((i) => byId.get(i)).filter(Boolean) }; // pertahankan urutan permintaan
  });

  app.get('/v1/catalog/tracks/:id', async (req) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound('Lagu');
    const t = await db.one(`${TRACK_SELECT} WHERE t.id = $1 AND ${LIVE}`, [id]);
    if (!t) throw notFound('Lagu');
    return t;
  });

  app.get('/v1/catalog/tracks/:id/lyrics', async (req) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound('Lirik');
    const l = await db.one(
      `SELECT l.synced, l.lines FROM lyrics l JOIN tracks t ON t.id = l.track_id JOIN releases r ON r.id = t.release_id WHERE l.track_id = $1 AND ${LIVE}`,
      [id],
    );
    if (!l) throw notFound('Lirik');
    return l;
  });

  // ---------- Podcast & fiksi ----------
  app.get('/v1/catalog/shows', async (req) => {
    const q = req.query as { kind?: string; category?: string };
    const data = await db.query(
      `SELECT ${SHOW_COLS} FROM shows s WHERE ($1::text IS NULL OR s.kind = $1) AND ($2::text IS NULL OR s.category = $2) ORDER BY s.created_at`,
      [q.kind ?? null, q.category ?? null],
    );
    return { data };
  });

  app.get('/v1/catalog/shows/:id', async (req) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound('Show');
    const s = await db.one(`SELECT ${SHOW_COLS} FROM shows s WHERE s.id = $1`, [id]);
    if (!s) throw notFound('Show');
    s.episodes = await db.query(
      `SELECT ${EPISODE_COLS} FROM episodes e WHERE e.show_id = $1
       ORDER BY ${s.kind === 'FICTION' ? 'e.season NULLS FIRST, e.episode_number' : 'e.published_at DESC'}`,
      [id],
    );
    return s;
  });

  app.get('/v1/catalog/episodes/:id', async (req) => {
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound('Episode');
    const e = await db.one(`SELECT ${EPISODE_COLS} FROM episodes e WHERE e.id = $1`, [id]);
    if (!e) throw notFound('Episode');
    e.show = await db.one(`SELECT ${SHOW_COLS} FROM shows s WHERE s.id = $1`, [e.show_id]);
    return e;
  });

  // ---------- Media hasil upload (dev; produksi: CDN/object storage) ----------
  app.get('/v1/catalog/media/:file', async (req, reply) => {
    const { file } = req.params as { file: string };
    if (!/^[\w.-]+$/.test(file)) throw notFound('Media');
    const p = join(UPLOAD_DIR, file);
    if (!existsSync(p)) throw notFound('Media');
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    reply.header('content-type', MIME[ext] ?? 'application/octet-stream');
    reply.header('content-length', statSync(p).size);
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return reply.send(createReadStream(p));
  });
}
