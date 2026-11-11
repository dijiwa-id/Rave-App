import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

/**
 * Tanda tangan URL media berbatas waktu (HMAC MEDIA_SIGNING_SECRET) — dipakai playback untuk rendisi khusus Premium
 * (AAC 320 / FLAC) dan diverifikasi catalog saat menyajikan berkas. Tautan yang bocor kedaluwarsa sendiri.
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
