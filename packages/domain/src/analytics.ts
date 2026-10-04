// Audience Match (REQ-B2B-07, TDD §11.4) dan agregasi aman privasi (UU PDP §8.2).

/** Ambang minimum agregat agar segmen tidak dapat di-reidentifikasi. */
export const K_ANONYMITY_MIN = 50;

export interface AudienceMatchInput {
  listenersInEventCity: number;
  totalMonthlyListeners: number;
  growth90dPct: number; // -100..+inf
  engagementRate: number; // 0..1 (save rate / repeat listen)
  genreFit: number; // 0..1 kecocokan genre dengan kategori acara
}

/** Skor 0–100. Bobot: kota 45%, pertumbuhan 20%, engagement 20%, genre 15%. */
export function audienceMatchScore(i: AudienceMatchInput): number {
  const cityShare = i.totalMonthlyListeners > 0 ? i.listenersInEventCity / i.totalMonthlyListeners : 0;
  const city = Math.min(1, cityShare * 4); // 25% pendengar di kota event = skor kota penuh
  const growth = Math.max(0, Math.min(1, (i.growth90dPct + 20) / 120));
  const s = 0.45 * city + 0.2 * growth + 0.2 * Math.min(1, i.engagementRate) + 0.15 * Math.min(1, i.genreFit);
  return Math.round(s * 100);
}

/** Sembunyikan segmen di bawah ambang k (mengembalikan null). */
export function kSafe(count: number): number | null {
  return count >= K_ANONYMITY_MIN ? count : null;
}

/** Qualified stream: ≥30 detik (§11.3). */
export const QUALIFIED_STREAM_MS = 30_000;

// ---- Royalti user-centric hybrid (§4.3) ----
export interface ListenerRevenue {
  userId: string;
  revenue: number; // pendapatan yang diatribusikan ke pendengar (iklan/premium) dalam rupiah
  streams: Record<string, number>; // trackId -> qualified streams
}

/**
 * UCPS: pendapatan tiap pendengar hanya dibagi ke lagu yang ia dengar.
 * Pendengar dengan revenue < floor dimasukkan ke pool pro-rata (hybrid floor).
 */
export function userCentricRoyalty(listeners: ListenerRevenue[], royaltyPct = 65, floor = 1000): Record<string, number> {
  const out: Record<string, number> = {};
  let pool = 0;
  const poolStreams: Record<string, number> = {};
  for (const l of listeners) {
    const total = Object.values(l.streams).reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const royalty = (l.revenue * royaltyPct) / 100;
    if (l.revenue < floor) {
      pool += royalty;
      for (const [t, n] of Object.entries(l.streams)) poolStreams[t] = (poolStreams[t] ?? 0) + n;
      continue;
    }
    for (const [t, n] of Object.entries(l.streams)) out[t] = (out[t] ?? 0) + (royalty * n) / total;
  }
  const poolTotal = Object.values(poolStreams).reduce((a, b) => a + b, 0);
  if (poolTotal > 0) for (const [t, n] of Object.entries(poolStreams)) out[t] = (out[t] ?? 0) + (pool * n) / poolTotal;
  for (const k of Object.keys(out)) out[k] = Math.floor(out[k]);
  return out;
}
