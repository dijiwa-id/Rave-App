// Unduhan offline Premium (P-7, ADR-0004) — sisi catalog: izin konten, artefak terenkripsi lazy, pembungkusan CEK.
// CEK polos hanya hidup sebentar di proses catalog (saat membuat artefak & membungkus ke kunci perangkat); playback
// hanya menerima CEK yang sudah dibungkus untuk satu perangkat.
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { OfflineContentKind } from '@rave/domain/offline';
import {
  cekKeyId,
  createOflEncryptor,
  offlineDeny,
  openCek,
  parseDevicePublicKey,
  publish,
  requireService,
  requireServiceOnly,
  sealCek,
  settings,
  unprocessable,
  uuidv7,
  wakeJob,
  wrapAad,
  wrapCek,
  z,
  type Client,
  type Db,
  type Job,
} from '@rave/service-kit';
import { EPISODE_VISIBLE } from './queries.js';
import { UPLOAD_DIR } from './storage.js';

export const OFFLINE_JOB = 'offline-artifacts';
const MAX_ATTEMPTS = 3;
const STALE_MIN = 15;
const RETRY_FAILED_MIN = 60;
const MEDIA = '/v1/catalog/media/';

type Q = Pick<Db, 'query'>;

/** Rendisi unduhan dari pengaturan (`download.quality`); master & lossless tidak pernah. */
export function offlineRendition(): 'normal' | 'low' {
  return settings.get<string>('download.quality') === 'low' ? 'low' : 'normal';
}

export interface OfflineSource {
  ok: true;
  source_file: string;
  codec_label: string;
}
export type OfflineResolve = OfflineSource | { ok: false; code: 'content_not_found' | 'content_not_allowed' | 'content_unavailable' } | { ok: false; code: 'preparing' };

/** Status konten untuk unduhan: harus tayang (rilis LIVE / episode terlihat & unggahan), diizinkan, dan rendisinya ada. */
export async function resolveOfflineSource(db: Q, kind: OfflineContentKind, id: string, rendition: string): Promise<OfflineResolve> {
  const row =
    kind === 'track'
      ? (
          await db.query(
            `SELECT t.offline_allowed, r.status = 'LIVE' AS visible, true AS uploaded, u.renditions, u.transcode_status
               FROM tracks t JOIN releases r ON r.id = t.release_id
               LEFT JOIN uploads u ON t.audio_url LIKE '${MEDIA}%' AND u.stored_name = split_part(t.audio_url, '${MEDIA}', 2)
              WHERE t.id = $1`,
            [id],
          )
        )[0]
      : (
          await db.query(
            `SELECT e.offline_allowed, (${EPISODE_VISIBLE}) AS visible, e.source = 'upload' AS uploaded, u.renditions, u.transcode_status
               FROM episodes e
               LEFT JOIN uploads u ON e.audio_url LIKE '${MEDIA}%' AND u.stored_name = split_part(e.audio_url, '${MEDIA}', 2)
              WHERE e.id = $1`,
            [id],
          )
        )[0];
  if (!row || !row.visible) return { ok: false, code: 'content_not_found' };
  if (!row.offline_allowed) return { ok: false, code: 'content_not_allowed' };
  if (!row.uploaded) return { ok: false, code: 'content_unavailable' };
  const r = row.renditions?.[rendition];
  const file = typeof r?.url === 'string' && r.url.startsWith(MEDIA) ? r.url.slice(MEDIA.length) : null;
  if (!file) return ['pending', 'processing'].includes(row.transcode_status) ? { ok: false, code: 'preparing' } : { ok: false, code: 'content_unavailable' };
  return { ok: true, source_file: file, codec_label: r.codec_label ?? 'AAC' };
}

/** Antrean global penuh (`download.queue_max`) → 503 + Retry-After, tanpa menambah baris (melindungi disk/CPU VPS). */
export const QUEUE_RETRY_AFTER_S = 60;
async function assertQueueRoom(db: Q) {
  const n = (await db.query(`SELECT count(*)::int AS n FROM offline_artifacts WHERE status IN ('pending', 'processing')`))[0]?.n ?? 0;
  if (n >= settings.num('download.queue_max')) throw offlineDeny('queue_full', { retry_after_s: QUEUE_RETRY_AFTER_S });
}

/** Antre ulang artefak (sumber berganti / berkas hilang / kunci segel berganti / gagal lama). `bump` = versi & CEK baru. */
async function requeueArtifact(db: Db, a: any, src: OfflineSource, bump: boolean) {
  await assertQueueRoom(db);
  await db.query(
    `UPDATE offline_artifacts SET status = 'pending', attempts = 0, error = NULL, source_file = $2, codec_label = $4,
            version = version + CASE WHEN $3 THEN 1 ELSE 0 END, updated_at = now()
      WHERE id = $1 AND status IN ('ready', 'failed')`,
    [a.id, src.source_file, bump, src.codec_label],
  );
  await wakeJob(db, OFFLINE_JOB);
}

/**
 * Pastikan artefak ada/antre (idempoten, aman paralel lewat UNIQUE + ON CONFLICT). Mengembalikan baris artefak
 * bila siap, atau null bila sedang/baru diantrekan. Sumber berganti / berkas hilang / kunci segel CEK berganti
 * (`key_id` ≠ kunci aktif) → dibuat ulang (versi baru, CEK baru). Antrean global penuh → 503 `queue_full`.
 */
export async function ensureArtifact(db: Db, kind: OfflineContentKind, id: string, rendition: string, src: OfflineSource): Promise<any | null> {
  let a = await db.one(`SELECT * FROM offline_artifacts WHERE content_kind = $1 AND content_id = $2 AND rendition = $3`, [kind, id, rendition]);
  if (!a) {
    await assertQueueRoom(db);
    await db.query(
      `INSERT INTO offline_artifacts (id, content_kind, content_id, rendition, source_file, codec_label) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (content_kind, content_id, rendition) DO NOTHING`,
      [uuidv7(), kind, id, rendition, src.source_file, src.codec_label],
    );
    await wakeJob(db, OFFLINE_JOB);
    return null;
  }
  const stale =
    a.source_file !== src.source_file ||
    (a.status === 'ready' && (!a.path || !existsSync(join(UPLOAD_DIR, a.path)) || (a.key_id != null && a.key_id !== cekKeyId())));
  const retry = a.status === 'failed' && new Date(a.updated_at).getTime() < Date.now() - RETRY_FAILED_MIN * 60_000;
  if (stale || retry) {
    await requeueArtifact(db, a, src, stale);
    return null;
  }
  if (a.status === 'failed') return 'failed';
  return a.status === 'ready' ? a : null;
}

/** Terbitkan event pencabutan offline untuk konten (no-op bila daftar kosong). Dipanggil di transaksi domain. */
export async function publishOfflineRevoked(tx: Client, kind: OfflineContentKind, ids: string[], reason: 'TAKEN_DOWN' | 'OFFLINE_DISABLED' | 'UNPUBLISHED' | 'DELETED') {
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 500) {
    const chunk = uniq.slice(i, i + 500);
    await publish(tx, 'catalog.offline.revoked', chunk[0], { contentKind: kind, contentIds: chunk, reason });
  }
}

export const artifactOut = (a: any) => ({
  id: a.id,
  version: a.version,
  format: 'RAVEOFL1' as const,
  rendition: a.rendition,
  codec_label: a.codec_label,
  mime: 'audio/mp4',
  size: Number(a.size),
  plain_size: Number(a.plain_size),
  sha256: a.sha256,
  url: `${MEDIA}${a.path}`,
});

const keyBody = z.object({
  kind: z.enum(['track', 'episode']),
  id: z.string().uuid(),
  device_public_key: z.string().min(80).max(400),
});

export async function offlineRoutes(app: FastifyInstance, { db }: { db: Db }) {
  /**
   * Internal (playback): minta artefak + CEK terbungkus untuk satu perangkat.
   * 200 {status:'ready', artifact, wrapped_key} · 202 {status:'preparing', retry_after_s} · 403/404/409 Problem (code).
   */
  app.post('/internal/offline/key', { preHandler: requireServiceOnly(db, 'catalog:/internal/offline/key') }, async (req, reply) => {
    if (!settings.bool('download.enabled')) throw offlineDeny('offline_disabled');
    const b = keyBody.parse(req.body ?? {});
    if (!parseDevicePublicKey(b.device_public_key)) throw unprocessable('Kunci publik perangkat tidak valid', { code: 'invalid_public_key' });
    const rendition = offlineRendition();
    const src = await resolveOfflineSource(db, b.kind, b.id, rendition);
    const preparing = () => (reply.status(202), { status: 'preparing' as const, retry_after_s: 15 });
    if (!src.ok) {
      if (src.code === 'preparing') return preparing();
      throw offlineDeny(src.code);
    }
    const a = await ensureArtifact(db, b.kind, b.id, rendition, src);
    if (a === 'failed') throw offlineDeny('content_unavailable');
    if (!a) return preparing();
    let cek: Buffer;
    try {
      cek = openCek(a.cek_encrypted);
    } catch (e) {
      // Artefak lama tanpa key_id yang disegel bahan kunci lain (OFFLINE_KEY/KYC_KEY berganti) → bangun ulang, bukan 500.
      req.log.warn({ artifactId: a.id, err: (e as Error).message }, 'CEK artefak offline tidak bisa dibuka — dibangun ulang');
      await requeueArtifact(db, a, src, true);
      return preparing();
    }
    try {
      const wrapped = wrapCek(cek, b.device_public_key, wrapAad(b.kind, b.id));
      return { status: 'ready' as const, artifact: artifactOut(a), wrapped_key: wrapped };
    } finally {
      cek.fill(0);
    }
  });

  /** Internal (playback recheck): ketersediaan offline banyak konten sekaligus (2 query, bukan N). */
  app.post('/internal/offline/status', { preHandler: requireService }, async (req) => {
    const b = z.object({ tracks: z.array(z.string().uuid()).max(2000).default([]), episodes: z.array(z.string().uuid()).max(2000).default([]) }).parse(req.body ?? {});
    const available: Record<string, boolean> = {};
    for (const id of [...b.tracks, ...b.episodes]) available[id] = false;
    if (b.tracks.length) {
      const rows = await db.query(
        `SELECT t.id FROM tracks t JOIN releases r ON r.id = t.release_id WHERE t.id = ANY($1::uuid[]) AND r.status = 'LIVE' AND t.offline_allowed`,
        [b.tracks],
      );
      for (const r of rows) available[r.id] = true;
    }
    if (b.episodes.length) {
      const rows = await db.query(`SELECT e.id FROM episodes e WHERE e.id = ANY($1::uuid[]) AND e.offline_allowed AND e.source = 'upload' AND ${EPISODE_VISIBLE}`, [b.episodes]);
      for (const r of rows) available[r.id] = true;
    }
    return { available };
  });
}

/** Hitung SHA-256 & ukuran aliran yang lewat (tanpa menyangga). */
function hashTap() {
  const h = createHash('sha256');
  let n = 0;
  const t = new Transform({
    transform(c: Buffer, _e, cb) {
      h.update(c);
      n += c.length;
      cb(null, c);
    },
  });
  return { t, done: () => ({ sha256: h.digest('hex'), size: n }) };
}

/**
 * Enkripsi satu artefak secara streaming (memori ≈ 64 KiB) ke `<path>.<acak>.part` lalu rename atomik. Nama `.part`
 * unik per percobaan: dua worker (klaim basi setelah 15 menit) tidak pernah menulis/menghapus berkas sementara yang sama.
 */
export async function buildArtifact(srcPath: string, outPath: string): Promise<{ cek: Buffer; iv: Buffer; size: number; plainSize: number; sha256: string }> {
  const plainSize = (await stat(srcPath)).size;
  const cek = randomBytes(32);
  const iv = randomBytes(8);
  const tap = hashTap();
  const part = `${outPath}.${randomBytes(6).toString('hex')}.part`;
  try {
    await pipeline(createReadStream(srcPath), createOflEncryptor(cek, plainSize, iv), tap.t, createWriteStream(part));
    await rename(part, outPath);
  } catch (e) {
    await rm(part, { force: true }).catch(() => {});
    throw e;
  }
  const { sha256, size } = tap.done();
  return { cek, iv, size, plainSize, sha256 };
}

/**
 * Worker artefak offline: konkurensi 1 per replika (job runner tidak pernah tumpang tindih; satu artefak per putaran).
 * Tanpa ffmpeg — hanya membaca rendisi AAC yang sudah ada & mengenkripsinya. Gagal → dicoba ulang s.d. 3 kali.
 */
export const offlineArtifactJob: Job = {
  name: OFFLINE_JOB,
  everyMs: 30_000,
  wake: true,
  async run({ db, log }) {
    const job = await db.one(
      `UPDATE offline_artifacts SET status = 'processing', started_at = now(), attempts = attempts + 1, updated_at = now()
        WHERE id = (
          SELECT id FROM offline_artifacts
           WHERE (status = 'pending' OR (status = 'processing' AND started_at < now() - interval '${STALE_MIN} minutes'))
             AND attempts < ${MAX_ATTEMPTS}
           ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING id, content_kind, content_id, rendition, source_file, version, attempts, path`,
    );
    if (!job) return;
    // Nama akhir unik per percobaan (bukan hanya per versi): worker lama yang klaimnya basi tidak menimpa/menghapus berkas
    // milik worker yang mengklaim ulang.
    const name = `ofl-${job.id}-v${job.version}-${randomBytes(4).toString('hex')}.rofl`;
    let built: Awaited<ReturnType<typeof buildArtifact>> | null = null;
    try {
      const src = join(UPLOAD_DIR, job.source_file);
      if (!existsSync(src)) throw new Error('berkas rendisi sumber tidak ditemukan');
      built = await buildArtifact(src, join(UPLOAD_DIR, name));
      // Guard: hanya klaim INI (status processing + attempts sama) yang boleh menandai siap. Diklaim ulang / diantre ulang
      // (sumber berganti) selama enkripsi → hasil dibuang.
      const done = await db.query(
        `UPDATE offline_artifacts SET status = 'ready', path = $2, cek_encrypted = $3, iv = $4, size = $5, plain_size = $6, sha256 = $7, key_id = $8,
                codec_label = coalesce(codec_label, 'AAC'), error = NULL, ready_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'processing' AND attempts = $9 RETURNING id`,
        [job.id, name, sealCek(built.cek), built.iv.toString('hex'), built.size, built.plainSize, built.sha256, cekKeyId(), job.attempts],
      );
      if (!done.length) {
        await rm(join(UPLOAD_DIR, name), { force: true }).catch(() => {});
        log.warn({ artifactId: job.id, attempt: job.attempts }, 'artefak offline selesai tetapi klaim sudah tidak berlaku — berkas dibuang');
        return;
      }
      // Berkas versi/percobaan lama tidak lagi dirujuk → hapus.
      if (job.path && job.path !== name) await rm(join(UPLOAD_DIR, job.path), { force: true }).catch(() => {});
      log.info({ artifactId: job.id, kind: job.content_kind, bytes: built.size }, 'artefak offline siap');
      await wakeJob(db, OFFLINE_JOB); // mungkin masih ada antrean
    } catch (e) {
      const msg = (e as Error).message.slice(0, 500);
      const final = job.attempts >= MAX_ATTEMPTS;
      if (built) await rm(join(UPLOAD_DIR, name), { force: true }).catch(() => {});
      await db.query(`UPDATE offline_artifacts SET status = $2, error = $3, updated_at = now() WHERE id = $1 AND status = 'processing' AND attempts = $4`, [
        job.id,
        final ? 'failed' : 'pending',
        msg,
        job.attempts,
      ]);
      log.error({ artifactId: job.id, attempt: job.attempts, err: msg }, final ? 'artefak offline gagal permanen' : 'artefak offline gagal, dicoba ulang');
    } finally {
      built?.cek.fill(0);
    }
  },
};
