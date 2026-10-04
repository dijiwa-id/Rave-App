import { createService, config } from '@gema/service-kit';
import { consumers } from './consumers.js';
import { expiryJob, payoutJob, releaseJob } from './jobs.js';
import { routes } from './routes.js';
import { seed } from './seed.js';

const svc = createService({
  name: 'finance',
  schema: 'finance',
  port: config.ports.finance,
  migrationsDir: new URL('../migrations/', import.meta.url),
  routes,
  consumers,
  jobs: [releaseJob, payoutJob, expiryJob],
  seed,
});

await svc.start();
