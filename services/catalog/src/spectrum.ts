// Amplop spektrum per lagu (LCD pemutar, kontrak bersama web/desktop/mobile):
// GET /v1/catalog/tracks/:id/spectrum → 200 amplop | 202 {status:'pending'} (antre) | 404 {error:'not_found'}.
// Status/antrean di tabel track_spectra; byte di <UPLOAD_DIR>/spectrum/<track_id>.v<version>.bin.
// Pembuatan: worker `track-spectrum` (1 lagu sekaligus per instance, batas waktu) — terpisah dari transcoding,
// sehingga kegagalannya tidak pernah memengaruhi pemutaran atau hasil transcoding.
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { SpectrumAnalyzer, SPECTRUM_SAMPLE_RATE, SPECTRUM_VERSION, spectrumToBase64 } from '@rave/domain/spectrum';
import { requireSuperAdmin, wakeJob, z, type Job, type ServiceContext } from '@rave/service-kit';
import { decodePcm, ffmpegPath } from './audio.js';
import { isUuid } from './queries.js';
import { UPLOAD_DIR } from './storage.js';

export const SPECTRUM_JOB = 'track-spectrum';
const SPECTRUM_DIR = join(UPLOAD_DIR, 'spectrum');
mkdirSync(SPECTRUM_DIR, { recursive: true });
const fileOf = (trackId: string, version = SPECTRUM_VERSION) => join(SPECTRUM_DIR, `${trackId}.v${version}.bin`);

const MAX_ATTEMPTS = 3;
const STALE_MIN = 10;
/** Lagu lebih panjang dari ini hanya dianalisis s.d. batas (amplop tetap valid; sisa → klien memakai frame terakhir). */
const MAX_SECONDS = 60 * 60;
/** URL audio eksternal (data demo/seed) ikut dianalisis kecuali SPECTRUM_EXTERNAL=0. */
const allowExternal = () => process.env.SPECTRUM_EXTERNAL !== '0';

type Q = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/** Antrekan lagu (idempoten; versi lama / gagal di-reset bila `retry`). Tidak pernah melempar. */
export async function enqueueSpectrum(db: Q, trackIds: string[], opts: { retry?: boolean } = {}): Promise<void> {
  if (!trackIds.length || !ffmpegPath()) return;
  try {
    await db.query(
      `INSERT INTO track_spectra (track_id, version) SELECT unnest($1::uuid[]), $2
       ON CONFLICT (track_id) DO UPDATE SET status = 'pending', version = EXCLUDED.version, attempts = 0, error = NULL, requested_at = now()
        WHERE track_spectra.version < EXCLUDED.version OR ($3 AND track_spectra.status IN ('failed','unavailable'))`,
      [trackIds, SPECTRUM_VERSION, !!opts.retry],
    );
    await wakeJob(db, SPECTRUM_JOB);
  } catch {
    /* tidak kritis */
  }
}

/** Di dalam transaksi penayangan rilis: satu INSERT sederhana (tidak bisa gagal karena FK) + NOTIFY saat commit. */
export async function queueReleaseSpectra(tx: Q, releaseId: string) {
  if (!ffmpegPath()) return;
  await tx.query(
    `INSERT INTO track_spectra (track_id, version) SELECT id, $2 FROM tracks WHERE release_id = $1 AND audio_url IS NOT NULL ON CONFLICT (track_id) DO NOTHING`,
    [releaseId, SPECTRUM_VERSION],
  );
  await wakeJob(tx, SPECTRUM_JOB);
}

/** Setelah transcoding upload selesai: antrekan lagu yang memakai master itu (sumber terbaik kini tersedia). */
export async function enqueueSpectrumForUpload(db: Q & { query<T = any>(sql: string, params?: unknown[]): Promise<T[]> }, storedName: string) {
  try {
    const rows = await db.query<{ id: string }>(`SELECT id FROM tracks WHERE audio_url = $1`, [`/v1/catalog/media/${storedName}`]);
    // Master baru/ulang → buat ulang amplop yang sudah ada juga (sumber bisa berubah).
    if (rows.length) await db.query(`DELETE FROM track_spectra WHERE track_id = ANY($1::uuid[]) AND status <> 'processing'`, [rows.map((r) => r.id)]);
    await enqueueSpectrum(db, rows.map((r) => r.id));
  } catch {
    /* tidak kritis */
  }
}

/** Sumber dekode: rendisi AAC 320 → AAC 160 → master → AAC 64 (lokal), atau URL eksternal http(s). */
async function resolveSource(db: ServiceContext['db'], trackId: string): Promise<{ src: string; label: string; durationMs: number } | null> {
  const t = await db.one<{ audio_url: string | null; duration_ms: number; stored_name: string | null; renditions: Record<string, { url?: string }> | null }>(
    `SELECT t.audio_url, t.duration_ms, u.stored_name, u.renditions
       FROM tracks t LEFT JOIN uploads u ON t.audio_url LIKE '/v1/catalog/media/%' AND u.stored_name = split_part(t.audio_url, '/v1/catalog/media/', 2)
      WHERE t.id = $1`,
    [trackId],
  );
  if (!t?.audio_url) return null;
  const local = (url?: string) => {
    const name = url?.split('/v1/catalog/media/')[1]?.split(/[?#]/)[0];
    if (!name || !/^[\w.-]+$/.test(name)) return null;
    const p = join(UPLOAD_DIR, name);
    return existsSync(p) ? p : null;
  };
  if (t.audio_url.startsWith('/v1/catalog/media/')) {
    const r = t.renditions ?? {};
    for (const [label, url] of [['high', r.high?.url], ['normal', r.normal?.url], ['master', t.audio_url], ['low', r.low?.url]] as const) {
      const p = local(url);
      if (p) return { src: p, label, durationMs: t.duration_ms };
    }
    return null;
  }
  if (/^https?:\/\//i.test(t.audio_url) && allowExternal()) return { src: t.audio_url, label: 'external', durationMs: t.duration_ms };
  return null;
}

/** Analisis satu lagu → tulis berkas (atomik) → kembalikan metadata. */
export async function generateSpectrum(db: ServiceContext['db'], trackId: string) {
  const s = await resolveSource(db, trackId);
  if (!s) return null;
  const a = new SpectrumAnalyzer({ sampleRate: SPECTRUM_SAMPLE_RATE });
  // Batas waktu: 2× durasi lagu (min 60 dtk, maks 10 menit) — dekode ke 32 kHz mono jauh lebih cepat dari real time.
  const timeoutMs = Math.min(600_000, Math.max(60_000, (s.durationMs || 0) * 2));
  await decodePcm(s.src, SPECTRUM_SAMPLE_RATE, (pcm) => a.push(pcm), { timeoutMs, maxSeconds: MAX_SECONDS });
  const env = a.finish();
  if (!env.frames) throw new Error('audio kosong');
  const out = fileOf(trackId);
  const part = `${out}.part`;
  await writeFile(part, env.data);
  await rename(part, out).catch(async (e) => {
    await rm(part, { force: true });
    throw e;
  });
  return { ...env, source: s.label };
}

/** Worker: klaim 1 lagu (pending, atau processing macet), buat amplop. Gagal → coba ulang s.d. 3 kali. */
export const spectrumJob: Job = {
  name: SPECTRUM_JOB,
  everyMs: 30_000,
  wake: true,
  async run({ db, log }) {
    if (!ffmpegPath()) return;
    for (let n = 0; n < 50; n++) {
      const j = await db.one<{ track_id: string; attempts: number }>(
        `UPDATE track_spectra SET status = 'processing', started_at = now(), attempts = attempts + 1
          WHERE track_id = (
            SELECT track_id FROM track_spectra
             WHERE (status = 'pending' OR (status = 'processing' AND started_at < now() - interval '${STALE_MIN} minutes'))
               AND attempts < ${MAX_ATTEMPTS}
             ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING track_id, attempts`,
      );
      if (!j) return;
      const t0 = Date.now();
      try {
        const env = await generateSpectrum(db, j.track_id);
        if (!env) {
          await db.query(`UPDATE track_spectra SET status = 'unavailable', error = 'tidak ada sumber audio', done_at = now() WHERE track_id = $1`, [j.track_id]);
          continue;
        }
        await db.query(
          `UPDATE track_spectra SET status = 'done', version = $2, fps = $3, bands = $4, frames = $5, duration_ms = $6, source = $7, error = NULL, done_at = now()
            WHERE track_id = $1`,
          [j.track_id, SPECTRUM_VERSION, env.fps, env.bands, env.frames, env.duration_ms, env.source],
        );
        log.info({ trackId: j.track_id, frames: env.frames, source: env.source, ms: Date.now() - t0 }, 'spektrum lagu dibuat');
      } catch (e) {
        const msg = (e as Error).message.slice(0, 500);
        const final = j.attempts >= MAX_ATTEMPTS;
        await db.query(`UPDATE track_spectra SET status = $2, error = $3 WHERE track_id = $1`, [j.track_id, final ? 'failed' : 'pending', msg]).catch(() => {});
        log.warn({ trackId: j.track_id, attempt: j.attempts, err: msg }, final ? 'spektrum gagal permanen' : 'spektrum gagal, dicoba ulang');
        if (!final) return; // beri jeda (interval berikutnya) sebelum mencoba lagi
      }
    }
    await wakeJob(db, SPECTRUM_JOB); // batch penuh → lanjutkan segera
  },
};

const NOT_FOUND = { error: 'not_found' };
const PENDING = { status: 'pending' };

export async function spectrumRoutes(app: FastifyInstance, { db, log }: ServiceContext) {
  app.get('/v1/catalog/tracks/:id/spectrum', async (req, reply) => {
    const { id } = req.params as { id: string };
    const miss = () => reply.code(404).header('cache-control', 'no-cache').send(NOT_FOUND);
    if (!isUuid(id)) return miss();
    // Visibilitas sama dengan GET /v1/catalog/tracks/:id (rilis LIVE).
    const row = await db.one<{ status: string | null; version: number | null; fps: number; bands: number; frames: number; duration_ms: number }>(
      `SELECT s.status, s.version, s.fps, s.bands, s.frames, s.duration_ms
         FROM tracks t JOIN releases r ON r.id = t.release_id LEFT JOIN track_spectra s ON s.track_id = t.id
        WHERE t.id = $1 AND r.status = 'LIVE'`,
      [id],
    );
    if (!row) return miss();
    const etag = `"${id}-v${SPECTRUM_VERSION}"`;
    if (row.status === 'done' && row.version === SPECTRUM_VERSION) {
      const buf = await readFile(fileOf(id)).catch(() => null);
      if (buf && buf.length === row.frames * row.bands) {
        reply.header('cache-control', 'public, max-age=86400').header('etag', etag);
        if (String(req.headers['if-none-match'] ?? '').split(/\s*,\s*/).includes(etag)) return reply.code(304).send();
        return {
          track_id: id,
          version: SPECTRUM_VERSION,
          fps: row.fps,
          bands: row.bands,
          frames: row.frames,
          duration_ms: row.duration_ms,
          data: spectrumToBase64(buf),
        };
      }
      // Berkas hilang/rusak (mis. storage dipulihkan) → buat ulang.
      log.warn({ trackId: id }, 'berkas spektrum hilang, dibuat ulang');
      await db.query(`UPDATE track_spectra SET status = 'pending', attempts = 0, requested_at = now() WHERE track_id = $1 AND status = 'done'`, [id]);
      await wakeJob(db, SPECTRUM_JOB).catch(() => {});
      return reply.code(202).header('cache-control', 'no-store').send(PENDING);
    }
    // Tidak akan pernah ada (tanpa sumber audio / gagal permanen / ffmpeg tidak tersedia) → 404, klien memakai animasi cadangan.
    if (!ffmpegPath() || ((row.status === 'unavailable' || row.status === 'failed') && row.version === SPECTRUM_VERSION)) return miss();
    await enqueueSpectrum(db, [id]);
    return reply.code(202).header('cache-control', 'no-store').send(PENDING);
  });

  // Backfill (Super Admin): antrekan lagu LIVE yang belum punya amplop (atau versi lama; `retry_failed` = ulang yang gagal).
  app.post('/v1/admin/catalog/spectrum/backfill', { preHandler: requireSuperAdmin }, async (req) => {
    const b = z.object({ limit: z.number().int().min(1).max(10_000).default(500), retry_failed: z.boolean().default(false), track_ids: z.array(z.string().uuid()).max(500).optional() }).parse(req.body ?? {});
    if (!ffmpegPath()) return { queued: 0, detail: 'ffmpeg tidak tersedia' };
    const ids = b.track_ids?.length
      ? b.track_ids
      : (
          await db.query<{ id: string }>(
            `SELECT t.id FROM tracks t JOIN releases r ON r.id = t.release_id LEFT JOIN track_spectra s ON s.track_id = t.id
              WHERE r.status = 'LIVE' AND t.audio_url IS NOT NULL
                AND (s.track_id IS NULL OR s.version < $1 OR ($2 AND s.status IN ('failed','unavailable')))
              ORDER BY t.play_count DESC LIMIT $3`,
            [SPECTRUM_VERSION, b.retry_failed, b.limit],
          )
        ).map((r) => r.id);
    await enqueueSpectrum(db, ids, { retry: b.retry_failed || !!b.track_ids?.length });
    return { queued: ids.length };
  });

  app.get('/v1/admin/catalog/spectrum/status', { preHandler: requireSuperAdmin }, async () => {
    const rows = await db.query<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM track_spectra WHERE version = $1 GROUP BY status`, [SPECTRUM_VERSION]);
    const live = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM tracks t JOIN releases r ON r.id = t.release_id WHERE r.status = 'LIVE' AND t.audio_url IS NOT NULL`);
    return { version: SPECTRUM_VERSION, live_tracks: live?.n ?? 0, by_status: Object.fromEntries(rows.map((r) => [r.status, r.n])) };
  });
}
