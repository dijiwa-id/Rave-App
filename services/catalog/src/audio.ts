// Probe master audio & transcoding rendisi streaming dengan ffmpeg (ffmpeg-static di dev, FFMPEG_PATH di image produksi).
// Antrean = kolom uploads.transcode_status (diklaim FOR UPDATE SKIP LOCKED) → aman untuk banyak replika & pulih setelah restart.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  isLosslessCodec,
  LOSSY_PROFILE,
  losslessLabel,
  plannedRenditions,
  RENDITION_SETTING,
  type AudioMeta,
  type Rendition,
  type RenditionQuality,
  type Renditions,
} from '@rave/domain/audio';
import { settings, wakeJob, type Job } from '@rave/service-kit';
import { UPLOAD_DIR } from './storage.js';

const require = createRequire(import.meta.url);

let cachedFfmpeg: string | null | undefined;
/** Lokasi ffmpeg: FFMPEG_PATH → paket ffmpeg-static → null (transcoding tidak tersedia). */
export function ffmpegPath(): string | null {
  if (cachedFfmpeg !== undefined) return cachedFfmpeg;
  if (process.env.FFMPEG_PATH) return (cachedFfmpeg = existsSync(process.env.FFMPEG_PATH) ? process.env.FFMPEG_PATH : null);
  try {
    const p = require('ffmpeg-static') as string | null;
    cachedFfmpeg = p && existsSync(p) ? p : null;
  } catch {
    cachedFfmpeg = null;
  }
  return cachedFfmpeg;
}

/** Jalankan ffmpeg dengan batas waktu; kembalikan kode keluar + stderr (dipangkas). */
function runFfmpeg(args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  const bin = ffmpegPath();
  if (!bin) return Promise.reject(new Error('ffmpeg tidak tersedia di server (set FFMPEG_PATH)'));
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c: Buffer) => {
      err += c.toString();
      if (err.length > 64_000) err = err.slice(-32_000);
    });
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => (clearTimeout(t), reject(e)));
    p.on('close', (code, signal) => {
      clearTimeout(t);
      if (signal === 'SIGKILL') return reject(new Error(`ffmpeg melewati batas waktu ${Math.round(timeoutMs / 1000)} dtk`));
      resolve({ code: code ?? 1, stderr: err });
    });
  });
}

/** Baca format, codec, sample rate, bit depth, kanal, bitrate & durasi dari berkas apa pun yang dikenali ffmpeg. */
export async function probeAudio(path: string): Promise<AudioMeta | null> {
  const { stderr } = await runFfmpeg(['-i', path], 30_000);
  const audio = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Audio: ([^\n]+)/.exec(stderr)?.[1];
  if (!audio) return null;
  const codec = /^([\w-]+)/.exec(audio)?.[1] ?? 'unknown';
  const sampleRate = Number(/(\d+) Hz/.exec(audio)?.[1] ?? 0);
  const ch = /Hz, ([^,]+)/.exec(audio)?.[1] ?? '';
  const channels = ch.includes('mono') ? 1 : ch.includes('stereo') ? 2 : Number(/(\d+) channels/.exec(ch)?.[1] ?? 2);
  const lossless = isLosslessCodec(codec);
  let bitDepth = 0;
  if (lossless) {
    const explicit = /\((\d+) bit\)/.exec(audio)?.[1];
    const pcm = /^pcm_[suf](\d+)/.exec(codec)?.[1];
    const fmt = /, (s16|s32|s24|flt|dbl)p?\b/.exec(audio)?.[1];
    bitDepth = Number(explicit ?? pcm ?? (fmt === 's16' ? 16 : fmt === 's24' ? 24 : fmt === 's32' ? 32 : fmt ? 32 : 16));
  }
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const durationMs = d ? Math.round((Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])) * 1000) : 0;
  const kbps = Number(/(\d+) kb\/s/.exec(audio)?.[1] ?? /bitrate: (\d+) kb\/s/.exec(stderr)?.[1] ?? 0);
  const format = /Input #0, ([^,\n]+)/.exec(stderr)?.[1] ?? 'unknown';
  return { format, codec, lossless, sample_rate: sampleRate, bit_depth: bitDepth, channels, bitrate_kbps: kbps, duration_ms: durationMs };
}

/** Rendisi yang aktif menurut pengaturan Super Admin (`transcoding.renditions`). */
export function enabledRenditions(): RenditionQuality[] {
  const list = settings.get<string[]>('transcoding.renditions') ?? [];
  return [...new Set(list.map((x) => RENDITION_SETTING[String(x).trim()]).filter(Boolean))];
}

const fileOf = (stored: string, q: RenditionQuality) => `${stored.replace(/\.[^.]+$/, '')}.${q}.${q === 'lossless' ? 'flac' : 'm4a'}`;

/** Satu rendisi → berkas di bucket uploads (ditulis ke .part lalu rename atomik). */
async function encode(src: string, stored: string, q: RenditionQuality, m: AudioMeta, timeoutMs: number): Promise<Rendition> {
  const name = fileOf(stored, q);
  const out = join(UPLOAD_DIR, name);
  const part = `${out}.part`;
  const common = ['-y', '-i', src, '-map', '0:a:0', '-vn', '-map_metadata', '-1'];
  let args: string[];
  let label: string;
  if (q === 'lossless') {
    // FLAC dari master lossless; resolusi dipertahankan sampai 24-bit/96 kHz (hi-res), di atasnya diturunkan.
    const rate = Math.min(m.sample_rate || 44100, 96000);
    const depth = m.bit_depth > 16 ? 24 : 16;
    args = [...common, '-c:a', 'flac', '-compression_level', '5', '-ar', String(rate), '-sample_fmt', depth > 16 ? 's32' : 's16', ...(depth > 16 ? ['-bits_per_raw_sample', '24'] : []), '-f', 'flac', part];
    label = losslessLabel('FLAC', { bit_depth: depth, sample_rate: rate });
  } else {
    const p = LOSSY_PROFILE[q];
    args = [...common, '-c:a', 'aac', '-b:a', `${p.kbps}k`, '-ac', '2', '-ar', '44100', '-movflags', '+faststart', '-f', 'mp4', part];
    label = p.label;
  }
  try {
    const r = await runFfmpeg(args, timeoutMs);
    if (r.code !== 0) throw new Error(`ffmpeg ${q} gagal: ${r.stderr.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`);
    await rename(part, out);
  } catch (e) {
    await rm(part, { force: true }).catch(() => {});
    throw e;
  }
  return { url: `/v1/catalog/media/${name}`, codec_label: label, bytes: (await stat(out)).size };
}

/** Status transcoding untuk upload audio yang baru selesai diunggah. */
export function initialTranscodeStatus(): 'pending' | 'skipped' {
  return settings.bool('transcoding.enabled') && ffmpegPath() ? 'pending' : 'skipped';
}

const MAX_ATTEMPTS = 3;
const STALE_MIN = 20;

/**
 * Worker transcoding: klaim hingga `transcoding.max_concurrent_jobs` upload (pending, atau processing yang macet
 * > 20 menit karena instance mati), proses paralel, simpan rendisi. Gagal → dicoba ulang s.d. 3 kali.
 */
export const transcodeJob: Job = {
  name: 'audio-transcode',
  everyMs: 15_000,
  wake: true,
  async run({ db, log }) {
    if (!settings.bool('transcoding.enabled') || !ffmpegPath()) return;
    const limit = Math.max(1, Math.min(16, settings.num('transcoding.max_concurrent_jobs') || 2));
    const jobs = await db.tx(async (tx) =>
      (await tx.query<{ id: string; stored_name: string; audio_meta: AudioMeta; transcode_attempts: number }>(
        `UPDATE uploads SET transcode_status = 'processing', transcode_started_at = now(), transcode_attempts = transcode_attempts + 1
          WHERE id IN (
            SELECT id FROM uploads
             WHERE kind = 'audio' AND completed_at IS NOT NULL AND audio_meta IS NOT NULL
               AND (transcode_status = 'pending' OR (transcode_status = 'processing' AND transcode_started_at < now() - interval '${STALE_MIN} minutes'))
               AND transcode_attempts < ${MAX_ATTEMPTS}
             ORDER BY created_at
             LIMIT $1
             FOR UPDATE SKIP LOCKED)
          RETURNING id, stored_name, audio_meta, transcode_attempts`,
        [limit],
      )).rows,
    );
    await Promise.all(
      jobs.map(async (j) => {
        const src = join(UPLOAD_DIR, j.stored_name);
        const plan = plannedRenditions(j.audio_meta, enabledRenditions());
        // Batas waktu per rendisi: 4× durasi lagu, minimal 2 menit.
        const timeoutMs = Math.max(120_000, (j.audio_meta.duration_ms || 0) * 4);
        const out: Renditions = {};
        try {
          if (!existsSync(src)) throw new Error('berkas master tidak ditemukan');
          for (const q of plan) out[q] = await encode(src, j.stored_name, q, j.audio_meta, timeoutMs);
          await db.query(
            `UPDATE uploads SET renditions = $2, transcode_status = 'done', transcode_error = NULL, transcoded_at = now() WHERE id = $1`,
            [j.id, JSON.stringify(out)],
          );
          log.info({ uploadId: j.id, renditions: Object.keys(out) }, 'transcoding selesai');
        } catch (e) {
          const msg = (e as Error).message.slice(0, 500);
          const final = j.transcode_attempts >= MAX_ATTEMPTS;
          await db.query(`UPDATE uploads SET transcode_status = $2, transcode_error = $3 WHERE id = $1`, [j.id, final ? 'failed' : 'pending', msg]);
          log.error({ uploadId: j.id, attempt: j.transcode_attempts, err: msg }, final ? 'transcoding gagal permanen' : 'transcoding gagal, dicoba ulang');
        }
      }),
    );
    // Slot penuh → kemungkinan masih ada antrean; ambil batch berikutnya segera.
    if (jobs.length === limit) await wakeJob(db, 'audio-transcode');
  },
};

