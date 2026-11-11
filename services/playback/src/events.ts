import type { FastifyInstance } from 'fastify';
import { config, publish, settings, z, type Client, type ServiceContext } from '@rave/service-kit';
import { insertDeltas, type AggDelta, type ArtistCounter } from './aggregates.js';
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

/**
 * played_ms klien tidak boleh melebihi waktu nyata sejak sesi dibuat (+ toleransi buffering/jam) — tanpa ini
 * satu event `progress` instan dengan played_ms besar langsung menjadi qualified stream (dasar royalti).
 * Jam dipercepat dev (RAVE_FAST_CLOCK, default aktif di non-produksi; ditolak di produksi) melewati batas ini untuk e2e.
 */
const FAST_CLOCK = (process.env.RAVE_FAST_CLOCK ?? (config.isDev ? '1' : '0')) === '1';
const CLOCK_TOLERANCE_MS = 10_000;

/** Aturan fraud sederhana (REQ-ADM-03). Produksi: model + fitur device/IP/ASN di pipeline streaming. */
export const FRAUD = { loopWindow: 5, loopMaxPlayedMs: 35_000 };

// Re-ekspor kompat (counter harian kini lewat delta, lihat aggregates.ts).
export { bumpArtistDaily } from './aggregates.js';

/** Deteksi pola mencurigakan sebelum stream dihitung. */
async function fraudCheck(tx: Client, userId: string): Promise<string | null> {
  // Hitungan dibatasi ambang (LIMIT) → cukup scan indeks qualified_user_at_idx sampai ambang, bukan seluruh jam.
  const max = settings.num('streaming.fraud_max_streams_per_hour');
  const rate = await tx.query(
    `SELECT count(*)::int AS n FROM (SELECT 1 FROM qualified_streams WHERE user_id = $1 AND at > now() - interval '1 hour' LIMIT $2) x`,
    [userId, Number.isFinite(max) ? Math.max(0, Math.ceil(max)) : null],
  );
  if (rate.rows[0].n >= max) return 'RATE_LIMIT';
  // Pola loop "31 detik": sesi-sesi terakhir berhenti tepat setelah ambang qualified (indeks parsial sessions_user_qualified_idx).
  const recent = await tx.query(
    `SELECT max_played_ms FROM sessions WHERE user_id = $1 AND qualified_at IS NOT NULL ORDER BY created_at DESC LIMIT $2`,
    [userId, FRAUD.loopWindow],
  );
  if (recent.rows.length === FRAUD.loopWindow && recent.rows.every((r) => r.max_played_ms < FRAUD.loopMaxPlayedMs)) return 'LOOP_31S';
  return null;
}

/** Qualified stream (≥30 dtk): tetap di tx request (per sesi, dasar royalti); agregatnya hanya berupa delta. */
async function qualify(tx: Client, s: any, playedMs: number, deltas: AggDelta[]): Promise<boolean> {
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
  // daily_listeners = sumber dedup pendengar unik (kunci per user, bukan baris panas) → tetap sinkron.
  const newListener = await tx.query(`INSERT INTO daily_listeners (artist_id, date, user_id, city) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [
    s.artist_id,
    date,
    s.user_id,
    s.city,
  ]);
  deltas.push({
    artist_id: s.artist_id,
    date,
    track_id: s.track_id,
    city: s.city || UNKNOWN,
    // Usia tidak dikumpulkan di token → "Tidak diketahui" sampai profil demografis (consent) tersedia.
    age_group: UNKNOWN,
    source: s.source,
    streams: 1,
    listeners: newListener.rowCount ? 1 : 0,
  });
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

const COUNTER: Partial<Record<string, ArtistCounter>> = { start: 'starts', skip: 'skips', complete: 'completes' };

export async function eventRoutes(app: FastifyInstance, { db }: ServiceContext) {
  /**
   * Batch play events dari klien (start, progress tiap 15 dtk, complete, skip). Event offline dikirim saat online.
   * Sesi dikunci sekali, terurut id (bebas deadlock antar batch); play_events & delta agregat ditulis bulk.
   */
  app.post('/v1/events/play', async (req) => {
    const { events } = z.object({ events: z.array(evt).min(1).max(200) }).parse(req.body);
    const uid = req.user && !req.user.roles.includes('service') ? req.user.sub : null;
    let accepted = 0;
    let qualified = 0;
    await db.tx(async (tx) => {
      const ids = [...new Set(events.map((e) => e.session_id.toLowerCase()))];
      const rows = (await tx.query(`SELECT * FROM sessions WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [ids])).rows;
      const sessions = new Map<string, any>(rows.map((r) => [r.id, r]));
      const pe: { s: any; e: z.infer<typeof evt> }[] = [];
      const maxChanged = new Set<any>();
      const toQualify: { s: any; played: number }[] = [];
      const deltas: AggDelta[] = [];
      // Urutan event klien tetap dihormati (max_played_ms & momen qualified dihitung berurutan di memori).
      for (const e of events) {
        const s = sessions.get(e.session_id.toLowerCase());
        if (!s) continue;
        // Event harus berasal dari pemilik sesi (mencegah pemalsuan play untuk user lain).
        if ((s.user_id ?? null) !== uid) continue;
        if (e.track_id && e.track_id !== s.track_id) continue;
        if (e.episode_id && e.episode_id !== s.episode_id) continue;

        pe.push({ s, e });
        accepted++;
        // played_ms dibatasi durasi lagu + toleransi agar tidak bisa digelembungkan.
        const elapsedCap = FAST_CLOCK ? Infinity : Date.now() - new Date(s.created_at).getTime() + CLOCK_TOLERANCE_MS;
        const played = Math.max(0, Math.min(e.played_ms, (s.duration_ms || e.played_ms) + 5000, elapsedCap));
        if (played > s.max_played_ms) {
          s.max_played_ms = played;
          maxChanged.add(s);
        }
        if (s.track_id && s.artist_id) {
          const c = COUNTER[e.type];
          if (c) deltas.push({ artist_id: s.artist_id, date: todayWib(), [c]: 1 });
          // Ambang royalti dari Super Admin (default 30 dtk = QUALIFIED_STREAM_MS di domain).
          if (s.user_id && !s.preview_only && !s.qualified_at && played >= settings.num('royalty.qualified_stream_seconds') * 1000) {
            s.qualified_at = new Date();
            toQualify.push({ s, played });
          }
        }
      }
      if (pe.length) {
        await tx.query(
          `INSERT INTO play_events (session_id, user_id, track_id, episode_id, type, position_ms, played_ms, client_at)
           SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::int[], $7::int[], $8::timestamptz[])`,
          [
            pe.map((x) => x.s.id),
            pe.map((x) => x.s.user_id),
            pe.map((x) => x.s.track_id),
            pe.map((x) => x.s.episode_id),
            pe.map((x) => x.e.type),
            pe.map((x) => x.e.position_ms),
            pe.map((x) => x.e.played_ms),
            pe.map((x) => x.e.at ?? null),
          ],
        );
      }
      if (maxChanged.size) {
        const ss = [...maxChanged];
        await tx.query(`UPDATE sessions s SET max_played_ms = v.m FROM unnest($1::uuid[], $2::int[]) AS v(id, m) WHERE s.id = v.id`, [
          ss.map((x) => x.id),
          ss.map((x) => x.max_played_ms),
        ]);
      }
      // Setelah max_played_ms tersimpan → fraudCheck (pola loop) melihat state sesi yang sama seperti sebelumnya.
      for (const q of toQualify) if (await qualify(tx, q.s, q.played, deltas)) qualified++;
      await insertDeltas(tx, deltas);
    });
    return { accepted, qualified };
  });
}
