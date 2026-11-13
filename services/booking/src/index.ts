import { createService, config } from '@rave/service-kit';
import './common.js';
import { consumers } from './consumers.js';
import { contractJobs } from './contract-jobs.js';
import { bookingTimers } from './jobs.js';
import { adminRoutes } from './routes-admin.js';
import { artistRoutes } from './routes-artist.js';
import { bookingRoutes } from './routes-bookings.js';
import { contractRoutes } from './routes-contracts.js';
import { reportRoutes } from './reports.js';
import { seed } from './seed.js';

const svc = createService({
  name: 'booking',
  schema: 'booking',
  port: config.ports.booking,
  migrationsDir: new URL('../migrations/', import.meta.url),
  async routes(app, ctx) {
    await artistRoutes(app, ctx);
    await adminRoutes(app, ctx);
    await contractRoutes(app, ctx);
    await reportRoutes(app, ctx);
    // bookingRoutes memasang preHandler requireAuth → daftarkan di scope terpisah.
    await app.register(async (s) => bookingRoutes(s, ctx));
  },
  consumers,
  jobs: [bookingTimers, contractJobs],
  stats: async ({ db }) => (await db.one(
    `SELECT (SELECT count(*) FROM bookings WHERE status NOT IN ('DRAFT','SETTLED','DECLINED','EXPIRED','CANCELLED_BY_PROMOTOR','CANCELLED_BY_ARTIST','FORCE_MAJEURE'))::int AS bookings_active,
              (SELECT count(*) FROM bookings WHERE status = 'SETTLED')::int AS bookings_settled,
              (SELECT coalesce(sum(agreed_fee), 0) FROM bookings WHERE agreed_fee IS NOT NULL AND status IN ('BOOKED','BOOKED_AND_SECURED','AT_RISK','SHOW_DAY','COMPLETED','SETTLED'))::bigint AS gmv_offair,
              (SELECT count(*) FROM disputes WHERE status = 'OPEN')::int AS disputes_open`,
  )) ?? {},
  seed,
});

await svc.start();
