import { createService, config, type ServiceContext } from '@rave/service-kit';
import type { FastifyInstance } from 'fastify';
import { LiveManager, ME } from './manager.js';
import { pruneLiveStorage } from './media.js';
import { flushViewers, routes } from './routes.js';
import { seed } from './seed.js';

/** Service Live — siaran langsung: ingest RTMP/browser → ffmpeg → HLS, chat, penonton (docs/API.md §10). */
let mgr: LiveManager | null = null;

const svc = createService({
  name: 'live',
  schema: 'live',
  port: config.ports.live,
  migrationsDir: new URL('../migrations/', import.meta.url),
  routes: async (app: FastifyInstance, ctx: ServiceContext) => {
    mgr = new LiveManager(ctx);
    await mgr.init();
    await routes(app, ctx, mgr);
  },
  jobs: [
    // Registri instance (multi-replika): heartbeat terpisah dari watchdog agar tick lambat tidak membuat instance "mati".
    { name: 'live-heartbeat', everyMs: 5000, run: async () => mgr?.heartbeat() },
    { name: 'live-watchdog', everyMs: 3000, run: async () => mgr?.tick() },
    // Penonton aktif + peak/total dihitung berkala (bukan per heartbeat).
    { name: 'live-viewers', everyMs: 5000, run: async ({ db }) => flushViewers(db) },
    { name: 'live-expire-scheduled', everyMs: 60 * 60_000, run: async () => mgr?.expireScheduled() },
    // Segmen HLS yatim & folder siaran sisa → disk LIVE_DIR tidak tumbuh tanpa batas.
    {
      name: 'live-storage-prune',
      everyMs: 5 * 60_000,
      run: async ({ db, log }) => {
        const active = new Set((await db.query(`SELECT id FROM streams WHERE status <> 'ENDED'`)).map((r) => r.id as string));
        const r = pruneLiveStorage((id) => active.has(id));
        if (r.segments || r.dirs) log.info(r, 'storage live dibersihkan');
      },
    },
    {
      name: 'live-viewers-cleanup',
      everyMs: 60 * 60_000,
      run: async ({ db }) => void (await db.query(`DELETE FROM viewers v USING streams s WHERE s.id = v.stream_id AND s.status = 'ENDED' AND s.ended_at < now() - interval '30 days'`)),
    },
  ],
  stats: async ({ db }) =>
    (await db.one(
      `SELECT (SELECT count(*) FROM streams WHERE status IN ('LIVE','INTERRUPTED'))::int AS streams_live,
              (SELECT count(*) FROM viewers v JOIN streams s ON s.id = v.stream_id WHERE s.status IN ('LIVE','INTERRUPTED') AND v.last_seen > now() - interval '30 seconds')::int AS live_viewers,
              (SELECT count(*) FROM streams WHERE status = 'SCHEDULED' AND NOT is_demo)::int AS streams_scheduled,
              (SELECT count(*) FROM chat_messages WHERE created_at > now() - interval '1 day')::int AS chat_24h,
              (SELECT count(*) FROM streams WHERE status IN ('LIVE','INTERRUPTED') AND owner_instance = $1)::int AS instance_streams_live,
              (SELECT count(*) FROM instances WHERE heartbeat_at > now() - interval '15 seconds')::int AS live_instances`,
      [ME],
    )) ?? {},
  seed,
  // Hentikan ffmpeg (transcoder & kanal demo) dengan rapi sebelum DB ditutup.
  onShutdown: () => mgr?.stopAll(),
});

await svc.start();
