import { describe, expect, it } from 'vitest';
import {
  quoteTicketRefund,
  ticketRefundAmount,
  type TicketRefundPolicy,
  categoryViolation,
  evaluateAdBreak,
  type AdPolicy,
  type ListenerAdState,
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

describe('kebijakan iklan', () => {
  const policy: AdPolicy = { enabled: true, breakIntervalMinutes: 15, minStreamsBetweenBreaks: 3, maxAdsPerBreak: 2, maxAdsPerHour: 6, dailyGraceStreams: 5, podcastPreroll: true };
  const base: ListenerAdState = { anonymous: false, premium: false, placement: 'between_tracks', streamsToday: 10, streamsSinceBreak: 4, minutesSinceBreak: 20, adsLastHour: 0 };
  it('menayangkan iklan bila semua aturan lolos', () => {
    expect(evaluateAdBreak(policy, base)).toMatchObject({ outcome: 'serve', slots: 2 });
  });
  it('Premium, anonim, dan konten premium tidak pernah mendapat iklan', () => {
    expect(evaluateAdBreak(policy, { ...base, premium: true }).outcome).toBe('premium');
    expect(evaluateAdBreak(policy, { ...base, anonymous: true }).outcome).toBe('anonymous');
    expect(evaluateAdBreak(policy, { ...base, premiumContent: true }).outcome).toBe('premium_content');
  });
  it('menghormati masa bebas iklan, jeda minimum, jumlah lagu, dan batas per jam', () => {
    expect(evaluateAdBreak(policy, { ...base, streamsToday: 2 }).outcome).toBe('grace');
    expect(evaluateAdBreak(policy, { ...base, minutesSinceBreak: 5 }).outcome).toBe('too_soon');
    expect(evaluateAdBreak(policy, { ...base, streamsSinceBreak: 1 }).outcome).toBe('too_few_streams');
    expect(evaluateAdBreak(policy, { ...base, adsLastHour: 6 }).outcome).toBe('hourly_cap');
    expect(evaluateAdBreak(policy, { ...base, adsLastHour: 5 }).slots).toBe(1);
  });
  it('kategori: terlarang selalu ditolak, terbatas butuh izin & bisa diblokir', () => {
    expect(categoryViolation('gambling', [], 'X')).toMatch(/dilarang/);
    expect(categoryViolation('finance', [], null)).toMatch(/OJK/);
    expect(categoryViolation('finance', [], 'KEP-123/OJK')).toBeNull();
    expect(categoryViolation('alcohol', ['alcohol'], 'ABC')).toMatch(/diblokir/);
    expect(categoryViolation('music', ['alcohol'])).toBeNull();
  });
});

describe('refund tiket (REQ-TIX-05)', () => {
  const DAY = 86_400_000;
  const now = new Date('2026-11-01T12:00:00+07:00');
  const at = (days: number) => new Date(now.getTime() + days * DAY);
  const policy: TicketRefundPolicy = { buyerRequestEnabled: true, buyerDeadlineDays: 7, buyerRefundPct: 80, rescheduleOptOutDays: 7 };

  it('permintaan pembeli sebelum H-7 → porsi kebijakan tanpa biaya layanan', () => {
    const q = quoteTicketRefund({ startsAt: at(10), checkedIn: false }, policy, now);
    expect(q).toMatchObject({ eligible: true, reason: 'buyer_request', escrowPct: 80, refundFee: false });
  });
  it('lewat batas H-7 atau fitur dimatikan → ditolak', () => {
    expect(quoteTicketRefund({ startsAt: at(5), checkedIn: false }, policy, now).eligible).toBe(false);
    expect(quoteTicketRefund({ startsAt: at(30), checkedIn: false }, { ...policy, buyerRequestEnabled: false }, now).eligible).toBe(false);
  });
  it('jadwal berubah → refund penuh + biaya layanan selama masa opt-out, walau permintaan biasa dimatikan', () => {
    const off = { ...policy, buyerRequestEnabled: false };
    const q = quoteTicketRefund({ startsAt: at(3), rescheduledAt: at(-2), checkedIn: false }, off, now);
    expect(q).toMatchObject({ eligible: true, reason: 'rescheduled', escrowPct: 100, refundFee: true });
    expect(quoteTicketRefund({ startsAt: at(3), rescheduledAt: at(-8), checkedIn: false }, off, now).eligible).toBe(false);
  });
  it('sudah check-in atau event sudah mulai → ditolak', () => {
    expect(quoteTicketRefund({ startsAt: at(10), checkedIn: true }, policy, now).eligible).toBe(false);
    expect(quoteTicketRefund({ startsAt: at(-1), rescheduledAt: at(-2), checkedIn: false }, policy, now).eligible).toBe(false);
  });
  it('nominal: porsi escrow dibulatkan ke bawah, biaya layanan utuh bila dikembalikan', () => {
    expect(ticketRefundAmount({ escrowAmount: 150_001, feeAmount: 5_000 }, { escrowPct: 80, refundFee: false })).toEqual({ escrow: 120_000, fee: 0, total: 120_000 });
    expect(ticketRefundAmount({ escrowAmount: 150_000, feeAmount: 5_000 }, { escrowPct: 100, refundFee: true })).toEqual({ escrow: 150_000, fee: 5_000, total: 155_000 });
  });
});
