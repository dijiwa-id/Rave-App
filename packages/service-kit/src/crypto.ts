import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';

// Enkripsi kolom AES-256-GCM (TDD §11.5). Kunci sama dengan IAM (KYC_KEY) agar data lintas service kompatibel.
const key = () => createHash('sha256').update(process.env.KYC_KEY ?? `${config.jwtSecret}:kyc`).digest();

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
export function decryptField(enc: string): string {
  const b = Buffer.from(enc, 'base64');
  const d = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
/** Samarkan semua kecuali 4 digit terakhir. */
export const maskField = (s: string) => (s.length <= 4 ? '****' : '*'.repeat(s.length - 4) + s.slice(-4));
