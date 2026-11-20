import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, newTotpSecret, otpauthUri, totpStep, verifyTotp } from './totp.js';

// Secret uji RFC 6238 lampiran B (SHA1): ASCII "12345678901234567890".
const RFC_KEY = Buffer.from('12345678901234567890');
const RFC_B32 = base32Encode(RFC_KEY);

describe('TOTP (RFC 6238)', () => {
  it('base32 bolak-balik & cocok dengan vektor yang dikenal', () => {
    expect(RFC_B32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(RFC_B32).equals(RFC_KEY)).toBe(true);
    expect(base32Decode('gezd gnbv-gy3t qojq gezd gnbv gy3t qojq').equals(RFC_KEY)).toBe(true);
    const s = newTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)).toHaveLength(20);
  });

  it('HOTP: vektor RFC 4226 lampiran D', () => {
    const want = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    want.forEach((code, i) => expect(hotp(RFC_KEY, i)).toBe(code));
  });

  it('TOTP: vektor RFC 6238 (8 digit dipotong ke 6 digit terakhir)', () => {
    const cases: [number, string][] = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
    ];
    for (const [t, code8] of cases) expect(verifyTotp(RFC_B32, code8.slice(-6), { nowMs: t * 1000 })).toBe(totpStep(t * 1000));
  });

  it('jendela ±1 langkah, di luar itu ditolak', () => {
    const t = 1_800_000_000_000;
    const step = totpStep(t);
    expect(verifyTotp(RFC_B32, hotp(RFC_KEY, step - 1), { nowMs: t })).toBe(step - 1);
    expect(verifyTotp(RFC_B32, hotp(RFC_KEY, step + 1), { nowMs: t })).toBe(step + 1);
    expect(verifyTotp(RFC_B32, hotp(RFC_KEY, step - 2), { nowMs: t })).toBeNull();
    expect(verifyTotp(RFC_B32, hotp(RFC_KEY, step + 2), { nowMs: t })).toBeNull();
  });

  it('kode yang sudah dipakai (langkah ≤ lastStep) ditolak; format salah ditolak', () => {
    const t = 1_800_000_000_000;
    const step = totpStep(t);
    const code = hotp(RFC_KEY, step);
    expect(verifyTotp(RFC_B32, code, { nowMs: t, lastStep: step })).toBeNull();
    expect(verifyTotp(RFC_B32, code, { nowMs: t, lastStep: step - 1 })).toBe(step);
    expect(verifyTotp(RFC_B32, '12345', { nowMs: t })).toBeNull();
    expect(verifyTotp(RFC_B32, 'abcdef', { nowMs: t })).toBeNull();
  });

  it('URI otpauth untuk QR', () => {
    const u = new URL(otpauthUri(RFC_B32, 'superadmin@rave.id'));
    expect(u.protocol).toBe('otpauth:');
    expect(u.host).toBe('totp');
    expect(decodeURIComponent(u.pathname)).toBe('/RAVE:superadmin@rave.id');
    expect(u.searchParams.get('secret')).toBe(RFC_B32);
    expect(u.searchParams.get('issuer')).toBe('RAVE');
    expect(u.searchParams.get('digits')).toBe('6');
    expect(u.searchParams.get('period')).toBe('30');
  });
});
