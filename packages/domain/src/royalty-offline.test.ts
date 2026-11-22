// Royalti putar offline (P-7 T7, ADR-0004): stream offline dihitung setara stream Premium online; total split tepat.
// Cutoff periode (received_at) & kirim ulang tanpa dobel diuji terhadap Postgres asli di
// services/playback/src/offline-plays.pg.test.ts (dasar royalti `/internal/royalty/streams`).
import { describe, expect, it } from 'vitest';
import { computeRoyalty, splitTrack, sumSource, type ListenerInput } from './royalty.js';

describe('royalti: stream offline setara stream Premium online (P-7 T7)', () => {
  const cfg = { model: 'user_centric' as const, rightsholderSharePct: 70, hybridFloor: 1_000 };

  it('user-centric: pendengar Premium offline & online dengan pola sama → porsi lagu identik (asal stream bukan masukan)', () => {
    // Input royalti = hitungan stream per pengguna × lagu; playback menyertakan stream offline di hitungan yang sama.
    const r = computeRoyalty(
      [
        { userId: 'online', premium: 45_000, ads: 0, streams: { tOn: 3, tShared: 2 } },
        { userId: 'offline', premium: 45_000, ads: 0, streams: { tOff: 3, tShared: 2 } },
      ],
      cfg,
    );
    const amt = (id: string) => r.tracks.find((t) => t.trackId === id)!.amount;
    expect(amt('tOn')).toEqual(amt('tOff'));
    expect(amt('tOn').premium).toBe(18_900); // 45.000 × 70% × 3/5
    expect(amt('tShared').premium).toBe(25_200); // 12.600 dari masing-masing
    expect(r.rightsholderPool).toBe(63_000);
  });

  it('pro-rata & hybrid: total split tetap tepat = pool (largest remainder), termasuk pendengar offline', () => {
    const listeners: ListenerInput[] = [
      { userId: 'on', premium: 45_001, ads: 777, streams: { t1: 7, t2: 1 } },
      { userId: 'off', premium: 22_499, ads: 0, streams: { t2: 3, t3: 1 } }, // hanya putar offline (Premium Student)
      { userId: 'free', premium: 0, ads: 333, streams: { t3: 2 } }, // di bawah floor → pool
    ];
    for (const model of ['user_centric', 'pro_rata'] as const) {
      const r = computeRoyalty(listeners, { ...cfg, model });
      const total = r.tracks.reduce((a, t) => a + sumSource(t.amount), 0);
      expect(total).toBe(r.rightsholderPool);
      for (const t of r.tracks) {
        const s = splitTrack(t.amount, [
          { type: 'MASTER', party: 'org:a', pct: 3333, approved: true },
          { type: 'MASTER', party: 'org:b', pct: 6667, approved: true },
          { type: 'PUBLISHING', party: 'user:c', pct: 100, approved: true },
        ], 25);
        expect(s.lines.reduce((a, l) => a + sumSource(l.amount), 0)).toBe(sumSource(t.amount));
      }
    }
  });
});
