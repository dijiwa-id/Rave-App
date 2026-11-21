import { createService, config, requireService, z, type ServiceContext } from '@rave/service-kit';
import type { FastifyInstance } from 'fastify';
import { adminRoutes } from './admin.js';
import { seed } from './seed.js';
import { servingRoutes } from './serving.js';

/** Service Iklan — kebijakan penayangan tier Gratis: keputusan jeda, kampanye & peninjauan (docs/API.md §11). */
const TODAY = `(now() AT TIME ZONE 'Asia/Jakarta')::date`;

const svc = createService({
  name: 'ads',
  schema: 'ads',
  port: config.ports.ads,
  migrationsDir: new URL('../migrations/', import.meta.url),
  routes: async (app: FastifyInstance, ctx: ServiceContext) => {
    await servingRoutes(app, ctx);
    await adminRoutes(app, ctx);
    // Internal (finance — royalti): impresi iklan berbayar yang selesai per pendengar → atribusi pendapatan iklan (BRD §4.3).
    app.get('/internal/royalty/impressions', { preHandler: requireService }, async (req) => {
      const q = z.object({ from: z.string().datetime(), to: z.string().datetime() }).parse(req.query);
      const rows = await ctx.db.query(
        `SELECT i.user_id, count(*)::int AS n FROM impressions i JOIN campaigns c ON c.id = i.campaign_id
          WHERE NOT c.is_house AND i.completed_at IS NOT NULL AND i.served_at >= $1 AND i.served_at < $2 GROUP BY 1`,
        [q.from, q.to],
      );
      return { data: rows };
    });
  },
  // Hitungan "lagu" untuk masa bebas iklan & jarak antar-jeda berasal dari server (bukan laporan klien).
  consumers: () => ({
    'playback.stream.qualified': async (e, tx) => {
      // Consumer group baru membaca riwayat bus dari awal — hanya putaran hari ini (WIB) yang relevan.
      const today = (await tx.query(`SELECT ($1::timestamptz AT TIME ZONE 'Asia/Jakarta')::date = ${TODAY} AS ok`, [e.payload.at])).rows[0]?.ok;
      if (!today) return;
      await tx.query(
        `INSERT INTO listener_state (user_id, day, streams_today, streams_since_break) VALUES ($1, ${TODAY}, 1, 1)
         ON CONFLICT (user_id) DO UPDATE SET
           streams_today = CASE WHEN listener_state.day = ${TODAY} THEN listener_state.streams_today + 1 ELSE 1 END,
           streams_since_break = CASE WHEN listener_state.day = ${TODAY} THEN listener_state.streams_since_break + 1 ELSE 1 END,
           day = ${TODAY}, updated_at = now()`,
        [e.payload.userId],
      );
    },
  }),
  jobs: [
    {
      name: 'ads-flight-end',
      everyMs: 5 * 60_000,
      run: async ({ db }) => void (await db.query(`UPDATE campaigns SET status='ENDED', updated_at=now() WHERE status IN ('APPROVED','PAUSED') AND end_at IS NOT NULL AND end_at <= now()`)),
    },
    {
      name: 'ads-retention',
      everyMs: 6 * 60 * 60_000,
      // Data impresi tingkat pengguna disimpan 180 hari (minimisasi data, UU PDP); agregat tetap.
      run: async ({ db }) => void (await db.query(`DELETE FROM impressions WHERE served_at < now() - interval '180 days'`)),
    },
  ],
  stats: async ({ db }) =>
    (await db.one(
      `SELECT (SELECT count(*) FROM campaigns WHERE status = 'APPROVED' AND NOT is_house)::int AS ads_active_campaigns,
              (SELECT count(*) FROM campaigns WHERE status = 'PENDING_REVIEW')::int AS ads_pending_review,
              (SELECT count(*) FROM impressions WHERE served_at > now() - interval '1 day')::int AS ads_impressions_24h`,
    )) ?? {},
  seed,
});

await svc.start();
