import { createService, config } from '@rave/service-kit';
import { consumers } from './consumers.js';
import { routes } from './routes.js';
import { deliveryJob } from './delivery.js';
import { fanoutJob } from './notify.js';

const svc = createService({
  name: 'notification',
  schema: 'notify',
  port: config.ports.notification,
  migrationsDir: new URL('../migrations/', import.meta.url),
  routes,
  consumers,
  jobs: [deliveryJob, fanoutJob],
  stats: async ({ db }) => (await db.one(
    `SELECT (SELECT count(*) FROM notifications WHERE read_at IS NULL)::int AS unread,
              (SELECT count(*) FROM deliveries WHERE status = 'PENDING')::int AS deliveries_pending,
              (SELECT count(*) FROM deliveries WHERE status = 'FAILED')::int AS deliveries_failed`,
  )) ?? {},
});

await svc.start();
