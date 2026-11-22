import { describe, expect, it } from 'vitest';
import type { OfflineDenyCode } from '@rave/domain/offline';
import { OFFLINE_DENY } from '@rave/domain/offline';
import { deviceSlots, OFFLINE_DENY_CODES, offlineAvailability, offlineDenyCode, offlineErrorText } from './offline';

const problem = (status: number, code?: string, detail = 'detail server') => Object.assign(new Error(detail), { status, problem: { code, detail } });
const base = { enabled: true, tiers: ['INDIVIDUAL', 'STUDENT', 'DUO'], premium: true, memberType: 'INDIVIDUAL', gate: null } as const;

describe('offline (unduhan offline web)', () => {
  it('daftar kode web sama dengan kontrak domain §12', () => {
    expect([...OFFLINE_DENY_CODES].sort()).toEqual(Object.keys(OFFLINE_DENY).sort());
  });

  it('membaca kode dari Problem Details dan mengabaikan kode lain', () => {
    expect(offlineDenyCode(problem(409, 'device_limit'))).toBe('device_limit');
    expect(offlineDenyCode(problem(422, 'invalid_public_key'))).toBeNull();
    expect(offlineDenyCode(problem(500))).toBeNull();
    expect(offlineDenyCode(null)).toBeNull();
    expect(offlineDenyCode('x')).toBeNull();
  });

  it('pesan: kamus lokal per kode → detail API → pesan umum', () => {
    const msgs = Object.fromEntries(OFFLINE_DENY_CODES.map((c) => [c, `pesan ${c}`])) as Record<OfflineDenyCode, string>;
    expect(offlineErrorText(problem(403, 'offline_disabled'), msgs, 'umum')).toBe('pesan offline_disabled');
    expect(offlineErrorText(problem(500, undefined, 'Server sibuk'), msgs, 'umum')).toBe('Server sibuk');
    expect(offlineErrorText({}, msgs, 'umum')).toBe('umum');
  });

  it('status hak mengikuti urutan server: saklar → rollout → member → paket', () => {
    expect(offlineAvailability({ ...base, enabled: false })).toBe('disabled');
    expect(offlineAvailability({ ...base, gate: 'offline_disabled' })).toBe('disabled');
    // Rollout tertutup: jangan menyuruh beli Premium bila Premium pun belum bisa memakainya.
    expect(offlineAvailability({ ...base, premium: false, memberType: 'FREE', gate: 'rollout_not_included' })).toBe('rollout');
    expect(offlineAvailability({ ...base, gate: 'account_suspended' })).toBe('suspended');
    expect(offlineAvailability({ ...base, enabled: undefined })).toBe('unknown');
    expect(offlineAvailability({ ...base, gate: undefined })).toBe('unknown');
    expect(offlineAvailability({ ...base, premium: false, memberType: 'FREE' })).toBe('premium_required');
    expect(offlineAvailability({ ...base, premium: false })).toBe('premium_required');
    expect(offlineAvailability({ ...base, memberType: null })).toBe('premium_required');
    expect(offlineAvailability({ ...base, memberType: 'DUO', tiers: ['INDIVIDUAL'] })).toBe('tier_not_allowed');
    expect(offlineAvailability(base)).toBe('ready');
  });

  it('slot perangkat', () => {
    expect(deviceSlots(2, 5)).toEqual({ label: '2/5', full: false, remaining: 3 });
    expect(deviceSlots(5, 5)).toEqual({ label: '5/5', full: true, remaining: 0 });
    expect(deviceSlots(6, 5).full).toBe(true);
    expect(deviceSlots(0, 0)).toEqual({ label: '0/0', full: false, remaining: 0 });
  });
});
