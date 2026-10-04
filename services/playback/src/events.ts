import type { FastifyInstance } from 'fastify';
import { QUALIFIED_STREAM_MS } from '@gema/domain';
import { publish, z, type Client, type ServiceContext } from '@gema/service-kit';
import { todayWib, UNKNOWN } from './util.js';

const evt = z
  .object({
    session_id: z.string().uuid(),
    track_id: z.string().uuid().optional(),
    episode_id: z.string().uuid().optional(),
    type: z.enum(['start', 'progress', 'complete', 'skip']),
    position_ms: z.number().int().min(0).max(24 * 3600_000).default(0),
    played_ms: z.number().int().min(0).max(24 * 3600_000).default(0),
    at: z.string().datetime({ offset: true }).optional(),
  })
  .passthrough();

/** Aturan fraud sederhana (REQ-ADM-03). Produksi: model + fitur device/IP/ASN di pipeline streaming. */
export const FRAUD = { maxQualifiedPerHour: 120, loopWindow: 5, loopMaxPlayedMs: 35_000 };

async function bump(tx: Client, artistId: string, date: string, col: 'starts' | 'skips' | 'completes' | 'saves' | 'followers_gained') {
  await tx.query(
    `INSERT INTO agg_artist_daily (artist_id, date, ${col}) VALUES ($1,$2,1)
     ON CONFLICT (artist_id, date) DO UPDATE SET ${col} = agg_artist_daily.${col} + 1`,
    [artistId, date],
  );
}
export { bump as bumpArtistDaily };

/** Deteksi pola mencurigakan sebelum stream dihitung. */
async function fraudCheck(tx: Client, userId: string): Promise<string | null> {
  const rate = await tx.query(`SELECT count(*)::int AS n FROM qualified_streams WHERE user_id = $1 AND at > now() - interval '1 hour'`, [userId]);
  if (rate.rows[0].n >= FRAUD.maxQualifiedPerHour) return 'RATE_LIMIT';
  // Pola loop "31 detik": sesi-sesi terakhir berhenti tepat setelah ambang qualified.
  const recent = await tx.query(
    `SELECT max_played_ms FROM sessions WHERE user_id = $1 AND qualified_at IS NOT NULL ORDER BY created_at DESC LIMIT $2`,
    [userId, FRAUD.loopWindow],
  );
  if (recent.rows.length === FRAUD.loopWindow && recent.rows.every((r) => r.max_played_ms < FRAUD.loopMaxPlayedMs)) return 'LOOP_31S';
  return null;
}

async function qualify(tx: Client, s: any, playedMs: number): Promise<boolean> {
  const reason = await fraudCheck(tx, s.user_id);
  const now = new Date();
  await tx.query(`UPDATE sessions SET qualified_at = $2 WHERE id = $1`, [s.id, now]);
  await tx.query(
    `INSERT INTO qualified_streams (session_id, user_id, track_id, artist_id, city, played_ms, at, suspicious, fraud_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (session_id) DO NOTHING`,
    [s.id, s.user_id, s.track_id, s.artist_id, s.city, playedMs, now, !!reason, reason],
  );
  if (reason) return false;

  const date = todayWib();
  const city = s.city || UNKNOWN;
  await tx.query(
    `INSERT INTO agg_artist_daily (artist_id, date, streams) VALUES ($1,$2,1) ON CONFLICT (artist_id, date) DO UPDATE SET streams = agg_artist_daily.streams + 1`,
    [s.artist_id, date],
  );
  await tx.query(
    `INSERT INTO agg_track_daily (artist_id, track_id, date, streams) VALUES ($1,$2,$3,1) ON CONFLICT (track_id, date) DO UPDATE SET streams = agg_track_daily.streams + 1`,
    [s.artist_id, s.track_id, date],
  );
  const newListener = await tx.query(`INSERT INTO daily_listeners (artist_id, date, user_id, city) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [
    s.artist_id,
    date,
    s.user_id,
    s.city,
  ]);
  const l = newListener.rowCount ? 1 : 0;
  if (l) await tx.query(`UPDATE agg_artist_daily SET listeners = listeners + 1 WHERE artist_id = $1 AND date = $2`, [s.artist_id, date]);
  await tx.query(
    `INSERT INTO agg_city_daily (artist_id, date, city, listeners, streams) VALUES ($1,$2,$3,$4,1)
     ON CONFLICT (artist_id, date, city) DO UPDATE SET streams = agg_city_daily.streams + 1, listeners = agg_city_daily.listeners + $4`,
    [s.artist_id, date, city, l],
  );
  // Usia tidak dikumpulkan di token → "Tidak diketahui" sampai profil demografis (consent) tersedia.
  await tx.query(
    `INSERT INTO agg_age_daily (artist_id, date, age_group, streams) VALUES ($1,$2,$3,1) ON CONFLICT (artist_id, date, age_group) DO UPDATE SET streams = agg_age_daily.streams + 1`,
    [s.artist_id, date, UNKNOWN],
  );
  await tx.query(
    `INSERT INTO agg_source_daily (artist_id, date, source, streams) VALUES ($1,$2,$3,1) ON CONFLICT (artist_id, date, source) DO UPDATE SET streams = agg_source_daily.streams + 1`,
    [s.artist_id, date, s.source],
  );
  await publish(tx, 'playback.stream.qualified', s.track_id, {
    userId: s.user_id,
    trackId: s.track_id,
    artistId: s.artist_id,
    city: s.city,
    playedMs,
    at: now.toISOString(),
  });
  return true;
}

export async function eventRoutes(app: FastifyInstance, { db }: ServiceContext) {
  /** Batch play events dari klien (start, progress tiap 15 dtk, complete, skip). Event offline dikirim saat online. */
  app.post('/v1/events/play', async (req) => {
    const { events } = z.object({ events: z.array(evt).min(1).max(200) }).parse(req.body);
    const uid = req.user && !req.user.roles.includes('service') ? req.user.sub : null;
    let accepted = 0;
    let qualified = 0;
    await db.tx(async (tx) => {
      const cache = new Map<string, any>();
      for (const e of events) {
        let s = cache.get(e.session_id);
        if (s === undefined) {
          s = (await tx.query(`SELECT * FROM sessions WHERE id = $1 FOR UPDATE`, [e.session_id])).rows[0] ?? null;
          cache.set(e.session_id, s);
        }
        if (!s) continue;
        // Event harus berasal dari pemilik sesi (mencegah pemalsuan play untuk user lain).
        if ((s.user_id ?? null) !== uid) continue;
        if (e.track_id && e.track_id !== s.track_id) continue;
        if (e.episode_id && e.episode_id !== s.episode_id) continue;

        await tx.query(
          `INSERT INTO play_events (session_id, user_id, track_id, episode_id, type, position_ms, played_ms, client_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [s.id, s.user_id, s.track_id, s.episode_id, e.type, e.position_ms, e.played_ms, e.at ?? null],
        );
        accepted++;
        // played_ms dibatasi durasi lagu + toleransi agar tidak bisa digelembungkan.
        const played = Math.min(e.played_ms, (s.duration_ms || e.played_ms) + 5000);
        if (played > s.max_played_ms) {
          s.max_played_ms = played;
          await tx.query(`UPDATE sessions SET max_played_ms = $2 WHERE id = $1`, [s.id, played]);
        }
        if (s.track_id && s.artist_id) {
          const date = todayWib();
          if (e.type === 'start') await bump(tx, s.artist_id, date, 'starts');
          if (e.type === 'skip') await bump(tx, s.artist_id, date, 'skips');
          if (e.type === 'complete') await bump(tx, s.artist_id, date, 'completes');
          if (s.user_id && !s.preview_only && !s.qualified_at && played >= QUALIFIED_STREAM_MS) {
            s.qualified_at = new Date();
            if (await qualify(tx, s, played)) qualified++;
          }
        }
      }
    });
    return { accepted, qualified };
  });
}
