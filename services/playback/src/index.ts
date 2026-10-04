import { createService, config, type ServiceContext } from '@gema/service-kit';
import type { FastifyInstance } from 'fastify';
import { analyticsRoutes, uniquesJob } from './analytics.js';
import { consumers } from './consumers.js';
import { eventRoutes } from './events.js';
import { seed } from './seed.js';
import { sessionRoutes } from './sessions.js';

async function routes(app: FastifyInstance, ctx: ServiceContext) {
  await sessionRoutes(app, ctx);
  await eventRoutes(app, ctx);
  await analyticsRoutes(app, ctx);
}

const svc = createService({
  name: 'playback',
  schema: 'playback',
  port: config.ports.playback,
  migrationsDir: new URL('../migrations/', import.meta.url),
  routes,
  consumers,
  jobs: [uniquesJob],
  seed,
});

await svc.start();
