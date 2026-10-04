import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { attachUser } from './auth.js';
import { createBus, type Consumers } from './bus.js';
import { config } from './config.js';
import { createDb, migrate, type Db } from './db.js';
import { errorHandler } from './errors.js';

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
  /** Seed data demo (idempoten). Dijalankan dengan argumen CLI `seed`. */
  seed?: (ctx: ServiceContext) => Promise<void>;
}

/**
 * Bootstrap standar microservice GEMA.
 * CLI: `tsx src/index.ts`          → migrate + serve
 *      `tsx src/index.ts migrate`  → migrate saja
 *      `tsx src/index.ts seed`     → migrate + seed
 */
export function createService(def: ServiceDefinition) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: undefined,
      base: { svc: def.name },
    },
    genReqId: (req) => (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
    bodyLimit: 5 * 1024 * 1024,
  });
  const db = createDb(def.schema);
  const log = app.log;
  const bus = createBus(db, def.name, (o, m) => log.warn(o, m));
  const ctx: ServiceContext = { name: def.name, db, log, bus };

  app.decorateRequest('user', null);
  app.addHook('onRequest', attachUser);
  app.setErrorHandler(errorHandler);
  app.register(cors, { origin: true, credentials: true });
  app.get('/healthz', async () => ({ status: 'ok', service: def.name }));
  app.get('/readyz', async () => {
    await db.query('SELECT 1');
    return { status: 'ready', service: def.name };
  });

  async function start() {
    const cmd = process.argv[2];
    await migrate(db, def.migrationsDir, (m) => log.info(m));
    if (cmd === 'migrate') return shutdown(0);
    if (cmd === 'seed') {
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
    if (def.consumers) await bus.consume(def.consumers(ctx));
    for (const j of def.jobs ?? []) {
      setInterval(() => {
        j.run(ctx).catch((e) => log.error({ err: e?.message, job: j.name }, 'job gagal'));
      }, j.everyMs);
    }
    log.info({ port: def.port, bus: config.busDriver }, `${def.name} siap`);
  }

  async function shutdown(code = 0) {
    await bus.close().catch(() => {});
    await app.close().catch(() => {});
    await db.close().catch(() => {});
    process.exit(code);
  }
  process.on('SIGTERM', () => void shutdown(0));
  process.on('SIGINT', () => void shutdown(0));

  return { app, ctx, start };
}
