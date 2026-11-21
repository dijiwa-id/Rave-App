import { describe, expect, it } from 'vitest';
import { adRevenue, computeRoyalty, periodRange, premiumRevenue, previousPeriod, scaleTo, splitTrack, statementMath, sumSource } from './royalty.js';

describe('royalti — periode', () => {
  it('bulan WIB: 1 Nov 00:00 WIB = 31 Okt 17:00 UTC', () => {
    const r = periodRange('2026-11');
    expect(r.from.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-11-30T17:00:00.000Z');
    expect(r.days).toBe(30);
    expect(previousPeriod(new Date('2026-12-01T01:00:00Z'))).toBe('2026-11');
    expect(previousPeriod(new Date('2026-11-30T18:00:00Z'))).toBe('2026-11'); // 1 Des WIB
  });
});

describe('royalti — atribusi pendapatan', () => {
  const prices = { INDIVIDUAL: 49_900, STUDENT: 24_900, DUO: 64_900, ppnPct: 11 };
  it('Premium: DPP prorata hari aktif, Duo dibagi dua', () => {
    const { from } = periodRange('2026-11');
    const half = new Date(from.getTime() + 15 * 86_400_000);
    const m = premiumRevenue(
      [
        { userId: 'a', memberType: 'INDIVIDUAL', since: null, until: null },
        { userId: 'b', memberType: 'DUO', since: null, until: null },
        { userId: 'c', memberType: 'INDIVIDUAL', since: half, until: null },
        { userId: 'd', memberType: 'STUDENT', since: null, until: from },
      ],
      prices,
      '2026-11',
    );
    expect(Math.round(m.get('a')!)).toBe(44_955); // 49.900 / 1,11
    expect(Math.round(m.get('b')!)).toBe(29_234);
    expect(Math.round(m.get('c')!)).toBe(22_477);
    expect(m.has('d')).toBe(false);
  });
  it('iklan dibagi menurut impresi; skala ke angka final Finance', () => {
    const ads = adRevenue(1_000, new Map([['x', 3], ['y', 1]]));
    expect(ads.get('x')).toBe(750);
    expect([...scaleTo(ads, 2_000).values()]).toEqual([1_500, 500]);
  });
});

describe('royalti — UCPS hybrid', () => {
  const cfg = { model: 'user_centric' as const, rightsholderSharePct: 65, hybridFloor: 1_000 };
  it('pendapatan pendengar hanya ke lagu yang ia dengar; total persis = floor(65%)', () => {
    const r = computeRoyalty(
      [
        { userId: 'p', premium: 45_000, ads: 0, streams: { niche: 10 } },
        { userId: 'q', premium: 45_000, ads: 0, streams: { hit: 90, niche: 10 } },
      ],
      cfg,
    );
    expect(r.rightsholderPool).toBe(58_500);
    expect(r.tracks.reduce((a, t) => a + sumSource(t.amount), 0)).toBe(58_500);
    const niche = r.tracks.find((t) => t.trackId === 'niche')!;
    // Pro-rata akan memberi niche 20/110; UCPS memberi 29.250 + 2.925.
    expect(sumSource(niche.amount)).toBe(32_175);
    expect(niche.listeners).toBe(2);
  });
  it('pendengar di bawah floor masuk pool pro-rata', () => {
    const r = computeRoyalty(
      [
        { userId: 'f1', premium: 0, ads: 500, streams: { a: 1 } },
        { userId: 'f2', premium: 0, ads: 500, streams: { b: 3 } },
      ],
      cfg,
    );
    expect(r.listeners).toEqual({ direct: 0, pooled: 2, total: 2 });
    expect(r.tracks.find((t) => t.trackId === 'b')!.amount.pool).toBe(487);
    expect(r.rightsholderPool).toBe(650);
  });
  it('model pro-rata: semua pendapatan dikumpulkan', () => {
    const r = computeRoyalty([{ userId: 'p', premium: 10_000, ads: 0, streams: { a: 1, b: 1 } }], { ...cfg, model: 'pro_rata' });
    expect(r.tracks.map((t) => t.amount.pool)).toEqual([3_250, 3_250]);
  });
});

describe('royalti — split & statement', () => {
  it('publishing 20%, sisanya master; jumlah persis', () => {
    const s = splitTrack({ premium: 10_001, ads: 0, pool: 0 }, [
      { type: 'MASTER', party: 'org:a', pct: 65, approved: true },
      { type: 'MASTER', party: 'org:label', pct: 35, approved: true },
      { type: 'PUBLISHING', party: 'email:pencipta@x.id', pct: 100, approved: true },
    ], 20);
    expect(s.held).toBe(false);
    expect(s.lines.reduce((a, l) => a + sumSource(l.amount), 0)).toBe(10_001);
    expect(s.lines.find((l) => l.type === 'PUBLISHING')!.amount.premium).toBe(2_000);
  });
  it('split belum disetujui → ditahan', () => {
    expect(splitTrack({ premium: 100, ads: 0, pool: 0 }, [{ type: 'MASTER', party: 'org:a', pct: 100, approved: false }], 20).held).toBe(true);
  });
  it('statement: cadangan, PPh, ambang terutang dibawa (identitas terjaga)', () => {
    const cfg = { reservePct: 10, withholdingPct: 15, minPayable: 10_000 };
    const a = statementMath(100_000, 0, cfg);
    expect(a).toEqual({ gross: 100_000, reserve: 10_000, withholding: 13_500, carryIn: 0, payable: 76_500, carryOut: 0 });
    const b = statementMath(5_000, 2_000, cfg);
    expect(b.payable).toBe(0);
    expect(b.carryOut).toBe(5_000 - 500 - 675 + 2_000);
    for (const m of [a, b]) expect(m.gross + m.carryIn).toBe(m.reserve + m.withholding + m.payable + m.carryOut);
  });
});
