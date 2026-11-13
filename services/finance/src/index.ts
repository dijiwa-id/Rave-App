import { createService, config } from '@rave/service-kit';
import { consumers } from './consumers.js';
import { expiryJob, payoutJob, refundDispatchJob, releaseJob, sandboxRefundSettleJob } from './jobs.js';
import { paymentSettings } from './providers.js';
import { reportRoutes } from './reports.js';
import { routes } from './routes.js';
import { seed } from './seed.js';

const svc = createService({
  name: 'finance',
  schema: 'finance',
  port: config.ports.finance,
  migrationsDir: new URL('../migrations/', import.meta.url),
  routes: async (app, ctx) => {
    await routes(app, ctx);
    await reportRoutes(app, ctx);
  },
  consumers,
  jobs: [releaseJob, payoutJob, expiryJob, refundDispatchJob, sandboxRefundSettleJob],
  stats: async ({ db }) => (await db.one(
    `SELECT (SELECT coalesce(sum(held - released - refunded), 0) FROM escrow_holds)::bigint AS escrow_held,
              (SELECT count(*) FROM invoices WHERE status = 'PENDING')::int AS invoices_pending,
              (SELECT count(*) FROM payouts WHERE status IN ('REQUESTED','PROCESSING'))::int AS payouts_pending,
              (SELECT count(*) FROM refunds WHERE status IN ('REQUESTED','PENDING'))::int AS refunds_pending,
              (SELECT count(*) FROM refunds WHERE status = 'FAILED')::int AS refunds_failed`,
  )) ?? {},
  seed,
});

await svc.start();

// Peringatan bila produksi masih memakai sandbox (pembayaran & refund tidak memindahkan uang). Penyedia dapat diganti
// Super Admin kapan saja (Platform → Integrasi) tanpa restart.
void paymentSettings()
  .then((s) => {
    if (!config.isDev && s.provider === 'sandbox') console.warn('[finance] payment gateway = sandbox di produksi — pembayaran & refund tidak memindahkan uang sungguhan');
  })
  .catch((e) => console.error('[finance] konfigurasi payment gateway tidak valid:', e?.message ?? e));
