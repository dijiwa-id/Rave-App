import { createService, config, type Consumers } from '@rave/service-kit';
import { routes } from './routes.js';
import { seed } from './seed.js';

const consumers = (): Consumers => ({
  // Riwayat dengar dari qualified stream (≥30 dtk)
  'playback.stream.qualified': async (e, tx) => {
    const p = e.payload;
    if (!p.userId) return;
    await tx.query(
      `INSERT INTO listening_history (user_id, track_id, artist_id, played_at, event_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (event_id) DO NOTHING`,
      [p.userId, p.trackId, p.artistId ?? null, p.at, e.id],
    );
  },
  // Onboarding fan memilih ≥3 artis → otomatis di-follow (REQ-IAM-02)
  'iam.user.onboarded': async (e, tx) => {
    for (const a of e.payload.artistIds) await tx.query(`INSERT INTO follows (user_id, artist_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [e.payload.userId, a]);
  },
});

const svc = createService({
  name: 'library',
  schema: 'library',
  port: config.ports.library,
  migrationsDir: new URL('../migrations/', import.meta.url),
  routes,
  consumers,
  stats: async ({ db }) => (await db.one(
    `SELECT (SELECT count(*) FROM playlists)::int AS playlists,
              (SELECT count(*) FROM likes)::int AS likes,
              (SELECT count(*) FROM follows)::int AS follows,
              (SELECT count(*) FROM listening_history WHERE played_at > now() - interval '1 day')::int AS history_24h`,
  )) ?? {},
  seed,
});

await svc.start();
