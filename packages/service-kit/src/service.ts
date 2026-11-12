import cors from '@fastify/cors';
import { setIntegrationCaller } from './integrations.js';
import Fastify, { type FastifyInstance } from 'fastify';
import { attachUser, requireService } from './auth.js';
import { refreshSettings, settings, startSettingsListener } from './settings.js';
import { createBus, type Consumers } from './bus.js';
import { config, INSTANCE_ID } from './config.js';
import { createDb, migrate, type Db } from './db.js';
import { errorHandler } from './errors.js';
import { BUILD_INFO } from './version.js';

export interface ServiceContext {
  name: string;
  db: Db;
  log: FastifyInstance['log'];
  bus: ReturnType<typeof createBus>;
}

export interface Job {
  name: string;
  everyMs: number;
  run: (ctx: ServiceContext) => Promise<void>;
}

export interface ServiceDefinition {
  name: string;
  /** Schema Postgres milik service (database-per-service secara logis). */
  schema: string;
  port: number;
  migrationsDir: URL;
  routes: (app: FastifyInstance, ctx: ServiceContext) => Promise<void> | void;
  consumers?: (ctx: ServiceContext) => Consumers;
  jobs?: Job[];
  /** Metrik ringkas untuk dasbor Super Admin → `GET /internal/stats` (token service). */
  stats?: (ctx: ServiceContext) => Promise<Record<string, unknown>>;
  /** Seed data demo (idempoten). Dijalankan dengan argumen CLI `seed`. */
  seed?: (ctx: ServiceContext) => Promise<void>;
  /** Dipanggil saat shutdown sebelum DB ditutup (mis. menghentikan proses anak). */
  onShutdown?: (ctx: ServiceContext) => Promise<void> | void;
}

/**
 * Bootstrap standar microservice RAVE.
 * CLI: `tsx src/index.ts`          → migrate + serve
 *      `tsx src/index.ts migrate`  → migrate saja
 *      `tsx src/index.ts seed`     → migrate + seed
 */
export function createService(def: ServiceDefinition) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: undefined,
      base: { svc: def.name, instance: INSTANCE_ID },
    },
    // x-request-id dari klien hanya dipakai bila wajar (mencegah log injection / id raksasa).
    genReqId: (req) => {
      const id = req.headers['x-request-id'];
      return typeof id === 'string' && /^[\w.:-]{1,80}$/.test(id) ? id : crypto.randomUUID();
    },
    bodyLimit: 5 * 1024 * 1024,
  });
  const db = createDb(def.schema);
  const log = app.log;
  const bus = createBus(db, def.name, (o, m) => log.warn(o, m));
  const ctx: ServiceContext = { name: def.name, db, log, bus };
  setIntegrationCaller(def.name);
  const timers: NodeJS.Timeout[] = [];
  let settingsListener: ReturnType<typeof startSettingsListener> | null = null;
  let stopping = false;

  app.decorateRequest('user', null);
  app.addHook('onRequest', attachUser);
  app.setErrorHandler(errorHandler);
  app.register(cors, { origin: true, credentials: true });
  app.get('/healthz', async () => ({ status: 'ok', service: def.name, version: BUILD_INFO.version, commit: BUILD_INFO.commit }));
  app.get('/readyz', async () => {
    await db.query('SELECT 1');
    return { status: 'ready', service: def.name, version: BUILD_INFO.version };
  });
  const startedAt = Date.now();
  app.get('/internal/stats', { preHandler: requireService }, async () => {
    const mem = process.memoryUsage();
    return {
      service: def.name,
      instance: INSTANCE_ID,
      pid: process.pid,
      build: BUILD_INFO,
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      memory_mb: Math.round(mem.rss / 1048576),
      settings_loaded_at: settings.loadedAt() ? new Date(settings.loadedAt()!).toISOString() : null,
      settings_version: settings.version(),
      metrics: def.stats ? await def.stats(ctx) : {},
    };
  });

  /**
   * Tunggu Postgres siap sebelum migrasi. Service bisa start lebih dulu dari DB (restart Docker/host, failover DB terkelola);
   * tanpa ini proses langsung mati — di bawah `tsx watch` (dev) container tetap "running" tetapi service tidak melayani.
   * Batas: DB_WAIT_TIMEOUT_MS (default 120 dtk), lalu gagal seperti biasa agar orkestrator me-restart.
   */
  async function waitForDb() {
    const deadline = Date.now() + Number(process.env.DB_WAIT_TIMEOUT_MS ?? 120_000);
    for (let attempt = 1; ; attempt++) {
      try {
        await db.query('SELECT 1');
        if (attempt > 1) log.info({ attempt }, 'database siap');
        return;
      } catch (err: any) {
        if (Date.now() >= deadline) throw err;
        if (attempt === 1 || attempt % 5 === 0) log.warn({ attempt, err: err?.message }, 'database belum siap — mencoba lagi');
        await new Promise((r) => setTimeout(r, Math.min(1000 * attempt, 5000)));
      }
    }
  }

  async function start() {
    const cmd = process.argv[2];
    await waitForDb();
    await migrate(db, def.migrationsDir, (m) => log.info(m));
    if (cmd === 'migrate') return shutdown(0);
    if (cmd === 'seed') {
      // Akun demo (superadmin@rave.id dll.) tidak boleh muncul di produksi tanpa sengaja.
      if (!config.isDev && process.env.RAVE_ALLOW_SEED !== '1') {
        log.error('seed ditolak di produksi (set RAVE_ALLOW_SEED=1 bila memang disengaja)');
        return shutdown(1);
      }
      if (def.seed) await def.seed(ctx);
      await bus.relayOnce();
      log.info('seed selesai');
      return shutdown(0);
    }
    await app.register(async (scoped) => {
      await def.routes(scoped, ctx);
    });
    await app.listen({ port: def.port, host: process.env.HOST ?? '0.0.0.0' });
    bus.startRelay();
    // Pengaturan platform: snapshot awal + LISTEN/NOTIFY `rave_settings` (setiap replika, termasuk platform —
    // platform memuat dari DB lewat setSettingsLoader) + event bus + refresh berkala sebagai jaring pengaman.
    await refreshSettings(def.name);
    timers.push(setInterval(() => void refreshSettings(def.name), 60_000));
    settingsListener = startSettingsListener(def.name, { log: (o, m) => log.warn(o, m) });
    const own = def.consumers ? def.consumers(ctx) : {};
    await bus.consume({
      ...own,
      'platform.settings.updated': async (e, tx) => {
        settings.applyVersioned(e.payload.changes, e.payload.version);
        if (own['platform.settings.updated']) await own['platform.settings.updated'](e, tx);
      },
    });
    for (const j of def.jobs ?? []) {
      // Satu job tidak pernah berjalan tumpang tindih: tick dilewati bila run sebelumnya belum selesai (DB lambat).
      let running = false;
      timers.push(
        setInterval(() => {
          if (running || stopping) return;
          running = true;
          j.run(ctx)
            .catch((e) => log.error({ err: e?.message, job: j.name }, 'job gagal'))
            .finally(() => (running = false));
        }, j.everyMs),
      );
    }
    log.info({ port: def.port, bus: config.busDriver, instance: INSTANCE_ID }, `${def.name} siap`);
  }

  async function shutdown(code = 0) {
    if (stopping) return;
    stopping = true;
    // Batas keras: koneksi stream panjang (HLS, unduhan) tidak boleh menahan shutdown selamanya.
    setTimeout(() => process.exit(code || 1), 10_000).unref();
    timers.forEach(clearInterval);
    await settingsListener?.close().catch(() => {});
    await bus.close().catch(() => {});
    await app.close().catch(() => {});
    await Promise.resolve(def.onShutdown?.(ctx)).catch((e) => log.error({ err: e?.message }, 'onShutdown gagal'));
    await db.close().catch(() => {});
    process.exit(code);
  }
  process.on('SIGTERM', () => void shutdown(0));
  process.on('SIGINT', () => void shutdown(0));
  // Promise yang lupa ditangani dicatat (bukan mematikan proses diam-diam); exception fatal → shutdown rapi.
  process.on('unhandledRejection', (e: any) => log.error({ err: e?.message ?? String(e), stack: e?.stack }, 'unhandled rejection'));
  process.on('uncaughtException', (e) => {
    log.fatal({ err: e.message, stack: e.stack }, 'uncaught exception — shutdown');
    void shutdown(1);
  });

  return { app, ctx, start };
}
