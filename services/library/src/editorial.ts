import type { FastifyInstance, FastifyRequest } from 'fastify';
import { audit, badRequest, notFound, requirePermission, unprocessable, uuidv7, z, type ServiceContext } from '@rave/service-kit';
import { hydrateTracks } from './hydrate.js';

/**
 * Editor playlist editorial — Back Office, izin `library.curate` (Super Admin selalu boleh; default juga peran Editorial).
 *
 *   GET    /v1/admin/library/playlists                 daftar semua playlist editorial (termasuk draf)
 *   POST   /v1/admin/library/playlists                 buat (default draf, urutan paling akhir)
 *   GET    /v1/admin/library/playlists/:id             detail + lagu
 *   PATCH  /v1/admin/library/playlists/:id             ubah judul/deskripsi/sampul/tag/tayang
 *   DELETE /v1/admin/library/playlists/:id             hapus
 *   PUT    /v1/admin/library/playlists/order           urutan tampil di beranda { ids: [...] }
 *   POST   /v1/admin/library/playlists/:id/items       tambah lagu (banyak sekaligus, duplikat dilewati)
 *
 * Hapus & pindah satu lagu memakai endpoint playlist biasa (DELETE …/items/:itemId, POST …/items/:itemId/move) —
 * canEdit() mengizinkan kurator untuk playlist editorial. Semua perubahan tercatat di audit log.
 */

const MAX_ITEMS = 10_000;
const MAX_BATCH = 200;
const OWNER = { id: 'rave', name: 'RAVE' };
const uuid = z.string().uuid();
const tag = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Tag: huruf kecil, angka & tanda hubung (maks 40)');
const coverUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v.startsWith('/v1/catalog/media/') || /^https:\/\//.test(v), 'Sampul harus unggahan RAVE (/v1/catalog/media/…) atau URL https');
const body = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  cover_url: coverUrl.nullable().optional(),
  tags: z.array(tag).max(12).optional(),
  published: z.boolean().optional(),
});

export async function editorialRoutes(app: FastifyInstance, { db, log }: ServiceContext) {
  const ip = (req: FastifyRequest) => (req.headers['x-forwarded-for'] as string) ?? req.ip;
  const SELECT = `SELECT p.*, (SELECT count(*)::int FROM playlist_items i WHERE i.playlist_id = p.id) AS track_count FROM playlists p`;

  function out(p: any, firstCover?: string | null) {
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      cover_url: p.cover_url ?? firstCover ?? null,
      has_custom_cover: !!p.cover_url,
      tags: p.tags ?? [],
      sort_order: p.sort_order,
      published: p.published,
      track_count: p.track_count ?? 0,
      created_at: p.created_at,
      updated_at: p.updated_at,
    };
  }
  async function load(id: string) {
    const p = await db.one(`${SELECT} WHERE p.id = $1 AND p.is_editorial`, [uuid.parse(id)]);
    if (!p) throw notFound('Playlist editorial');
    return p;
  }
  /** Sampul otomatis dari lagu pertama bila tidak diunggah. */
  async function firstCovers(rows: any[]) {
    const need = rows.filter((r) => !r.cover_url).map((r) => r.id);
    if (!need.length) return new Map<string, string | null>();
    const firsts = await db.query(`SELECT DISTINCT ON (playlist_id) playlist_id, track_id FROM playlist_items WHERE playlist_id = ANY($1) ORDER BY playlist_id, position`, [need]);
    const tracks = await hydrateTracks(firsts.map((f) => f.track_id), log);
    return new Map(firsts.map((f) => [f.playlist_id as string, tracks.get(f.track_id)?.release.cover_url ?? null]));
  }
  async function detail(id: string) {
    const p = await load(id);
    const items = await db.query(`SELECT id, track_id, added_at FROM playlist_items WHERE playlist_id = $1 ORDER BY position LIMIT $2`, [id, MAX_ITEMS]);
    const tracks = await hydrateTracks(items.map((i) => i.track_id), log);
    const first = items[0] ? tracks.get(items[0].track_id)?.release.cover_url : null;
    return { ...out(p, first), items: items.map((i) => ({ item_id: i.id, added_at: i.added_at, track: tracks.get(i.track_id)! })) };
  }

  app.register(async (a) => {
    a.addHook('preHandler', requirePermission('library.curate'));

    a.get('/v1/admin/library/playlists', async (req) => {
      const q = z.object({ status: z.enum(['all', 'published', 'draft']).default('all'), q: z.string().trim().max(100).optional() }).parse(req.query ?? {});
      const rows = await db.query(
        `${SELECT} WHERE p.is_editorial
           AND ($1 = 'all' OR p.published = ($1 = 'published'))
           AND ($2::text IS NULL OR p.title ILIKE '%' || $2 || '%' OR $2 = ANY(p.tags))
         ORDER BY p.sort_order, p.created_at`,
        [q.status, q.q || null],
      );
      const covers = await firstCovers(rows);
      return { data: rows.map((r) => out(r, covers.get(r.id))) };
    });

    a.post('/v1/admin/library/playlists', async (req, reply) => {
      const b = body.parse(req.body);
      const id = uuidv7();
      await db.tx(async (tx) => {
        const next = (await tx.query(`SELECT coalesce(max(sort_order), 0) + 1 AS n FROM playlists WHERE is_editorial`)).rows[0].n;
        await tx.query(
          `INSERT INTO playlists (id, owner_id, owner_name, title, description, cover_url, visibility, is_editorial, tags, sort_order, published)
           VALUES ($1,$2,$3,$4,$5,$6,'PUBLIC',true,$7,$8,$9)`,
          [id, OWNER.id, OWNER.name, b.title, b.description ?? null, b.cover_url ?? null, [...new Set(b.tags ?? [])], next, b.published ?? false],
        );
        await audit(tx, { actorId: req.user!.sub, action: 'editorial.create', entity: 'playlist', entityId: id, data: { title: b.title, published: b.published ?? false }, ip: ip(req) });
      });
      reply.status(201);
      return detail(id);
    });

    // Didaftarkan sebelum '/:id' agar "order" tidak dibaca sebagai id.
    a.put('/v1/admin/library/playlists/order', async (req) => {
      const { ids } = z.object({ ids: z.array(uuid).min(1).max(500) }).parse(req.body);
      if (new Set(ids).size !== ids.length) throw badRequest('Daftar id berisi duplikat');
      await db.tx(async (tx) => {
        const all = (await tx.query(`SELECT id FROM playlists WHERE is_editorial FOR UPDATE`)).rows.map((r) => r.id as string);
        const unknown = ids.filter((i) => !all.includes(i));
        if (unknown.length) throw unprocessable(`Bukan playlist editorial: ${unknown.join(', ')}`);
        // Yang tidak disebut tetap di belakang dengan urutan relatif lama.
        const rest = (await tx.query(`SELECT id FROM playlists WHERE is_editorial AND NOT (id = ANY($1)) ORDER BY sort_order, created_at`, [ids])).rows.map((r) => r.id);
        const order = [...ids, ...rest];
        await tx.query(`UPDATE playlists p SET sort_order = o.n FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, n) WHERE p.id = o.id`, [order]);
        await audit(tx, { actorId: req.user!.sub, action: 'editorial.reorder', entity: 'playlist', data: { ids: order }, ip: ip(req) });
      });
      const rows = await db.query(`${SELECT} WHERE p.is_editorial ORDER BY p.sort_order, p.created_at`);
      const covers = await firstCovers(rows);
      return { data: rows.map((r) => out(r, covers.get(r.id))) };
    });

    a.get('/v1/admin/library/playlists/:id', async (req) => detail((req.params as { id: string }).id));

    a.patch('/v1/admin/library/playlists/:id', async (req) => {
      const { id } = req.params as { id: string };
      const b = body.partial().parse(req.body);
      if (!Object.keys(b).length) throw badRequest('Tidak ada perubahan');
      const p = await load(id);
      await db.tx(async (tx) => {
        await tx.query(
          `UPDATE playlists SET title = coalesce($2, title),
             description = CASE WHEN $3 THEN $4 ELSE description END,
             cover_url = CASE WHEN $5 THEN $6 ELSE cover_url END,
             tags = coalesce($7, tags), published = coalesce($8, published), updated_at = now()
           WHERE id = $1`,
          [id, b.title ?? null, 'description' in b, b.description ?? null, 'cover_url' in b, b.cover_url ?? null, b.tags ? [...new Set(b.tags)] : null, b.published ?? null],
        );
        await audit(tx, {
          actorId: req.user!.sub,
          action: b.published !== undefined && b.published !== p.published ? (b.published ? 'editorial.publish' : 'editorial.unpublish') : 'editorial.update',
          entity: 'playlist',
          entityId: id,
          data: { changed: Object.keys(b) },
          ip: ip(req),
        });
      });
      return detail(id);
    });

    a.delete('/v1/admin/library/playlists/:id', async (req) => {
      const { id } = req.params as { id: string };
      const p = await load(id);
      await db.tx(async (tx) => {
        await tx.query(`DELETE FROM playlists WHERE id = $1 AND is_editorial`, [id]);
        await audit(tx, { actorId: req.user!.sub, action: 'editorial.delete', entity: 'playlist', entityId: id, data: { title: p.title, tracks: p.track_count }, ip: ip(req) });
      });
      return { ok: true };
    });

    a.post('/v1/admin/library/playlists/:id/items', async (req, reply) => {
      const { id } = req.params as { id: string };
      const { track_ids } = z.object({ track_ids: z.array(uuid).min(1).max(MAX_BATCH) }).parse(req.body);
      const wanted = [...new Set(track_ids)];
      // Hanya lagu yang tersedia di katalog (bukan stub "Lagu tidak tersedia").
      const tracks = await hydrateTracks(wanted, log);
      const missing = wanted.filter((t) => !tracks.get(t) || tracks.get(t)!.unavailable);
      if (missing.length) throw unprocessable(`Lagu tidak ditemukan / tidak tersedia: ${missing.join(', ')}`);
      const added = await db.tx(async (tx) => {
        const p = (await tx.query(`SELECT * FROM playlists WHERE id = $1 AND is_editorial FOR UPDATE`, [uuid.parse(id)])).rows[0];
        if (!p) throw notFound('Playlist editorial');
        const have = new Set((await tx.query(`SELECT track_id FROM playlist_items WHERE playlist_id = $1 AND track_id = ANY($2)`, [id, wanted])).rows.map((r) => r.track_id as string));
        const fresh = wanted.filter((t) => !have.has(t));
        const agg = (await tx.query(`SELECT count(*)::int AS n, coalesce(max(position), 0) AS maxpos FROM playlist_items WHERE playlist_id = $1`, [id])).rows[0];
        if (agg.n + fresh.length > MAX_ITEMS) throw unprocessable(`Batas ${MAX_ITEMS} lagu per playlist`);
        const rows: { id: string; track_id: string; added_at: string }[] = [];
        let pos = Number(agg.maxpos);
        for (const t of fresh) {
          const r = (await tx.query(`INSERT INTO playlist_items (id, playlist_id, track_id, position, added_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, track_id, added_at`, [uuidv7(), id, t, ++pos, req.user!.sub])).rows[0];
          rows.push(r);
        }
        if (rows.length) {
          await tx.query(`UPDATE playlists SET updated_at = now() WHERE id = $1`, [id]);
          await audit(tx, { actorId: req.user!.sub, action: 'editorial.items_add', entity: 'playlist', entityId: id, data: { track_ids: fresh }, ip: ip(req) });
        }
        return { rows, skipped: wanted.length - fresh.length };
      });
      reply.status(201);
      return { added: added.rows.map((r) => ({ item_id: r.id, added_at: r.added_at, track: tracks.get(r.track_id)! })), skipped_duplicates: added.skipped };
    });
  });
}
