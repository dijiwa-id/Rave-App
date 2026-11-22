import { describe, expect, it } from 'vitest';
import { coerceSetting, SETTINGS_BY_KEY, SETTING_GROUPS, settingDefaults } from './settings.js';

describe('pengaturan unduhan offline (P-7)', () => {
  it('flag induk mati secara default & ditandai berbahaya', () => {
    expect(settingDefaults()['download.enabled']).toBe(false);
    expect(SETTINGS_BY_KEY['download.enabled'].dangerous).toBe(true);
    expect(SETTING_GROUPS.download).toBeDefined();
  });

  it('default sesuai keputusan: semua paket berbayar, 500 item, 30 hari, 72 jam, 60/jam, AAC 160', () => {
    const d = settingDefaults();
    expect(d['download.tiers']).toEqual(['INDIVIDUAL', 'STUDENT', 'DUO']);
    expect(d['download.allow_user_ids']).toEqual([]);
    expect(d['download.max_tracks_per_device']).toBe(500);
    expect(d['download.license_ttl_days']).toBe(30);
    expect(d['download.recheck_hours']).toBe(72);
    expect(d['download.rate_per_user_hour']).toBe(60);
    expect(d['download.podcast_enabled']).toBe(true);
    expect(d['download.quality']).toBe('normal');
    expect(d['subscription.download_devices']).toBe(5);
  });

  it('FREE bukan pilihan paket & kualitas lossless/master ditolak', () => {
    expect(() => coerceSetting('download.tiers', ['FREE'])).toThrow();
    expect(() => coerceSetting('download.quality', 'lossless')).toThrow();
    expect(() => coerceSetting('download.quality', 'high')).toThrow();
  });

  it('L5: download.tiers berbahaya & minimal satu paket (mematikan semua = lewat download.enabled)', () => {
    expect(SETTINGS_BY_KEY['download.tiers'].dangerous).toBe(true);
    expect(() => coerceSetting('download.tiers', [])).toThrow(/minimal 1/);
    expect(() => coerceSetting('download.tiers', ' , ')).toThrow(/minimal 1/);
    expect(coerceSetting('download.tiers', ['DUO'])).toEqual(['DUO']);
    // `min` pada daftar lain tetap opsional (allowlist rollout boleh kosong).
    expect(coerceSetting('download.allow_user_ids', [])).toEqual([]);
  });

  it('batas anti-penyalahgunaan (review keamanan): default & konsumen', () => {
    const d = settingDefaults();
    expect([d['download.pending_per_user'], d['download.queue_max'], d['download.recheck_per_minute'], d['download.devices_per_day'], d['download.device_reregister_block_days']]).toEqual([20, 200, 6, 10, 7]);
    expect(SETTINGS_BY_KEY['download.queue_max'].consumers).toEqual(['catalog']);
    expect(SETTINGS_BY_KEY['download.devices_per_day'].consumers).toEqual(['iam']);
  });
});
