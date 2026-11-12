import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

/**
 * Tanda tangan URL media berbatas waktu (HMAC MEDIA_SIGNING_SECRET) — dipakai playback untuk semua berkas yang tidak
 * publik (master asli + rendisi khusus Premium AAC 320 / FLAC) dan diverifikasi catalog saat menyajikan berkas.
 * Tautan yang bocor kedaluwarsa sendiri.
 */
const mac = (path: string, exp: number) => createHmac('sha256', config.mediaSigningSecret).update(`media:${path}:${exp}`).digest('base64url');

export function signMediaUrl(url: string, ttlSec: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const path = url.split('?')[0];
  return `${path}?exp=${exp}&sig=${mac(path, exp)}`;
}

export function verifyMediaSig(path: string, exp: unknown, sig: unknown): boolean {
  const e = Number(exp);
  if (!Number.isFinite(e) || e * 1000 < Date.now() || typeof sig !== 'string') return false;
  const a = Buffer.from(mac(path, e));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Prefiks URL bucket uploads yang disajikan catalog. */
export const MEDIA_PREFIX = '/v1/catalog/media/';

/** Rendisi streaming gratis (AAC 64 / AAC 160, lihat catalog/src/audio.ts → `<id>.low.m4a` / `<id>.normal.m4a`). */
const FREE_RENDITION = /^[\w-]+\.(low|normal)\.m4a$/i;
/** Gambar (artwork rilis, foto/sampul artis, sampul playlist). Upload artwork hanya menerima ekstensi ini. */
const IMAGE_FILE = /^[\w-]+\.(jpe?g|png|webp)$/i;

/**
 * Berkas di bucket uploads yang boleh disajikan tanpa tanda tangan: hanya rendisi gratis & gambar (daftar putih).
 * Selain itu — master asli apa pun ekstensinya (wav/flac/aiff/alac/mp3/ogg/opus/m4a), rendisi Premium,
 * atau berkas tak dikenal — wajib URL bertanda tangan (`signMediaUrl`).
 */
export function isPublicMediaFile(file: string): boolean {
  return FREE_RENDITION.test(file) || IMAGE_FILE.test(file);
}

/**
 * Tanda tangani URL media bila berkasnya tidak publik. URL eksternal (data demo/seed) & rendisi gratis dikembalikan apa adanya.
 */
export function signProtectedMediaUrl(url: string, ttlSec: number): string {
  const path = url.split(/[?#]/)[0];
  if (!path.startsWith(MEDIA_PREFIX)) return url;
  const file = path.slice(MEDIA_PREFIX.length);
  return isPublicMediaFile(file) ? path : signMediaUrl(path, ttlSec);
}
