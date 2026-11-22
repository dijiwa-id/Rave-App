// Pelaporan putar offline (P-7 T6, docs/adr/0004-unduhan-offline.md §Putar offline & royalti).
// Aturan murni (tanpa I/O): jendela waktu lisensi/perangkat/keanggotaan, batas played_ms, tumpang tindih & batas harian
// WIB per PENGGUNA (semua perangkat akun), jendela laju dua arah untuk putar yang dilaporkan tidak berurutan.
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
/** Total putar per pengguna (semua perangkat) per hari kalender WIB. */
export const OFFLINE_DAILY_CAP_MS = 24 * 3600_000;
/**
 * Baris REJECTED yang disimpan per perangkat per hari WIB (waktu diterima). Lewat → putar tetap dijawab `rejected`
 * tetapi tidak disimpan (seq tidak terpakai) — mencegah tabel tumbuh tanpa batas dari kiriman sampah. Perangkat normal
 * hampir tidak pernah menghasilkan penolakan.
 */
export const OFFLINE_REJECTED_PER_DEVICE_DAY = 1000;
/** Jendela hitungan RATE_LIMIT fraudCheck (sama dengan jalur online). */
export const FRAUD_RATE_WINDOW_MS = 3600_000;

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
  | 'after_membership' // started_at pada/setelah masa Premium berakhir (member_until) dan Premium tidak aktif lagi
  | 'overlap' // tumpang tindih dengan putar lain yang sudah diterima di akun yang sama (perangkat mana pun)
  | 'daily_limit'; // total putar akun (semua perangkat) di hari WIB itu melebihi 24 jam

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

/**
 * Masa keanggotaan: Premium sudah tidak aktif dan `started_at` ≥ `member_until` → 'after_membership'. Premium aktif atau
 * `member_until` tidak diketahui → null (pencabutan lisensi lewat `iam.user.member_changed` tetap menjaga lewat
 * 'after_license').
 */
export function membershipWindow(p: Pick<PlaySpan, 'start'>, m: { premium_active: boolean; member_until: Date | string | null }): OfflinePlayReject | null {
  if (m.premium_active) return null;
  const until = ms(m.member_until);
  if (until == null || !Number.isFinite(until)) return null;
  return p.start >= until ? 'after_membership' : null;
}

/**
 * RATE_LIMIT dua arah untuk putar yang dilaporkan belakangan (offline): true bila ADA jendela `(s − window, s]` yang
 * memuat `ref` (s ∈ [ref, ref + window)) dan sudah berisi ≥ `max` stream qualified. Untuk s = ref ini persis aturan
 * jalur online (hitung 1 jam sebelum ref); jendela lain menangkap putar yang dikirim dengan urutan waktu menurun.
 * `points` = waktu dengar stream yang sudah tercatat di `(ref − window, ref + window)` (urutan bebas).
 */
export function rateWindowExceeded(points: readonly number[], ref: number, max: number, windowMs = FRAUD_RATE_WINDOW_MS): boolean {
  if (!(max > 0)) return true; // batas 0 = semua ditandai (sama dengan `n >= max` di jalur online)
  const pts = points.filter((t) => t > ref - windowMs && t < ref + windowMs).sort((a, b) => a - b);
  if (pts.length < max) return false;
  // Kandidat ujung jendela: ref sendiri dan setiap titik di (ref, ref + window). Dua penunjuk: lo = titik pertama > s − window.
  let lo = 0;
  let hi = 0; // hi = jumlah titik ≤ s
  const ends = [ref, ...pts.filter((t) => t > ref)];
  for (const s of ends) {
    while (hi < pts.length && pts[hi]! <= s) hi++;
    while (lo < hi && pts[lo]! <= s - windowMs) lo++;
    if (hi - lo >= max) return true;
  }
  return false;
}

/** Jumlah stream qualified berturut-turut yang diperiksa pola loop (sama dengan jalur online). */
export const FRAUD_LOOP_WINDOW = 5;
/** Stream qualified "pendek" pola loop: berhenti sebelum ambang ini (tepat setelah ambang qualified 30 dtk). */
export const FRAUD_LOOP_MAX_PLAYED_MS = 35_000;

/** Satu stream qualified: waktu (epoch ms) + lama putar. */
export interface TimedPlay {
  t: number;
  played_ms: number;
}

/**
 * LOOP_31S dua arah untuk putar yang dilaporkan belakangan (offline). Aturan online: stream X ditandai bila `window`
 * stream qualified tepat sebelum X semuanya < `maxPlayedMs` (played_ms X sendiri tidak dilihat). Di sini `ref`
 * disisipkan ke urutan waktu stream yang sudah tercatat; ditandai bila ADA rangkaian `window + 1` stream berurutan yang
 * memuat `ref` dengan `window` stream pertamanya semua pendek:
 * - `ref` di ujung rangkaian → persis aturan online (hanya masa lalu; untuk urutan menaik hasilnya identik);
 * - `ref` di dalam rangkaian (tetangga sesudahnya sudah tercatat, putar dikirim dengan urutan waktu menurun) → played_ms
 *   `ref` ikut diperiksa; stream di ujung yang "seharusnya" ditandai sudah tercatat, jadi `ref` yang ditandai sebagai
 *   gantinya. Satu rangkaian pendek sepanjang N selalu menghasilkan N − `window` tanda, urutan kirim apa pun.
 * Seri waktu sama dengan `ref` dianggap sebelum `ref` (seperti `<= ref` di jalur lama). `points` cukup memuat
 * `window` stream terdekat di tiap sisi (urutan bebas).
 */
export function loopPatternExceeded(points: readonly TimedPlay[], ref: TimedPlay, window = FRAUD_LOOP_WINDOW, maxPlayedMs = FRAUD_LOOP_MAX_PLAYED_MS): boolean {
  if (!(window > 0)) return false;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const before = sorted.filter((p) => p.t <= ref.t).slice(-window);
  const after = sorted.filter((p) => p.t > ref.t).slice(0, window);
  const seq = [...before, ref, ...after].map((p) => p.played_ms);
  const k = before.length; // indeks ref
  // Rangkaian [s, s + window]: memuat ref (s ≤ k ≤ s + window) dan berada di dalam seq.
  for (let s = Math.max(0, k - window); s <= k && s + window < seq.length; s++) {
    let short = true;
    for (let i = s; i < s + window; i++) if (!(seq[i]! < maxPlayedMs)) short = false;
    if (short) return true;
  }
  return false;
}

/** Tumpang tindih dengan putar lain akun yang sama: [start, start+played) beririsan melebihi toleransi. */
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

/** Total played_ms akun di hari WIB `started_at` (termasuk event ini) melebihi 24 jam. */
export function exceedsDailyCap(p: PlaySpan, accepted: readonly PlaySpan[], capMs = OFFLINE_DAILY_CAP_MS): boolean {
  const day = wibDate(p.start);
  let total = p.played_ms;
  for (const q of accepted) if (wibDate(q.start) === day) total += q.played_ms;
  return total > capMs;
}
