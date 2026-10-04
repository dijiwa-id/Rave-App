import { createService, config } from '@gema/service-kit';
import { consumers } from './consumers.js';
import { routes } from './routes.js';
import { deliveryJob } from './delivery.js';

const svc = createService({
  name: 'notification',
  schema: 'notify',
  port: config.ports.notification,
  migrationsDir: new URL('../migrations/', import.meta.url),
  routes,
  consumers,
  jobs: [deliveryJob],
});

await svc.start();
