import type { DevicePlatform, OfflineDenyCode } from '@rave/domain/offline';

/**
 * Unduhan offline Premium (P-7, docs/adr/0004-unduhan-offline.md, docs/API.md §12) — logika murni untuk web.
 * Web fase 1 TIDAK menyimpan unduhan; web hanya menampilkan perangkat terdaftar, status hak, dan mencabut perangkat.
 */

/** Perangkat unduhan (`GET /v1/me/devices` → `{ data, limit, active }`; hanya perangkat aktif). */
export interface OfflineDevice {
  id: string;
  platform: DevicePlatform;
  name: string;
  app_version: string | null;
  key_fingerprint: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}
export interface OfflineDevicesResponse {
  data: OfflineDevice[];
  limit: number;
  active: number;
}

export const OFFLINE_DENY_CODES: readonly OfflineDenyCode[] = [
  'offline_disabled',
  'rollout_not_included',
  'account_suspended',
  'premium_required',
  'tier_not_allowed',
  'podcast_disabled',
  'device_not_found',
  'device_revoked',
  'device_limit',
  'device_full',
  'rate_limited',
  'device_rate_limited',
  'queue_full',
  'content_not_found',
  'content_not_allowed',
  'content_unavailable',
];

/** Kode penolakan §12 dari galat API (`problem.code`); null bila bukan galat unduhan offline. */
export function offlineDenyCode(err: unknown): OfflineDenyCode | null {
  // ApiError (lib/api.ts) membawa Problem Details di `problem`; duck typing agar modul ini bebas dependensi.
  const code = (err as { problem?: { code?: unknown } } | null)?.problem?.code;
  return typeof code === 'string' && (OFFLINE_DENY_CODES as readonly string[]).includes(code) ? (code as OfflineDenyCode) : null;
}

/** Pesan manusiawi: kamus lokal per kode §12, lalu `detail` dari API, lalu pesan umum. */
export function offlineErrorText(err: unknown, messages: Record<OfflineDenyCode, string>, fallback: string): string {
  const code = offlineDenyCode(err);
  if (code) return messages[code];
  const msg = (err as { message?: unknown } | null)?.message;
  return typeof msg === 'string' && msg ? msg : fallback;
}

/**
 * Status hak unduhan yang ditampilkan ke pengguna, mengikuti urutan pemeriksaan server (`offlineAccess`):
 * saklar & rollout dulu, baru hak member. `unknown` = konfigurasi belum termuat.
 */
export type OfflineAvailability = 'unknown' | 'disabled' | 'rollout' | 'suspended' | 'premium_required' | 'tier_not_allowed' | 'ready';

export function offlineAvailability(i: {
  /** `download.enabled` dari konfigurasi publik; undefined = belum termuat. */
  enabled: boolean | undefined;
  /** `download.tiers` publik. */
  tiers: readonly string[];
  premium: boolean;
  memberType: string | null | undefined;
  /** Hasil probe `GET /v1/offline/licenses` (saklar + rollout di server): null = lolos, undefined = belum diketahui. */
  gate: OfflineDenyCode | null | undefined;
}): OfflineAvailability {
  if (i.enabled === false || i.gate === 'offline_disabled') return 'disabled';
  if (i.gate === 'rollout_not_included') return 'rollout';
  if (i.gate === 'account_suspended') return 'suspended';
  if (i.enabled === undefined || i.gate === undefined) return 'unknown';
  const type = i.memberType ?? 'FREE';
  if (!i.premium || type === 'FREE') return 'premium_required';
  if (!i.tiers.includes(type)) return 'tier_not_allowed';
  return 'ready';
}

/** Slot perangkat: "2/5", penuh bila aktif ≥ batas. */
export function deviceSlots(active: number, limit: number): { label: string; full: boolean; remaining: number } {
  const a = Math.max(0, active);
  const l = Math.max(0, limit);
  return { label: `${a}/${l}`, full: l > 0 && a >= l, remaining: Math.max(0, l - a) };
}
