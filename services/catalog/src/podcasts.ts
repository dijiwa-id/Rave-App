import type { FastifyInstance, FastifyRequest } from 'fastify';
import { assertOrg, audit, badRequest, conflict, forbidden, notFound, requireAuth, requirePermission, settings, signProtectedMediaUrl, unprocessable, uuidv7, z, type ServiceContext } from '@rave/service-kit';
import { EMBED_PROVIDERS, parseEmbed, publishTarget, type EmbedError } from '@rave/domain/podcast';
import { isUuid } from './queries.js';
import { publishOfflineRevoked } from './offline.js';

/**
 * Podcaster — acara (podcast/audio fiksi) & episode buatan kreator, plus moderasi Back Office.
 *
 * Studio (anggota org OWNER/ADMIN/MEMBER; jenis org dari `podcast.creator_org_types`):
 *   GET    /v1/studio/podcasts?org_id=                     acara milik org + kebijakan aktif
 *   POST   /v1/studio/podcasts                             buat acara
 *   GET    /v1/studio/podcasts/:id                         acara + semua episode (semua status)
 *   PATCH  /v1/studio/podcasts/:id                         ubah acara
 *   DELETE /v1/studio/podcasts/:id                         hapus acara (beserta episodenya)
 *   POST   /v1/studio/podcasts/:id/episodes                buat episode (unggahan audio atau embed iframe)
 *   PATCH  /v1/studio/podcasts/:id/episodes/:episodeId     ubah / terbitkan / tarik ke draf
 *   DELETE /v1/studio/podcasts/:id/episodes/:episodeId
 *   POST   /v1/studio/podcasts/embed/preview               validasi kode embed → URL kanonik
 *
 * Back Office (izin `podcast.moderate`):
 *   GET    /v1/admin/podcasts/episodes?status=PENDING      antrean tinjauan
 *   POST   /v1/admin/podcasts/episodes/:id/decision        { approve, reason? } (tolak/sembunyikan wajib alasan)
 *   GET    /v1/admin/podcasts/shows                        semua acara (termasuk tersembunyi)
 *   POST   /v1/admin/podcasts/shows/:id/visibility         { hidden, reason? }
 */

const ORG_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
const EMBED_MSG: Record<EmbedError, string> = {
  empty: 'Kode embed kosong',
  no_url: 'Tidak menemukan alamat iframe/URL di kode embed',
  not_https: 'Alamat embed harus https',
  unsupported: `Platform embed tidak dikenali (didukung: ${Object.values(EMBED_PROVIDERS).map((p) => p.label).join(', ')})`,
  provider_disabled: 'Platform embed ini sedang tidak diizinkan admin',
};
const mediaUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v.startsWith('/v1/catalog/media/') || /^https:\/\//.test(v), 'Harus berkas unggahan RAVE (/v1/catalog/media/…) atau URL https');

const showBody = z.object({
  kind: z.enum(['PODCAST', 'FICTION']).default('PODCAST'),
  title: z.string().trim().min(2).max(120),
  publisher: z.string().trim().min(2).max(120),
  description: z.string().trim().max(4000).default(''),
  category: z.string().trim().min(2).max(60),
  cover_url: mediaUrl.nullable().optional(),
  explicit: z.boolean().default(false),
  content_warning: z.string().trim().max(200).nullable().optional(),
});
const episodeBody = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(4000).default(''),
  source: z.enum(['upload', 'embed']),
  audio_url: z.string().trim().max(500).optional(),
  embed_code: z.string().max(4000).optional(),
  duration_ms: z.number().int().min(0).max(24 * 3600_000).optional(),
  is_premium: z.boolean().default(false),
  season: z.number().int().min(1).max(999).nullable().optional(),
  episode_number: z.number().int().min(1).max(99_999).nullable().optional(),
  cover_url: mediaUrl.nullable().optional(),
  /** true = terbitkan (PENDING bila wajib tinjau), false = simpan sebagai draf. */
  publish: z.boolean().default(false),
});

export function podcastPolicy() {
  return {
    creator_enabled: settings.bool('podcast.creator_enabled'),
    creator_org_types: settings.get<string[]>('podcast.creator_org_types'),
    require_review: settings.bool('podcast.require_review'),
    fiction_enabled: settings.bool('podcast.fiction_enabled'),
    max_shows_per_org: settings.num('podcast.max_shows_per_org'),
    max_episode_minutes: settings.num('podcast.max_episode_minutes'),
    premium_episodes: settings.bool('podcast.premium_episodes'),
    embed_enabled: settings.bool('podcast.embed_enabled'),
    embed_providers: settings.get<string[]>('podcast.embed_providers'),
    audio_max_mb: settings.num('upload.podcast_max_mb'),
    cover_min_px: settings.num('upload.cover_min_px'),
  };
}

export async function podcastRoutes(app: FastifyInstance, { db }: ServiceContext) {
  const ip = (req: FastifyRequest) => (req.headers['x-forwarded-for'] as string) ?? req.ip;
  const SHOW_SELECT = `SELECT s.*, (SELECT count(*)::int FROM episodes e WHERE e.show_id = s.id) AS episode_count,
      (SELECT count(*)::int FROM episodes e WHERE e.show_id = s.id AND e.status = 'PUBLISHED') AS published_count,
      (SELECT count(*)::int FROM episodes e WHERE e.show_id = s.id AND e.status = 'PENDING') AS pending_count
    FROM shows s`;

  const showOut = (s: any) => ({
    id: s.id,
    org_id: s.org_id,
    kind: s.kind,
    title: s.title,
    publisher: s.publisher,
    description: s.description,
    category: s.category,
    cover_url: s.cover_url,
    explicit: s.explicit,
    content_warning: s.content_warning,
    status: s.status,
    hidden_reason: s.hidden_reason,
    episode_count: s.episode_count ?? 0,
    published_count: s.published_count ?? 0,
    pending_count: s.pending_count ?? 0,
    created_at: s.created_at,
    updated_at: s.updated_at,
  });
  const episodeOut = (e: any) => ({
    id: e.id,
    show_id: e.show_id,
    title: e.title,
    description: e.description,
    status: e.status,
    source: e.source,
    audio_url: e.source === 'upload' ? e.audio_url : null,
    // Pratinjau untuk kreator & moderator (berkas audio wajib URL bertanda tangan; kedaluwarsa 1 jam).
    audio_preview_url: e.source === 'upload' && e.audio_url ? signProtectedMediaUrl(e.audio_url, 3600) : null,
    embed: e.source === 'embed' ? { provider: e.embed_provider, src: e.embed_url, kind: e.embed_kind, height: e.embed_height } : null,
    duration_ms: e.duration_ms,
    is_premium: e.is_premium,
    offline_allowed: e.offline_allowed ?? true,
    season: e.season,
    episode_number: e.episode_number,
    cover_url: e.cover_url,
    review_note: e.review_note,
    submitted_at: e.submitted_at,
    reviewed_at: e.reviewed_at,
    published_at: e.status === 'PUBLISHED' ? e.published_at : null,
    created_at: e.created_at,
    updated_at: e.updated_at,
  });

  /** Org boleh menjadi podcaster (jenis org diizinkan & fitur aktif). */
  function assertCreator(req: FastifyRequest, orgId: string) {
    const m = assertOrg(req.user, orgId, [...ORG_ROLES]);
    if (!settings.bool('podcast.creator_enabled')) throw forbidden('Penerbitan podcast oleh kreator sedang dinonaktifkan admin');
    if (!settings.get<string[]>('podcast.creator_org_types').includes(m.type)) throw forbidden('Jenis akun ini belum diizinkan menerbitkan podcast');
    return m;
  }
  async function loadShow(req: FastifyRequest, id: string, write = true) {
    if (!isUuid(id)) throw notFound('Acara');
    const s = await db.one(`${SHOW_SELECT} WHERE s.id = $1`, [id]);
    if (!s || !s.org_id) throw notFound('Acara');
    if (write) assertCreator(req, s.org_id);
    else assertOrg(req.user, s.org_id, [...ORG_ROLES]);
    return s;
  }

  /** Validasi sumber episode (unggahan milik user / embed yang diizinkan) → kolom yang disimpan. */
  async function resolveSource(req: FastifyRequest, b: { source: 'upload' | 'embed'; audio_url?: string; embed_code?: string; duration_ms?: number; is_premium: boolean }) {
    if (b.source === 'embed') {
      if (!settings.bool('podcast.embed_enabled')) throw forbidden('Episode embed dari platform lain sedang dinonaktifkan admin');
      if (b.is_premium) throw unprocessable('Episode embed tidak bisa Premium (diputar di platform asal)');
      const r = parseEmbed(b.embed_code ?? '', settings.get<string[]>('podcast.embed_providers'));
      if (!r.ok) throw unprocessable(EMBED_MSG[r.error]);
      return { audio_url: null, duration_ms: b.duration_ms ?? 0, embed_provider: r.embed.provider, embed_url: r.embed.src, embed_kind: r.embed.kind, embed_height: r.embed.height };
    }
    const url = (b.audio_url ?? '').trim();
    if (!url.startsWith('/v1/catalog/media/')) throw unprocessable('Unggah berkas audio episode terlebih dahulu');
    const stored = url.slice('/v1/catalog/media/'.length).split('?')[0];
    const u = await db.one(`SELECT kind, purpose, completed_at, audio_meta FROM uploads WHERE stored_name = $1 AND user_id = $2`, [stored, req.user!.sub]);
    if (!u || u.kind !== 'audio' || u.purpose !== 'podcast' || !u.completed_at) throw unprocessable('Audio episode harus berkas yang selesai Anda unggah lewat Podcaster');
    const dur = Number(u.audio_meta?.duration_ms) || b.duration_ms || 0;
    const maxMin = settings.num('podcast.max_episode_minutes');
    if (dur > maxMin * 60_000) throw unprocessable(`Durasi episode melebihi batas ${maxMin} menit`);
    return { audio_url: `/v1/catalog/media/${stored}`, duration_ms: dur, embed_provider: null, embed_url: null, embed_kind: null, embed_height: null };
  }

  app.register(async (s) => {
    s.addHook('preHandler', requireAuth);

    s.post('/v1/studio/podcasts/embed/preview', async (req) => {
      const { embed_code } = z.object({ embed_code: z.string().max(4000) }).parse(req.body);
      if (!settings.bool('podcast.embed_enabled')) throw forbidden('Episode embed dari platform lain sedang dinonaktifkan admin');
      const r = parseEmbed(embed_code, settings.get<string[]>('podcast.embed_providers'));
      if (!r.ok) throw unprocessable(EMBED_MSG[r.error]);
      return r.embed;
    });

    s.get('/v1/studio/podcasts', async (req) => {
      const { org_id } = req.query as { org_id?: string };
      if (!org_id || !isUuid(org_id)) throw badRequest('org_id wajib');
      const m = assertOrg(req.user, org_id, [...ORG_ROLES]);
      const policy = podcastPolicy();
      const rows = await db.query(`${SHOW_SELECT} WHERE s.org_id = $1 ORDER BY s.created_at DESC`, [org_id]);
      return { data: rows.map(showOut), policy, eligible: policy.creator_enabled && policy.creator_org_types.includes(m.type) };
    });

    s.post('/v1/studio/podcasts', async (req, reply) => {
      const b = showBody.extend({ org_id: z.string().uuid() }).parse(req.body);
      assertCreator(req, b.org_id);
      if (b.kind === 'FICTION' && !settings.bool('podcast.fiction_enabled')) throw forbidden('Audio fiksi oleh kreator sedang dinonaktifkan admin');
      const id = uuidv7();
      await db.tx(async (tx) => {
        await tx.query(`SELECT pg_advisory_xact_lock(hashtext('podcast-org:' || $1))`, [b.org_id]);
        const n = (await tx.query(`SELECT count(*)::int AS n FROM shows WHERE org_id = $1`, [b.org_id])).rows[0].n;
        const max = settings.num('podcast.max_shows_per_org');
        if (n >= max) throw unprocessable(`Batas ${max} acara per akun tercapai`);
        await tx.query(
          `INSERT INTO shows (id, org_id, kind, title, publisher, description, cover_url, category, explicit, content_warning, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [id, b.org_id, b.kind, b.title, b.publisher, b.description, b.cover_url ?? null, b.category, b.explicit, b.content_warning ?? null, req.user!.sub],
        );
        await audit(tx, { actorId: req.user!.sub, action: 'podcast.show.create', entity: 'show', entityId: id, data: { title: b.title, kind: b.kind, org_id: b.org_id }, ip: ip(req) });
      });
      reply.status(201);
      return showOut(await db.one(`${SHOW_SELECT} WHERE s.id = $1`, [id]));
    });

    s.get('/v1/studio/podcasts/:id', async (req) => {
      const sh = await loadShow(req, (req.params as { id: string }).id, false);
      const eps = await db.query(
        `SELECT * FROM episodes WHERE show_id = $1 ORDER BY ${sh.kind === 'FICTION' ? 'season NULLS FIRST, episode_number NULLS LAST, created_at' : 'created_at DESC'}`,
        [sh.id],
      );
      return { ...showOut(sh), episodes: eps.map(episodeOut), policy: podcastPolicy() };
    });

    s.patch('/v1/studio/podcasts/:id', async (req) => {
      const sh = await loadShow(req, (req.params as { id: string }).id);
      const b = showBody.partial().parse(req.body ?? {});
      if (!Object.keys(b).length) throw badRequest('Tidak ada perubahan');
      if (b.kind === 'FICTION' && sh.kind !== 'FICTION' && !settings.bool('podcast.fiction_enabled')) throw forbidden('Audio fiksi oleh kreator sedang dinonaktifkan admin');
      await db.query(
        `UPDATE shows SET kind = coalesce($2, kind), title = coalesce($3, title), publisher = coalesce($4, publisher),
           description = coalesce($5, description), category = coalesce($6, category),
           cover_url = CASE WHEN $7 THEN $8 ELSE cover_url END, explicit = coalesce($9, explicit),
           content_warning = CASE WHEN $10 THEN $11 ELSE content_warning END, updated_at = now()
         WHERE id = $1`,
        [sh.id, b.kind ?? null, b.title ?? null, b.publisher ?? null, b.description ?? null, b.category ?? null, 'cover_url' in b, b.cover_url ?? null, b.explicit ?? null, 'content_warning' in b, b.content_warning ?? null],
      );
      await audit(db, { actorId: req.user!.sub, action: 'podcast.show.update', entity: 'show', entityId: sh.id, data: { changed: Object.keys(b) }, ip: ip(req) });
      return showOut(await db.one(`${SHOW_SELECT} WHERE s.id = $1`, [sh.id]));
    });

    s.delete('/v1/studio/podcasts/:id', async (req) => {
      const sh = await loadShow(req, (req.params as { id: string }).id, false);
      assertOrg(req.user, sh.org_id, ['OWNER', 'ADMIN']);
      await db.tx(async (tx) => {
        const eps = (await tx.query(`SELECT id FROM episodes WHERE show_id = $1`, [sh.id])).rows.map((x: { id: string }) => x.id);
        await tx.query(`DELETE FROM shows WHERE id = $1`, [sh.id]);
        await publishOfflineRevoked(tx, 'episode', eps, 'DELETED');
        await audit(tx, { actorId: req.user!.sub, action: 'podcast.show.delete', entity: 'show', entityId: sh.id, data: { title: sh.title, episodes: sh.episode_count }, ip: ip(req) });
      });
      return { ok: true };
    });

    s.post('/v1/studio/podcasts/:id/episodes', async (req, reply) => {
      const sh = await loadShow(req, (req.params as { id: string }).id);
      if (sh.status === 'HIDDEN') throw conflict('Acara ini disembunyikan moderator — episode baru tidak bisa ditambahkan');
      const b = episodeBody.parse(req.body);
      if (b.is_premium && !settings.bool('podcast.premium_episodes')) throw forbidden('Episode Premium oleh kreator sedang dinonaktifkan admin');
      const src = await resolveSource(req, b);
      const status = b.publish ? publishTarget(settings.bool('podcast.require_review')) : 'DRAFT';
      const id = uuidv7();
      await db.tx(async (tx) => {
        await tx.query(
          `INSERT INTO episodes (id, show_id, title, description, duration_ms, is_premium, season, episode_number, audio_url, cover_url,
             status, source, embed_provider, embed_url, embed_kind, embed_height, submitted_at, published_at, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now(), $18)`,
          [
            id, sh.id, b.title, b.description, src.duration_ms, b.is_premium, b.season ?? null, b.episode_number ?? null, src.audio_url, b.cover_url ?? null,
            status, b.source, src.embed_provider, src.embed_url, src.embed_kind, src.embed_height, status === 'DRAFT' ? null : new Date(), req.user!.sub,
          ],
        );
        await tx.query(`UPDATE shows SET updated_at = now() WHERE id = $1`, [sh.id]);
        await audit(tx, { actorId: req.user!.sub, action: 'podcast.episode.create', entity: 'episode', entityId: id, data: { show_id: sh.id, status, source: b.source, provider: src.embed_provider }, ip: ip(req) });
      });
      reply.status(201);
      return episodeOut(await db.one(`SELECT * FROM episodes WHERE id = $1`, [id]));
    });

    s.patch('/v1/studio/podcasts/:id/episodes/:episodeId', async (req) => {
      const { id, episodeId } = req.params as { id: string; episodeId: string };
      const sh = await loadShow(req, id);
      if (!isUuid(episodeId)) throw notFound('Episode');
      const e = await db.one(`SELECT * FROM episodes WHERE id = $1 AND show_id = $2`, [episodeId, sh.id]);
      if (!e) throw notFound('Episode');
      if (e.status === 'HIDDEN') throw conflict('Episode disembunyikan moderator dan tidak bisa diubah');
      const b = episodeBody.omit({ publish: true }).partial().extend({ publish: z.boolean().optional(), offline_allowed: z.boolean().optional() }).parse(req.body ?? {});
      // offline_allowed (P-7) bukan perubahan isi → tidak memicu tinjauan ulang.
      const contentChanged = Object.keys(b).some((k) => k !== 'publish' && k !== 'offline_allowed');
      const nextPremium = b.is_premium ?? e.is_premium;
      if (b.is_premium && !e.is_premium && !settings.bool('podcast.premium_episodes')) throw forbidden('Episode Premium oleh kreator sedang dinonaktifkan admin');
      let src: Awaited<ReturnType<typeof resolveSource>> | null = null;
      if (b.source || b.audio_url !== undefined || b.embed_code !== undefined) {
        src = await resolveSource(req, { source: b.source ?? e.source, audio_url: b.audio_url ?? e.audio_url, embed_code: b.embed_code ?? e.embed_url, duration_ms: b.duration_ms, is_premium: nextPremium });
      } else if (nextPremium && e.source === 'embed') throw unprocessable('Episode embed tidak bisa Premium (diputar di platform asal)');
      // Status: publish=true → tinjau/tayang; publish=false → draf. Mengubah isi episode yang sudah tayang/ditolak
      // saat tinjauan wajib → masuk antrean lagi (agar perubahan tidak lolos tanpa moderasi).
      const review = settings.bool('podcast.require_review');
      let status: string = e.status;
      if (b.publish === true) status = e.status === 'PUBLISHED' && !contentChanged ? 'PUBLISHED' : publishTarget(review);
      else if (b.publish === false) status = 'DRAFT';
      else if (contentChanged && review && (e.status === 'PUBLISHED' || e.status === 'REJECTED')) status = 'PENDING';
      else if (contentChanged && e.status === 'REJECTED') status = 'DRAFT';
      // Menekan "Terbitkan" lagi pada episode yang sudah menunggu (tanpa ubah isi) tidak memindahkannya ke ujung antrean.
      const nowSubmitted = (status === 'PENDING' && (e.status !== 'PENDING' || contentChanged)) || (status === 'PUBLISHED' && e.status !== 'PUBLISHED');
      await db.tx(async (tx) => {
        await tx.query(
          `UPDATE episodes SET title = coalesce($2, title), description = coalesce($3, description),
             is_premium = $4, season = CASE WHEN $5 THEN $6 ELSE season END, episode_number = CASE WHEN $7 THEN $8 ELSE episode_number END,
             cover_url = CASE WHEN $9 THEN $10 ELSE cover_url END,
             source = coalesce($11, source), audio_url = CASE WHEN $12 THEN $13 ELSE audio_url END,
             duration_ms = CASE WHEN $12 THEN $14 ELSE coalesce($15, duration_ms) END,
             embed_provider = CASE WHEN $12 THEN $16 ELSE embed_provider END, embed_url = CASE WHEN $12 THEN $17 ELSE embed_url END,
             embed_kind = CASE WHEN $12 THEN $18 ELSE embed_kind END, embed_height = CASE WHEN $12 THEN $19 ELSE embed_height END,
             status = $20, submitted_at = CASE WHEN $21 THEN now() ELSE submitted_at END,
             published_at = CASE WHEN $20 = 'PUBLISHED' AND status <> 'PUBLISHED' THEN now() ELSE published_at END,
             review_note = CASE WHEN $21 THEN NULL ELSE review_note END, offline_allowed = coalesce($22, offline_allowed), updated_at = now()
           WHERE id = $1`,
          [
            e.id, b.title ?? null, b.description ?? null, nextPremium, 'season' in b, b.season ?? null, 'episode_number' in b, b.episode_number ?? null,
                      // Durasi episode unggahan berasal dari berkas (probe) — klien hanya boleh mengisinya untuk episode embed.
            'cover_url' in b, b.cover_url ?? null, src ? (b.source ?? e.source) : null, !!src, src?.audio_url ?? null, src?.duration_ms ?? 0, e.source === 'embed' ? (b.duration_ms ?? null) : null,
            src?.embed_provider ?? null, src?.embed_url ?? null, src?.embed_kind ?? null, src?.embed_height ?? null, status, nowSubmitted,
            b.offline_allowed ?? null,
          ],
        );
        await audit(tx, { actorId: req.user!.sub, action: 'podcast.episode.update', entity: 'episode', entityId: e.id, data: { changed: Object.keys(b), from: e.status, to: status }, ip: ip(req) });
        // Unduhan offline dicabut bila episode tidak tayang lagi, berganti audio/menjadi embed, atau izin offline dimatikan.
        if (e.status === 'PUBLISHED' && status !== 'PUBLISHED') await publishOfflineRevoked(tx, 'episode', [e.id], 'UNPUBLISHED');
        else if (b.offline_allowed === false && e.offline_allowed) await publishOfflineRevoked(tx, 'episode', [e.id], 'OFFLINE_DISABLED');
        else if (src && e.status === 'PUBLISHED') await publishOfflineRevoked(tx, 'episode', [e.id], 'UNPUBLISHED');
      });
      return episodeOut(await db.one(`SELECT * FROM episodes WHERE id = $1`, [e.id]));
    });

    s.delete('/v1/studio/podcasts/:id/episodes/:episodeId', async (req) => {
      const { id, episodeId } = req.params as { id: string; episodeId: string };
      const sh = await loadShow(req, id, false);
      if (!isUuid(episodeId)) throw notFound('Episode');
      await db.tx(async (tx) => {
        const r = (await tx.query(`DELETE FROM episodes WHERE id = $1 AND show_id = $2 RETURNING title`, [episodeId, sh.id])).rows;
        if (!r.length) throw notFound('Episode');
        await audit(tx, { actorId: req.user!.sub, action: 'podcast.episode.delete', entity: 'episode', entityId: episodeId, data: { show_id: sh.id, title: r[0].title }, ip: ip(req) });
        await publishOfflineRevoked(tx, 'episode', [episodeId], 'DELETED');
      });
      return { ok: true };
    });
  });

  // ---------- Back Office: moderasi ----------
  app.register(async (a) => {
    a.addHook('preHandler', requirePermission('podcast.moderate'));

    a.get('/v1/admin/podcasts/episodes', async (req) => {
      const q = z
        .object({ status: z.enum(['PENDING', 'PUBLISHED', 'REJECTED', 'HIDDEN', 'DRAFT', 'all']).default('PENDING'), q: z.string().trim().max(100).optional() })
        .parse(req.query ?? {});
      const rows = await db.query(
        `SELECT e.*, s.title AS show_title, s.publisher, s.kind AS show_kind, s.cover_url AS show_cover, s.org_id, s.status AS show_status
           FROM episodes e JOIN shows s ON s.id = e.show_id
          WHERE s.org_id IS NOT NULL AND ($1 = 'all' OR e.status = $1)
            AND ($2::text IS NULL OR e.title ILIKE '%' || $2 || '%' OR s.title ILIKE '%' || $2 || '%' OR s.publisher ILIKE '%' || $2 || '%')
          ORDER BY ${q.status === 'PENDING' ? 'e.submitted_at NULLS LAST' : 'e.updated_at DESC'} LIMIT 200`,
        [q.status, q.q || null],
      );
      const counts = await db.one(`SELECT count(*) FILTER (WHERE e.status = 'PENDING')::int AS pending FROM episodes e JOIN shows s ON s.id = e.show_id WHERE s.org_id IS NOT NULL`);
      return {
        data: rows.map((r) => ({
          ...episodeOut(r),
          show: { id: r.show_id, title: r.show_title, publisher: r.publisher, kind: r.show_kind, cover_url: r.show_cover, org_id: r.org_id, status: r.show_status },
        })),
        pending: counts.pending,
      };
    });

    a.post('/v1/admin/podcasts/episodes/:id/decision', async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Episode');
      const b = z.object({ action: z.enum(['approve', 'reject', 'hide']), reason: z.string().trim().max(500).optional() }).parse(req.body);
      if (b.action !== 'approve' && (b.reason ?? '').length < 5) throw badRequest('Alasan wajib (min. 5 karakter) — ditampilkan ke kreator');
      const e = await db.one(`SELECT e.status, e.title, s.org_id FROM episodes e JOIN shows s ON s.id = e.show_id WHERE e.id = $1`, [id]);
      if (!e || !e.org_id) throw notFound('Episode');
      if (b.action === 'approve' && !['PENDING', 'REJECTED', 'HIDDEN'].includes(e.status)) throw conflict(`Episode berstatus ${e.status}`);
      if (b.action === 'reject' && e.status !== 'PENDING') throw conflict('Hanya episode yang menunggu tinjauan yang bisa ditolak');
      if (b.action === 'hide' && e.status !== 'PUBLISHED') throw conflict('Hanya episode tayang yang bisa disembunyikan');
      const to = { approve: 'PUBLISHED', reject: 'REJECTED', hide: 'HIDDEN' }[b.action];
      await db.tx(async (tx) => {
        await tx.query(
          `UPDATE episodes SET status = $2, review_note = $3, reviewed_at = now(), reviewed_by = $4,
             published_at = CASE WHEN $2 = 'PUBLISHED' THEN now() ELSE published_at END, updated_at = now() WHERE id = $1`,
          [id, to, b.action === 'approve' ? null : b.reason, req.user!.sub],
        );
        await audit(tx, { actorId: req.user!.sub, action: `podcast.episode.${b.action}`, entity: 'episode', entityId: id, data: { title: e.title, from: e.status, reason: b.reason ?? null }, ip: ip(req) });
        if (e.status === 'PUBLISHED' && to !== 'PUBLISHED') await publishOfflineRevoked(tx, 'episode', [id], 'UNPUBLISHED');
      });
      return episodeOut(await db.one(`SELECT * FROM episodes WHERE id = $1`, [id]));
    });

    a.get('/v1/admin/podcasts/shows', async (req) => {
      const q = z.object({ q: z.string().trim().max(100).optional(), origin: z.enum(['creator', 'all']).default('all') }).parse(req.query ?? {});
      const rows = await db.query(
        `${SHOW_SELECT} WHERE ($1 = 'all' OR s.org_id IS NOT NULL) AND ($2::text IS NULL OR s.title ILIKE '%' || $2 || '%' OR s.publisher ILIKE '%' || $2 || '%')
         ORDER BY s.status DESC, s.updated_at DESC LIMIT 300`,
        [q.origin, q.q || null],
      );
      return { data: rows.map(showOut) };
    });

    a.post('/v1/admin/podcasts/shows/:id/visibility', async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Acara');
      const b = z.object({ hidden: z.boolean(), reason: z.string().trim().max(500).optional() }).parse(req.body);
      if (b.hidden && (b.reason ?? '').length < 5) throw badRequest('Alasan wajib (min. 5 karakter) — ditampilkan ke kreator');
      const sh = await db.one(`SELECT title FROM shows WHERE id = $1`, [id]);
      if (!sh) throw notFound('Acara');
      await db.tx(async (tx) => {
        await tx.query(`UPDATE shows SET status = $2, hidden_reason = $3, updated_at = now() WHERE id = $1`, [id, b.hidden ? 'HIDDEN' : 'ACTIVE', b.hidden ? b.reason : null]);
        if (b.hidden) {
          const eps = (await tx.query(`SELECT id FROM episodes WHERE show_id = $1 AND status = 'PUBLISHED'`, [id])).rows.map((x: { id: string }) => x.id);
          await publishOfflineRevoked(tx, 'episode', eps, 'UNPUBLISHED');
        }
        await audit(tx, { actorId: req.user!.sub, action: b.hidden ? 'podcast.show.hide' : 'podcast.show.unhide', entity: 'show', entityId: id, data: { title: sh.title, reason: b.reason ?? null }, ip: ip(req) });
      });
      return showOut(await db.one(`${SHOW_SELECT} WHERE s.id = $1`, [id]));
    });
  });
}
