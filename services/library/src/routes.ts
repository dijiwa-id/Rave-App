import type { FastifyInstance, FastifyRequest } from 'fastify';
import { badRequest, forbidden, notFound, publish, requireAuth, unprocessable, uuidv7, z, type ServiceContext } from '@gema/service-kit';
import { hydrateTracks } from './hydrate.js';

const MAX_ITEMS = 10_000;
const uuid = z.string().uuid();

function summary(p: any) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    cover_url: p.cover_url ?? p.first_cover ?? null,
    owner: { id: p.owner_id, name: p.owner_name },
    visibility: p.visibility,
    track_count: p.track_count ?? 0,
    is_editorial: p.is_editorial,
  };
}

const PLAYLIST_SELECT = `SELECT p.*, (SELECT count(*)::int FROM playlist_items i WHERE i.playlist_id = p.id) AS track_count FROM playlists p`;

export async function routes(app: FastifyInstance, { db, log }: ServiceContext) {
  /** Lengkapi cover playlist tanpa cover memakai artwork lagu pertama. */
  async function withCovers(rows: any[]) {
    const need = rows.filter((r) => !r.cover_url);
    if (!need.length) return rows.map(summary);
    const firsts = await db.query(
      `SELECT DISTINCT ON (playlist_id) playlist_id, track_id FROM playlist_items WHERE playlist_id = ANY($1) ORDER BY playlist_id, position`,
      [need.map((r) => r.id)],
    );
    const tracks = await hydrateTracks(firsts.map((f) => f.track_id), log);
    const cover = new Map(firsts.map((f) => [f.playlist_id, tracks.get(f.track_id)?.release.cover_url ?? null]));
    return rows.map((r) => summary({ ...r, first_cover: cover.get(r.id) }));
  }

  async function loadPlaylist(id: string) {
    const p = await db.one(`${PLAYLIST_SELECT} WHERE p.id = $1`, [id]);
    if (!p) throw notFound('Playlist');
    return p;
  }

  async function canEdit(p: any, userId: string, itemsOnly = false) {
    if (p.owner_id === userId) return true;
    if (itemsOnly && p.visibility === 'COLLAB') return !!(await db.one(`SELECT 1 FROM playlist_collaborators WHERE playlist_id = $1 AND user_id = $2`, [p.id, userId]));
    return false;
  }

  function canView(p: any, req: FastifyRequest) {
    if (p.is_editorial || p.visibility !== 'PRIVATE') return true;
    return req.user?.sub === p.owner_id || req.user?.roles.includes('admin');
  }

  // ---------- Publik ----------
  app.get('/v1/library/playlists/featured', async (req) => {
    const { tag } = req.query as { tag?: string };
    const rows = await db.query(`${PLAYLIST_SELECT} WHERE p.is_editorial AND ($1::text IS NULL OR $1 = ANY(p.tags)) ORDER BY p.sort_order, p.created_at`, [tag ?? null]);
    return { data: await withCovers(rows) };
  });

  app.get('/v1/library/playlists/:id', async (req) => {
    const { id } = req.params as { id: string };
    if (!uuid.safeParse(id).success) throw notFound('Playlist');
    const p = await loadPlaylist(id);
    if (!canView(p, req)) throw notFound('Playlist');
    const items = await db.query(`SELECT id, track_id, added_at FROM playlist_items WHERE playlist_id = $1 ORDER BY position LIMIT $2`, [id, MAX_ITEMS]);
    const tracks = await hydrateTracks(items.map((i) => i.track_id), log);
    const [s] = await withCovers([p]);
    return { ...s, items: items.map((i) => ({ item_id: i.id, added_at: i.added_at, track: tracks.get(i.track_id)! })) };
  });

  // ---------- Butuh login ----------
  app.register(async (a) => {
    a.addHook('preHandler', requireAuth);
    const uid = (req: FastifyRequest) => req.user!.sub;

    a.get('/v1/library/summary', async (req) => {
      const u = uid(req);
      const [liked, pls, fol, rel, recent] = await Promise.all([
        db.one(`SELECT count(*)::int AS n FROM likes WHERE user_id = $1`, [u]),
        db.query(
          `${PLAYLIST_SELECT} WHERE p.owner_id = $1 OR p.id IN (SELECT playlist_id FROM playlist_collaborators WHERE user_id = $2) ORDER BY p.updated_at DESC`,
          [u, u],
        ),
        db.query(`SELECT artist_id FROM follows WHERE user_id = $1 ORDER BY created_at DESC`, [u]),
        db.query(`SELECT release_id FROM saved_releases WHERE user_id = $1 ORDER BY created_at DESC`, [u]),
        db.query(`SELECT track_id FROM (SELECT DISTINCT ON (track_id) track_id, played_at FROM listening_history WHERE user_id = $1 ORDER BY track_id, played_at DESC) h ORDER BY played_at DESC LIMIT 20`, [u]),
      ]);
      return {
        liked_count: liked?.n ?? 0,
        playlists: await withCovers(pls),
        followed_artists: fol.map((r) => r.artist_id),
        saved_releases: rel.map((r) => r.release_id),
        recent_track_ids: recent.map((r) => r.track_id),
      };
    });

    // Likes
    a.get('/v1/library/likes', async (req) => {
      const rows = await db.query(`SELECT track_id FROM likes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5000`, [uid(req)]);
      const t = await hydrateTracks(rows.map((r) => r.track_id), log);
      return { data: rows.map((r) => t.get(r.track_id)!) };
    });
    a.get('/v1/library/likes/contains', async (req) => {
      const ids = String((req.query as any).ids ?? '')
        .split(',')
        .filter((s) => uuid.safeParse(s).success)
        .slice(0, 200);
      if (!ids.length) return { ids: [] };
      const rows = await db.query(`SELECT track_id FROM likes WHERE user_id = $1 AND track_id = ANY($2)`, [uid(req), ids]);
      return { ids: rows.map((r) => r.track_id) };
    });
    a.put('/v1/library/likes/:trackId', async (req) => {
      const trackId = uuid.parse((req.params as any).trackId);
      await db.tx(async (tx) => {
        const r = await tx.query(`INSERT INTO likes (user_id, track_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [uid(req), trackId]);
        if (r.rowCount) await publish(tx, 'library.track.liked', uid(req), { userId: uid(req), trackId });
      });
      return { liked: true };
    });
    a.delete('/v1/library/likes/:trackId', async (req) => {
      await db.query(`DELETE FROM likes WHERE user_id = $1 AND track_id = $2`, [uid(req), uuid.parse((req.params as any).trackId)]);
      return { liked: false };
    });

    // Follows
    a.get('/v1/library/follows/:artistId', async (req) => {
      const r = await db.one(`SELECT 1 FROM follows WHERE user_id = $1 AND artist_id = $2`, [uid(req), uuid.parse((req.params as any).artistId)]);
      return { following: !!r };
    });
    a.put('/v1/library/follows/:artistId', async (req) => {
      const artistId = uuid.parse((req.params as any).artistId);
      await db.tx(async (tx) => {
        const r = await tx.query(`INSERT INTO follows (user_id, artist_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [uid(req), artistId]);
        if (r.rowCount) await publish(tx, 'library.artist.followed', artistId, { userId: uid(req), artistId });
      });
      return { following: true };
    });
    a.delete('/v1/library/follows/:artistId', async (req) => {
      const artistId = uuid.parse((req.params as any).artistId);
      await db.tx(async (tx) => {
        const r = await tx.query(`DELETE FROM follows WHERE user_id = $1 AND artist_id = $2`, [uid(req), artistId]);
        if (r.rowCount) await publish(tx, 'library.artist.unfollowed', artistId, { userId: uid(req), artistId });
      });
      return { following: false };
    });

    // Saved releases
    a.put('/v1/library/releases/:releaseId', async (req) => {
      await db.query(`INSERT INTO saved_releases (user_id, release_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [uid(req), uuid.parse((req.params as any).releaseId)]);
      return { saved: true };
    });
    a.delete('/v1/library/releases/:releaseId', async (req) => {
      await db.query(`DELETE FROM saved_releases WHERE user_id = $1 AND release_id = $2`, [uid(req), uuid.parse((req.params as any).releaseId)]);
      return { saved: false };
    });

    // Playlists
    a.get('/v1/library/playlists', async (req) => {
      const rows = await db.query(
        `${PLAYLIST_SELECT} WHERE p.owner_id = $1 OR p.id IN (SELECT playlist_id FROM playlist_collaborators WHERE user_id = $2) ORDER BY p.updated_at DESC`,
        [uid(req), uid(req)],
      );
      return { data: await withCovers(rows) };
    });

    const plBody = z.object({
      title: z.string().trim().min(1).max(100),
      description: z.string().max(300).nullable().optional(),
      visibility: z.enum(['PUBLIC', 'PRIVATE', 'COLLAB']).optional(),
      cover_url: z.string().url().nullable().optional(),
    });
    a.post('/v1/library/playlists', async (req, reply) => {
      const b = plBody.parse(req.body);
      const p = await db.one(
        `INSERT INTO playlists (id, owner_id, owner_name, title, description, visibility, cover_url) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *, 0 AS track_count`,
        [uuidv7(), uid(req), req.user!.name ?? 'Kamu', b.title, b.description ?? null, b.visibility ?? 'PUBLIC', b.cover_url ?? null],
      );
      reply.status(201);
      return { ...summary(p), items: [] };
    });
    a.patch('/v1/library/playlists/:id', async (req) => {
      const { id } = req.params as { id: string };
      const p = await loadPlaylist(uuid.parse(id));
      if (!(await canEdit(p, uid(req)))) throw forbidden('Hanya pemilik playlist');
      const b = plBody.partial().parse(req.body);
      await db.query(
        `UPDATE playlists SET title = coalesce($2, title), description = CASE WHEN $3 THEN $4 ELSE description END,
           visibility = coalesce($5, visibility), cover_url = CASE WHEN $6 THEN $7 ELSE cover_url END, updated_at = now() WHERE id = $1`,
        [id, b.title ?? null, 'description' in b, b.description ?? null, b.visibility ?? null, 'cover_url' in b, b.cover_url ?? null],
      );
      const [s] = await withCovers([await loadPlaylist(id)]);
      return s;
    });
    a.delete('/v1/library/playlists/:id', async (req) => {
      const { id } = req.params as { id: string };
      const p = await loadPlaylist(uuid.parse(id));
      if (!(await canEdit(p, uid(req)))) throw forbidden('Hanya pemilik playlist');
      await db.query(`DELETE FROM playlists WHERE id = $1`, [id]);
      return { ok: true };
    });

    a.post('/v1/library/playlists/:id/items', async (req, reply) => {
      const { id } = req.params as { id: string };
      const { track_id } = z.object({ track_id: z.string().uuid() }).parse(req.body);
      const item = await db.tx(async (tx) => {
        const p = (await tx.query(`SELECT * FROM playlists WHERE id = $1 FOR UPDATE`, [uuid.parse(id)])).rows[0];
        if (!p) throw notFound('Playlist');
        if (!(await canEdit(p, uid(req), true))) throw forbidden('Tidak dapat mengubah playlist ini');
        const agg = (await tx.query(`SELECT count(*)::int AS n, coalesce(max(position), 0) AS maxpos FROM playlist_items WHERE playlist_id = $1`, [id])).rows[0];
        if (agg.n >= MAX_ITEMS) throw unprocessable(`Batas ${MAX_ITEMS} lagu per playlist`);
        const r = (
          await tx.query(`INSERT INTO playlist_items (id, playlist_id, track_id, position, added_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, added_at`, [
            uuidv7(),
            id,
            track_id,
            Number(agg.maxpos) + 1,
            uid(req),
          ])
        ).rows[0];
        await tx.query(`UPDATE playlists SET updated_at = now() WHERE id = $1`, [id]);
        return r;
      });
      const t = await hydrateTracks([track_id], log);
      reply.status(201);
      return { item_id: item.id, added_at: item.added_at, track: t.get(track_id) };
    });

    a.delete('/v1/library/playlists/:id/items/:itemId', async (req) => {
      const { id, itemId } = req.params as { id: string; itemId: string };
      const p = await loadPlaylist(uuid.parse(id));
      if (!(await canEdit(p, uid(req), true))) throw forbidden('Tidak dapat mengubah playlist ini');
      await db.query(`DELETE FROM playlist_items WHERE playlist_id = $1 AND id = $2`, [id, uuid.parse(itemId)]);
      return { ok: true };
    });

    // Fractional index: pindah ke setelah item lain (null = paling atas) tanpa renumber.
    a.post('/v1/library/playlists/:id/items/:itemId/move', async (req) => {
      const { id, itemId } = req.params as { id: string; itemId: string };
      const { after_item_id } = z.object({ after_item_id: z.string().uuid().nullable() }).parse(req.body);
      if (after_item_id === itemId) throw badRequest('after_item_id tidak boleh sama dengan item');
      await db.tx(async (tx) => {
        const p = (await tx.query(`SELECT * FROM playlists WHERE id = $1 FOR UPDATE`, [uuid.parse(id)])).rows[0];
        if (!p) throw notFound('Playlist');
        if (!(await canEdit(p, uid(req), true))) throw forbidden('Tidak dapat mengubah playlist ini');
        let pos: number;
        if (!after_item_id) {
          const r = (await tx.query(`SELECT coalesce(min(position), 1) AS m FROM playlist_items WHERE playlist_id = $1 AND id <> $2`, [id, itemId])).rows[0];
          pos = Number(r.m) - 1;
        } else {
          const after = (await tx.query(`SELECT position FROM playlist_items WHERE playlist_id = $1 AND id = $2`, [id, after_item_id])).rows[0];
          if (!after) throw notFound('Item acuan');
          const next = (
            await tx.query(`SELECT position FROM playlist_items WHERE playlist_id = $1 AND position > $2 AND id <> $3 ORDER BY position LIMIT 1`, [id, after.position, itemId])
          ).rows[0];
          pos = next ? (Number(after.position) + Number(next.position)) / 2 : Number(after.position) + 1;
        }
        const u = await tx.query(`UPDATE playlist_items SET position = $3 WHERE playlist_id = $1 AND id = $2`, [id, itemId, pos]);
        if (!u.rowCount) throw notFound('Item');
      });
      return { ok: true };
    });

    a.get('/v1/library/history', async (req) => {
      const rows = await db.query(`SELECT track_id, played_at FROM listening_history WHERE user_id = $1 ORDER BY played_at DESC LIMIT 50`, [uid(req)]);
      const t = await hydrateTracks(rows.map((r) => r.track_id), log);
      return { data: rows.map((r) => ({ ...t.get(r.track_id)!, played_at: r.played_at })) };
    });
  });
}
