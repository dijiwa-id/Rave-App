import { createService, config } from '@gema/service-kit';
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
  seed,
});

await svc.start();
