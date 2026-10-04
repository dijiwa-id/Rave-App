/**
 * API Gateway (TDD §10.2 lapisan Edge): routing per prefix, verifikasi JWT di tepi,
 * rate limit (lebih ketat di endpoint login & tiket), request-id, CORS.
 * Endpoint /internal/* TIDAK pernah diteruskan.
 */
import cors from '@fastify/cors';
import proxy from '@fastify/http-proxy';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { config, serviceUrl, verifyAccessToken, type ServiceName } from '@gema/service-kit';

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
  ['/v1/notifications', 'notification'],
];

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info', base: { svc: 'gateway' } },
  genReqId: (req) => (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
  bodyLimit: 60 * 1024 * 1024, // upload master audio (dev). Produksi: presigned URL langsung ke object storage.
});

await app.register(cors, { origin: true, credentials: true, exposedHeaders: ['Idempotent-Replayed', 'X-Request-Id'] });

// Rate limit per token (sub) atau IP. Endpoint sensitif dibatasi lebih ketat (REQ-WEB-02, REQ-TIX-01).
await app.register(rateLimit, {
  global: true,
  max: (req) => (req.url.startsWith('/v1/auth/otp') ? 10 : req.url.startsWith('/v1/ticketing/orders') ? 30 : 600),
  timeWindow: '1 minute',
  keyGenerator: (req) => {
    const h = req.headers.authorization;
    return (h ? h.slice(-24) : req.ip) + (req.url.startsWith('/v1/auth/otp') ? ':otp' : '');
  },
  errorResponseBuilder: (_req, ctx) => ({
    type: 'about:blank',
    title: 'Too Many Requests',
    status: 429,
    detail: `Terlalu banyak permintaan. Coba lagi dalam ${Math.ceil(ctx.ttl / 1000)} detik.`,
  }),
});

app.addHook('onRequest', async (req, reply) => {
  reply.header('x-request-id', req.id);
  if (req.url.startsWith('/internal')) {
    return reply.status(404).type('application/problem+json').send({ type: 'about:blank', title: 'Not Found', status: 404 });
  }
  // Tolak token rusak/kedaluwarsa di tepi; endpoint publik tetap jalan tanpa token.
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) {
    try {
      await verifyAccessToken(h.slice(7));
    } catch {
      return reply
        .status(401)
        .type('application/problem+json')
        .send({ type: 'about:blank', title: 'Unauthorized', status: 401, detail: 'Token tidak valid atau kedaluwarsa' });
    }
  }
});

app.get('/healthz', async () => ({ status: 'ok', service: 'gateway' }));

// Status agregat semua service (untuk dashboard ops / smoke test).
app.get('/v1/status', async () => {
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
});

for (const [prefix, upstream] of ROUTES) {
  await app.register(proxy, {
    upstream: serviceUrl(upstream),
    prefix,
    rewritePrefix: prefix,
    http2: false,
    replyOptions: {
      rewriteRequestHeaders: (req, headers) => ({ ...headers, 'x-request-id': req.id, 'x-forwarded-for': req.ip }),
    },
  });
}

app.setNotFoundHandler((req, reply) => {
  reply.status(404).type('application/problem+json').send({ type: 'about:blank', title: 'Not Found', status: 404, instance: req.url });
});

await app.listen({ port: config.ports.gateway, host: process.env.HOST ?? '0.0.0.0' });
app.log.info(`gateway siap di :${config.ports.gateway}`);
