import { createService, config } from '@gema/service-kit';
import { completeEventsJob, consumers, expireJob, refundCancelledJob } from './consumers.js';
import { routes } from './routes.js';
import { seed } from './seed.js';

const svc = createService({
  name: 'ticketing',
  schema: 'ticketing',
  port: config.ports.ticketing,
  migrationsDir: new URL('../migrations/', import.meta.url),
  routes,
  consumers,
  jobs: [expireJob, completeEventsJob, refundCancelledJob],
  stats: async ({ db }) => (await db.one(
    `SELECT (SELECT count(*) FROM tickets WHERE status <> 'REFUNDED')::int AS tickets_sold,
              (SELECT coalesce(sum(total), 0) FROM orders WHERE status = 'PAID')::bigint AS ticket_gmv,
              (SELECT count(*) FROM events WHERE status = 'PUBLISHED')::int AS events_published`,
  )) ?? {},
  seed,
});

await svc.start();
