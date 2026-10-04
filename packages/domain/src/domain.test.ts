import { describe, expect, it } from 'vitest';
import {
  allocate,
  assertBalanced,
  audienceMatchScore,
  bookingInvoice,
  calendarStatusFor,
  canTransition,
  computeCancellation,
  rotatingCode,
  userCentricRoyalty,
  validateShares,
  verifyRotatingCode,
} from './index.js';

describe('booking state machine (§7.1)', () => {
  it('mengizinkan happy path sesuai aktor', () => {
    expect(canTransition('DRAFT', 'INQUIRY', 'promotor')).toBe(true);
    expect(canTransition('INQUIRY', 'NEGOTIATING', 'management')).toBe(true);
    expect(canTransition('SIGNED', 'BOOKED', 'system')).toBe(true);
    expect(canTransition('COMPLETED', 'SETTLED', 'system')).toBe(true);
  });
  it('menolak transisi ilegal', () => {
    expect(canTransition('DRAFT', 'BOOKED', 'promotor')).toBe(false);
    expect(canTransition('SIGNED', 'BOOKED', 'promotor')).toBe(false); // hanya webhook PG
    expect(canTransition('INQUIRY', 'CANCELLED_BY_ARTIST', 'management')).toBe(false);
  });
  it('memetakan status kalender', () => {
    expect(calendarStatusFor('AGREED')).toBe('PENDING_CONTRACT');
    expect(calendarStatusFor('BOOKED_AND_SECURED')).toBe('BOOKED_AND_SECURED');
    expect(calendarStatusFor('INQUIRY')).toBeNull();
  });
});

describe('matriks pembatalan (§7.3)', () => {
  const base = { dpPaid: 25_000_000, settlementPaid: 25_000_000 };
  it('promotor > 30 hari: 50% DP hangus', () => {
    const r = computeCancellation({ ...base, party: 'promotor', daysBeforeEvent: 45 });
    expect(r.toArtist).toBe(12_500_000);
    expect(r.refundToPromotor).toBe(37_500_000);
  });
  it('promotor 14–30 hari: DP hangus, pelunasan refund 50%', () => {
    const r = computeCancellation({ ...base, party: 'promotor', daysBeforeEvent: 20 });
    expect(r.toArtist).toBe(37_500_000);
    expect(r.refundToPromotor).toBe(12_500_000);
  });
  it('promotor < 14 hari: semua hangus ke artis', () => {
    const r = computeCancellation({ ...base, party: 'promotor', daysBeforeEvent: 3 });
    expect(r.toArtist).toBe(50_000_000);
    expect(r.refundToPromotor).toBe(0);
  });
  it('artis batal: refund 100% + penalti', () => {
    const r = computeCancellation({ ...base, party: 'artist', daysBeforeEvent: 3, fee: 50_000_000, artistPenaltyPct: 25 });
    expect(r.refundToPromotor).toBe(50_000_000);
    expect(r.artistPenalty).toBe(12_500_000);
  });
  it('total selalu sama dengan dana yang dibayar', () => {
    for (const d of [1, 14, 20, 30, 31, 90]) {
      const r = computeCancellation({ dpPaid: 3_333_333, settlementPaid: 1_111_111, party: 'promotor', daysBeforeEvent: d });
      expect(r.toArtist + r.refundToPromotor).toBe(4_444_444);
    }
  });
});

describe('uang & split', () => {
  it('allocate selalu menjumlah tepat (largest remainder)', () => {
    const shares = [
      { partyId: 'a', pct: 33.33 },
      { partyId: 'b', pct: 33.33 },
      { partyId: 'c', pct: 33.34 },
    ];
    for (const amt of [1, 100, 99_999, 46_500_001]) {
      expect(allocate(amt, shares).reduce((s, x) => s + x.amount, 0)).toBe(amt);
    }
  });
  it('validasi total split 100%', () => {
    expect(validateShares([{ partyId: 'a', pct: 60 }, { partyId: 'b', pct: 40 }]).ok).toBe(true);
    expect(validateShares([{ partyId: 'a', pct: 60 }, { partyId: 'b', pct: 30 }]).ok).toBe(false);
  });
  it('invoice booking DP 50% + service fee', () => {
    const inv = bookingInvoice(50_000_000, 50);
    expect(inv.dp + inv.settlement).toBe(50_000_000);
    expect(inv.serviceFee).toBe(2_000_000);
    expect(inv.artistCommission).toBe(3_500_000);
  });
  it('ledger menolak transaksi tidak seimbang', () => {
    expect(() =>
      assertBalanced([
        { account: 'a', side: 'DEBIT', amount: 100 },
        { account: 'b', side: 'CREDIT', amount: 99 },
      ]),
    ).toThrow();
    expect(() =>
      assertBalanced([
        { account: 'a', side: 'DEBIT', amount: 100 },
        { account: 'b', side: 'CREDIT', amount: 100 },
      ]),
    ).not.toThrow();
  });
});

describe('tiket & analitik', () => {
  it('QR berputar valid dalam jendela ±1 langkah', () => {
    const t = 1_700_000_000_000;
    const code = rotatingCode('s3cret', t);
    expect(verifyRotatingCode('s3cret', code, t + 10_000)).toBe(true);
    expect(verifyRotatingCode('s3cret', code, t + 120_000)).toBe(false);
  });
  it('audience match 0..100', () => {
    const s = audienceMatchScore({ listenersInEventCity: 5000, totalMonthlyListeners: 20000, growth90dPct: 40, engagementRate: 0.3, genreFit: 1 });
    expect(s).toBeGreaterThan(50);
    expect(s).toBeLessThanOrEqual(100);
  });
  it('UCPS: pendapatan pendengar hanya ke lagu yang ia dengar', () => {
    const r = userCentricRoyalty(
      [
        { userId: 'u1', revenue: 10_000, streams: { t1: 10 } },
        { userId: 'u2', revenue: 10_000, streams: { t2: 1000 } },
      ],
      100,
      0,
    );
    expect(r.t1).toBe(10_000); // niche tetap mendapat penuh walau stream sedikit
    expect(r.t2).toBe(10_000);
  });
});
