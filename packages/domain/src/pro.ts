// RAVE Pro — langganan B2B untuk organisasi (BRD v3.0 §4.1 "RAVE Pro (B2B SaaS)", REQ-PAY-03).
// Paket Starter / Pro / Label: take rate lebih rendah (promotor 3% + artis 5%), analitik lanjutan, multi-roster.
// Murni (tanpa I/O): harga, PPN, prorata, matriks fitur, dan siklus hidup langganan — dipakai finance, booking, iam & web.

import type { CommissionPolicy } from './money.js';

export const PRO_PLANS = ['STARTER', 'PRO', 'LABEL'] as const;
export type ProPlan = (typeof PRO_PLANS)[number];
export const BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** Organisasi yang dapat berlangganan (Kreator/podcaster tidak — tidak memakai booking off-air). */
export const PRO_ORG_TYPES = ['ARTIST', 'MANAGEMENT', 'LABEL', 'PROMOTOR', 'VENUE'] as const;
export type ProOrgType = (typeof PRO_ORG_TYPES)[number];
export const isProEligible = (type: string): type is ProOrgType => (PRO_ORG_TYPES as readonly string[]).includes(type);

export const PRO_STATUSES = ['ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED'] as const;
export type ProStatus = (typeof PRO_STATUSES)[number];
/** Status yang masih memberi hak Pro (PAST_DUE = masa tenggang). */
export const PRO_ENTITLED: ProStatus[] = ['ACTIVE', 'PAST_DUE'];

export const PLAN_RANK: Record<ProPlan, number> = { STARTER: 1, PRO: 2, LABEL: 3 };
export const PLAN_LABEL: Record<ProPlan, string> = { STARTER: 'Starter', PRO: 'Pro', LABEL: 'Label' };

/** Getter pengaturan (settings.num di service, setting() di web) — harga & batas dapat diubah Super Admin tanpa deploy. */
export type NumSetting = (key: string) => number;

export const PRO_SETTING = {
  enabled: 'subscription.pro_enabled',
  price: (p: ProPlan) => `subscription.pro_price_${p.toLowerCase()}_idr`,
  roster: (p: ProPlan) => `subscription.pro_roster_${p.toLowerCase()}`,
  freeRoster: 'subscription.pro_free_roster',
  yearlyDiscount: 'subscription.pro_yearly_discount_pct',
  ppn: 'subscription.pro_ppn_pct',
  graceDays: 'subscription.pro_grace_days',
  renewalLeadDays: 'subscription.pro_renewal_invoice_days',
  checkoutHours: 'subscription.pro_checkout_hours',
  promotorFee: 'subscription.pro_promotor_service_fee_pct',
  artistCommission: 'subscription.pro_artist_commission_pct',
} as const;

/** Fitur per paket. Batas roster numerik diambil dari pengaturan (0 = tanpa batas). */
export interface ProFeatures {
  reducedTakeRate: boolean;
  insights: boolean;
  insightsMaxDays: number;
  csvExport: boolean;
  counterpartBreakdown: boolean;
  proBadge: boolean;
  prioritySupport: boolean;
  dedicatedManager: boolean;
}
export const PRO_FEATURES: Record<ProPlan, ProFeatures> = {
  STARTER: { reducedTakeRate: true, insights: true, insightsMaxDays: 90, csvExport: false, counterpartBreakdown: false, proBadge: true, prioritySupport: false, dedicatedManager: false },
  PRO: { reducedTakeRate: true, insights: true, insightsMaxDays: 365, csvExport: true, counterpartBreakdown: true, proBadge: true, prioritySupport: true, dedicatedManager: false },
  LABEL: { reducedTakeRate: true, insights: true, insightsMaxDays: 730, csvExport: true, counterpartBreakdown: true, proBadge: true, prioritySupport: true, dedicatedManager: true },
};

/** Paket yang ditawarkan per jenis org (Label untuk manajemen/label multi-roster; promotor cukup Starter/Pro). */
export function plansFor(type: string): ProPlan[] {
  if (type === 'MANAGEMENT' || type === 'LABEL') return ['STARTER', 'PRO', 'LABEL'];
  return ['STARTER', 'PRO'];
}

const round100 = (n: number) => Math.round(n / 100) * 100;

/** Harga dasar (sebelum PPN) satu siklus. Tahunan = 12 × bulanan dikurangi diskon tahunan, dibulatkan ke Rp100. */
export function planPrice(plan: ProPlan, cycle: BillingCycle, num: NumSetting): number {
  const monthly = Math.max(0, Math.round(num(PRO_SETTING.price(plan))));
  if (cycle === 'MONTHLY') return monthly;
  return round100(monthly * 12 * (1 - Math.min(90, Math.max(0, num(PRO_SETTING.yearlyDiscount))) / 100));
}

/** PPN keluaran atas harga dasar (dibulatkan ke rupiah terdekat). */
export function ppnOf(subtotal: number, ppnPct: number): number {
  return Math.round((subtotal * Math.round(ppnPct * 100)) / 10000);
}

export function cycleEnd(start: Date, cycle: BillingCycle): Date {
  const d = new Date(start);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + (cycle === 'YEARLY' ? 12 : 1));
  // Tanggal 31 → hari terakhir bulan tujuan (bukan meluber ke bulan berikutnya).
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/**
 * Kredit prorata saat upgrade: nilai sisa periode berjalan dari harga dasar yang dibayar (tanpa PPN).
 * Kredit tidak pernah melebihi harga paket baru (tidak ada saldo negatif / pengembalian tunai).
 */
export function prorationCredit(paidSubtotal: number, periodStart: Date, periodEnd: Date, now: Date): number {
  const total = periodEnd.getTime() - periodStart.getTime();
  const left = periodEnd.getTime() - now.getTime();
  if (total <= 0 || left <= 0 || paidSubtotal <= 0) return 0;
  return Math.floor((paidSubtotal * Math.min(left, total)) / total);
}

export interface ProQuote {
  plan: ProPlan;
  cycle: BillingCycle;
  subtotal: number;
  credit: number;
  ppn_pct: number;
  ppn: number;
  total: number;
}
export function quote(plan: ProPlan, cycle: BillingCycle, num: NumSetting, credit = 0): ProQuote {
  const subtotal = planPrice(plan, cycle, num);
  const c = Math.min(Math.max(0, Math.floor(credit)), subtotal);
  const ppnPct = num(PRO_SETTING.ppn);
  const ppn = ppnOf(subtotal - c, ppnPct);
  return { plan, cycle, subtotal, credit: c, ppn_pct: ppnPct, ppn, total: subtotal - c + ppn };
}

/** Batas roster artis kelolaan (manajemen/label). 0 = tanpa batas. */
export function rosterLimit(plan: ProPlan | null, num: NumSetting): number {
  return Math.max(0, Math.round(num(plan ? PRO_SETTING.roster(plan) : PRO_SETTING.freeRoster)));
}

export interface ProState {
  plan: ProPlan;
  status: ProStatus;
  current_period_end: string | Date;
}
export function isEntitled(s: { status: string; current_period_end?: string | Date | null; grace_until?: string | Date | null } | null | undefined, now = new Date()): boolean {
  if (!s || !PRO_ENTITLED.includes(s.status as ProStatus)) return false;
  const until = s.status === 'PAST_DUE' ? s.grace_until : s.current_period_end;
  return !until || new Date(until).getTime() > now.getTime();
}

/** Take rate untuk satu booking: diskon promotor bila org promotor Pro; diskon artis bila org artis/manajemennya Pro. */
export function commissionFor(standard: CommissionPolicy, pro: CommissionPolicy, parties: { promotorPro: boolean; artistPro: boolean }): CommissionPolicy {
  return {
    promotorServiceFeePct: parties.promotorPro ? Math.min(pro.promotorServiceFeePct, standard.promotorServiceFeePct) : standard.promotorServiceFeePct,
    artistCommissionPct: parties.artistPro ? Math.min(pro.artistCommissionPct, standard.artistCommissionPct) : standard.artistCommissionPct,
  };
}

export type ProLifecycleAction = 'NONE' | 'ISSUE_RENEWAL' | 'START_GRACE' | 'EXPIRE';
export interface LifecycleInput {
  status: ProStatus;
  source: 'PAID' | 'COMPLIMENTARY';
  auto_renew: boolean;
  current_period_end: Date;
  grace_until: Date | null;
  has_open_renewal: boolean;
}

/**
 * Langkah berikutnya untuk satu langganan (job finance, idempoten):
 * - ACTIVE + perpanjangan otomatis, ≤ N hari sebelum akhir periode, belum ada tagihan → terbitkan tagihan perpanjangan;
 * - ACTIVE lewat akhir periode: perpanjangan otomatis berbayar → masa tenggang (PAST_DUE); selain itu → EXPIRED;
 * - PAST_DUE lewat masa tenggang → EXPIRED.
 */
export function lifecycleAction(s: LifecycleInput, now: Date, cfg: { renewalLeadDays: number }): ProLifecycleAction {
  const t = now.getTime();
  const end = s.current_period_end.getTime();
  if (s.status === 'ACTIVE') {
    const renews = s.auto_renew && s.source === 'PAID';
    if (t >= end) return renews ? 'START_GRACE' : 'EXPIRE';
    if (renews && !s.has_open_renewal && t >= end - cfg.renewalLeadDays * 86_400_000) return 'ISSUE_RENEWAL';
    return 'NONE';
  }
  if (s.status === 'PAST_DUE') {
    if (!s.grace_until || t >= s.grace_until.getTime()) return 'EXPIRE';
    return s.has_open_renewal ? 'NONE' : 'ISSUE_RENEWAL';
  }
  return 'NONE';
}
