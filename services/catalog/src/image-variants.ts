// Varian gambar hasil upload (cover, foto artis, banner) untuk performa (LCP): WebP diperkecil, dibuat sekali lewat ffmpeg
// lalu di-cache di <UPLOAD_DIR>/variants. Berkas asli tidak pernah diubah; bila ffmpeg tak ada/gagal → kirim asli.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffmpegPath } from './audio.js';
import { UPLOAD_DIR } from './storage.js';

/** Lebar yang diizinkan (piksel); permintaan lain dibulatkan ke atas → jumlah varian per gambar terbatas. */
export const IMAGE_WIDTHS = [96, 160, 240, 320, 480, 640, 960, 1280] as const;
/** Tanpa `?w`: gambar besar dikirim sebagai WebP maks. 1280 px bila browser menerima WebP. */
export const DEFAULT_MAX_WIDTH = 1280;
/** Gambar asli di bawah ambang ini dikirim apa adanya bila tanpa `?w` (sudah ringan). */
const OPTIMIZE_OVER_BYTES = 200 * 1024;
const RASTER = /\.(jpe?g|png|webp)$/i;
const DIR = join(UPLOAD_DIR, 'variants');

export const isRasterImage = (file: string) => RASTER.test(file);
export const snapWidth = (w: number) => IMAGE_WIDTHS.find((x) => x >= w) ?? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1];
export const shouldOptimize = (size: number) => size > OPTIMIZE_OVER_BYTES;

const inflight = new Map<string, Promise<string | null>>();
let running = 0;
const queue: (() => void)[] = [];
/** Maks. 2 ffmpeg bersamaan agar lonjakan permintaan sampul tidak menghabiskan CPU service. */
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((r) => queue.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    queue.shift()?.();
  }
}

function encode(src: string, out: string, width: number): Promise<boolean> {
  const bin = ffmpegPath();
  if (!bin) return Promise.resolve(false);
  const tmp = `${out}.${process.pid}.${Date.now()}.tmp.webp`;
  return new Promise((resolve) => {
    const p = spawn(bin, ['-v', 'error', '-y', '-i', src, '-vf', `scale='min(${width},iw)':-2:flags=lanczos`, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '80', '-compression_level', '4', tmp], { stdio: 'ignore' });
    const kill = setTimeout(() => p.kill('SIGKILL'), 20_000);
    p.on('error', () => (clearTimeout(kill), resolve(false)));
    p.on('close', (code) => {
      clearTimeout(kill);
      if (code === 0 && existsSync(tmp) && statSync(tmp).size > 0) {
        renameSync(tmp, out); // atomik: pembaca tidak pernah melihat berkas setengah jadi
        resolve(true);
      } else {
        rmSync(tmp, { force: true });
        resolve(false);
      }
    });
  });
}

/**
 * Path varian WebP selebar `width` untuk berkas upload `file` (dibuat bila belum ada). null → pakai asli.
 * Varian yang lebih besar dari asli tidak pernah dibuat (scale min(w, iw)).
 */
export async function imageVariant(file: string, width: number): Promise<string | null> {
  const out = join(DIR, `${file}.w${width}.webp`);
  if (existsSync(out)) return out;
  const key = out;
  let job = inflight.get(key);
  if (!job) {
    job = slot(async () => {
      mkdirSync(DIR, { recursive: true });
      return (await encode(join(UPLOAD_DIR, file), out, width)) ? out : null;
    }).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return job;
}

const SHARE_LOGO = fileURLToPath(new URL('../assets/share-logo.png', import.meta.url));

/**
 * Gambar pratinjau tautan bagikan (X/Facebook/WhatsApp, Open Graph 1200×630): latar sampul buram & gelap, sampul
 * persegi, dan logo RAVE asli (assets/share-logo.png). Di-cache per lagu + sampul (`key`) — sampul berganti → gambar baru.
 * Tanpa sampul lokal → hanya logo di latar ungu RAVE. null bila ffmpeg tak tersedia/gagal.
 */
export async function shareOgImage(key: string, cover: string | null): Promise<string | null> {
  const out = join(DIR, `share-og-${key.replace(/[^\w.-]/g, '_')}.jpg`);
  if (existsSync(out)) return out;
  const bin = ffmpegPath();
  if (!bin || !existsSync(SHARE_LOGO)) return null;
  let job = inflight.get(out);
  if (!job) {
    job = slot(async () => {
      mkdirSync(DIR, { recursive: true });
      const tmp = `${out}.${process.pid}.${Date.now()}.tmp.jpg`;
      const args = cover
        ? ['-v', 'error', '-y', '-i', cover, '-i', SHARE_LOGO, '-filter_complex',
            '[0]scale=1200:630:force_original_aspect_ratio=increase,crop=1200:630,boxblur=28:4,eq=brightness=-0.32:saturation=1.15[bg];' +
            '[0]scale=520:520:force_original_aspect_ratio=increase,crop=520:520[cv];' +
            '[bg]drawbox=x=72:y=67:w=520:h=520:color=0x0b0a0c:t=fill[sh];[sh][cv]overlay=56:55[a];' +
            '[1]scale=500:-1[lg];[a][lg]overlay=650:(H-h)/2',
            '-frames:v', '1', '-q:v', '3', tmp]
        : ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2a1233:s=1200x630', '-i', SHARE_LOGO, '-filter_complex', '[1]scale=640:-1[lg];[0][lg]overlay=(W-w)/2:(H-h)/2', '-frames:v', '1', '-q:v', '3', tmp];
      const ok = await new Promise<boolean>((resolve) => {
        const p = spawn(bin, args, { stdio: 'ignore' });
        const kill = setTimeout(() => p.kill('SIGKILL'), 20_000);
        p.on('error', () => (clearTimeout(kill), resolve(false)));
        p.on('close', (code) => (clearTimeout(kill), resolve(code === 0 && existsSync(tmp) && statSync(tmp).size > 0)));
      });
      if (!ok) {
        rmSync(tmp, { force: true });
        return null;
      }
      renameSync(tmp, out);
      return out;
    }).finally(() => inflight.delete(out));
    inflight.set(out, job);
  }
  return job;
}
