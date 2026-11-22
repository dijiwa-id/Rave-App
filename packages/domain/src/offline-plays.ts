// Pelaporan putar offline (P-7 T6, docs/adr/0004-unduhan-offline.md §Putar offline & royalti).
// Aturan murni (tanpa I/O): jendela waktu lisensi/perangkat, batas played_ms, tumpang tindih per perangkat, batas harian WIB.
// Playback (`POST /v1/events/offline-plays`) memanggil fungsi ini di bawah kunci per pengguna; yang lolos masuk ke logika
// qualified stream yang sama dengan jalur online (sumber `offline`).

/** Event per batch (batas body). */
export const OFFLINE_PLAYS_MAX_BATCH = 200;
/** Toleransi jam perangkat terhadap jam server (started_at/akhir putar boleh sedikit di depan `now`). */
export const OFFLINE_CLOCK_SKEW_MS = 5 * 60_000;
/** played_ms dipangkas ke durasi konten + toleransi (sama dengan jalur online). */
export const OFFLINE_DURATION_TOLERANCE_MS = 5_000;
/** Pembulatan jam klien antar-putar berurutan (akhir putar sebelumnya boleh melewati awal putar berikutnya ≤ ini). */
export const OFFLINE_OVERLAP_TOLERANCE_MS = 1_000;
/** Total putar per perangkat per hari kalender WIB. */
export const OFFLINE_DAILY_CAP_MS = 24 * 3600_000;

export type OfflinePlayStatus = 'accepted' | 'duplicate' | 'rejected';
/** Alasan penolakan per event (field `reason`). Ditolak = tidak pernah dibayar; kiriman ulang dengan seq sama = `duplicate`. */
export type OfflinePlayReject =
  | 'license_not_found' // lisensi tidak ada / milik akun atau perangkat lain (tidak disimpan)
  | 'license_mismatch' // lisensi untuk konten lain
  | 'content_not_found' // konten sudah dihapus dari katalog (tidak bisa diatribusikan)
  | 'before_license' // started_at sebelum lisensi pertama kali terbit
  | 'after_license' // started_at setelah lisensi kedaluwarsa / dicabut
  | 'after_device_revoked' // started_at setelah perangkat dicabut
  | 'in_future' // started_at (atau akhir putar) di masa depan melebihi toleransi jam
  | 'too_old' // lebih tua dari download.report_max_age_days
  | 'overlap' // tumpang tindih dengan putar lain yang sudah diterima di perangkat yang sama
  | 'daily_limit'; // total putar perangkat di hari WIB itu melebihi 24 jam

export interface OfflinePlayLicense {
  user_id: string;
  device_id: string;
  track_id: string | null;
  episode_id: string | null;
  /** Lisensi pertama kali terbit (baris dibuat). `issued_at` ikut berganti saat diperpanjang lewat POST, jadi bukan batas bawah. */
  created_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
}
export interface OfflinePlayInput {
  license_id: string;
  track_id?: string | null;
  episode_id?: string | null;
  started_at: number; // epoch ms
  played_ms: number;
}
export interface OfflineWindowRules {
  now: number;
  maxAgeMs: number;
  skewMs?: number;
}

/** Satu putar di perangkat: mulai (epoch ms) + lama putar yang diakui. */
export interface PlaySpan {
  start: number;
  played_ms: number;
}

const ms = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).getTime());

/** Lisensi milik pengguna+perangkat yang sama (selain itu 'license_not_found' — tidak membocorkan lisensi orang lain). */
export function licenseOwnership(lic: OfflinePlayLicense | null | undefined, userId: string, deviceId: string): OfflinePlayReject | null {
  if (!lic || lic.user_id !== userId || lic.device_id !== deviceId) return 'license_not_found';
  return null;
}

/** Konten event = konten lisensi. */
export function licenseContent(lic: OfflinePlayLicense, p: Pick<OfflinePlayInput, 'track_id' | 'episode_id'>): OfflinePlayReject | null {
  const same = (p.track_id ?? null) === (lic.track_id ?? null) && (p.episode_id ?? null) === (lic.episode_id ?? null);
  return same ? null : 'license_mismatch';
}

/**
 * started_at ∈ [lisensi terbit, min(expires_at, revoked_at)), sebelum perangkat dicabut, tidak di masa depan (± skew),
 * dan tidak lebih tua dari batas pelaporan. Urutan pemeriksaan stabil (alasan pertama yang gagal dikembalikan).
 */
export function playWindow(
  p: PlaySpan,
  lic: OfflinePlayLicense,
  deviceRevokedAt: Date | string | null,
  rules: OfflineWindowRules,
): OfflinePlayReject | null {
  const skew = rules.skewMs ?? OFFLINE_CLOCK_SKEW_MS;
  const t = p.start;
  if (!Number.isFinite(t)) return 'in_future';
  if (t > rules.now + skew || t + p.played_ms > rules.now + skew) return 'in_future';
  if (t < rules.now - rules.maxAgeMs) return 'too_old';
  if (t < ms(lic.created_at)!) return 'before_license';
  const end = Math.min(ms(lic.expires_at)!, ms(lic.revoked_at) ?? Infinity);
  if (t >= end) return 'after_license';
  const dev = ms(deviceRevokedAt);
  if (dev != null && t >= dev) return 'after_device_revoked';
  return null;
}

/** played_ms dibatasi durasi konten + toleransi (durasi 0/tidak diketahui → tidak dipangkas, sama dengan jalur online). */
export function capPlayedMs(playedMs: number, durationMs: number | null | undefined, toleranceMs = OFFLINE_DURATION_TOLERANCE_MS): number {
  const v = Math.max(0, Math.floor(playedMs));
  return durationMs && durationMs > 0 ? Math.min(v, durationMs + toleranceMs) : v;
}

/** Tanggal kalender WIB (YYYY-MM-DD) dari epoch ms. */
export const wibDate = (t: number) => new Date(t + 7 * 3600_000).toISOString().slice(0, 10);

/** Tumpang tindih dengan putar lain di perangkat yang sama: [start, start+played) beririsan melebihi toleransi. */
export function overlapsAny(p: PlaySpan, accepted: readonly PlaySpan[], toleranceMs = OFFLINE_OVERLAP_TOLERANCE_MS): boolean {
  const a0 = p.start;
  const a1 = p.start + p.played_ms;
  for (const q of accepted) {
    const b0 = q.start;
    const b1 = q.start + q.played_ms;
    // Dua putar berawal di detik yang sama selalu bertabrakan (mis. putar yang sama dikirim ulang dengan seq baru).
    if (a0 === b0) return true;
    if (Math.min(a1, b1) - Math.max(a0, b0) > toleranceMs) return true;
  }
  return false;
}

/** Total played_ms perangkat di hari WIB `started_at` (termasuk event ini) melebihi 24 jam. */
export function exceedsDailyCap(p: PlaySpan, accepted: readonly PlaySpan[], capMs = OFFLINE_DAILY_CAP_MS): boolean {
  const day = wibDate(p.start);
  let total = p.played_ms;
  for (const q of accepted) if (wibDate(q.start) === day) total += q.played_ms;
  return total > capMs;
}
