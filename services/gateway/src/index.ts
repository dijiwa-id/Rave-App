/**
 * API Gateway (TDD §10.2 lapisan Edge): routing per prefix, verifikasi JWT di tepi,
 * rate limit (lebih ketat di endpoint login & tiket), request-id, CORS.
 * Endpoint /internal/* TIDAK pernah diteruskan.
 */
import cors from '@fastify/cors';
import proxy from '@fastify/http-proxy';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import {
  config,
  INSTANCE_ID,
  serviceUrl,
  settings,
  startSettingsListener,
  startSettingsPolling,
  verifyAccessToken,
  type AuthUser,
  type ServiceName,
} from '@gema/service-kit';
import { createPgRateLimit, type PgRateLimit } from './rate-store.js';

type Upstream = Exclude<ServiceName, 'gateway'>;

// Urutan penting: prefix lebih spesifik lebih dulu.
export const ROUTES: [prefix: string, upstream: Upstream][] = [
  ['/v1/auth', 'iam'],
  ['/v1/me', 'iam'],
  ['/v1/orgs', 'iam'],
  ['/v1/waitlist', 'iam'],
  ['/v1/admin/iam', 'iam'],
  ['/v1/catalog', 'catalog'],
  ['/v1/studio', 'catalog'],
  ['/v1/admin/qc', 'catalog'],
  ['/v1/library', 'library'],
  ['/v1/playback', 'playback'],
  ['/v1/events/play', 'playback'],
  ['/v1/analytics', 'playback'],
  ['/v1/booking', 'booking'],
  ['/v1/admin/disputes', 'booking'],
  ['/v1/finance', 'finance'],
  ['/v1/webhooks/pg', 'finance'],
  ['/v1/admin/finance', 'finance'],
  ['/v1/ticketing', 'ticketing'],
  ['/v1/admin/ticketing', 'ticketing'],
  ['/v1/notifications', 'notification'],
  ['/v1/ads', 'ads'],
  ['/v1/admin/ads', 'ads'],
  ['/v1/live', 'live'],
  ['/v1/admin/live', 'live'],
  ['/v1/platform', 'platform'],
  ['/v1/admin/platform', 'platform'],
];

/**
 * Modul yang bisa dimatikan Super Admin: SEMUA metode ke prefix ini ditolak 503 untuk non-admin
 * (admin tetap lolos agar back office bisa memantau/menyelesaikan data yang sudah ada).
 * Catatan: tagihan /v1/finance/invoices dipakai bersama booking & tiket (purpose tidak ada di path) → tidak di-gate.
 */
const MODULE_PREFIXES: [prefix: string, key: string, label: string][] = [
  ['/v1/booking', 'modules.booking', 'Booking off-air'],
  ['/v1/ticketing', 'modules.ticketing', 'Ticketing'],
  ['/v1/waitlist', 'modules.waitlist', 'Waitlist'],
  ['/v1/live', 'modules.live', 'Live streaming'],
  ['/v1/catalog/shows', 'modules.podcasts', 'Podcast & cerita'],
  ['/v1/catalog/episodes', 'modules.podcasts', 'Podcast & cerita'],
];
/** Tetap dilayani saat mode pemeliharaan: login, back office, konfigurasi, dan webhook PG (dana masuk tak boleh hilang). */
const MAINTENANCE_BYPASS = ['/v1/auth', '/v1/admin', '/v1/platform', '/v1/webhooks'];
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/**
 * POST yang secara makna adalah "menonton/mendengar" (bukan transaksi): tetap dilayani saat pemeliharaan,
 * sesuai janji "streaming tetap berjalan" — sesi putar musik, play event, token & heartbeat siaran live.
 */
const PLAYBACK_WRITES = [
  /^\/v1\/playback\//,
  /^\/v1\/events\/play/,
  /^\/v1\/live\/streams\/[^/]+\/(playback|heartbeat)$/,
  // siaran browser yang sedang berjalan tidak boleh putus karena pemeliharaan
  /^\/v1\/live\/studio\/streams\/[^/]+\/ingest\//,
  // jeda iklan & pelaporan impresi bagian dari pemutaran (pendapatan iklan tidak hilang)
  /^\/v1\/ads\/break$/,
  /^\/v1\/ads\/impressions\/[^/]+\/events$/,
];

/**
 * `TRUST_PROXY` (di belakang load balancer/ingress): `true`, jumlah hop (`1`), atau daftar IP/CIDR proxy tepercaya
 * (`10.0.0.0/8,172.16.0.0/12`). Tanpa ini, req.ip = alamat LB → semua pengguna anonim berbagi satu bucket rate limit.
 * Default mati: jangan percayai X-Forwarded-For dari klien langsung.
 */
function trustProxyOption(): boolean | number | string {
  const v = process.env.TRUST_PROXY?.trim();
  if (!v || v === 'false') return false;
  if (v === 'true') return true;
  return /^\d+$/.test(v) ? Number(v) : v;
}

const app = Fastify({
  // Tipe Fastify tidak memuat `number` (jumlah hop), padahal didukung runtime (proxy-addr).
  trustProxy: trustProxyOption() as boolean | string,
  logger: { level: process.env.LOG_LEVEL ?? 'info', base: { svc: 'gateway', instance: INSTANCE_ID } },
  genReqId: (req) => (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
  bodyLimit: 2048 * 1024 * 1024, // upload master audio (dev; batas efektif = storage.max_upload_mb). Produksi: presigned URL langsung ke object storage.
});

// Pengaturan platform (maintenance, modul, rate limit): real-time lewat LISTEN `gema_settings` di setiap replika;
// polling 30 dtk hanya jaring pengaman (gateway tidak punya event bus).
const settingsPoll = startSettingsPolling('gateway', 30_000);
settingsPoll.unref();
const settingsListener = startSettingsListener('gateway', { log: (o, m) => app.log.warn(o, m) });

await app.register(cors, { origin: true, credentials: true, exposedHeaders: ['Idempotent-Replayed', 'X-Request-Id'] });

/**
 * Kelas rate limit dari path saja (tanpa query string) dengan pola ber-anchor — query seperti `?x=/ingest/`
 * tidak boleh memindahkan permintaan ke bucket longgar.
 */
type RateClass = 'otp' | 'hls' | 'ingest' | 'tix' | '';
function rateClass(path: string): RateClass {
  // Penerbitan OTP dan penukaran kode/refresh token sama-sama ketat (tebakan kode OTP, penyalahgunaan biaya kirim).
  if (/^\/v1\/auth\/(otp|token)(\/|$)/.test(path)) return 'otp';
  if (/^\/v1\/live\/hls\//.test(path)) return 'hls';
  if (/^\/v1\/live\/studio\/streams\/[^/]+\/ingest\//.test(path)) return 'ingest';
  if (/^\/v1\/ticketing\/orders(\/|$)/.test(path)) return 'tix';
  return '';
}

/**
 * Konteks tepi per permintaan, diisi hook onRequest: path yang sudah di-decode (router & service men-decode juga,
 * jadi gerbang modul/rate limit wajib menilai bentuk yang sama) dan `sub` dari token yang SUDAH diverifikasi.
 */
const edge = new WeakMap<object, { path: string; sub: string | null }>();
const edgePath = (req: { url: string }) => edge.get(req)?.path ?? req.url.split('?')[0];

// Store hitungan: `memory` (default, dev — per replika) atau `pg` (bersama antar-replika, fail open).
const RATE_LIMIT_STORE = (process.env.RATE_LIMIT_STORE ?? 'memory').toLowerCase();
if (!['memory', 'pg'].includes(RATE_LIMIT_STORE)) throw new Error(`RATE_LIMIT_STORE tidak dikenal: ${RATE_LIMIT_STORE} (memory|pg)`);
const pgRate: PgRateLimit | null = RATE_LIMIT_STORE === 'pg' ? await createPgRateLimit(app.log) : null;

// Rate limit per token (sub) atau IP. Endpoint sensitif dibatasi lebih ketat (REQ-WEB-02, REQ-TIX-01).
await app.register(rateLimit, {
  global: true,
  // Setelah hook onRequest (verifikasi JWT): kunci bucket memakai `sub` yang terverifikasi, bukan isi header mentah.
  hook: 'preHandler',
  ...(pgRate ? { store: pgRate.Store as any } : {}),
  max: (req) => {
    const cls = rateClass(edgePath(req));
    if (cls === 'otp') return settings.num('security.rate_limit_otp_per_minute');
    // playlist + segmen tiap 1–4 dtk per penonton; potongan ingest tiap 1 dtk (penonton di balik satu IP/NAT)
    if (cls === 'hls' || cls === 'ingest') return 6000;
    if (cls === 'tix') return 30;
    return settings.num('security.rate_limit_per_minute');
  },
  timeWindow: '1 minute',
  keyGenerator: (req) => {
    // Pengguna terautentikasi → per `sub` (token baru setelah refresh tetap bucket yang sama); anonim → per IP.
    // Bucket terpisah per kelas endpoint: lalu lintas media (HLS/ingest) tidak boleh menghabiskan kuota API umum,
    // dan bucket ketat (otp/tix) tidak berbagi hitungan dengan bucket umum.
    const sub = edge.get(req)?.sub;
    const cls = rateClass(edgePath(req));
    return (sub ? `u:${sub}` : `ip:${req.ip}`) + (cls ? ':' + cls : '');
  },
  errorResponseBuilder: (_req, ctx) => ({
    type: 'about:blank',
    title: 'Too Many Requests',
    status: 429,
    detail: `Terlalu banyak permintaan. Coba lagi dalam ${Math.ceil(ctx.ttl / 1000)} detik.`,
  }),
});

const problem = (reply: any, status: number, title: string, detail?: string) =>
  reply.status(status).type('application/problem+json').send({ type: 'about:blank', title, status, ...(detail ? { detail } : {}) });

app.addHook('onRequest', async (req, reply) => {
  reply.header('x-request-id', req.id);
  // Path di-decode SEKALI di tepi: `/v1/%74icketing` tidak boleh lolos dari gerbang modul / kelas rate limit.
  // Garis miring ter-encode ditolak (tidak pernah dipakai klien sah, dipakai untuk mengakali pencocokan prefix).
  const rawPath = req.url.split('?')[0];
  if (/%2f|%5c/i.test(rawPath)) return problem(reply, 400, 'Bad Request', 'Path tidak valid');
  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return problem(reply, 400, 'Bad Request', 'Path tidak valid');
  }
  if (path.startsWith('/internal') || rawPath.startsWith('/internal')) return problem(reply, 404, 'Not Found');
  // Tolak token rusak/kedaluwarsa di tepi; endpoint publik tetap jalan tanpa token.
  // Header Authorization selain "Bearer <token>" ditolak (dulu diteruskan sebagai anonim dengan bucket rate limit baru).
  const h = req.headers.authorization;
  if (h !== undefined && !h.startsWith('Bearer ')) return problem(reply, 401, 'Unauthorized', 'Header Authorization harus berformat "Bearer <token>"');
  let user: AuthUser | null = null;
  if (h) {
    try {
      user = await verifyAccessToken(h.slice(7));
    } catch {
      return reply
        .status(401)
        .type('application/problem+json')
        .send({ type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Token tidak valid atau kedaluwarsa' });
    }
  }
  edge.set(req, { path, sub: user?.sub ?? null });
  const isAdmin = !!user?.roles.includes('admin');
  const mod = MODULE_PREFIXES.find(([p]) => path === p || path.startsWith(p + '/'));
  if (mod && req.method !== 'OPTIONS' && !isAdmin && !settings.bool(mod[1])) {
    return reply.status(503).type('application/problem+json').send({
      type: 'https://gema.id/problems/module-disabled',
      title: 'Modul dinonaktifkan',
      status: 503,
      detail: `${mod[2]} sedang dinonaktifkan oleh admin GEMA.`,
    });
  }
  if (READ_METHODS.has(req.method)) return;
  // Mode pemeliharaan: baca tetap jalan (streaming tidak terganggu); tulis ditolak kecuali admin.
  if (
    settings.bool('maintenance.enabled') &&
    !isAdmin &&
    !MAINTENANCE_BYPASS.some((p) => path.startsWith(p)) &&
    !PLAYBACK_WRITES.some((re) => re.test(path))
  ) {
    return reply.status(503).header('retry-after', '300').type('application/problem+json').send({
      type: 'https://gema.id/problems/maintenance',
      title: 'Sedang pemeliharaan',
      status: 503,
      detail: settings.get<string>('maintenance.message'),
    });
  }
});

app.get('/healthz', async () => ({ status: 'ok', service: 'gateway', instance: INSTANCE_ID, rate_limit_store: RATE_LIMIT_STORE }));

// Status agregat semua service (untuk dashboard ops / smoke test). Di-cache 5 dtk agar tidak memicu fan-out per permintaan.
let statusCache: { at: number; v: Promise<{ ok: boolean; services: { service: string; ok: boolean; ms: number }[] }> } | null = null;
app.get('/v1/status', async () => {
  if (!statusCache || Date.now() - statusCache.at > 5000) statusCache = { at: Date.now(), v: checkStatus() };
  return statusCache.v;
});

async function checkStatus() {
  const ups = [...new Set(ROUTES.map((r) => r[1]))];
  const results = await Promise.all(
    ups.map(async (u) => {
      const t = Date.now();
      try {
        const r = await fetch(serviceUrl(u) + '/readyz', { signal: AbortSignal.timeout(1500) });
        return { service: u, ok: r.ok, ms: Date.now() - t };
      } catch {
        return { service: u, ok: false, ms: Date.now() - t };
      }
    }),
  );
  return { ok: results.every((r) => r.ok), services: results };
}

for (const [prefix, upstream] of ROUTES) {
  await app.register(proxy, {
    upstream: serviceUrl(upstream),
    prefix,
    rewritePrefix: prefix,
    http2: false,
    replyOptions: {
      // `Expect: 100-continue` (dikirim curl/klien mobile untuk body besar) tidak didukung undici → 500.
      // Node sudah menjawab 100 Continue ke klien, jadi header ini tidak perlu diteruskan ke upstream.
      rewriteRequestHeaders: (req, headers) => {
        const { expect: _expect, ...rest } = headers;
        return { ...rest, 'x-request-id': req.id, 'x-forwarded-for': req.ip };
      },
    },
  });
}

app.setNotFoundHandler((req, reply) => {
  reply.status(404).type('application/problem+json').send({ type: 'about:blank', title: 'Not Found', status: 404, instance: req.url });
});

await app.listen({ port: config.ports.gateway, host: process.env.HOST ?? '0.0.0.0' });
app.log.info({ instance: INSTANCE_ID, rateLimitStore: RATE_LIMIT_STORE }, `gateway siap di :${config.ports.gateway}`);

// Shutdown rapi: hentikan terima koneksi, tunggu permintaan berjalan; batas keras 10 dtk (koneksi HLS/unduhan panjang).
let closing = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    if (closing) return;
    closing = true;
    app.log.info({ sig }, 'gateway berhenti');
    setTimeout(() => process.exit(1), 10_000).unref();
    clearInterval(settingsPoll);
    app
      .close()
      .then(() => Promise.all([settingsListener.close(), pgRate?.close()]))
      .then(
        () => process.exit(0),
        () => process.exit(1),
      );
  });
}
