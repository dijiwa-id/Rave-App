import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '@rave/service-kit';

/** Storage privat dokumen kontrak (<root>/storage/contracts). Tidak pernah disajikan statis; akses hanya via signed URL. Produksi: bucket privat. */
export const CONTRACT_DIR = process.env.CONTRACT_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'storage', 'contracts');

function pathOf(key: string): string {
  const p = normalize(join(CONTRACT_DIR, key));
  if (!p.startsWith(CONTRACT_DIR + sep)) throw new Error('Kunci storage tidak valid');
  return p;
}
export function putContractFile(key: string, data: Buffer): { sha256: string; size: number } {
  const p = pathOf(key);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data, { mode: 0o600 });
  return { sha256: createHash('sha256').update(data).digest('hex'), size: data.length };
}
export const readContractFile = (key: string): Buffer => readFileSync(pathOf(key));

// ---- Signed URL (HMAC-SHA256, berbatas waktu) ----
const sig = (payload: string) => createHmac('sha256', config.mediaSigningSecret).update(`contract-file:${payload}`).digest('base64url');

export function signFileToken(key: string, ttlSec: number, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ k: key, e: Math.floor(now / 1000) + ttlSec })).toString('base64url');
  return `${payload}.${sig(payload)}`;
}
export function verifyFileToken(token: string, now = Date.now()): string | null {
  const [payload, s] = token.split('.');
  if (!payload || !s) return null;
  const expect = sig(payload);
  const a = Buffer.from(s);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { k, e } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof k === 'string' && typeof e === 'number' && e * 1000 > now ? k : null;
  } catch {
    return null;
  }
}
