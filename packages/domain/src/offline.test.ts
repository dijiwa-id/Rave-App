import { describe, expect, it } from 'vitest';
import { deviceDenial, licenseQuota, memberChangeRevokes, offlineAccess, offlinePolicy, type OfflinePolicy } from './offline.js';
import { settingDefaults } from './settings.js';

const ON: OfflinePolicy = { enabled: true, allowUserIds: [], tiers: ['INDIVIDUAL', 'STUDENT', 'DUO'], podcastEnabled: true };
const premium = { userId: 'u1', memberType: 'INDIVIDUAL', premiumActive: true };

describe('hak unduhan offline', () => {
  it('default registri: fitur mati → semua ditolak', () => {
    const d = settingDefaults();
    expect(offlineAccess(offlinePolicy((k) => d[k]), premium)).toBe('offline_disabled');
  });

  it('Premium aktif dengan paket diizinkan → berhak', () => {
    expect(offlineAccess(ON, premium)).toBeNull();
    expect(offlineAccess(ON, premium, 'episode')).toBeNull();
  });

  it('Gratis, Premium kedaluwarsa, ditangguhkan → ditolak', () => {
    expect(offlineAccess(ON, { userId: 'u1', memberType: 'FREE', premiumActive: false })).toBe('premium_required');
    expect(offlineAccess(ON, { userId: 'u1', memberType: 'INDIVIDUAL', premiumActive: false })).toBe('premium_required');
    expect(offlineAccess(ON, { ...premium, suspended: true })).toBe('account_suspended');
  });

  it('paket tidak ada di download.tiers → tier_not_allowed', () => {
    expect(offlineAccess({ ...ON, tiers: ['INDIVIDUAL'] }, { userId: 'u1', memberType: 'STUDENT', premiumActive: true })).toBe('tier_not_allowed');
  });

  it('allowlist rollout: hanya ID terdaftar bila tidak kosong', () => {
    expect(offlineAccess({ ...ON, allowUserIds: ['u2'] }, premium)).toBe('rollout_not_included');
    expect(offlineAccess({ ...ON, allowUserIds: ['u1'] }, premium)).toBeNull();
  });

  it('podcast dimatikan → episode ditolak, lagu tetap boleh', () => {
    expect(offlineAccess({ ...ON, podcastEnabled: false }, premium, 'episode')).toBe('podcast_disabled');
    expect(offlineAccess({ ...ON, podcastEnabled: false }, premium, 'track')).toBeNull();
  });
});

describe('perangkat & kuota', () => {
  const dev = { id: 'd1', user_id: 'u1', revoked_at: null, public_key: 'x' };
  it('perangkat milik orang lain → 404 (tidak membocorkan), dicabut → device_revoked', () => {
    expect(deviceDenial(dev, 'u1')).toBeNull();
    expect(deviceDenial(dev, 'u2')).toBe('device_not_found');
    expect(deviceDenial(null, 'u1')).toBe('device_not_found');
    expect(deviceDenial({ ...dev, revoked_at: new Date() }, 'u1')).toBe('device_revoked');
  });

  it('kapasitas perangkat lalu rate limit per jam', () => {
    expect(licenseQuota({ activeOnDevice: 499, maxPerDevice: 500, createdLastHour: 59, ratePerHour: 60 })).toBeNull();
    expect(licenseQuota({ activeOnDevice: 500, maxPerDevice: 500, createdLastHour: 0, ratePerHour: 60 })).toBe('device_full');
    expect(licenseQuota({ activeOnDevice: 0, maxPerDevice: 500, createdLastHour: 60, ratePerHour: 60 })).toBe('rate_limited');
  });

  it('M2: permintaan yang menunggu artefak dihitung ke laju & dibatasi per akun', () => {
    const base = { activeOnDevice: 0, maxPerDevice: 500, ratePerHour: 60, maxPending: 20 };
    expect(licenseQuota({ ...base, createdLastHour: 50, pendingOthers: 10 })).toBe('rate_limited');
    expect(licenseQuota({ ...base, createdLastHour: 0, pendingOthers: 19 })).toBeNull();
    expect(licenseQuota({ ...base, createdLastHour: 0, pendingOthers: 20 })).toBe('rate_limited');
    // Polling konten yang sudah menunggu tidak ditolak oleh batas menunggu.
    expect(licenseQuota({ ...base, createdLastHour: 0, pendingOthers: 20, alreadyPending: true })).toBeNull();
  });
});

describe('pencabutan karena perubahan member', () => {
  const future = new Date(Date.now() + 86400_000).toISOString();
  it('turun ke Gratis / paket dikeluarkan → cabut; tetap Premium → tidak', () => {
    expect(memberChangeRevokes(ON, { userId: 'u1', memberType: 'FREE', premium: false, memberUntil: null })).toBe(true);
    expect(memberChangeRevokes({ ...ON, tiers: ['DUO'] }, { userId: 'u1', memberType: 'INDIVIDUAL', premium: true, memberUntil: future })).toBe(true);
    expect(memberChangeRevokes(ON, { userId: 'u1', memberType: 'DUO', premium: true, memberUntil: future })).toBe(false);
    expect(memberChangeRevokes(ON, { userId: 'u1', memberType: 'DUO', premium: true, memberUntil: '2000-01-01T00:00:00Z' })).toBe(true);
  });
});
