import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '@gema/service-kit';

/** Tanggal (YYYY-MM-DD) zona WIB — agregasi harian mengikuti waktu Indonesia Barat. */
export const todayWib = (ms = Date.now()) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);

export function signStream(sessionId: string, exp: number): string {
  return createHmac('sha256', config.mediaSigningSecret).update(`${sessionId}.${exp}`).digest('base64url');
}

export function verifyStream(sessionId: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const a = Buffer.from(signStream(sessionId, exp));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type Quality = 'auto' | 'low' | 'normal' | 'high' | 'lossless';
/** REQ-STR-02: label kualitas yang tampil di player. Auto = AAC 160 (default hemat biaya CDN, §4.2). */
export const CODEC_LABEL: Record<Quality, string> = {
  auto: 'AAC 160',
  low: 'HE-AAC 48',
  normal: 'AAC 160',
  high: 'AAC 320',
  lossless: 'FLAC 16/44.1',
};

export const UNKNOWN = 'Tidak diketahui';
