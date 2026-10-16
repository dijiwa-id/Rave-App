import { createService, config, type ServiceContext } from '@gema/service-kit';
import type { FastifyInstance } from 'fastify';
import { backupJob, backupRoutes } from './backups.js';
import { brandingRoutes } from './branding.js';
import { overviewRoutes } from './overview.js';
import { settingsRoutes } from './settings.js';
import { storageJobs, storageRoutes } from './storage.js';

/** Service Platform — panel Super Admin: pengaturan tanpa deploy, branding, storage, backup, event bus (docs/API.md §9). */
async function routes(app: FastifyInstance, ctx: ServiceContext) {
  await settingsRoutes(app, ctx);
  await overviewRoutes(app, ctx);
  await storageRoutes(app, ctx);
  await backupRoutes(app, ctx);
  await brandingRoutes(app, ctx);
}

const svc = createService({
  name: 'platform',
  schema: 'platform',
  port: config.ports.platform,
  migrationsDir: new URL('../migrations/', import.meta.url),
  routes,
  jobs: [backupJob, ...storageJobs],
  stats: async ({ db }) => {
    const r = await db.one(
      `SELECT (SELECT version FROM settings_state WHERE id = 1) AS settings_version,
              (SELECT count(*) FROM settings)::int AS settings_overridden,
              (SELECT count(*) FROM backups WHERE status = 'COMPLETED')::int AS backups`,
    );
    return r ?? {};
  },
  // Sampel storage pertama agar grafik tren langsung terisi.
  seed: async ({ db }) => {
    const { sample } = await import('./storage.js');
    await sample(db);
  },
});

await svc.start();
