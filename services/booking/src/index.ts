import { createService, config } from '@gema/service-kit';
import './common.js';
import { consumers } from './consumers.js';
import { bookingTimers } from './jobs.js';
import { adminRoutes } from './routes-admin.js';
import { artistRoutes } from './routes-artist.js';
import { bookingRoutes } from './routes-bookings.js';
import { seed } from './seed.js';

const svc = createService({
  name: 'booking',
  schema: 'booking',
  port: config.ports.booking,
  migrationsDir: new URL('../migrations/', import.meta.url),
  async routes(app, ctx) {
    await artistRoutes(app, ctx);
    await adminRoutes(app, ctx);
    // bookingRoutes memasang preHandler requireAuth → daftarkan di scope terpisah.
    await app.register(async (s) => bookingRoutes(s, ctx));
  },
  consumers,
  jobs: [bookingTimers],
  seed,
});

await svc.start();
