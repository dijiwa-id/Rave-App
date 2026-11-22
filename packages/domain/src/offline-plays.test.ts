import { describe, expect, it } from 'vitest';
import {
  capPlayedMs,
  exceedsDailyCap,
  licenseContent,
  licenseOwnership,
  membershipWindow,
  OFFLINE_CLOCK_SKEW_MS,
  overlapsAny,
  playWindow,
  rateWindowExceeded,
  wibDate,
  type OfflinePlayLicense,
} from './offline-plays.js';
import { settingDefaults, SETTINGS_BY_KEY } from './settings.js';

const H = 3600_000;
const DAY = 24 * H;
const NOW = Date.parse('2026-11-22T05:00:00Z'); // 12:00 WIB
const lic = (o: Partial<OfflinePlayLicense> = {}): OfflinePlayLicense => ({
  user_id: 'u1',
  device_id: 'd1',
  track_id: 't1',
  episode_id: null,
  created_at: new Date(NOW - 10 * DAY),
  expires_at: new Date(NOW + 20 * DAY),
  revoked_at: null,
  ...o,
});
const rules = { now: NOW, maxAgeMs: 35 * DAY };

describe('putar offline: aturan murni (P-7 T6)', () => {
  it('kepemilikan & konten lisensi', () => {
    expect(licenseOwnership(null, 'u1', 'd1')).toBe('license_not_found');
    expect(licenseOwnership(lic({ user_id: 'u2' }), 'u1', 'd1')).toBe('license_not_found');
    expect(licenseOwnership(lic({ device_id: 'd2' }), 'u1', 'd1')).toBe('license_not_found');
    expect(licenseOwnership(lic(), 'u1', 'd1')).toBeNull();
    expect(licenseContent(lic(), { track_id: 't1' })).toBeNull();
    expect(licenseContent(lic(), { track_id: 't2' })).toBe('license_mismatch');
    expect(licenseContent(lic(), { episode_id: 't1' })).toBe('license_mismatch');
  });

  it('jendela waktu: [terbit, min(kedaluwarsa, dicabut)), perangkat, masa depan ± 5 menit, batas umur', () => {
    const w = (start: number, l = lic(), dev: Date | null = null, played_ms = 60_000) => playWindow({ start, played_ms }, l, dev, rules);
    expect(w(NOW - DAY)).toBeNull();
    expect(w(NOW - 11 * DAY)).toBe('before_license');
    expect(w(NOW - DAY, lic({ expires_at: new Date(NOW - 2 * DAY) }))).toBe('after_license');
    expect(w(NOW - 3 * DAY, lic({ expires_at: new Date(NOW - 2 * DAY) }))).toBeNull();
    expect(w(NOW - DAY, lic({ revoked_at: new Date(NOW - DAY) }))).toBe('after_license'); // tepat saat dicabut = tidak sah
    expect(w(NOW - DAY - 1, lic({ revoked_at: new Date(NOW - DAY) }))).toBeNull();
    expect(w(NOW - DAY, lic(), new Date(NOW - 2 * DAY))).toBe('after_device_revoked');
    expect(w(NOW + OFFLINE_CLOCK_SKEW_MS - 60_000, lic(), null, 30_000)).toBeNull();
    expect(w(NOW + OFFLINE_CLOCK_SKEW_MS + 1)).toBe('in_future');
    expect(w(NOW - 10_000, lic(), null, 10 * 60_000)).toBe('in_future'); // berakhir 10 menit di masa depan
    expect(w(NOW - 36 * DAY, lic({ created_at: new Date(NOW - 40 * DAY) }))).toBe('too_old');
  });

  it('played_ms dipangkas ke durasi + 5 dtk (durasi tidak diketahui → apa adanya)', () => {
    expect(capPlayedMs(999_999, 200_000)).toBe(205_000);
    expect(capPlayedMs(100_000, 200_000)).toBe(100_000);
    expect(capPlayedMs(400_000, 0)).toBe(400_000);
    expect(capPlayedMs(-5, 200_000)).toBe(0);
  });

  it('tumpang tindih: berurutan sah, toleransi 1 dtk, mulai sama selalu bentrok', () => {
    const acc = [{ start: 0, played_ms: 180_000 }];
    expect(overlapsAny({ start: 180_000, played_ms: 60_000 }, acc)).toBe(false);
    expect(overlapsAny({ start: 179_500, played_ms: 60_000 }, acc)).toBe(false);
    expect(overlapsAny({ start: 170_000, played_ms: 60_000 }, acc)).toBe(true);
    expect(overlapsAny({ start: -60_000, played_ms: 120_000 }, acc)).toBe(true); // sebelum & menimpa awal
    expect(overlapsAny({ start: 0, played_ms: 0 }, acc)).toBe(true);
  });

  it('hari kalender WIB & batas 24 jam per perangkat', () => {
    expect(wibDate(Date.parse('2026-11-21T16:59:59Z'))).toBe('2026-11-21');
    expect(wibDate(Date.parse('2026-11-21T17:00:00Z'))).toBe('2026-11-22');
    const d0 = Date.parse('2026-11-21T17:00:00Z'); // 22 Nov 00:00 WIB
    const acc = Array.from({ length: 23 }, (_, i) => ({ start: d0 + i * H, played_ms: H }));
    expect(exceedsDailyCap({ start: d0 + 23 * H, played_ms: H }, acc)).toBe(false); // tepat 24 jam
    expect(exceedsDailyCap({ start: d0 + 23 * H, played_ms: H + 1 }, acc)).toBe(true);
    expect(exceedsDailyCap({ start: d0 + 24 * H, played_ms: H }, acc)).toBe(false); // hari berikutnya
  });

  it('pengaturan download.report_max_age_days: default 35 (TTL 30 + margin), hanya playback', () => {
    expect(settingDefaults()['download.report_max_age_days']).toBe(35);
    expect(SETTINGS_BY_KEY['download.report_max_age_days'].consumers).toEqual(['playback']);
  });
  it('RATE_LIMIT dua arah: jendela 1 jam mana pun yang memuat ref; untuk titik masa lalu saja = aturan online', () => {
    const M = 60_000;
    const ref = NOW;
    // Hanya masa lalu: identik dengan hitungan (ref − 1 jam, ref].
    expect(rateWindowExceeded(Array.from({ length: 9 }, (_, i) => ref - i * M), ref, 10)).toBe(false);
    expect(rateWindowExceeded(Array.from({ length: 10 }, (_, i) => ref - i * M), ref, 10)).toBe(true);
    expect(rateWindowExceeded(Array.from({ length: 10 }, (_, i) => ref - H - i * M), ref, 10)).toBe(false); // tepat 1 jam lalu = di luar
    // Hanya masa depan (putar dikirim urutan menurun): 10 titik dalam 1 jam setelah ref → jendela (t10 − 1 jam, t10] memuat ref.
    expect(rateWindowExceeded(Array.from({ length: 10 }, (_, i) => ref + (i + 1) * M), ref, 10)).toBe(true);
    expect(rateWindowExceeded(Array.from({ length: 9 }, (_, i) => ref + (i + 1) * M), ref, 10)).toBe(false);
    // Dua sisi: 5 sebelum + 5 sesudah dalam 30 menit → satu jendela berisi 10.
    expect(rateWindowExceeded([...Array.from({ length: 5 }, (_, i) => ref - (i + 1) * M), ...Array.from({ length: 5 }, (_, i) => ref + (i + 1) * M)], ref, 10)).toBe(true);
    // Tersebar: 9 di 50–59 menit sebelum, 9 di 50–59 menit sesudah → tidak ada jendela 1 jam memuat ref dengan ≥ 10.
    const far = [...Array.from({ length: 9 }, (_, i) => ref - (50 + i) * M), ...Array.from({ length: 9 }, (_, i) => ref + (50 + i) * M)];
    expect(rateWindowExceeded(far, ref, 10)).toBe(false);
    expect(rateWindowExceeded([], ref, 0)).toBe(true); // batas 0 = semua ditandai (seperti online)
    expect(rateWindowExceeded([ref], ref, Infinity)).toBe(false);
  });

  it('masa keanggotaan: Premium tidak aktif & started_at ≥ member_until → after_membership', () => {
    const until = new Date(NOW - DAY).toISOString();
    expect(membershipWindow({ start: NOW - DAY - 1 }, { premium_active: false, member_until: until })).toBeNull();
    expect(membershipWindow({ start: NOW - DAY }, { premium_active: false, member_until: until })).toBe('after_membership');
    expect(membershipWindow({ start: NOW }, { premium_active: true, member_until: until })).toBeNull();
    expect(membershipWindow({ start: NOW }, { premium_active: false, member_until: null })).toBeNull();
  });

  it('pengaturan download.report_per_minute: default 30, hanya playback', () => {
    expect(settingDefaults()['download.report_per_minute']).toBe(30);
    expect(SETTINGS_BY_KEY['download.report_per_minute'].consumers).toEqual(['playback']);
  });
});
