import { createService, config } from '@rave/service-kit';
import { routes } from './routes.js';
import { adminRoutes } from './admin.js';
import { reportRoutes } from './reports.js';
import { seed } from './seed.js';
import { oauthRoutes } from './oauth.js';
import { verificationRoutes } from './verification.js';

const svc = createService({
  name: 'iam',
  schema: 'iam',
  port: config.ports.iam,
  migrationsDir: new URL('../migrations/', import.meta.url),
  routes: async (app, ctx) => {
    await routes(app, ctx);
    await oauthRoutes(app, ctx);
    await adminRoutes(app, ctx);
    await verificationRoutes(app, ctx);
    await reportRoutes(app, ctx);
  },
  jobs: [
    {
      name: 'otp-cleanup',
      everyMs: 10 * 60_000,
      run: async ({ db }) => {
        await db.query(`DELETE FROM otp_codes WHERE expires_at < now() - interval '1 day'`);
        await db.query(`DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'`);
        await db.query(`DELETE FROM oauth_flows WHERE expires_at < now()`);
        await db.query(`DELETE FROM oauth_app_launches WHERE expires_at < now() - interval '1 hour'`);
        await db.query(`DELETE FROM oauth_login_codes WHERE expires_at < now() - interval '1 day'`);
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
