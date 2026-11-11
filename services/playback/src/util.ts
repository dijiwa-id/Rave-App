import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '@rave/service-kit';

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

// Kualitas & label codec: packages/domain/src/audio.ts (resolvePlayback) — label mengikuti berkas yang diputar.

export const UNKNOWN = 'Tidak diketahui';
