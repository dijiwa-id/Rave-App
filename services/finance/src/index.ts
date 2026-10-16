import { createService, config } from '@gema/service-kit';
import { consumers } from './consumers.js';
import { expiryJob, payoutJob, refundDispatchJob, releaseJob, sandboxRefundSettleJob } from './jobs.js';
import { paymentProvider } from './providers.js';
import { routes } from './routes.js';
import { seed } from './seed.js';

const svc = createService({
  name: 'finance',
  schema: 'finance',
  port: config.ports.finance,
  migrationsDir: new URL('../migrations/', import.meta.url),
  routes,
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

// Fail fast bila PAYMENT_PROVIDER salah ketik; peringatkan bila produksi masih memakai sandbox (refund tidak memindahkan uang).
const provider = paymentProvider();
if (!config.isDev && provider.name === 'sandbox') console.warn('[finance] PAYMENT_PROVIDER=sandbox di produksi — refund & pembayaran tidak memindahkan uang sungguhan');

await svc.start();
