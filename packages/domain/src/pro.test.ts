import { describe, expect, it } from 'vitest';
import { DEFAULT_COMMISSION, PRO_COMMISSION } from './money.js';
import { commissionFor, cycleEnd, isEntitled, lifecycleAction, planPrice, plansFor, prorationCredit, quote, rosterLimit } from './pro.js';

const S: Record<string, number> = {
  'subscription.pro_price_starter_idr': 149_000,
  'subscription.pro_price_pro_idr': 399_000,
  'subscription.pro_price_label_idr': 999_000,
  'subscription.pro_yearly_discount_pct': 17,
  'subscription.pro_ppn_pct': 11,
  'subscription.pro_free_roster': 3,
  'subscription.pro_roster_starter': 10,
  'subscription.pro_roster_pro': 30,
  'subscription.pro_roster_label': 0,
};
const num = (k: string) => S[k] ?? 0;

describe('RAVE Pro — harga & PPN', () => {
  it('bulanan = harga pengaturan; tahunan diskon & dibulatkan ke Rp100', () => {
    expect(planPrice('PRO', 'MONTHLY', num)).toBe(399_000);
    expect(planPrice('PRO', 'YEARLY', num)).toBe(3_974_000); // 399.000 × 12 × 0,83 = 3.974.040 → 3.974.000
  });
  it('quote: PPN dari harga setelah kredit; kredit tidak melebihi harga', () => {
    const q = quote('STARTER', 'MONTHLY', num);
    expect(q).toMatchObject({ subtotal: 149_000, credit: 0, ppn: 16_390, total: 165_390 });
    const up = quote('PRO', 'MONTHLY', num, 100_000);
    expect(up).toMatchObject({ subtotal: 399_000, credit: 100_000, ppn: 32_890, total: 331_890 });
    expect(quote('STARTER', 'MONTHLY', num, 10_000_000).total).toBe(0);
  });
  it('paket Label hanya untuk manajemen/label', () => {
    expect(plansFor('PROMOTOR')).toEqual(['STARTER', 'PRO']);
    expect(plansFor('LABEL')).toContain('LABEL');
  });
});

describe('RAVE Pro — periode & prorata', () => {
  it('akhir siklus bulanan menjaga tanggal, 31 Jan → akhir Februari', () => {
    expect(cycleEnd(new Date('2026-01-31T03:00:00Z'), 'MONTHLY').toISOString()).toBe('2026-02-28T03:00:00.000Z');
    expect(cycleEnd(new Date('2026-03-15T00:00:00Z'), 'YEARLY').toISOString()).toBe('2027-03-15T00:00:00.000Z');
  });
  it('kredit prorata = porsi sisa periode dari harga dasar yang dibayar', () => {
    const start = new Date('2026-11-01T00:00:00Z');
    const end = new Date('2026-12-01T00:00:00Z');
    expect(prorationCredit(300_000, start, end, new Date('2026-11-16T00:00:00Z'))).toBe(150_000);
    expect(prorationCredit(300_000, start, end, new Date('2026-12-02T00:00:00Z'))).toBe(0);
  });
});

describe('RAVE Pro — hak & take rate', () => {
  it('hak berlaku saat ACTIVE dalam periode atau PAST_DUE dalam masa tenggang', () => {
    const now = new Date('2026-11-21T00:00:00Z');
    expect(isEntitled({ status: 'ACTIVE', current_period_end: '2026-12-01' }, now)).toBe(true);
    expect(isEntitled({ status: 'ACTIVE', current_period_end: '2026-11-01' }, now)).toBe(false);
    expect(isEntitled({ status: 'PAST_DUE', current_period_end: '2026-11-15', grace_until: '2026-11-22' }, now)).toBe(true);
    expect(isEntitled({ status: 'EXPIRED', current_period_end: '2027-01-01' }, now)).toBe(false);
  });
  it('take rate per pihak: promotor 3%, artis 5% hanya untuk pihak yang Pro', () => {
    expect(commissionFor(DEFAULT_COMMISSION, PRO_COMMISSION, { promotorPro: true, artistPro: false })).toEqual({ promotorServiceFeePct: 3, artistCommissionPct: 7 });
    expect(commissionFor(DEFAULT_COMMISSION, PRO_COMMISSION, { promotorPro: false, artistPro: true })).toEqual({ promotorServiceFeePct: 4, artistCommissionPct: 5 });
    // Tarif Pro tidak pernah lebih mahal dari standar walau salah konfigurasi.
    expect(commissionFor({ promotorServiceFeePct: 2, artistCommissionPct: 4 }, PRO_COMMISSION, { promotorPro: true, artistPro: true })).toEqual({ promotorServiceFeePct: 2, artistCommissionPct: 4 });
  });
  it('batas roster: gratis 3, Starter 10, Label tanpa batas', () => {
    expect(rosterLimit(null, num)).toBe(3);
    expect(rosterLimit('STARTER', num)).toBe(10);
    expect(rosterLimit('LABEL', num)).toBe(0);
  });
});

describe('RAVE Pro — siklus hidup', () => {
  const end = new Date('2026-12-01T00:00:00Z');
  const base = { status: 'ACTIVE' as const, source: 'PAID' as const, auto_renew: true, current_period_end: end, grace_until: null, has_open_renewal: false };
  const cfg = { renewalLeadDays: 7 };
  it('tagihan perpanjangan terbit 7 hari sebelum akhir periode, sekali saja', () => {
    expect(lifecycleAction(base, new Date('2026-11-20T00:00:00Z'), cfg)).toBe('NONE');
    expect(lifecycleAction(base, new Date('2026-11-25T00:00:00Z'), cfg)).toBe('ISSUE_RENEWAL');
    expect(lifecycleAction({ ...base, has_open_renewal: true }, new Date('2026-11-25T00:00:00Z'), cfg)).toBe('NONE');
  });
  it('lewat akhir periode: perpanjangan otomatis → masa tenggang; berhenti/komplimen → berakhir', () => {
    const after = new Date('2026-12-01T00:00:01Z');
    expect(lifecycleAction(base, after, cfg)).toBe('START_GRACE');
    expect(lifecycleAction({ ...base, auto_renew: false }, after, cfg)).toBe('EXPIRE');
    expect(lifecycleAction({ ...base, source: 'COMPLIMENTARY', auto_renew: false }, after, cfg)).toBe('EXPIRE');
  });
  it('masa tenggang habis → berakhir', () => {
    const grace = { ...base, status: 'PAST_DUE' as const, grace_until: new Date('2026-12-08T00:00:00Z'), has_open_renewal: true };
    expect(lifecycleAction(grace, new Date('2026-12-05T00:00:00Z'), cfg)).toBe('NONE');
    expect(lifecycleAction(grace, new Date('2026-12-08T00:00:00Z'), cfg)).toBe('EXPIRE');
  });
});
