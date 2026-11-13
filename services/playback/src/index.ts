import { createService, config, type ServiceContext } from '@rave/service-kit';
import type { FastifyInstance } from 'fastify';
import { aggFlushJob } from './aggregates.js';
import { analyticsRoutes, uniquesJob } from './analytics.js';
import { consumers } from './consumers.js';
import { eventRoutes } from './events.js';
import { seed } from './seed.js';
import { reportRoutes } from './reports.js';
import { sessionRoutes } from './sessions.js';

async function routes(app: FastifyInstance, ctx: ServiceContext) {
  await sessionRoutes(app, ctx);
  await eventRoutes(app, ctx);
  await analyticsRoutes(app, ctx);
  await reportRoutes(app, ctx);
}

const svc = createService({
  name: 'playback',
  schema: 'playback',
  port: config.ports.playback,
  migrationsDir: new URL('../migrations/', import.meta.url),
  routes,
  consumers,
  jobs: [aggFlushJob, uniquesJob],
  stats: async ({ db }) => (await db.one(
    `SELECT (SELECT count(*) FROM qualified_streams WHERE NOT suspicious AND at >= date_trunc('day', now()))::int AS streams_today,
              (SELECT count(*) FROM qualified_streams WHERE NOT suspicious AND at > now() - interval '28 days')::int AS streams_28d,
              (SELECT count(*) FROM qualified_streams WHERE suspicious AND at > now() - interval '28 days')::int AS fraud_28d,
              (SELECT count(*) FROM sessions WHERE expires_at > now())::int AS sessions_active`,
  )) ?? {},
  seed,
});

await svc.start();
