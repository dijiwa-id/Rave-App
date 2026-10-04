import { createService, config, type ServiceContext } from '@gema/service-kit';
import type { FastifyInstance } from 'fastify';
import { adminRoutes, scheduledReleaseJob } from './admin.js';
import { consumers, listenersDecayJob } from './consumers.js';
import { publicRoutes } from './routes.js';
import { seed } from './seed.js';
import { studioRoutes } from './studio.js';

async function routes(app: FastifyInstance, ctx: ServiceContext) {
  await publicRoutes(app, ctx);
  await studioRoutes(app, ctx);
  await adminRoutes(app, ctx);
}

const svc = createService({
  name: 'catalog',
  schema: 'catalog',
  port: config.ports.catalog,
  migrationsDir: new URL('../migrations/', import.meta.url),
  routes,
  consumers,
  jobs: [scheduledReleaseJob, listenersDecayJob],
  seed,
});

await svc.start();
