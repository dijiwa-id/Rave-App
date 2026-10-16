import { describe, expect, it } from 'vitest';
import {
  assertContractTransition,
  assertEditableFields,
  canContractTransition,
  computeContractTax,
  diffSnapshots,
  expectedSigner,
  ForbiddenFieldError,
  InvalidContractTransitionError,
  isContractLocked,
  requiresEMeterai,
  statusAfterSign,
  termAmounts,
  termDueDate,
  trackerSteps,
  validateFeeSplit,
  validateTerms,
  type PaymentTerm,
} from './index.js';

const terms: PaymentTerm[] = [
  { label: 'DP', pct: 50, due: { type: 'ON_SIGN' } },
  { label: 'Pelunasan', pct: 50, due: { type: 'DAYS_BEFORE_EVENT', days: 7 } },
];

describe('state machine kontrak', () => {
  it('happy path tanpa artis: promotor → manajemen → ACTIVE', () => {
    expect(canContractTransition('CONTRACT_GENERATED', 'AWAITING_PROMOTOR_SIGN', 'management')).toBe(true);
    expect(statusAfterSign('AWAITING_PROMOTOR_SIGN', 'promotor', false)).toBe('AWAITING_MANAGEMENT_SIGN');
    expect(statusAfterSign('AWAITING_MANAGEMENT_SIGN', 'management', false)).toBe('ACTIVE');
  });
  it('dengan acknowledgement artis: manajemen → artis → ACTIVE', () => {
    expect(statusAfterSign('AWAITING_MANAGEMENT_SIGN', 'management', true)).toBe('AWAITING_ARTIST_ACK');
    expect(statusAfterSign('AWAITING_ARTIST_ACK', 'artist', true)).toBe('ACTIVE');
    expect(trackerSteps(true)).toHaveLength(4);
    expect(trackerSteps(false)).toHaveLength(3);
  });
  it('menegakkan urutan tanda tangan', () => {
    expect(() => statusAfterSign('AWAITING_PROMOTOR_SIGN', 'management', false)).toThrow();
    expect(() => statusAfterSign('AWAITING_MANAGEMENT_SIGN', 'promotor', false)).toThrow();
    expect(() => statusAfterSign('AWAITING_MANAGEMENT_SIGN', 'artist', true)).toThrow();
    expect(() => statusAfterSign('CONTRACT_GENERATED', 'promotor', false)).toThrow();
    expect(expectedSigner('ACTIVE')).toBeNull();
  });
  it('menolak transisi ilegal', () => {
    expect(canContractTransition('CONTRACT_GENERATED', 'ACTIVE', 'system')).toBe(false);
    expect(canContractTransition('AWAITING_PROMOTOR_SIGN', 'AWAITING_MANAGEMENT_SIGN', 'promotor')).toBe(false); // hanya sistem setelah tanda tangan sah
    expect(canContractTransition('AWAITING_MANAGEMENT_SIGN', 'REJECTED', 'promotor')).toBe(false); // promotor sudah tanda tangan
    expect(canContractTransition('CONTRACT_GENERATED', 'AWAITING_PROMOTOR_SIGN', 'promotor')).toBe(false);
    expect(canContractTransition('CONTRACT_GENERATED', 'REJECTED', 'promotor')).toBe(false); // promotor belum melihat draf
    expect(canContractTransition('AWAITING_PROMOTOR_SIGN', 'REJECTED', 'promotor')).toBe(true);
    expect(canContractTransition('AWAITING_PROMOTOR_SIGN', 'REJECTED', 'management')).toBe(false);
    expect(() => assertContractTransition('ACTIVE', 'CANCELLED', 'promotor')).toThrow(InvalidContractTransitionError);
  });
  it('ACTIVE dan status akhir terkunci', () => {
    for (const s of ['ACTIVE', 'REJECTED', 'CANCELLED', 'EXPIRED'] as const) {
      expect(isContractLocked(s)).toBe(true);
      for (const to of ['ACTIVE', 'CANCELLED', 'REJECTED', 'EXPIRED', 'AWAITING_PROMOTOR_SIGN'] as const) {
        for (const a of ['promotor', 'management', 'artist', 'system'] as const) expect(canContractTransition(s, to, a)).toBe(false);
      }
    }
    expect(isContractLocked('AWAITING_PROMOTOR_SIGN')).toBe(false);
  });
});

describe('termin & split fee', () => {
  it('total termin harus 100%', () => {
    expect(validateTerms(terms).ok).toBe(true);
    const bad = validateTerms([{ ...terms[0], pct: 40 }, terms[1]]);
    expect(bad.ok).toBe(false);
    expect(bad.errors.join()).toContain('90%');
    expect(validateTerms([]).ok).toBe(false);
    expect(validateTerms([{ label: 'x', pct: 100, due: { type: 'EVENT_DAY' } }]).ok).toBe(false); // pertama harus ON_SIGN
    expect(validateTerms([{ ...terms[0], pct: 33.33 }, { ...terms[1], pct: 33.33 }, { label: 'c', pct: 33.34, due: { type: 'EVENT_DAY' } }]).ok).toBe(true);
  });
  it('nominal termin selalu berjumlah tepat sama dengan nilai', () => {
    const t3: PaymentTerm[] = [
      { label: 'a', pct: 33.33, due: { type: 'ON_SIGN' } },
      { label: 'b', pct: 33.33, due: { type: 'DAYS_BEFORE_EVENT', days: 7 } },
      { label: 'c', pct: 33.34, due: { type: 'EVENT_DAY' } },
    ];
    for (const v of [10_000_001, 25_000_000, 7]) expect(termAmounts(v, t3).reduce((s, n) => s + n, 0)).toBe(v);
    expect(termAmounts(20_000_000, terms)).toEqual([10_000_000, 10_000_000]);
  });
  it('jatuh tempo termin', () => {
    expect(termDueDate({ type: 'ON_SIGN' }, '2026-12-01', '2026-11-01')).toBe('2026-11-04');
    expect(termDueDate({ type: 'DAYS_BEFORE_EVENT', days: 7 }, '2026-12-01', '2026-11-01')).toBe('2026-11-24');
    expect(termDueDate({ type: 'EVENT_DAY' }, '2026-12-01', '2026-11-01')).toBe('2026-12-01');
  });
  it('split fee total 100%', () => {
    expect(validateFeeSplit({ management_pct: 20, artist_pct: 73, platform_pct: 7 }).ok).toBe(true);
    expect(validateFeeSplit({ management_pct: 20, artist_pct: 70, platform_pct: 7 }).ok).toBe(false);
    expect(validateFeeSplit({ management_pct: -5, artist_pct: 98, platform_pct: 7 }).ok).toBe(false);
  });
});

describe('pajak & e-Meterai', () => {
  const rates = { pph21Pct: 2.5, pph23Pct: 2 };
  it('GROSS: pajak dipotong dari nilai', () => {
    expect(computeContractTax(20_000_000, 'GROSS', 'company', rates)).toMatchObject({ gross: 20_000_000, tax: 400_000, nett: 19_600_000, kind: 'PPH23' });
    expect(computeContractTax(20_000_000, 'GROSS', 'individual', rates)).toMatchObject({ tax: 500_000, kind: 'PPH21' });
  });
  it('NETT: gross di-gross-up sehingga nett tidak kurang dari yang disepakati', () => {
    for (const v of [10_000_000, 19_999_999, 7_777_777]) {
      for (const payee of ['company', 'individual'] as const) {
        const r = computeContractTax(v, 'NETT', payee, rates);
        expect(r.nett).toBeGreaterThanOrEqual(v);
        expect(r.nett - v).toBeLessThan(100);
        expect(r.gross - r.tax).toBe(r.nett);
      }
    }
  });
  it('e-Meterai hanya di atas Rp 5.000.000', () => {
    expect(requiresEMeterai(5_000_000)).toBe(false);
    expect(requiresEMeterai(5_000_001)).toBe(true);
    expect(requiresEMeterai(9_000_000, 10_000_000)).toBe(false);
  });
});

describe('whitelist & diff', () => {
  it('manajemen boleh ubah termin & klausul khusus, bukan klausul terkunci', () => {
    expect(() => assertEditableFields('management', { payment_terms: [], special_clauses: 'x', require_artist_ack: true })).not.toThrow();
    expect(() => assertEditableFields('management', { force_majeure: 'hapus' })).toThrow(ForbiddenFieldError);
    expect(() => assertEditableFields('management', { tax: 0 })).toThrow(ForbiddenFieldError); // pajak dihitung backend
  });
  it('promotor tidak boleh menyentuh klausul khusus', () => {
    expect(() => assertEditableFields('promotor', { fee: 1, payment_terms: [] })).not.toThrow();
    expect(() => assertEditableFields('promotor', { special_clauses: 'x' })).toThrow(ForbiddenFieldError);
  });
  it('diff snapshot antar versi', () => {
    const v1 = { fee: 20_000_000, terms: [{ pct: 50 }, { pct: 50 }], rider: { a: 1 } };
    const v2 = { fee: 22_000_000, terms: [{ pct: 30 }, { pct: 40 }, { pct: 30 }], rider: { a: 1 } };
    expect(diffSnapshots(v1, v1)).toEqual([]);
    expect(diffSnapshots(v1, v2)).toEqual([
      { path: 'fee', before: 20_000_000, after: 22_000_000 },
      { path: 'terms[0].pct', before: 50, after: 30 },
      { path: 'terms[1].pct', before: 50, after: 40 },
      { path: 'terms[2].pct', before: undefined, after: 30 },
    ]);
  });
});
