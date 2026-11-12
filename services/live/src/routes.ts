import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  assertOrg,
  audit,
  badRequest,
  callService,
  config,
  conflict,
  forbidden,
  HttpError,
  isAdmin,
  notFound,
  requireAuth,
  requirePermission,
  requireService,
  settings,
  unauthorized,
  uuidv7,
  z,
  type AuthUser,
  type Db,
  type ServiceContext,
  hasPermission,
} from '@rave/service-kit';
import { keyHash, ME, newStreamKey, type LiveManager } from './manager.js';
import { RTMP_PUBLIC_URL, streamDir } from './media.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAYBACK_TTL_S = 6 * 3600;

const COLS = `s.*,
  (SELECT count(*) FROM viewers v WHERE v.stream_id = s.id AND v.last_seen > now() - interval '30 seconds')::int AS viewers`;

export function streamOut(r: any, owner = false) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    access: r.access,
    event: r.event_id ? { id: r.event_id, slug: r.event_slug, title: r.event_title, city: r.event_city, starts_at: r.event_starts_at } : null,
    artist: r.artist_id ? { id: r.artist_id, name: r.artist_name, slug: r.artist_slug, image_url: r.artist_image } : null,
    org: { id: r.org_id, name: r.org_name, type: r.org_type },
    cover_url: r.cover_url ?? r.artist_image ?? null,
    scheduled_at: r.scheduled_at,
    started_at: r.started_at,
    ended_at: r.ended_at,
    ended_reason: r.ended_reason,
    viewers: r.status === 'ENDED' ? 0 : (r.viewers ?? 0),
    peak_viewers: r.peak_viewers,
    total_views: r.total_views,
    ingest: r.ingest,
    chat_enabled: settings.bool('live.chat_enabled'),
    is_demo: r.is_demo,
    ...(owner ? { key_hint: r.key_hint } : {}),
  };
}

// ---- Penonton aktif: dihitung job berkala (index.ts, tiap 5 dtk), bukan per heartbeat ----
const viewerCounts = new Map<string, number>(); // streamId → penonton aktif (≤ 30 dtk)
const newViews = new Map<string, number>(); // streamId → penonton unik baru sejak flush terakhir

/** Hitung penonton aktif per siaran, perbarui peak_viewers & total_views (batch). */
let lastIdleFlush = 0;
export async function flushViewers(db: Db) {
  // Idle (tidak ada penonton aktif & tidak ada penonton baru): cukup periksa tiap 15 dtk, bukan tiap 5 dtk.
  // Penonton pertama yang bergabung masuk `newViews` → hitungan langsung diperbarui pada tick berikutnya.
  if (!viewerCounts.size && !newViews.size) {
    if (Date.now() - lastIdleFlush < 15_000) return;
    lastIdleFlush = Date.now();
  }
  const rows = await db.query<{ stream_id: string; n: number }>(
    `SELECT v.stream_id, count(*)::int AS n FROM viewers v JOIN streams s ON s.id = v.stream_id
      WHERE s.status IN ('LIVE','INTERRUPTED') AND v.last_seen > now() - interval '30 seconds' GROUP BY 1`,
  );
  viewerCounts.clear();
  for (const r of rows) viewerCounts.set(r.stream_id, r.n);
  const added = [...newViews];
  newViews.clear();
  const ids = [...new Set([...viewerCounts.keys(), ...added.map(([id]) => id)])];
  if (!ids.length) return;
  await db.query(
    `UPDATE streams s SET peak_viewers = greatest(s.peak_viewers, x.n), total_views = s.total_views + x.added
       FROM unnest($1::uuid[], $2::int[], $3::int[]) AS x(id, n, added)
      WHERE s.id = x.id AND (x.n > s.peak_viewers OR x.added > 0)`,
    [ids, ids.map((id) => viewerCounts.get(id) ?? 0), ids.map((id) => added.find(([k]) => k === id)?.[1] ?? 0)],
  );
}

// ---- Token pemutaran HLS: HMAC(id.exp), dibawa di query karena pemutar tidak mengirim header Authorization ----
const sign = (id: string, exp: number) => createHmac('sha256', config.mediaSigningSecret).update(`live:${id}.${exp}`).digest('base64url');
export function playbackToken(id: string) {
  const exp = Math.floor(Date.now() / 1000) + PLAYBACK_TTL_S;
  return { token: `${exp}.${sign(id, exp)}`, exp };
}
function verifyToken(id: string, token: string | undefined): boolean {
  const [expS, sig] = String(token ?? '').split('.');
  const exp = Number(expS);
  if (!exp || !sig || exp < Date.now() / 1000) return false;
  const want = Buffer.from(sign(id, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function routes(app: FastifyInstance, ctx: ServiceContext, mgr: LiveManager) {
  const { db, name } = ctx;

  async function load(id: string) {
    if (!UUID_RE.test(id)) throw notFound('Siaran');
    const r = await db.one(`SELECT ${COLS} FROM streams s WHERE s.id = $1`, [id]);
    if (!r) throw notFound('Siaran');
    return r;
  }
  // Loader ringan (tanpa hitung penonton) + cache memori 2 dtk untuk endpoint polling (chat GET, heartbeat).
  const liteCache = new Map<string, { at: number; r: any }>();
  async function loadLite(id: string) {
    if (!UUID_RE.test(id)) throw notFound('Siaran');
    const hit = liteCache.get(id);
    if (hit && Date.now() - hit.at < 2000) return hit.r;
    const r = await db.one(`SELECT id, status, access, org_id, event_id, event_slug FROM streams WHERE id = $1`, [id]);
    if (!r) throw notFound('Siaran');
    if (liteCache.size > 1000) liteCache.clear();
    liteCache.set(id, { at: Date.now(), r });
    return r;
  }
  // Anggota org penyiar, atau admin moderator (izin live.moderate) — bukan sembarang admin (audit go-live A1).
  const isMember = (u: AuthUser | null, orgId: string) => !!u?.roles.includes('service') || hasPermission(u, 'live.moderate') || !!u?.orgs.some((o) => o.id === orgId);

  /** Kesehatan dihitung di replika pemilik (transcoder & antrean potongan ada di memorinya); cadangan: perkiraan lokal. */
  async function healthFor(r: any) {
    const local = () => mgr.health(r.id, r.status, r.ingest, r.started_at, r.viewers);
    if (r.status === 'ENDED' || !r.owner_instance || r.owner_instance === ME || mgr.isPublishing(r.id)) return local();
    const o = await mgr.ownerOf(r.id);
    if (!o || o.id === ME) return local();
    try {
      return await mgr.forward(o, 'GET', `/internal/live/streams/${r.id}/health`, undefined, 1500);
    } catch {
      const h = local();
      h.warnings.push('Server pemilik siaran tidak terjangkau — data kesehatan tidak lengkap');
      return h;
    }
  }
  const ingestPath = (id: string, session: string) => `/internal/live/streams/${id}/ingest/${encodeURIComponent(session)}`;

  /** Hak tonton: PUBLIC = semua; TICKET = pemegang tiket event, anggota org pemilik, atau admin. */
  async function access(r: any, u: AuthUser | null): Promise<null | 'login_required' | 'ticket_required' | 'not_live'> {
    if (r.access === 'TICKET' && !isMember(u, r.org_id)) {
      if (!u) return 'login_required';
      const t = await callService<{ valid: boolean }>(name, 'ticketing', `/internal/tickets/check?event_id=${r.event_id}&user_id=${u.sub}`).catch(() => ({ valid: false }));
      if (!t.valid) return 'ticket_required';
    }
    if (r.status !== 'LIVE' && r.status !== 'INTERRUPTED') return 'not_live';
    return null;
  }

  // =========================== Publik ===========================
  app.get('/v1/live/streams', async (req) => {
    const q = req.query as { status?: string; artist_id?: string; event_id?: string; org_id?: string; limit?: string };
    const limit = Math.min(Math.max(Number(q.limit) || 24, 1), 100);
    const where: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown) => (params.push(v), `$${params.length}`);
    let order = 's.created_at DESC';
    if (q.status === 'live') (where.push(`s.status IN ('LIVE','INTERRUPTED')`), (order = 'viewers DESC, s.started_at'));
    else if (q.status === 'upcoming') (where.push(`s.status = 'SCHEDULED' AND NOT s.is_demo`), (order = 's.scheduled_at NULLS LAST'));
    else if (q.status === 'ended') (where.push(`s.status = 'ENDED' AND NOT s.is_demo`), (order = 's.ended_at DESC'));
    for (const [k, col] of [['artist_id', 'artist_id'], ['event_id', 'event_id'], ['org_id', 'org_id']] as const) {
      const v = q[k];
      if (v) {
        if (!UUID_RE.test(v)) return { data: [] };
        where.push(`s.${col} = ${p(v)}`);
      }
    }
    const rows = await db.query(`SELECT ${COLS} FROM streams s ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ${p(limit)}`, params);
    return { data: rows.map((r) => streamOut(r)) };
  });

  app.get('/v1/live/streams/:id', async (req) => {
    const r = await load((req.params as { id: string }).id);
    const reason = await access(r, req.user);
    return { ...streamOut(r, isMember(req.user, r.org_id)), can_watch: reason === null, access_reason: reason };
  });

  app.post('/v1/live/streams/:id/playback', async (req) => {
    const r = await load((req.params as { id: string }).id);
    const reason = await access(r, req.user);
    if (reason === 'login_required') throw unauthorized('Masuk untuk menonton siaran bertiket');
    if (reason === 'ticket_required')
      throw new HttpError(403, 'Forbidden', 'Siaran ini khusus pemegang tiket', { type: 'https://rave.id/problems/ticket-required', event_id: r.event_id, event_slug: r.event_slug });
    if (reason === 'not_live') throw conflict('Siaran belum dimulai atau sudah berakhir', { type: 'https://rave.id/problems/not-live', status: r.status });
    const t = playbackToken(r.id);
    return { hls_url: `/v1/live/hls/${r.id}/index.m3u8?token=${encodeURIComponent(t.token)}`, expires_at: new Date(t.exp * 1000).toISOString() };
  });

  // HLS: playlist ditulis ulang agar setiap URL segmen membawa token yang sama.
  app.get('/v1/live/hls/:id/:file', async (req, reply) => {
    const { id, file } = req.params as { id: string; file: string };
    const token = (req.query as { token?: string }).token;
    if (!UUID_RE.test(id) || !/^(index\.m3u8|seg\d+\.ts)$/.test(file)) throw notFound('File');
    if (!verifyToken(id, token)) throw forbidden('Token pemutaran tidak valid atau kedaluwarsa');
    const p = join(streamDir(id), file);
    if (!existsSync(p)) throw notFound(file.endsWith('.m3u8') ? 'Playlist (siaran belum mengirim gambar)' : 'Segmen');
    if (file === 'index.m3u8') {
      const q = `?token=${encodeURIComponent(token!)}`;
      const body = readFileSync(p, 'utf8')
        .split('\n')
        .map((l) => (l && !l.startsWith('#') ? l.trim() + q : l))
        .join('\n');
      reply.header('content-type', 'application/vnd.apple.mpegurl');
      reply.header('cache-control', 'no-cache, no-store');
      return body;
    }
    reply.header('content-type', 'video/mp2t');
    reply.header('content-length', statSync(p).size);
    reply.header('cache-control', 'private, max-age=60');
    return reply.send(createReadStream(p));
  });

  app.post('/v1/live/streams/:id/heartbeat', async (req) => {
    const r = await loadLite((req.params as { id: string }).id);
    const b = z.object({ viewer_id: z.string().uuid() }).parse(req.body ?? {});
    if (r.status === 'LIVE' || r.status === 'INTERRUPTED') {
      const u = req.user && !req.user.roles.includes('service') ? req.user : null;
      const key = u ? `u:${u.sub}` : `a:${b.viewer_id}`;
      // Tulis hanya bila penonton baru atau last_seen > 10 dtk (heartbeat klien 15 dtk, jendela aktif 30 dtk).
      const ins = await db.query(
        `INSERT INTO viewers (stream_id, viewer_key, user_id) VALUES ($1,$2,$3)
         ON CONFLICT (stream_id, viewer_key) DO UPDATE SET last_seen = now() WHERE viewers.last_seen < now() - interval '10 seconds'
         RETURNING (xmax = 0) AS fresh`,
        [r.id, key, u?.sub ?? null],
      );
      const fresh = !!ins[0]?.fresh;
      if (fresh) newViews.set(r.id, (newViews.get(r.id) ?? 0) + 1);
      return { viewers: Math.max(viewerCounts.get(r.id) ?? 0, 1), status: r.status };
    }
    return { viewers: 0, status: r.status };
  });

  // ---- Chat (polling) ----
  app.get('/v1/live/streams/:id/chat', async (req) => {
    const r = await loadLite((req.params as { id: string }).id);
    const q = req.query as { after?: string; limit?: string };
    const limit = Math.min(Number(q.limit) || 50, 100);
    const after = Number(q.after) || 0;
    // Tanpa `after`: N pesan terakhir; dengan `after`: pesan baru setelahnya.
    const rows = after
      ? await db.query(`SELECT * FROM chat_messages WHERE stream_id=$1 AND id > $2 AND deleted_at IS NULL ORDER BY id LIMIT $3`, [r.id, after, limit])
      : (await db.query(`SELECT * FROM chat_messages WHERE stream_id=$1 AND deleted_at IS NULL ORDER BY id DESC LIMIT $2`, [r.id, limit])).reverse();
    const last = rows.length ? rows[rows.length - 1].id : after;
    return {
      data: rows.map((m) => ({ id: m.id, user_id: m.user_id, display_name: m.display_name, body: m.body, created_at: m.created_at, mine: m.user_id === req.user?.sub })),
      last_id: last,
      chat_enabled: settings.bool('live.chat_enabled'),
      slowmode_s: settings.num('live.chat_slowmode_seconds'),
    };
  });

  app.post('/v1/live/streams/:id/chat', { preHandler: requireAuth }, async (req, reply) => {
    const r = await load((req.params as { id: string }).id);
    const b = z.object({ body: z.string().trim().min(1, 'Pesan kosong').max(300) }).parse(req.body);
    if (!settings.bool('live.chat_enabled')) throw forbidden('Live chat sedang dimatikan');
    if (r.status === 'ENDED') throw forbidden('Siaran sudah berakhir');
    if ((await access(r, req.user)) === 'ticket_required') throw forbidden('Chat khusus pemegang tiket');
    const slow = settings.num('live.chat_slowmode_seconds');
    if (slow > 0 && !isMember(req.user, r.org_id)) {
      const last = await db.one(`SELECT created_at FROM chat_messages WHERE stream_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 1`, [r.id, req.user!.sub]);
      const wait = last ? slow - (Date.now() - new Date(last.created_at).getTime()) / 1000 : 0;
      if (wait > 0) throw new HttpError(429, 'Too Many Requests', `Slowmode: tunggu ${Math.ceil(wait)} detik`, { retry_after_s: Math.ceil(wait) });
    }
    const m = (
      await db.query(`INSERT INTO chat_messages (stream_id, user_id, display_name, body) VALUES ($1,$2,$3,$4) RETURNING *`, [
        r.id,
        req.user!.sub,
        (req.user!.name ?? req.user!.email ?? 'Pendengar').slice(0, 60),
        b.body,
      ])
    )[0];
    reply.status(201);
    return { id: m.id, user_id: m.user_id, display_name: m.display_name, body: m.body, created_at: m.created_at, mine: true };
  });

  // =========================== Studio (pemilik siaran) ===========================
  const createBody = z.object({
    org_id: z.string().uuid(),
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().max(2000).optional().nullable(),
    scheduled_at: z.string().datetime({ offset: true }).optional().nullable(),
    access: z.enum(['PUBLIC', 'TICKET']).default('PUBLIC'),
    event_id: z.string().uuid().optional().nullable(),
    artist_id: z.string().uuid().optional().nullable(),
    cover_url: z.string().max(500).optional().nullable(),
  });

  /** Data denormalisasi org/artis/event dari service pemiliknya. */
  async function enrich(u: AuthUser, b: { org_id: string; access: string; event_id?: string | null; artist_id?: string | null }) {
    const org = await callService<any>(name, 'iam', `/internal/orgs/${b.org_id}`).catch(() => null);
    if (!org) throw badRequest('Organisasi tidak ditemukan');
    const artistId = b.artist_id ?? org.artist_id ?? null;
    const artist = artistId ? await callService<any>(name, 'catalog', `/internal/artists/${artistId}`).catch(() => null) : null;
    if (artistId && !artist) throw badRequest('Artis tidak ditemukan');
    let event: any = null;
    if (b.event_id) {
      event = await callService<any>(name, 'ticketing', `/v1/ticketing/events/${b.event_id}`).catch(() => null);
      if (!event) throw badRequest('Event tidak ditemukan');
      const performs = artistId && (event.artists ?? []).some((a: any) => (a.id ?? a) === artistId);
      if (event.org_id !== b.org_id && !performs) throw forbidden('Event bukan milik organisasi ini');
    }
    if (b.access === 'TICKET' && !event) throw badRequest('Siaran bertiket wajib terkait event');
    return { org, artist, event };
  }

  async function loadOwned(req: FastifyRequest) {
    const r = await load((req.params as { id: string }).id);
    assertOrg(req.user, r.org_id, ['OWNER', 'ADMIN', 'MEMBER']);
    return r;
  }
  const rtmpInfo = (key: string) => ({ stream_key: key, rtmp_server: RTMP_PUBLIC_URL, rtmp_url: `${RTMP_PUBLIC_URL}/${key}` });

  app.register(async (s) => {
    s.addHook('preHandler', requireAuth);

    s.get('/v1/live/studio/streams', async (req) => {
      const { org_id } = req.query as { org_id?: string };
      if (!org_id || !UUID_RE.test(org_id)) throw badRequest('org_id wajib');
      assertOrg(req.user, org_id);
      const rows = await db.query(
        `SELECT ${COLS} FROM streams s WHERE s.org_id=$1 ORDER BY (s.status IN ('LIVE','INTERRUPTED')) DESC, (s.status='SCHEDULED') DESC, coalesce(s.scheduled_at, s.created_at) DESC`,
        [org_id],
      );
      return { data: rows.map((r) => streamOut(r, true)) };
    });

    s.post('/v1/live/studio/streams', async (req, reply) => {
      const b = createBody.parse(req.body);
      assertOrg(req.user, b.org_id, ['OWNER', 'ADMIN', 'MEMBER']);
      const { org, artist, event } = await enrich(req.user!, b);
      const key = newStreamKey();
      const id = uuidv7();
      const r = (
        await db.query(
          `INSERT INTO streams (id, org_id, org_name, org_type, artist_id, artist_name, artist_slug, artist_image, title, description, cover_url, access,
             event_id, event_slug, event_title, event_city, event_starts_at, scheduled_at, stream_key_hash, key_hint, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
          [
            id, b.org_id, org.name, org.type, artist?.id ?? null, artist?.name ?? null, artist?.slug ?? null, artist?.image_url ?? null,
            b.title, b.description ?? null, b.cover_url ?? null, b.access,
            event?.id ?? null, event?.slug ?? null, event?.title ?? null, event?.city ?? null, event?.starts_at ?? null,
            b.scheduled_at ?? null, keyHash(key), key.slice(-4), req.user!.sub,
          ],
        )
      )[0];
      mgr.register(id, keyHash(key));
      await audit(db, { actorId: req.user!.sub, action: 'live.stream.create', entity: 'stream', entityId: id, data: { title: b.title, access: b.access } });
      reply.status(201);
      return { stream: streamOut({ ...r, viewers: 0 }, true), ...rtmpInfo(key) };
    });

    s.patch('/v1/live/studio/streams/:id', async (req) => {
      const r = await loadOwned(req);
      if (r.status === 'ENDED') throw conflict('Siaran sudah berakhir');
      const b = createBody.omit({ org_id: true, artist_id: true }).partial().parse(req.body ?? {});
      const accessNext = b.access ?? r.access;
      const eventId = b.event_id === undefined ? r.event_id : b.event_id;
      const { event } = await enrich(req.user!, { org_id: r.org_id, access: accessNext, event_id: eventId, artist_id: r.artist_id });
      await db.query(
        `UPDATE streams SET title=$2, description=$3, scheduled_at=$4, access=$5, cover_url=$6,
           event_id=$7, event_slug=$8, event_title=$9, event_city=$10, event_starts_at=$11, updated_at=now() WHERE id=$1`,
        [
          r.id, b.title ?? r.title, b.description === undefined ? r.description : b.description, b.scheduled_at === undefined ? r.scheduled_at : b.scheduled_at,
          accessNext, b.cover_url === undefined ? r.cover_url : b.cover_url,
          event?.id ?? null, event?.slug ?? null, event?.title ?? null, event?.city ?? null, event?.starts_at ?? null,
        ],
      );
      return streamOut(await load(r.id), true);
    });

    s.post('/v1/live/studio/streams/:id/key', async (req) => {
      const r = await loadOwned(req);
      if (r.status === 'ENDED') throw conflict('Siaran sudah berakhir');
      if (r.is_demo) throw conflict('Kunci kanal demo dikelola server');
      if (await mgr.busy(r)) throw conflict('Tidak bisa merotasi kunci saat siaran menerima sinyal');
      const key = newStreamKey();
      await db.query(`UPDATE streams SET stream_key_hash=$2, key_hint=$3, updated_at=now() WHERE id=$1`, [r.id, keyHash(key), key.slice(-4)]);
      mgr.register(r.id, keyHash(key));
      await audit(db, { actorId: req.user!.sub, action: 'live.stream.key_rotate', entity: 'stream', entityId: r.id });
      return rtmpInfo(key);
    });

    // ---- Ingest dari browser: potongan WebM berurutan lewat HTTP ----
    for (const ct of ['video/webm', 'application/octet-stream'])
      s.addContentTypeParser(ct, { parseAs: 'buffer', bodyLimit: 2 * 1024 * 1024 }, (_r, body, done) => done(null, body));

    s.post('/v1/live/studio/streams/:id/ingest/start', async (req) => {
      const r = await loadOwned(req);
      const b = z.object({ mime: z.string().max(100) }).parse(req.body ?? {});
      if (!/^video\/webm/.test(b.mime)) throw badRequest('Format perekaman harus video/webm');
      if (r.is_demo) throw conflict('Kanal demo menerima sinyal dari server');
      // Instance penerima start menjadi pemilik; potongan yang mendarat di replika lain diteruskan ke sini.
      const session_id = await mgr.startBrowser(r.id, r.status);
      await audit(db, { actorId: req.user!.sub, action: 'live.ingest.browser_start', entity: 'stream', entityId: r.id, data: { mime: b.mime } });
      return { session_id, chunk_ms: 1000 };
    });

    s.put('/v1/live/studio/streams/:id/ingest/:session/chunks/:seq', async (req) => {
      const { session, seq } = req.params as { session: string; seq: string };
      const r = await loadOwned(req);
      const n = Number(seq);
      if (!Number.isInteger(n) || n < 0) throw badRequest('seq tidak valid');
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || !body.length) throw badRequest('Potongan kosong');
      if (mgr.hasBrowserSession(r.id)) return mgr.chunk(r.id, session, n, body);
      // Load balancer tanpa sticky session: teruskan ke replika pemilik sesi ingest.
      const o = await mgr.ownerOf(r.id);
      if (o && o.id !== ME) return mgr.forward(o, 'PUT', `${ingestPath(r.id, session)}/chunks/${n}`, body);
      throw conflict(
        o || !r.owner_instance
          ? 'Sesi siaran browser tidak aktif — mulai ulang siaran'
          : 'Server penerima siaran ini tidak aktif lagi — mulai ulang siaran dari Studio',
        { type: 'https://rave.id/problems/ingest-session-lost' },
      );
    });

    s.post('/v1/live/studio/streams/:id/ingest/:session/stop', async (req) => {
      const r = await loadOwned(req);
      const session = (req.params as { session: string }).session;
      if (!mgr.hasBrowserSession(r.id)) {
        const o = await mgr.ownerOf(r.id);
        if (o && o.id !== ME) return mgr.forward(o, 'POST', `${ingestPath(r.id, session)}/stop`);
      }
      await mgr.stopBrowser(r.id, session);
      return { stopped: true };
    });

    s.get('/v1/live/studio/streams/:id/health', async (req) => healthFor(await loadOwned(req)));

    s.post('/v1/live/studio/streams/:id/end', async (req) => {
      const r = await loadOwned(req);
      if (r.status === 'ENDED') return streamOut(r, true);
      await mgr.end(r.id, 'ended_by_host');
      await audit(db, { actorId: req.user!.sub, action: 'live.stream.end', entity: 'stream', entityId: r.id });
      return streamOut(await load(r.id), true);
    });

    s.delete('/v1/live/studio/streams/:id', async (req) => {
      const r = await loadOwned(req);
      if (r.status !== 'SCHEDULED' && r.status !== 'ENDED') throw conflict('Akhiri siaran terlebih dulu');
      if (r.is_demo) throw conflict('Kanal demo tidak bisa dihapus (matikan lewat pengaturan live.demo_channel)');
      await mgr.end(r.id, 'deleted');
      await db.query(`DELETE FROM streams WHERE id=$1`, [r.id]);
      await audit(db, { actorId: req.user!.sub, action: 'live.stream.delete', entity: 'stream', entityId: r.id, data: { title: r.title } });
      return { deleted: true };
    });
  });

  // =========================== Internal antar-replika (token service) ===========================
  app.register(async (i) => {
    i.addHook('preHandler', requireService);
    i.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 2 * 1024 * 1024 }, (_r, body, done) => done(null, body));
    const sid = (req: FastifyRequest) => {
      const { id } = req.params as { id: string };
      if (!UUID_RE.test(id)) throw notFound('Siaran');
      return id;
    };

    // Potongan ingest browser yang diteruskan replika lain — hanya diproses lokal (tidak diteruskan lagi).
    i.put('/internal/live/streams/:id/ingest/:session/chunks/:seq', async (req) => {
      const id = sid(req);
      const { session, seq } = req.params as { session: string; seq: string };
      const n = Number(seq);
      if (!Number.isInteger(n) || n < 0) throw badRequest('seq tidak valid');
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || !body.length) throw badRequest('Potongan kosong');
      if (!mgr.hasBrowserSession(id)) throw conflict('Sesi siaran browser tidak aktif — mulai ulang siaran');
      return mgr.chunk(id, session, n, body);
    });

    i.post('/internal/live/streams/:id/ingest/:session/stop', async (req) => {
      await mgr.stopBrowser(sid(req), (req.params as { session: string }).session);
      return { stopped: true };
    });

    i.get('/internal/live/streams/:id/health', async (req) => {
      const r = await load(sid(req));
      return mgr.health(r.id, r.status, r.ingest, r.started_at, r.viewers);
    });

    // Siaran diakhiri di replika lain → putus publisher lokal sekarang (watchdog menyusul ≤ 3 dtk bila panggilan ini gagal).
    i.post('/internal/live/streams/:id/sync', async (req) => {
      await mgr.syncLocal([sid(req)]);
      return { synced: true };
    });
  });

  // =========================== Back office ===========================
  app.register(async (a) => {
    a.addHook('preHandler', requirePermission('live.moderate'));

    a.get('/v1/admin/live/streams', async (req) => {
      const { status } = req.query as { status?: string };
      const rows = await db.query(
        `SELECT ${COLS} FROM streams s WHERE ($1::text IS NULL OR s.status = $1) ORDER BY (s.status IN ('LIVE','INTERRUPTED')) DESC, s.created_at DESC LIMIT 200`,
        [status || null],
      );
      return { data: await Promise.all(rows.map(async (r) => ({ ...streamOut(r, true), health: await healthFor(r) }))) };
    });

    a.post('/v1/admin/live/streams/:id/stop', async (req) => {
      const r = await load((req.params as { id: string }).id);
      const b = z.object({ reason: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(300) }).parse(req.body);
      await mgr.end(r.id, `moderation: ${b.reason}`);
      await audit(db, { actorId: req.user!.sub, action: 'live.stream.moderation_stop', entity: 'stream', entityId: r.id, data: { reason: b.reason } });
      return streamOut(await load(r.id), true);
    });

    a.delete('/v1/admin/live/chat/:messageId', async (req) => {
      const r = await db.query(`UPDATE chat_messages SET deleted_at=now(), deleted_by=$2 WHERE id=$1 AND deleted_at IS NULL RETURNING stream_id`, [
        Number((req.params as { messageId: string }).messageId) || 0,
        req.user!.sub,
      ]);
      if (r.length) await audit(db, { actorId: req.user!.sub, action: 'live.chat.delete', entity: 'chat', entityId: String((req.params as any).messageId) });
      return { deleted: r.length > 0 };
    });
  });
}
