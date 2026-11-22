// Pelaporan putar offline (P-7 T6, docs/adr/0004-unduhan-offline.md §Putar offline & royalti).
// Perangkat mengirim putar dari unduhan saat online lagi. Validasi (status akun, lisensi, jendela waktu & keanggotaan,
// tumpang tindih & batas harian per pengguna) lalu yang lolos masuk ke logika qualified stream yang SAMA dengan jalur
// online (`recordQualified`, sumber `offline`). Idempoten per (device_id, seq); semua efek satu batch dalam satu
// transaksi + outbox, diserialkan per pengguna dengan kunci try (gagal cepat → 429, tidak menahan koneksi pool).
import type { FastifyInstance } from 'fastify';
import {
  capPlayedMs,
  exceedsDailyCap,
  licenseContent,
  licenseOwnership,
  membershipWindow,
  OFFLINE_PLAYS_MAX_BATCH,
  OFFLINE_REJECTED_PER_DEVICE_DAY,
  overlapsAny,
  playWindow,
  wibDate,
  type OfflinePlayLicense,
  type OfflinePlayReject,
  type PlaySpan,
} from '@rave/domain/offline-plays';
import { callService, HttpError, offlineDeny, requireAuth, settings, uuidv7, z, type Db, type Job } from '@rave/service-kit';
import { insertDeltas, type AggDelta } from './aggregates.js';
import { fraudCheck, recordQualified, USER_STREAM_TRY_LOCK } from './events.js';
import { mapIamUpstream, mapUpstream, rateExceeded, type Entitlement } from './offline.js';

export interface ContentMeta {
  tracks: Record<string, { artist_id: string; duration_ms: number }>;
  episodes: Record<string, { duration_ms: number }>;
}
export interface OfflinePlayDeps {
  /** iam: status akun/keanggotaan + pemilik & waktu cabut perangkat (perangkat yang sudah dicabut tetap boleh melapor putar sebelum dicabut). */
  entitlement(userId: string, deviceId: string): Promise<Entitlement>;
  /** catalog: artis & durasi konten (tanpa filter status — lisensi sah tetap dibayar walau konten kemudian ditarik). */
  contentMeta(tracks: string[], episodes: string[]): Promise<ContentMeta>;
}

export function offlinePlayServiceDeps(name: string): OfflinePlayDeps {
  return {
    // Galat hulu dipetakan sama dengan /v1/offline/* (detail internal tidak bocor; 4xx tak terpetakan → 502 upstream_error).
    entitlement: (userId, deviceId) => callService<Entitlement>(name, 'iam', `/internal/offline/entitlement?user_id=${userId}&device_id=${deviceId}`).catch(mapIamUpstream),
    contentMeta: (tracks, episodes) => callService<ContentMeta>(name, 'catalog', '/internal/playback/meta', { method: 'POST', body: { tracks, episodes } }).catch(mapUpstream),
  };
}

const play = z
  .object({
    seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    license_id: z.string().uuid(),
    track_id: z.string().uuid().optional(),
    episode_id: z.string().uuid().optional(),
    started_at: z.string().datetime({ offset: true }),
    played_ms: z.number().int().min(0).max(24 * 3600_000),
  })
  .refine((p) => !!p.track_id !== !!p.episode_id, 'Isi salah satu: track_id atau episode_id');
const body = z.object({ device_id: z.string().uuid(), plays: z.array(play).min(1).max(OFFLINE_PLAYS_MAX_BATCH) });

export type OfflinePlayResult =
  | { seq: number; status: 'accepted'; qualified: boolean; played_ms: number }
  | { seq: number; status: 'duplicate'; original: 'accepted' | 'rejected'; reason?: string | null }
  | { seq: number; status: 'rejected'; reason: OfflinePlayReject };

/**
 * Kunci transaksi per pengguna (try): dua batch paralel (perangkat yang sama / perangkat lain akun yang sama) tidak
 * pernah berjalan bersamaan — yang kalah langsung 429 + Retry-After, bukan menunggu sambil memegang koneksi pool.
 */
export const OFFLINE_PLAYS_LOCK = USER_STREAM_TRY_LOCK;
/** Retry-After saat batch lain akun yang sama sedang diproses (satu batch ≤ 200 putar selesai dalam hitungan detik). */
export const OFFLINE_PLAYS_BUSY_RETRY_S = 5;

const tooMany = (sec: number) =>
  new HttpError(429, 'Too Many Requests', `Terlalu banyak permintaan. Coba lagi dalam ${sec} detik.`, { type: 'https://rave.id/problems/offline/rate-limited', code: 'rate_limited', retry_after_s: sec });
/** Awal hari kalender WIB (epoch ms) yang memuat `t`. */
const wibDayStart = (t: number) => Date.parse(`${wibDate(t)}T00:00:00+07:00`);

const lower = (s: string) => s.toLowerCase();

export async function offlinePlayRoutes(app: FastifyInstance, { db, name }: { db: Db; name: string }, deps: OfflinePlayDeps = offlinePlayServiceDeps(name)) {
  app.register(async (s) => {
    s.addHook('preHandler', requireAuth);

    /**
     * Batch putar offline (≤ 200). Respons per event: accepted (+ qualified) | duplicate | rejected(reason).
     * Sengaja TIDAK di-gate `download.enabled`: putar dari lisensi yang sah tetap harus dibayar ke artis.
     */
    s.post('/v1/events/offline-plays', async (req, reply) => {
      const userId = req.user!.sub;
      // Ember laju per akun SEBELUM panggilan iam/catalog & transaksi (tahan multi-replika, tabel offline_rate).
      if (await rateExceeded(db, `oplays:${userId}`, settings.num('download.report_per_minute'))) throw tooMany(60);
      const b = body.parse(req.body ?? {});
      const deviceId = lower(b.device_id);
      const plays = b.plays.map((p) => ({
        ...p,
        license_id: lower(p.license_id),
        track_id: p.track_id ? lower(p.track_id) : null,
        episode_id: p.episode_id ? lower(p.episode_id) : null,
        start: new Date(p.started_at).getTime(),
      }));

      // Seq ganda dalam satu batch: kemunculan pertama diproses, sisanya dilaporkan duplicate dari hasil itu.
      const firstIdx = new Map<number, number>();
      plays.forEach((p, i) => firstIdx.has(p.seq) || firstIdx.set(p.seq, i));
      const unique = plays.filter((p, i) => firstIdx.get(p.seq) === i);

      // Panggilan antar-service DI LUAR transaksi (tidak ada HTTP selama kunci dipegang).
      const ent = await deps.entitlement(userId, deviceId);
      // Akun ditangguhkan/dihapus: seluruh batch ditolak 403 (TIDAK final — perangkat menyimpan log & mengirim ulang;
      // bila akun dipulihkan dalam batas umur laporan, putar sah tetap dibayar). Tidak ada yang disimpan.
      if (ent.user?.suspended) throw offlineDeny('account_suspended');
      const device = ent.device;
      if (!device || device.user_id !== userId) throw offlineDeny('device_not_found');
      const member = { premium_active: !!ent.user?.premium_active, member_until: ent.user?.member_until ?? null };
      const meta = await deps.contentMeta(
        [...new Set(plays.filter((p) => p.track_id).map((p) => p.track_id!))],
        [...new Set(plays.filter((p) => p.episode_id).map((p) => p.episode_id!))],
      );

      const now = Date.now();
      const receivedAt = new Date(now);
      const maxAgeMs = settings.num('download.report_max_age_days') * 86400_000;
      const thresholdMs = settings.num('royalty.qualified_stream_seconds') * 1000;
      const city = (req.user as { city?: string | null }).city ?? null;

      const out = await db.tx(async (tx) => {
        const lock = await tx.query(OFFLINE_PLAYS_LOCK, [userId]);
        if (!lock.rows[0]?.ok) throw tooMany(OFFLINE_PLAYS_BUSY_RETRY_S);
        const seqs = unique.map((p) => p.seq);
        const existing = new Map<number, { status: string; reject_reason: string | null }>(
          (await tx.query(`SELECT seq, status, reject_reason FROM offline_plays WHERE device_id = $1 AND seq = ANY($2::bigint[])`, [deviceId, seqs])).rows.map(
            (r: any) => [Number(r.seq), r],
          ),
        );
        const licenses = new Map<string, OfflinePlayLicense>(
          (await tx.query(`SELECT id, user_id, device_id, track_id, episode_id, created_at, expires_at, revoked_at FROM offline_licenses WHERE id = ANY($1::uuid[])`, [
            [...new Set(unique.map((p) => p.license_id))],
          ])).rows.map((r: any) => [r.id, r]),
        );
        // Putar akun (SEMUA perangkat) yang sudah diterima di sekitar rentang batch: tumpang tindih & batas harian WIB per
        // pengguna — satu orang tidak bisa mendengar dua putar sekaligus. played_ms ≤ 24 jam.
        const starts = unique.filter((p) => Number.isFinite(p.start)).map((p) => p.start);
        const accepted: PlaySpan[] = starts.length
          ? (
              await tx.query(
                `SELECT started_at_client, played_ms FROM offline_plays
                  WHERE user_id = $1 AND status = 'ACCEPTED' AND started_at_client >= $2 AND started_at_client < $3`,
                [userId, new Date(Math.min(...starts) - 2 * 86400_000), new Date(Math.max(...starts) + 2 * 86400_000)],
              )
            ).rows.map((r: any) => ({ start: new Date(r.started_at_client).getTime(), played_ms: r.played_ms }))
          : [];
        // Sisa kuota baris REJECTED perangkat hari ini (WIB, menurut waktu diterima).
        let rejectRoom =
          OFFLINE_REJECTED_PER_DEVICE_DAY -
          (await tx.query(`SELECT count(*)::int AS n FROM offline_plays WHERE device_id = $1 AND status = 'REJECTED' AND received_at >= $2`, [deviceId, new Date(wibDayStart(now))])).rows[0].n;

        const results = new Map<number, OfflinePlayResult>();
        const deltas: AggDelta[] = [];
        // Diproses menurut waktu dengar (lalu seq): tumpang tindih, batas harian & fraudCheck berurutan seperti putar aslinya.
        const order = [...unique].sort((a, b) => a.start - b.start || a.seq - b.seq);
        for (const p of order) {
          const prev = existing.get(p.seq);
          if (prev) {
            // Kiriman ulang (seq sudah tercatat): hasil pertama berlaku, tidak ada efek kedua.
            results.set(p.seq, { seq: p.seq, status: 'duplicate', original: prev.status === 'ACCEPTED' ? 'accepted' : 'rejected', reason: prev.reject_reason });
            continue;
          }
          const lic = licenses.get(p.license_id);
          const own = licenseOwnership(lic, userId, deviceId);
          if (own) {
            // Lisensi asing/tidak ada: tidak disimpan (FK & tidak mencatat lisensi akun lain); seq tidak terpakai.
            results.set(p.seq, { seq: p.seq, status: 'rejected', reason: own });
            continue;
          }
          const kindMeta = p.track_id ? meta.tracks[p.track_id] : meta.episodes[p.episode_id!];
          const played = capPlayedMs(p.played_ms, kindMeta?.duration_ms);
          const span = { start: p.start, played_ms: played };
          const reason: OfflinePlayReject | null =
            licenseContent(lic!, p) ??
            (kindMeta ? null : 'content_not_found') ??
            playWindow(span, lic!, device.revoked_at, { now, maxAgeMs }) ??
            membershipWindow(span, member) ??
            (overlapsAny(span, accepted) ? 'overlap' : null) ??
            (exceedsDailyCap(span, accepted) ? 'daily_limit' : null);

          if (reason && rejectRoom <= 0) {
            // Kuota penolakan tersimpan habis: tetap dijawab rejected (final bagi klien), tanpa baris baru.
            results.set(p.seq, { seq: p.seq, status: 'rejected', reason });
            continue;
          }
          const id = uuidv7();
          const qualifies = !reason && !!p.track_id && played >= thresholdMs;
          // fraudCheck SEBELUM putar ini tercatat (seperti jalur online: sesi ditandai qualified setelah pemeriksaan).
          const playedAt = new Date(p.start);
          const fraud = qualifies ? await fraudCheck(tx, userId, playedAt) : null;
          const ins = await tx.query(
            `INSERT INTO offline_plays (id, user_id, device_id, license_id, track_id, episode_id, seq, started_at_client, played_ms, reported_played_ms, received_at, status, reject_reason, qualified_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (device_id, seq) DO NOTHING`,
            [id, userId, deviceId, p.license_id, p.track_id, p.episode_id, p.seq, new Date(p.start), played, p.played_ms, receivedAt, reason ? 'REJECTED' : 'ACCEPTED', reason, qualifies ? receivedAt : null],
          );
          if (!ins.rowCount) {
            // Hanya mungkin tanpa kunci (mis. tabel diisi jalur lain) — tetap aman: UNIQUE(device_id, seq).
            results.set(p.seq, { seq: p.seq, status: 'duplicate', original: 'accepted', reason: null });
            continue;
          }
          if (reason) {
            rejectRoom--;
            results.set(p.seq, { seq: p.seq, status: 'rejected', reason });
            continue;
          }
          accepted.push(span);
          let qualified = false;
          if (qualifies) {
            const t = meta.tracks[p.track_id!]!;
            qualified = await recordQualified(
              tx,
              { id, userId, trackId: p.track_id!, artistId: t.artist_id, city, source: 'offline', origin: 'offline', playedMs: played, at: receivedAt, playedAt },
              fraud,
              deltas,
            );
            await tx.query(`INSERT INTO track_artists (track_id, artist_id) VALUES ($1,$2) ON CONFLICT (track_id) DO NOTHING`, [p.track_id, t.artist_id]);
          }
          results.set(p.seq, { seq: p.seq, status: 'accepted', qualified, played_ms: played });
        }
        await insertDeltas(tx, deltas);
        return results;
      });

      const final: OfflinePlayResult[] = plays.map((p, i) => {
        const r = out.get(p.seq)!;
        if (firstIdx.get(p.seq) === i || r.status === 'duplicate') return r;
        return { seq: p.seq, status: 'duplicate', original: r.status, reason: r.status === 'rejected' ? r.reason : null };
      });
      const count = (st: OfflinePlayResult['status']) => final.filter((r) => r.status === st).length;
      reply.header('cache-control', 'private, no-store');
      return {
        device_id: deviceId,
        received_at: receivedAt.toISOString(),
        accepted: count('accepted'),
        duplicate: count('duplicate'),
        rejected: count('rejected'),
        qualified: final.filter((r) => r.status === 'accepted' && r.qualified).length,
        results: final,
      };
    });
  });
}

/** Batas hapus per putaran job (indeks BRIN received_at + filter status); beberapa putaran per jalan. */
const PURGE_BATCH = 5000;
const PURGE_ROUNDS = 20;
/**
 * Retensi: baris REJECTED (tidak pernah dibayar, tidak punya qualified stream) yang diterima lebih dari
 * `download.report_max_age_days` + 1 hari lalu dihapus berbatch. Seq yang terbebas tidak bisa dipakai untuk memasukkan
 * putar lama lagi: putar itu kini pasti `too_old`. Baris ACCEPTED (dasar royalti/audit) tidak pernah dihapus.
 */
export const offlinePlaysPurgeJob: Job = {
  name: 'offline-plays-purge',
  everyMs: 3600_000,
  async run({ db, log }) {
    const days = Math.max(1, Math.ceil(settings.num('download.report_max_age_days'))) + 1;
    let total = 0;
    for (let i = 0; i < PURGE_ROUNDS; i++) {
      const r = await db.query(
        `DELETE FROM offline_plays WHERE id IN (
           SELECT id FROM offline_plays WHERE status = 'REJECTED' AND received_at < now() - make_interval(days => $1) LIMIT $2 FOR UPDATE SKIP LOCKED)
         RETURNING 1`,
        [days, PURGE_BATCH],
      );
      total += r.length;
      if (r.length < PURGE_BATCH) break;
    }
    if (total) log.info({ purged: total }, 'putar offline ditolak lama dihapus');
  },
};
