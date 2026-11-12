import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';
import { callService } from './helpers.js';

/**
 * Integrasi pihak ketiga yang diatur Super Admin (Platform → Integrasi), disimpan di `platform.integrations`.
 * Rahasia (API key) dienkripsi AES-256-GCM di DB dan tidak pernah dikirim ke browser.
 * Service lain membaca konfigurasi terdekripsi lewat `GET /internal/integrations/:kind` (token service, tidak diteruskan
 * gateway) dengan cache singkat. Bila belum diatur di dasbor → `null` → pemanggil memakai env (perilaku lama).
 */

export type IntegrationKind = 'email' | 'payment';

export interface IntegrationConfig {
  kind: IntegrationKind;
  provider: string;
  /** Nilai non-rahasia (alamat pengirim, mode sandbox/produksi, domain, …). */
  config: Record<string, string>;
  /** Nilai rahasia terdekripsi (API key). Hanya ada di sisi server. */
  secrets: Record<string, string>;
  updated_at: string;
}

// ---- Enkripsi rahasia (dipakai service platform) ----
// Kunci: INTEGRATIONS_KEY bila ada; jika tidak diturunkan dari KYC_KEY (wajib di produksi) / JWT secret (dev).
// Mengganti kunci membuat rahasia tersimpan tidak terbaca → isi ulang di dasbor (lihat docs/DEPLOYMENT.md).
const key = () => createHash('sha256').update(`${process.env.INTEGRATIONS_KEY ?? process.env.KYC_KEY ?? config.jwtSecret}:integrations:v1`).digest();

export function encryptSecrets(s: Record<string, string>): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(s), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
export function decryptSecrets(enc: string | null | undefined): Record<string, string> {
  if (!enc) return {};
  const b = Buffer.from(enc, 'base64');
  const d = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
}
/** Tampilan aman untuk UI: hanya 4 karakter terakhir. */
export const maskSecret = (v: string | undefined | null) => (v ? `••••${v.slice(-4)}` : null);

// ---- Pembaca untuk service lain ----
const TTL_MS = 15_000;
const cache = new Map<IntegrationKind, { at: number; value: IntegrationConfig | null }>();
let callerName = 'service';
/** Loader lokal (service platform membaca DB-nya sendiri, bukan HTTP ke dirinya). */
let localLoader: ((kind: IntegrationKind) => Promise<IntegrationConfig | null>) | null = null;

export function setIntegrationCaller(name: string) {
  callerName = name;
}
export function setIntegrationLoader(fn: typeof localLoader) {
  localLoader = fn;
}
/** Buang cache (dipanggil platform setelah menyimpan, dan oleh uji). */
export function invalidateIntegration(kind?: IntegrationKind) {
  if (kind) cache.delete(kind);
  else cache.clear();
}

/**
 * Konfigurasi integrasi aktif dari dasbor, atau `null` bila belum diatur (→ pakai env).
 * Platform tidak terjangkau → nilai terakhir yang diketahui tetap dipakai (pengiriman OTP tidak ikut mati).
 */
export async function getIntegration(kind: IntegrationKind): Promise<IntegrationConfig | null> {
  const hit = cache.get(kind);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const value = localLoader
      ? await localLoader(kind)
      : ((await callService<{ integration: IntegrationConfig | null }>(callerName, 'platform', `/internal/integrations/${kind}`)).integration ?? null);
    cache.set(kind, { at: Date.now(), value });
    return value;
  } catch {
    if (hit) return hit.value;
    return null;
  }
}
