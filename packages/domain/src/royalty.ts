// Royalti streaming bulanan (BRD v3.0 §4.3, §6.9 REQ-ROY-02/03, §7.5; TDD §11.4).
// Murni (tanpa I/O): atribusi pendapatan per pendengar, UCPS hybrid / pro-rata, split hak per lagu, dan statement
// per pihak (cadangan koreksi, PPh, ambang terutang). Semua nominal integer rupiah; jumlah keluaran selalu PERSIS sama
// dengan masukan (largest remainder) agar ledger seimbang.

import { allocate } from './money.js';

export type RoyaltyModel = 'user_centric' | 'pro_rata';
export const ROYALTY_SOURCES = ['premium', 'ads', 'pool'] as const;
export type RoyaltySource = (typeof ROYALTY_SOURCES)[number];
export type BySource = Record<RoyaltySource, number>;
export const zeroSource = (): BySource => ({ premium: 0, ads: 0, pool: 0 });
export const sumSource = (s: BySource) => s.premium + s.ads + s.pool;

/** Periode royalti = bulan kalender WIB, 'YYYY-MM'. */
export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export function periodRange(period: string): { from: Date; to: Date; days: number } {
  if (!PERIOD_RE.test(period)) throw new Error(`Periode tidak valid: ${period}`);
  const [y, m] = period.split('-').map(Number);
  // 00:00 WIB = 17:00 UTC hari sebelumnya.
  const from = new Date(Date.UTC(y, m - 1, 1) - 7 * 3600_000);
  const to = new Date(Date.UTC(y, m, 1) - 7 * 3600_000);
  return { from, to, days: Math.round((to.getTime() - from.getTime()) / 86_400_000) };
}
export function previousPeriod(now = new Date()): string {
  const wib = new Date(now.getTime() + 7 * 3600_000);
  const d = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function currentPeriod(now = new Date()): string {
  const wib = new Date(now.getTime() + 7 * 3600_000);
  return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------- 1. Atribusi pendapatan ke pendengar ----------
export interface PremiumMember {
  userId: string;
  memberType: 'INDIVIDUAL' | 'STUDENT' | 'DUO';
  /** Mulai & akhir keanggotaan (null = tanpa batas). */
  since: Date | null;
  until: Date | null;
}
export interface PremiumPrices {
  INDIVIDUAL: number;
  STUDENT: number;
  DUO: number;
  /** Harga termasuk PPN → DPP = harga × 100 / (100 + ppnPct). */
  ppnPct: number;
}

/** Pendapatan bersih (DPP) Premium per akun dalam periode, prorata hari aktif. Duo dibagi dua akun. */
export function premiumRevenue(members: PremiumMember[], prices: PremiumPrices, period: string): Map<string, number> {
  const { from, to } = periodRange(period);
  const span = to.getTime() - from.getTime();
  const out = new Map<string, number>();
  for (const m of members) {
    const start = Math.max(from.getTime(), m.since?.getTime() ?? from.getTime());
    const end = Math.min(to.getTime(), m.until?.getTime() ?? to.getTime());
    if (end <= start) continue;
    const gross = prices[m.memberType] / (m.memberType === 'DUO' ? 2 : 1);
    const dpp = (gross * 100) / (100 + prices.ppnPct);
    out.set(m.userId, (out.get(m.userId) ?? 0) + (dpp * (end - start)) / span);
  }
  return out;
}

/** Pendapatan iklan bersih periode dibagi ke pendengar menurut impresi iklan berbayar yang selesai diputar. */
export function adRevenue(total: number, impressions: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const n = [...impressions.values()].reduce((a, b) => a + b, 0);
  if (total <= 0 || n <= 0) return out;
  for (const [u, k] of impressions) out.set(u, (total * k) / n);
  return out;
}

/** Skalakan peta pendapatan agar totalnya = angka final Finance (mis. Premium aktual dari penagihan). */
export function scaleTo(map: Map<string, number>, total: number | null | undefined): Map<string, number> {
  if (total == null) return map;
  const cur = [...map.values()].reduce((a, b) => a + b, 0);
  if (cur <= 0) return map;
  return new Map([...map].map(([k, v]) => [k, (v * total) / cur]));
}

// ---------- 2. Pembagian ke lagu ----------
export interface ListenerInput {
  userId: string;
  premium: number;
  ads: number;
  /** trackId → stream qualified (non-fraud) dalam periode. */
  streams: Record<string, number>;
}
export interface RoyaltyConfig {
  model: RoyaltyModel;
  rightsholderSharePct: number;
  /** Pendengar dengan pendapatan < floor masuk pool pro-rata (hybrid floor, BRD §4.3). */
  hybridFloor: number;
}
export interface TrackRoyalty {
  trackId: string;
  streams: number;
  listeners: number;
  amount: BySource;
}
export interface RoyaltyResult {
  revenue: BySource & { total: number };
  rightsholderPool: number;
  tracks: TrackRoyalty[];
  /** Pendengar UCPS langsung vs masuk pool hybrid. */
  listeners: { direct: number; pooled: number; total: number };
}

/**
 * UCPS hybrid: porsi pemegang hak dari pendapatan tiap pendengar hanya dibagi ke lagu yang ia dengar, sesuai jumlah stream.
 * Pendengar di bawah floor dikumpulkan ke pool lalu dibagi pro-rata stream. Model `pro_rata`: semua pendapatan dikumpulkan
 * lalu dibagi menurut pangsa stream total. Pendengar tanpa stream tidak menyumbang (pendapatannya tetap milik platform).
 */
export function computeRoyalty(listeners: ListenerInput[], cfg: RoyaltyConfig): RoyaltyResult {
  const pct = Math.min(100, Math.max(0, cfg.rightsholderSharePct)) / 100;
  const exact = new Map<string, BySource>();
  const streams = new Map<string, number>();
  const who = new Map<string, Set<string>>();
  const poolStreams = new Map<string, number>();
  let pool = 0;
  let direct = 0;
  let pooled = 0;
  const revenue = { premium: 0, ads: 0, pool: 0, total: 0 };
  const add = (t: string, src: RoyaltySource, v: number) => {
    const e = exact.get(t) ?? zeroSource();
    e[src] += v;
    exact.set(t, e);
  };
  for (const l of listeners) {
    const total = Object.values(l.streams).reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    revenue.premium += l.premium;
    revenue.ads += l.ads;
    for (const [t, n] of Object.entries(l.streams)) {
      streams.set(t, (streams.get(t) ?? 0) + n);
      if (!who.has(t)) who.set(t, new Set());
      who.get(t)!.add(l.userId);
    }
    const rev = l.premium + l.ads;
    if (cfg.model === 'pro_rata' || rev < cfg.hybridFloor) {
      pooled++;
      pool += rev * pct;
      for (const [t, n] of Object.entries(l.streams)) poolStreams.set(t, (poolStreams.get(t) ?? 0) + n);
      continue;
    }
    direct++;
    for (const [t, n] of Object.entries(l.streams)) {
      add(t, 'premium', (l.premium * pct * n) / total);
      add(t, 'ads', (l.ads * pct * n) / total);
    }
  }
  const poolN = [...poolStreams.values()].reduce((a, b) => a + b, 0);
  if (poolN > 0) for (const [t, n] of poolStreams) add(t, 'pool', (pool * n) / poolN);
  revenue.total = revenue.premium + revenue.ads;

  // Pembulatan: total kolam = floor(total pasti); dibagi largest remainder per (lagu, sumber).
  const cells: { key: string; pct: number }[] = [];
  for (const [t, s] of exact) for (const src of ROYALTY_SOURCES) if (s[src] > 0) cells.push({ key: `${t}|${src}`, pct: s[src] });
  const grand = Math.floor(cells.reduce((a, c) => a + c.pct, 0) + 1e-6);
  const rounded = grand > 0 ? allocate(grand, cells.map((c) => ({ partyId: c.key, pct: c.pct }))) : [];
  const tracks = new Map<string, TrackRoyalty>();
  for (const t of streams.keys()) tracks.set(t, { trackId: t, streams: streams.get(t)!, listeners: who.get(t)?.size ?? 0, amount: zeroSource() });
  for (const r of rounded) {
    const [t, src] = r.partyId.split('|') as [string, RoyaltySource];
    tracks.get(t)!.amount[src] += r.amount;
  }
  return {
    revenue: { premium: Math.round(revenue.premium), ads: Math.round(revenue.ads), pool: 0, total: Math.round(revenue.total) },
    rightsholderPool: grand,
    tracks: [...tracks.values()].sort((a, b) => sumSource(b.amount) - sumSource(a.amount)),
    listeners: { direct, pooled, total: direct + pooled },
  };
}

// ---------- 3. Split hak per lagu ----------
export interface RightsShare {
  type: 'MASTER' | 'PUBLISHING';
  /** Kunci pihak penerima (org:<id> / user:<id> / email:<alamat> untuk pihak yang belum terdaftar). */
  party: string;
  pct: number;
  approved: boolean;
}
export interface SplitLine {
  party: string;
  type: 'MASTER' | 'PUBLISHING';
  pct: number;
  amount: BySource;
}

/**
 * Bagi royalti satu lagu: `publishingPct`% ke pemegang hak cipta lagu (PUBLISHING), sisanya ke pemegang hak rekaman (MASTER).
 * Lagu tanpa pemegang PUBLISHING → seluruhnya ke MASTER. Bila ada split yang belum disetujui → `held` (royalti ditahan,
 * BRD §4.3 "royalti ditahan sampai split disetujui").
 */
export function splitTrack(amount: BySource, shares: RightsShare[], publishingPct: number): { held: boolean; lines: SplitLine[] } {
  if (!shares.length || shares.some((s) => !s.approved)) return { held: true, lines: [] };
  const master = shares.filter((s) => s.type === 'MASTER');
  const pub = shares.filter((s) => s.type === 'PUBLISHING');
  if (!master.length) return { held: true, lines: [] };
  const lines = new Map<string, SplitLine>();
  for (const src of ROYALTY_SOURCES) {
    const total = amount[src];
    if (total <= 0) continue;
    const pubAmt = pub.length ? Math.floor((total * Math.min(100, Math.max(0, publishingPct))) / 100) : 0;
    for (const [group, part] of [
      [master, total - pubAmt],
      [pub, pubAmt],
    ] as const) {
      if (!group.length || part <= 0) continue;
      for (const a of allocate(part, group.map((s, i) => ({ partyId: String(i), pct: s.pct })))) {
        const s = group[Number(a.partyId)];
        const key = `${s.type}|${s.party}`;
        const l = lines.get(key) ?? { party: s.party, type: s.type, pct: s.pct, amount: zeroSource() };
        l.amount[src] += a.amount;
        lines.set(key, l);
      }
    }
  }
  return { held: false, lines: [...lines.values()] };
}

// ---------- 4. Statement per pihak ----------
export interface StatementConfig {
  reservePct: number;
  withholdingPct: number;
  minPayable: number;
}
export interface StatementMath {
  gross: number;
  reserve: number;
  withholding: number;
  carryIn: number;
  /** Masuk wallet sekarang. */
  payable: number;
  /** Dibawa ke periode berikutnya karena di bawah ambang (tidak hangus). */
  carryOut: number;
}
/**
 * Bruto → cadangan koreksi (ditahan, dilepas setelah masa cadangan) → PPh atas bagian yang dibayarkan → + saldo bawaan.
 * Total di bawah ambang terutang dibawa ke statement berikutnya. Identitas: gross + carryIn = reserve + withholding + payable + carryOut.
 */
export function statementMath(gross: number, carryIn: number, cfg: StatementConfig): StatementMath {
  const reserve = Math.floor((gross * Math.min(50, Math.max(0, cfg.reservePct))) / 100);
  const released = gross - reserve;
  const withholding = Math.floor((released * Math.min(50, Math.max(0, cfg.withholdingPct))) / 100);
  const net = released - withholding + carryIn;
  if (net < cfg.minPayable) return { gross, reserve, withholding, carryIn, payable: 0, carryOut: net };
  return { gross, reserve, withholding, carryIn, payable: net, carryOut: 0 };
}

/** Rentang wajar per stream untuk deteksi anomali review Finance (rupiah per stream qualified). */
export function perStream(amount: number, streams: number): number | null {
  return streams > 0 ? Math.round((amount / streams) * 100) / 100 : null;
}
