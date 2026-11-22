import type { FastifyInstance } from 'fastify';
import { config, publish, settings, z, type Client, type ServiceContext } from '@rave/service-kit';
import { FRAUD_LOOP_MAX_PLAYED_MS, FRAUD_LOOP_WINDOW, FRAUD_RATE_WINDOW_MS, loopPatternExceeded, rateWindowExceeded } from '@rave/domain/offline-plays';
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

/**
 * Kunci transaksi per pengguna untuk pencatatan qualified stream (hitungan RATE_LIMIT/LOOP_31S + sisip). Laporan putar
 * offline memakai versi `try` (gagal cepat → 429, tidak menahan koneksi pool); jalur online menunggu (blocking) tetapi
 * mengambilnya SETELAH sesi dikunci dan SEBELUM menulis qualified_streams/daily_listeners — transaksi offline tidak
 * pernah mengunci baris sesi, jadi urutan ini bebas deadlock. Kunci yang sama → hitungan fraud online & offline
 * pengguna yang sama tidak bisa sama-sama lolos di ambang.
 */
export const USER_STREAM_LOCK = `SELECT pg_advisory_xact_lock(hashtext('playback.offline-plays'), hashtext($1))`;
export const USER_STREAM_TRY_LOCK = `SELECT pg_try_advisory_xact_lock(hashtext('playback.offline-plays'), hashtext($1)) AS ok`;

/** Aturan fraud sederhana (REQ-ADM-03). Produksi: model + fitur device/IP/ASN di pipeline streaming. */
export const FRAUD = { loopWindow: FRAUD_LOOP_WINDOW, loopMaxPlayedMs: FRAUD_LOOP_MAX_PLAYED_MS };


/**
 * Deteksi pola mencurigakan sebelum stream dihitung.
 * - RATE_LIMIT menurut WAKTU DENGAR (`coalesce(played_at, at)`):
 *   - online (tanpa `ref`): stream qualified pengguna dalam 1 jam sebelum sekarang ≥ batas (tidak berubah);
 *   - offline (`ref` = started_at perangkat): DUA ARAH — ditandai bila ada jendela 1 jam yang memuat `ref` sudah berisi
 *     ≥ batas (`rateWindowExceeded`). Putar offline datang tidak berurutan (batch per putar, waktu menurun); hitungan satu
 *     arah hanya melihat masa lalu sehingga putar yang lebih awal selalu lolos. Untuk urutan menaik hasilnya identik
 *     dengan hitungan satu arah, dan sinkronisasi ratusan putar lintas hari tetap tidak dianggap "N stream dalam 1 jam".
 * - LOOP_31S: N stream qualified berturut-turut berhenti tepat setelah ambang. Online (tanpa `ref`): N sesi online terakhir
 *   (perilaku lama). Offline: sesi online + putar offline qualified, DUA ARAH (`loopPatternExceeded`, `refPlayedMs` =
 *   played_ms putar ini) — urutan kirim menurun terdeteksi sama dengan urutan menaik.
 */
export async function fraudCheck(tx: Client, userId: string, ref?: Date, refPlayedMs?: number): Promise<string | null> {
  const max = settings.num('streaming.fraud_max_streams_per_hour');
  const cap = Number.isFinite(max) ? Math.max(0, Math.ceil(max)) : null;
  if (!ref) {
    // Hitungan dibatasi ambang (LIMIT) → cukup scan indeks qualified_user_played_idx sampai ambang, bukan seluruh jam.
    const rate = await tx.query(
      `SELECT count(*)::int AS n FROM (SELECT 1 FROM qualified_streams WHERE user_id = $1
          AND coalesce(played_at, at) > now() - interval '1 hour' LIMIT $2) x`,
      [userId, cap],
    );
    if (rate.rows[0].n >= max) return 'RATE_LIMIT';
  } else {
    // Titik di (ref − 1 jam, ref + 1 jam), dibatasi 2 × batas: bila sebanyak itu, salah satu sisi berisi ≥ batas dan
    // jendela yang berakhir di ref / di titik terakhir sisi kanan pasti melampaui (pigeonhole) → tidak perlu sisa baris.
    const lim = cap == null ? null : 2 * cap;
    const pts = await tx.query(
      `SELECT coalesce(played_at, at) AS t FROM qualified_streams WHERE user_id = $1
          AND coalesce(played_at, at) > $3::timestamptz - interval '1 hour' AND coalesce(played_at, at) < $3::timestamptz + interval '1 hour'
        ORDER BY coalesce(played_at, at) LIMIT $2`,
      [userId, lim, ref],
    );
    if ((lim != null && pts.rows.length >= lim) || rateWindowExceeded(pts.rows.map((r: any) => new Date(r.t).getTime()), ref.getTime(), max, FRAUD_RATE_WINDOW_MS))
      return 'RATE_LIMIT';
  }
  // Pola loop "31 detik": sesi-sesi berhenti tepat setelah ambang qualified (indeks parsial sessions_user_qualified_idx).
  if (!ref) {
    // Online: tidak berubah — N sesi qualified terakhir pengguna.
    const recent = await tx.query(`SELECT max_played_ms FROM sessions WHERE user_id = $1 AND qualified_at IS NOT NULL ORDER BY created_at DESC LIMIT $2`, [
      userId,
      FRAUD.loopWindow,
    ]);
    if (recent.rows.length === FRAUD.loopWindow && recent.rows.every((r: any) => r.max_played_ms < FRAUD.loopMaxPlayedMs)) return 'LOOP_31S';
    return null;
  }
  // Offline: DUA ARAH — N stream terdekat di tiap sisi ref (sesi online + putar offline qualified; qualified ⇒ ACCEPTED,
  // filter status memakai indeks parsial offline_plays_user_started_idx), lalu `loopPatternExceeded`.
  const near = await tx.query(
    `SELECT t, played FROM (
       (SELECT created_at AS t, max_played_ms AS played FROM sessions
         WHERE user_id = $1 AND qualified_at IS NOT NULL AND created_at <= $3 ORDER BY created_at DESC LIMIT $2)
       UNION ALL
       (SELECT started_at_client, played_ms FROM offline_plays
         WHERE user_id = $1 AND status = 'ACCEPTED' AND qualified_at IS NOT NULL AND started_at_client <= $3 ORDER BY started_at_client DESC LIMIT $2)
       UNION ALL
       (SELECT created_at, max_played_ms FROM sessions
         WHERE user_id = $1 AND qualified_at IS NOT NULL AND created_at > $3 ORDER BY created_at ASC LIMIT $2)
       UNION ALL
       (SELECT started_at_client, played_ms FROM offline_plays
         WHERE user_id = $1 AND status = 'ACCEPTED' AND qualified_at IS NOT NULL AND started_at_client > $3 ORDER BY started_at_client ASC LIMIT $2)
     ) x`,
    [userId, FRAUD.loopWindow, ref],
  );
  const pts = near.rows.map((r: any) => ({ t: new Date(r.t).getTime(), played_ms: Number(r.played) }));
  if (loopPatternExceeded(pts, { t: ref.getTime(), played_ms: refPlayedMs ?? Infinity }, FRAUD.loopWindow, FRAUD.loopMaxPlayedMs)) return 'LOOP_31S';
  return null;
}

/** Satu qualified stream (online: id sesi; offline: id offline_plays — ruang uuidv7 yang sama, tidak bertabrakan). */
export interface QualifiedStream {
  id: string;
  userId: string;
  trackId: string;
  artistId: string;
  city: string | null;
  /** agg_source_daily (online: sumber sesi; offline: 'offline'). */
  source: string;
  origin: 'online' | 'offline';
  playedMs: number;
  /** Diakui server = dasar periode royalti. */
  at: Date;
  /** Waktu dengar (offline: started_at perangkat) = tanggal agregat & daily_listeners (WIB). */
  playedAt: Date;
}

/**
 * Catat qualified stream + agregat + event (dipakai jalur online & offline — satu logika). Dipanggil di tx request
 * (dasar royalti); `reason` dari fraudCheck → baris suspicious, dikecualikan dari royalti & agregat.
 */
export async function recordQualified(tx: Client, q: QualifiedStream, reason: string | null, deltas: AggDelta[]): Promise<boolean> {
  const ins = await tx.query(
    `INSERT INTO qualified_streams (session_id, user_id, track_id, artist_id, city, played_ms, at, suspicious, fraud_reason, origin, played_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (session_id) DO NOTHING`,
    [q.id, q.userId, q.trackId, q.artistId, q.city, q.playedMs, q.at, !!reason, reason, q.origin, q.playedAt],
  );
  // Sudah tercatat (kiriman ulang) → tidak ada agregat/event kedua.
  if (reason || !ins.rowCount) return false;

  const date = todayWib(q.playedAt.getTime());
  // daily_listeners = sumber dedup pendengar unik (kunci per user, bukan baris panas) → tetap sinkron.
  const newListener = await tx.query(`INSERT INTO daily_listeners (artist_id, date, user_id, city) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [
    q.artistId,
    date,
    q.userId,
    q.city,
  ]);
  deltas.push({
    artist_id: q.artistId,
    date,
    track_id: q.trackId,
    city: q.city || UNKNOWN,
    // Usia tidak dikumpulkan di token → "Tidak diketahui" sampai profil demografis (consent) tersedia.
    age_group: UNKNOWN,
    source: q.source,
    streams: 1,
    listeners: newListener.rowCount ? 1 : 0,
  });
  await publish(tx, 'playback.stream.qualified', q.trackId, {
    userId: q.userId,
    trackId: q.trackId,
    artistId: q.artistId,
    city: q.city,
    playedMs: q.playedMs,
    at: q.playedAt.toISOString(),
    ...(q.origin === 'offline' ? { source: 'offline' as const, receivedAt: q.at.toISOString() } : {}),
  });
  return true;
}

/** Qualified stream (≥30 dtk) jalur online: tetap di tx request (per sesi, dasar royalti); agregatnya hanya berupa delta. */
async function qualify(tx: Client, s: any, playedMs: number, deltas: AggDelta[]): Promise<boolean> {
  const reason = await fraudCheck(tx, s.user_id);
  const now = new Date();
  await tx.query(`UPDATE sessions SET qualified_at = $2 WHERE id = $1`, [s.id, now]);
  return recordQualified(
    tx,
    { id: s.id, userId: s.user_id, trackId: s.track_id, artistId: s.artist_id, city: s.city, source: s.source, origin: 'online', playedMs, at: now, playedAt: now },
    reason,
    deltas,
  );
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
      // Kunci per pengguna yang sama dengan laporan putar offline (lihat USER_STREAM_LOCK) — hanya bila ada yang qualified.
      if (toQualify.length && uid) await tx.query(USER_STREAM_LOCK, [uid]);
      for (const q of toQualify) if (await qualify(tx, q.s, q.played, deltas)) qualified++;
      await insertDeltas(tx, deltas);
    });
    return { accepted, qualified };
  });
}
