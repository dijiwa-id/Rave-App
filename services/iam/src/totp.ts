import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) untuk aplikasi authenticator — Google Authenticator, Microsoft Authenticator, Authy, 1Password, dll.
 * Parameter standar yang didukung semua aplikasi: HMAC-SHA1, 6 digit, periode 30 detik, secret 160 bit (base32).
 */
export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;
/** Toleransi jam ponsel/server: terima langkah sebelumnya & berikutnya (±30 dtk). */
export const TOTP_WINDOW = 1;
/** Salah kode berturut-turut sebelum terkunci sementara. */
export const TOTP_MAX_FAILURES = 5;
export const TOTP_LOCK_MIN = 15;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('secret base32 tidak valid');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Secret baru 20 byte (160 bit, sesuai rekomendasi RFC 4226) dalam base32. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

/** HOTP (RFC 4226) untuk satu counter. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const totpStep = (nowMs = Date.now()) => Math.floor(nowMs / 1000 / TOTP_PERIOD);

/**
 * Cocokkan kode dengan secret (base32). Mengembalikan langkah waktu yang cocok, atau null.
 * Langkah ≤ `lastStep` ditolak (kode yang sama tidak bisa dipakai dua kali).
 */
export function verifyTotp(secretB32: string, code: string, opts: { nowMs?: number; lastStep?: number } = {}): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secretB32);
  const now = totpStep(opts.nowMs);
  const want = Buffer.from(code);
  let match: number | null = null;
  // Periksa semua langkah dalam jendela (tanpa berhenti lebih awal) agar waktu respons tidak membocorkan posisi.
  for (let d = -TOTP_WINDOW; d <= TOTP_WINDOW; d++) {
    const step = now + d;
    if (step <= (opts.lastStep ?? 0)) continue;
    if (timingSafeEqual(Buffer.from(hotp(key, step)), want) && match === null) match = step;
  }
  return match;
}

/** URI `otpauth://` untuk QR — dipindai aplikasi authenticator. */
export function otpauthUri(secretB32: string, account: string, issuer = 'RAVE'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret: secretB32, issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD) });
  return `otpauth://totp/${label}?${q}`;
}
