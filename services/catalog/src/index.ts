import { createService, config, type ServiceContext } from '@rave/service-kit';
import type { FastifyInstance } from 'fastify';
import { adminRoutes, scheduledReleaseJob } from './admin.js';
import { consumers, listenersDecayJob } from './consumers.js';
import { publicRoutes } from './routes.js';
import { reportRoutes } from './reports.js';
import { seed } from './seed.js';
import { studioRoutes } from './studio.js';
import { transcodeJob } from './audio.js';

async function routes(app: FastifyInstance, ctx: ServiceContext) {
  await publicRoutes(app, ctx);
  await studioRoutes(app, ctx);
  await adminRoutes(app, ctx);
  await reportRoutes(app, ctx);
}

const svc = createService({
  name: 'catalog',
  schema: 'catalog',
  port: config.ports.catalog,
  migrationsDir: new URL('../migrations/', import.meta.url),
  routes,
  consumers,
  jobs: [scheduledReleaseJob, listenersDecayJob, transcodeJob],
  stats: async ({ db }) =>
    (await db.one(
      `SELECT (SELECT count(*) FROM artists)::int AS artists,
              (SELECT count(*) FROM tracks t JOIN releases r ON r.id = t.release_id WHERE r.status = 'LIVE')::int AS tracks_live,
              (SELECT count(*) FROM releases WHERE status = 'IN_REVIEW')::int AS releases_in_review,
              (SELECT count(*) FROM releases)::int AS releases,
              (SELECT count(*) FROM shows)::int AS shows,
              (SELECT count(*) FROM uploads WHERE completed_at IS NOT NULL)::int AS uploads`,
    )) ?? {},
  seed,
});

await svc.start();
