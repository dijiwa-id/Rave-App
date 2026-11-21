import type { FastifyInstance, FastifyRequest } from 'fastify';
import { audit, badRequest, conflict, notFound, reqLocale, requirePermission, unprocessable, uuidv7, z, type ServiceContext } from '@rave/service-kit';
import { NEWS_CATEGORIES, NEWS_LIMITS, NEWS_SLUG_RE, hasEnglish, localizeNews, newsStatus, readMinutes, slugify, type NewsContent } from '@rave/domain/news';

/**
 * Ruang berita RAVE — publik (/berita) & Back Office → Konten → Berita (izin `news.publish`).
 *
 *   GET    /v1/platform/news                    publik: artikel tayang (?category=&limit=&offset=), bahasa dari Accept-Language
 *   GET    /v1/platform/news/:slug              publik: satu artikel tayang + "baca juga"
 *   GET    /v1/admin/platform/news              editor: semua artikel (?status=all|draft|scheduled|published|archived&q=&category=)
 *   POST   /v1/admin/platform/news              editor: buat draf
 *   GET    /v1/admin/platform/news/:id          editor: detail (kedua bahasa)
 *   PATCH  /v1/admin/platform/news/:id          editor: ubah isi/metadata
 *   POST   /v1/admin/platform/news/:id/publish  editor: terbitkan sekarang atau jadwalkan { published_at? }
 *   POST   /v1/admin/platform/news/:id/unpublish  editor: kembali ke draf
 *   POST   /v1/admin/platform/news/:id/archive  editor: arsipkan (hilang dari publik, tautan lama → /berita)
 *   DELETE /v1/admin/platform/news/:id          editor: hapus permanen (hanya draf/arsip)
 *
 * Artikel "terjadwal" = status published dengan published_at di masa depan; publik memfilter published_at ≤ now(),
 * jadi penayangan terjadi tepat waktu tanpa job. Cerita utama paling banyak satu (dijaga indeks unik).
 */

const L = NEWS_LIMITS;
const imageUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v.startsWith('/v1/catalog/media/') || /^https:\/\//.test(v), 'Foto harus unggahan RAVE (/v1/catalog/media/…) atau URL https');
const block = z.union([
  z.object({ p: z.string().trim().min(1).max(L.block) }).strict(),
  z.object({ h: z.string().trim().min(1).max(200) }).strict(),
  z.object({ quote: z.string().trim().min(1).max(600), by: z.string().trim().max(L.quoteBy).default('') }).strict(),
]);
const textId = z.object({
  title: z.string().trim().min(1, 'Judul wajib diisi').max(L.title),
  excerpt: z.string().trim().max(L.excerpt).default(''),
  image_alt: z.string().trim().max(L.imageAlt).default(''),
  body: z.array(block).max(L.blocks).default([]),
});
const textEn = z.object({
  title: z.string().trim().max(L.title).default(''),
  excerpt: z.string().trim().max(L.excerpt).default(''),
  image_alt: z.string().trim().max(L.imageAlt).default(''),
  body: z.array(block).max(L.blocks).default([]),
});
const slug = z.string().trim().toLowerCase().max(L.slug).regex(NEWS_SLUG_RE, 'Slug: huruf kecil, angka & tanda hubung');
const body = z.object({
  slug: slug.optional(),
  category: z.enum(NEWS_CATEGORIES),
  author: z.string().trim().min(1).max(L.author).default('Tim RAVE'),
  image_url: imageUrl.nullable().optional(),
  featured: z.boolean().optional(),
  content: z.object({ id: textId, en: textEn.nullable().optional() }),
});
const STATUSES = ['all', 'draft', 'scheduled', 'published', 'archived'] as const;

/** Ringkasan untuk daftar publik. */
function publicSummary(r: any, lang: string) {
  const t = localizeNews(r.content as NewsContent, lang);
  return {
    slug: r.slug,
    category: r.category,
    title: t.title,
    excerpt: t.excerpt,
    image: r.image_url,
    image_alt: t.image_alt,
    author: r.author,
    date: r.published_at,
    read_min: r.read_min,
    featured: r.featured,
  };
}

function adminOut(r: any) {
  const c = r.content as NewsContent;
  return {
    id: r.id,
    slug: r.slug,
    category: r.category,
    status: newsStatus(r.status, r.published_at),
    title: c.id.title,
    excerpt: c.id.excerpt,
    image_url: r.image_url,
    author: r.author,
    featured: r.featured,
    read_min: r.read_min,
    has_en: hasEnglish(c),
    published_at: r.published_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    updated_by: r.updated_by,
  };
}
const adminDetail = (r: any) => ({ ...adminOut(r), content: r.content as NewsContent });

/** Konten bersih: bahasa Inggris kosong disimpan null agar fallback jelas. */
function cleanContent(c: z.infer<typeof body>['content']): NewsContent {
  const en = c.en && (c.en.title || c.en.excerpt || c.en.image_alt || c.en.body.length) ? c.en : null;
  return { id: c.id as NewsContent['id'], en: en as NewsContent['en'] };
}

/** Syarat minimal sebelum tayang (draf boleh belum lengkap). */
function publishProblems(r: any): string[] {
  const c = r.content as NewsContent;
  const out: string[] = [];
  if (!c.id.excerpt?.trim()) out.push('ringkasan');
  if (!c.id.body?.length) out.push('isi artikel');
  if (!r.image_url) out.push('foto utama');
  if (r.image_url && !c.id.image_alt?.trim()) out.push('teks alternatif foto');
  return out;
}

export async function newsRoutes(app: FastifyInstance, { db }: ServiceContext) {
  const ip = (req: FastifyRequest) => (req.headers['x-forwarded-for'] as string) ?? req.ip;
  const actor = (req: FastifyRequest) => req.user?.name ?? req.user?.email ?? req.user?.sub ?? null;
  const LIVE = `status = 'published' AND published_at <= now()`;

  // ------------------------------------------------------------------ Publik
  app.get('/v1/platform/news', async (req, reply) => {
    const q = z
      .object({
        category: z.enum(NEWS_CATEGORIES).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(60),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query ?? {});
    const lang = reqLocale(req);
    const [rows, total, counts] = await Promise.all([
      db.query(`SELECT * FROM news_articles WHERE ${LIVE} AND ($1::text IS NULL OR category = $1) ORDER BY published_at DESC, id DESC LIMIT $2 OFFSET $3`, [
        q.category ?? null,
        q.limit,
        q.offset,
      ]),
      db.one(`SELECT count(*)::int AS n FROM news_articles WHERE ${LIVE} AND ($1::text IS NULL OR category = $1)`, [q.category ?? null]),
      db.query(`SELECT category, count(*)::int AS n FROM news_articles WHERE ${LIVE} GROUP BY category`),
    ]);
    reply.header('cache-control', 'public, max-age=60').header('vary', 'accept-language');
    return {
      data: rows.map((r) => publicSummary(r, lang)),
      total: total?.n ?? 0,
      categories: Object.fromEntries(counts.map((c) => [c.category, c.n])),
    };
  });

  app.get('/v1/platform/news/:slug', async (req, reply) => {
    const s = slug.safeParse((req.params as { slug: string }).slug);
    if (!s.success) throw notFound('Artikel');
    const r = await db.one(`SELECT * FROM news_articles WHERE slug = $1 AND ${LIVE}`, [s.data]);
    if (!r) throw notFound('Artikel');
    const lang = reqLocale(req);
    // "Baca juga": kategori sama dulu, lalu terbaru lainnya.
    const related = await db.query(
      `SELECT * FROM news_articles WHERE ${LIVE} AND id <> $1 ORDER BY (category = $2) DESC, published_at DESC LIMIT 3`,
      [r.id, r.category],
    );
    reply.header('cache-control', 'public, max-age=60').header('vary', 'accept-language');
    return { ...publicSummary(r, lang), body: localizeNews(r.content as NewsContent, lang).body, updated_at: r.updated_at, related: related.map((x) => publicSummary(x, lang)) };
  });

  // ------------------------------------------------------------------ Back Office
  app.register(async (a) => {
    a.addHook('preHandler', requirePermission('news.publish'));

    async function load(id: string) {
      if (!z.string().uuid().safeParse(id).success) throw notFound('Artikel');
      const r = await db.one(`SELECT * FROM news_articles WHERE id = $1`, [id]);
      if (!r) throw notFound('Artikel');
      return r;
    }
    async function uniqueSlug(base: string, exceptId?: string) {
      const root = base || 'berita';
      for (let i = 1; i < 200; i++) {
        const cand = i === 1 ? root : `${root.slice(0, L.slug - 4).replace(/-+$/, '')}-${i}`;
        const hit = await db.one(`SELECT id FROM news_articles WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2)`, [cand, exceptId ?? null]);
        if (!hit) return cand;
      }
      throw conflict('Slug sudah dipakai');
    }
    /** Jalankan perubahan dalam transaksi; menyetel cerita utama melepas cerita utama lain. */
    async function save(req: FastifyRequest, id: string, sets: Record<string, unknown>, action: string, data?: unknown) {
      await db.tx(async (tx) => {
        // Cerita utama hanya satu di antara artikel tayang/terjadwal: draf boleh ditandai tanpa menggeser cerita utama yang
        // sedang tayang — penanda itu baru "mengambil alih" saat artikelnya terbit.
        const cur = (await tx.query(`SELECT status, featured FROM news_articles WHERE id = $1`, [id])).rows[0];
        const willPublish = (sets.status ?? cur?.status) === 'published';
        const willFeature = sets.featured ?? cur?.featured;
        if (willPublish && willFeature) await tx.query(`UPDATE news_articles SET featured = false WHERE featured AND status = 'published' AND id <> $1`, [id]);
        const keys = Object.keys(sets);
        const cols = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
        await tx.query(`UPDATE news_articles SET ${cols}${cols ? ', ' : ''}updated_by = $${keys.length + 2}, updated_at = now() WHERE id = $1`, [
          id,
          ...keys.map((k) => (k === 'content' ? JSON.stringify(sets[k]) : sets[k])),
          actor(req),
        ]);
        await audit(tx, { actorId: req.user!.sub, action, entity: 'news', entityId: id, data, ip: ip(req) });
      });
      return adminDetail(await load(id));
    }

    a.get('/v1/admin/platform/news', async (req) => {
      const q = z
        .object({ status: z.enum(STATUSES).default('all'), q: z.string().trim().max(100).optional(), category: z.enum(NEWS_CATEGORIES).optional() })
        .parse(req.query ?? {});
      const statusSql: Record<(typeof STATUSES)[number], string> = {
        all: 'true',
        draft: `status = 'draft'`,
        archived: `status = 'archived'`,
        scheduled: `status = 'published' AND published_at > now()`,
        published: `status = 'published' AND published_at <= now()`,
      };
      const [rows, counts] = await Promise.all([
        db.query(
        `SELECT * FROM news_articles
          WHERE ${statusSql[q.status]}
            AND ($1::text IS NULL OR content->'id'->>'title' ILIKE '%' || $1 || '%' OR slug ILIKE '%' || $1 || '%' OR author ILIKE '%' || $1 || '%')
            AND ($2::text IS NULL OR category = $2)
          ORDER BY (status = 'draft') DESC, coalesce(published_at, updated_at) DESC`,
        [q.q || null, q.category ?? null],
      ),
        db.one(
        `SELECT count(*)::int AS all,
                count(*) FILTER (WHERE status = 'draft')::int AS draft,
                count(*) FILTER (WHERE status = 'published' AND published_at > now())::int AS scheduled,
                count(*) FILTER (WHERE status = 'published' AND published_at <= now())::int AS published,
                count(*) FILTER (WHERE status = 'archived')::int AS archived
           FROM news_articles`,
        ),
      ]);
      return { data: rows.map(adminOut), counts };
    });

    a.post('/v1/admin/platform/news', async (req, reply) => {
      const b = body.parse(req.body);
      const content = cleanContent(b.content);
      const id = uuidv7();
      const s = await uniqueSlug(b.slug ?? slugify(content.id.title));
      if (b.slug && s !== b.slug) throw conflict(`Slug "${b.slug}" sudah dipakai artikel lain`);
      await db.tx(async (tx) => {
        await tx.query(
          `INSERT INTO news_articles (id, slug, category, content, image_url, author, featured, read_min, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
          [id, s, b.category, JSON.stringify(content), b.image_url ?? null, b.author, b.featured ?? false, readMinutes(content.id), actor(req)],
        );
        await audit(tx, { actorId: req.user!.sub, action: 'news.create', entity: 'news', entityId: id, data: { slug: s, title: content.id.title }, ip: ip(req) });
      });
      reply.status(201);
      return adminDetail(await load(id));
    });

    a.get('/v1/admin/platform/news/:id', async (req) => adminDetail(await load((req.params as { id: string }).id)));

    a.patch('/v1/admin/platform/news/:id', async (req) => {
      const { id } = req.params as { id: string };
      const b = body.partial().parse(req.body);
      if (!Object.keys(b).length) throw badRequest('Tidak ada perubahan');
      const r = await load(id);
      const sets: Record<string, unknown> = {};
      if (b.slug !== undefined && b.slug !== r.slug) {
        // Slug artikel yang sudah tayang tetap boleh diubah, tetapi tautan lama berhenti bekerja — editor diingatkan di UI.
        const s = await uniqueSlug(b.slug, id);
        if (s !== b.slug) throw conflict(`Slug "${b.slug}" sudah dipakai artikel lain`);
        sets.slug = s;
      }
      if (b.category !== undefined) sets.category = b.category;
      if (b.author !== undefined) sets.author = b.author;
      if (b.image_url !== undefined) sets.image_url = b.image_url;
      if (b.featured !== undefined) sets.featured = b.featured;
      if (b.content !== undefined) {
        const content = cleanContent(b.content);
        sets.content = content;
        sets.read_min = readMinutes(content.id);
      }
      // Artikel tayang tidak boleh kehilangan bidang wajib.
      if (r.status === 'published') {
        const missing = publishProblems({ ...r, ...sets });
        if (missing.length) throw unprocessable(`Artikel tayang wajib memiliki ${missing.join(', ')}`);
      }
      return save(req, id, sets, 'news.update', { fields: Object.keys(sets) });
    });

    a.post('/v1/admin/platform/news/:id/publish', async (req) => {
      const { id } = req.params as { id: string };
      const b = z.object({ published_at: z.string().datetime({ offset: true }).nullable().optional() }).parse(req.body ?? {});
      const r = await load(id);
      const missing = publishProblems(r);
      if (missing.length) throw unprocessable(`Lengkapi dulu sebelum terbit: ${missing.join(', ')}`);
      // Arsip yang diterbitkan ulang mempertahankan tanggal terbit aslinya.
      const at = b.published_at ? new Date(b.published_at) : r.status === 'archived' && r.published_at ? new Date(r.published_at) : new Date();
      if (b.published_at && at.getTime() < Date.now() - 365 * 86400_000) throw unprocessable('Tanggal terbit terlalu jauh di masa lalu');
      return save(req, id, { status: 'published', published_at: at }, at.getTime() > Date.now() ? 'news.schedule' : 'news.publish', { published_at: at.toISOString() });
    });

    a.post('/v1/admin/platform/news/:id/unpublish', async (req) => {
      const { id } = req.params as { id: string };
      await load(id);
      return save(req, id, { status: 'draft', published_at: null, featured: false }, 'news.unpublish');
    });

    a.post('/v1/admin/platform/news/:id/archive', async (req) => {
      const { id } = req.params as { id: string };
      await load(id);
      return save(req, id, { status: 'archived', featured: false }, 'news.archive');
    });

    a.delete('/v1/admin/platform/news/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const r = await load(id);
      if (r.status === 'published') throw conflict('Artikel yang tayang/terjadwal tidak bisa dihapus — batalkan terbit atau arsipkan dulu');
      await db.tx(async (tx) => {
        await tx.query(`DELETE FROM news_articles WHERE id = $1`, [id]);
        await audit(tx, { actorId: req.user!.sub, action: 'news.delete', entity: 'news', entityId: id, data: { slug: r.slug, title: (r.content as NewsContent).id.title }, ip: ip(req) });
      });
      reply.status(204);
    });
  });
}
