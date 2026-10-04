// QR e-ticket berputar (TOTP-like) — REQ-TIX-02, TDD §11.1 tickets.secret.
import { createHmac } from 'node:crypto';

export const QR_STEP_SECONDS = 15;

export function rotatingCode(secret: string, atMs: number = Date.now(), step = QR_STEP_SECONDS): string {
  const counter = Math.floor(atMs / 1000 / step);
  const h = createHmac('sha256', secret).update(String(counter)).digest();
  const offset = h[h.length - 1] & 0x0f;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/** Validasi kode dengan toleransi ±1 langkah untuk clock skew di gate. */
export function verifyRotatingCode(secret: string, code: string, atMs: number = Date.now(), window = 1): boolean {
  for (let w = -window; w <= window; w++) {
    if (rotatingCode(secret, atMs + w * QR_STEP_SECONDS * 1000) === code) return true;
  }
  return false;
}

export const RESERVATION_MINUTES = 10;
