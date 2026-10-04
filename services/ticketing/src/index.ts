import { createService, config } from '@gema/service-kit';
import { consumers, expireJob } from './consumers.js';
import { routes } from './routes.js';
import { seed } from './seed.js';

const svc = createService({
  name: 'ticketing',
  schema: 'ticketing',
  port: config.ports.ticketing,
  migrationsDir: new URL('../migrations/', import.meta.url),
  routes,
  consumers,
  jobs: [expireJob],
  seed,
});

await svc.start();
