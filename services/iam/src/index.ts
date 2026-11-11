import { createService, config } from '@rave/service-kit';
import { routes } from './routes.js';
import { adminRoutes } from './admin.js';
import { seed } from './seed.js';

const svc = createService({
  name: 'iam',
  schema: 'iam',
  port: config.ports.iam,
  migrationsDir: new URL('../migrations/', import.meta.url),
  routes: async (app, ctx) => {
    await routes(app, ctx);
    await adminRoutes(app, ctx);
  },
  jobs: [
    {
      name: 'otp-cleanup',
      everyMs: 10 * 60_000,
      run: async ({ db }) => {
        await db.query(`DELETE FROM otp_codes WHERE expires_at < now() - interval '1 day'`);
        await db.query(`DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'`);
      },
    },
  ],
  stats: async ({ db }) =>
    (await db.one(
      `SELECT (SELECT count(*) FROM users WHERE deleted_at IS NULL)::int AS users_total,
              (SELECT count(*) FROM users WHERE deleted_at IS NULL AND created_at > now() - interval '7 days')::int AS users_7d,
              (SELECT count(*) FROM orgs)::int AS orgs,
              (SELECT count(*) FROM kyc_submissions WHERE status = 'PENDING')::int AS kyc_pending,
              (SELECT count(*) FROM users WHERE admin_role IS NOT NULL AND deleted_at IS NULL)::int AS admins,
              (SELECT count(*) FROM users WHERE suspended_at IS NOT NULL)::int AS suspended,
              (SELECT count(*) FROM waitlist)::int AS waitlist`,
    )) ?? {},
  seed,
});

await svc.start();
