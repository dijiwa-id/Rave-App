// Unduhan offline Premium (P-7, docs/adr/0004-unduhan-offline.md): aturan hak murni (tanpa I/O) + kontrak lisensi.
// Dipakai iam (perangkat), catalog (izin konten) dan playback (lisensi). Klien memakai tipe payload yang sama.

export const DEVICE_PLATFORMS = ['desktop', 'android', 'ios', 'web'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];
export type OfflineContentKind = 'track' | 'episode';
export type OfflineLicenseStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';
/** Alasan pencabutan yang dikirim ke klien lewat recheck. */
export type OfflineRevokeReason =
  | 'MEMBERSHIP' // bukan Premium lagi / paket tidak diizinkan / dikeluarkan dari rollout
  | 'DEVICE_REVOKED' // perangkat dicabut pemilik
  | 'CONTENT_WITHDRAWN' // rilis ditarik, episode disembunyikan/dihapus, atau offline_allowed dimatikan
  | 'ACCOUNT_SUSPENDED'
  | 'USER_REMOVED'; // pengguna menghapus unduhan

/** Kode penolakan (field `code` di Problem Details) — klien memetakan ke pesan/aksi (mis. ajakan Premium). */
export type OfflineDenyCode =
  | 'offline_disabled'
  | 'rollout_not_included'
  | 'account_suspended'
  | 'premium_required'
  | 'tier_not_allowed'
  | 'podcast_disabled'
  | 'device_not_found'
  | 'device_revoked'
  | 'device_limit'
  | 'device_full'
  | 'rate_limited'
  | 'device_rate_limited'
  | 'queue_full'
  | 'content_not_found'
  | 'content_not_allowed'
  | 'content_unavailable';

/** Pesan Problem Details (detail ID → EN). Status HTTP per kode. */
export const OFFLINE_DENY: Record<OfflineDenyCode, { status: number; id: string; en: string }> = {
  offline_disabled: { status: 403, id: 'Unduhan offline sedang tidak tersedia', en: 'Offline downloads are currently unavailable' },
  rollout_not_included: { status: 403, id: 'Unduhan offline belum tersedia untuk akun Anda', en: 'Offline downloads are not yet available for your account' },
  account_suspended: { status: 403, id: 'Akun Anda sedang ditangguhkan', en: 'Your account is suspended' },
  premium_required: { status: 403, id: 'Unduhan offline khusus pelanggan Premium', en: 'Offline downloads are for Premium subscribers only' },
  tier_not_allowed: { status: 403, id: 'Paket Premium Anda tidak mencakup unduhan offline', en: 'Your Premium plan does not include offline downloads' },
  podcast_disabled: { status: 403, id: 'Episode podcast belum bisa diunduh', en: 'Podcast episodes cannot be downloaded yet' },
  device_not_found: { status: 404, id: 'Perangkat tidak ditemukan', en: 'Device not found' },
  device_revoked: { status: 403, id: 'Perangkat ini sudah dicabut dari akun Anda', en: 'This device has been removed from your account' },
  device_limit: { status: 409, id: 'Batas perangkat unduhan tercapai. Cabut salah satu perangkat terlebih dahulu', en: 'Download device limit reached. Remove one of your devices first' },
  device_full: { status: 409, id: 'Batas unduhan di perangkat ini tercapai. Hapus beberapa unduhan terlebih dahulu', en: 'Download limit reached on this device. Remove some downloads first' },
  rate_limited: { status: 429, id: 'Terlalu banyak unduhan baru dalam satu jam. Coba lagi nanti', en: 'Too many new downloads within an hour. Please try again later' },
  device_rate_limited: { status: 429, id: 'Terlalu banyak pendaftaran perangkat hari ini. Coba lagi besok', en: 'Too many device registrations today. Please try again tomorrow' },
  queue_full: { status: 503, id: 'Antrean penyiapan unduhan sedang penuh. Coba lagi beberapa saat lagi', en: 'The download preparation queue is full. Please try again shortly' },
  content_not_found: { status: 404, id: 'Konten tidak ditemukan', en: 'Content not found' },
  content_not_allowed: { status: 403, id: 'Pemilik konten tidak mengizinkan unduhan offline', en: 'The rights holder does not allow offline downloads' },
  content_unavailable: { status: 409, id: 'Konten ini belum tersedia untuk diunduh', en: 'This content is not available for download yet' },
};
/** Galat service hulu (iam/catalog) yang tidak punya padanan kode §12 → 502 generik (detail internal tidak diteruskan). */
export const OFFLINE_UPSTREAM_ERROR = { id: 'Layanan unduhan sedang bermasalah. Coba lagi beberapa saat lagi', en: 'The download service is having problems. Please try again shortly' };
export const OFFLINE_MESSAGES_EN: Record<string, string> = {
  ...Object.fromEntries(Object.values(OFFLINE_DENY).map((m) => [m.id, m.en])),
  [OFFLINE_UPSTREAM_ERROR.id]: OFFLINE_UPSTREAM_ERROR.en,
};

export interface OfflinePolicy {
  enabled: boolean;
  allowUserIds: string[];
  tiers: string[];
  podcastEnabled: boolean;
}
export interface OfflineMember {
  userId: string;
  memberType: string | null | undefined;
  /** Premium efektif menurut IAM (`memberActive`: paket berbayar & belum kedaluwarsa). */
  premiumActive: boolean;
  suspended?: boolean;
}

/** Baca kebijakan dari pembaca pengaturan platform. */
export function offlinePolicy(get: (key: string) => unknown): OfflinePolicy {
  const list = (k: string) => (Array.isArray(get(k)) ? (get(k) as unknown[]).map(String) : []);
  return { enabled: Boolean(get('download.enabled')), allowUserIds: list('download.allow_user_ids'), tiers: list('download.tiers'), podcastEnabled: Boolean(get('download.podcast_enabled')) };
}

/** Saklar fitur & rollout (tanpa data member). Null = lolos. */
export function offlineGate(p: OfflinePolicy, userId: string): OfflineDenyCode | null {
  if (!p.enabled) return 'offline_disabled';
  if (p.allowUserIds.length && !p.allowUserIds.includes(userId)) return 'rollout_not_included';
  return null;
}

/** Hak member atas unduhan (Gratis tidak pernah). Null = berhak. */
export function memberEntitlement(p: OfflinePolicy, m: OfflineMember): OfflineDenyCode | null {
  if (m.suspended) return 'account_suspended';
  const type = m.memberType ?? 'FREE';
  if (!m.premiumActive || type === 'FREE') return 'premium_required';
  if (!p.tiers.includes(type)) return 'tier_not_allowed';
  return null;
}

/** Pemeriksaan lengkap untuk penerbitan lisensi. Null = berhak. */
export function offlineAccess(p: OfflinePolicy, m: OfflineMember, kind?: OfflineContentKind): OfflineDenyCode | null {
  return offlineGate(p, m.userId) ?? memberEntitlement(p, m) ?? (kind === 'episode' && !p.podcastEnabled ? 'podcast_disabled' : null);
}

export interface OfflineDevice {
  id: string;
  user_id: string;
  revoked_at: string | Date | null;
  public_key: string;
}
/** Perangkat harus milik pengguna (perangkat orang lain = 404, tidak membocorkan keberadaan) dan belum dicabut. */
export function deviceDenial(d: OfflineDevice | null | undefined, userId: string): OfflineDenyCode | null {
  if (!d || d.user_id !== userId) return 'device_not_found';
  if (d.revoked_at) return 'device_revoked';
  return null;
}

/**
 * Batas lisensi baru: kapasitas perangkat lalu laju per jam. Permintaan yang masih menunggu artefak (202 `preparing`)
 * ikut dihitung (`pendingOthers` = konten LAIN yang sedang disiapkan untuk akun ini dalam 1 jam) dan dibatasi
 * `maxPending` — tanpa ini 202 berulang untuk konten berbeda bisa memaksa seluruh katalog dienkripsi.
 */
export function licenseQuota(q: {
  activeOnDevice: number;
  maxPerDevice: number;
  createdLastHour: number;
  ratePerHour: number;
  pendingOthers?: number;
  maxPending?: number;
  alreadyPending?: boolean;
}): OfflineDenyCode | null {
  if (q.activeOnDevice >= q.maxPerDevice) return 'device_full';
  const pending = q.pendingOthers ?? 0;
  if (q.createdLastHour + pending >= q.ratePerHour) return 'rate_limited';
  if (!q.alreadyPending && q.maxPending !== undefined && pending >= q.maxPending) return 'rate_limited';
  return null;
}

/** Konsumen `iam.user.member_changed`: true bila lisensi pengguna harus dicabut. */
export function memberChangeRevokes(p: OfflinePolicy, e: { userId: string; memberType: string; premium: boolean; memberUntil: string | null }, now = Date.now()): boolean {
  const active = e.premium && (!e.memberUntil || new Date(e.memberUntil).getTime() > now);
  return memberEntitlement(p, { userId: e.userId, memberType: e.memberType, premiumActive: active }) !== null;
}

export interface OfflineWrappedKey {
  alg: 'ECDH-ES+HKDF-SHA256+A256GCM';
  epk: string;
  iv: string;
  ct: string;
}

/** Isi lisensi (JSON yang ditandatangani Ed25519). Aditif: klien wajib mengabaikan field yang tidak dikenal. */
export interface OfflineLicensePayload {
  v: 1;
  typ: 'rave.offline.license';
  license_id: string;
  user_id: string;
  device_id: string;
  track_id: string | null;
  episode_id: string | null;
  artifact: {
    id: string;
    version: number;
    format: 'RAVEOFL1';
    rendition: string;
    codec_label: string;
    mime: string;
    size: number;
    plain_size: number;
    sha256: string;
  };
  key: OfflineWrappedKey;
  issued_at: string;
  expires_at: string;
  recheck_at: string;
}
