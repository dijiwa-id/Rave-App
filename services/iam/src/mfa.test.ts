import { describe, expect, it } from 'vitest';
import { hashRecoveryCode, newRecoveryCodes, normalizeRecoveryCode, RECOVERY_CODE_COUNT } from './mfa.js';

describe('2FA — kode pemulihan', () => {
  it('10 kode unik berformat xxxxx-xxxxx (base32 huruf kecil)', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
  });

  it('pengetikan ulang dinormalkan: huruf besar, spasi & tanda hubung diabaikan', () => {
    expect(normalizeRecoveryCode(' AbCdE-fGh23 ')).toBe('abcdefgh23');
    const uid = '01a1f920-543f-752d-b6c8-4593f28931a6';
    expect(hashRecoveryCode(uid, 'abcde-fgh23')).toBe(hashRecoveryCode(uid, 'ABCDE FGH23'));
  });

  it('hash terikat ke akun (kode yang sama di akun lain tidak cocok)', () => {
    expect(hashRecoveryCode('user-a', 'abcde-fgh23')).not.toBe(hashRecoveryCode('user-b', 'abcde-fgh23'));
  });
});
