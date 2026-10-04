// Uang selalu integer Rupiah (IDR tidak memakai pecahan dalam praktik). Tidak pernah float.
// Di database: BIGINT. Lihat docs/adr/0003-money.md.

export type Idr = number;

export function assertIdr(n: number): asserts n is Idr {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Nilai rupiah tidak valid: ${n}`);
}

/** Persentase dengan pembulatan ke bawah (sisa pembulatan diserahkan ke pemanggil). */
export function pct(amount: Idr, percent: number): Idr {
  return Math.floor((amount * Math.round(percent * 100)) / 10000);
}

export function formatIdr(n: number): string {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

export interface Share {
  partyId: string;
  pct: number; // 0..100, boleh desimal 2 digit
}

/** Validasi total split = 100% (REQ-STU-02, rights_shares per type). */
export function validateShares(shares: Share[]): { ok: boolean; total: number } {
  const total = Math.round(shares.reduce((s, x) => s + x.pct * 100, 0)) / 100;
  return { ok: Math.abs(total - 100) < 0.001 && shares.every((s) => s.pct > 0), total };
}

/**
 * Alokasi jumlah ke beberapa pihak dengan metode largest remainder agar
 * jumlah hasil selalu persis sama dengan input (penting untuk ledger).
 */
export function allocate(amount: Idr, shares: Share[]): { partyId: string; amount: Idr }[] {
  if (shares.length === 0) return [];
  const totalBp = shares.reduce((s, x) => s + Math.round(x.pct * 100), 0);
  const raw = shares.map((s) => {
    const exact = (amount * Math.round(s.pct * 100)) / totalBp;
    return { partyId: s.partyId, floor: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let left = amount - raw.reduce((s, r) => s + r.floor, 0);
  const order = [...raw.keys()].sort((a, b) => raw[b].rem - raw[a].rem);
  for (const i of order) {
    if (left <= 0) break;
    raw[i].floor += 1;
    left -= 1;
  }
  return raw.map((r) => ({ partyId: r.partyId, amount: r.floor }));
}

// ---- Komisi off-air (Bab 4.1, keputusan D-02 masih terbuka → parameter) ----
export interface CommissionPolicy {
  promotorServiceFeePct: number; // dibebankan ke promotor di atas fee
  artistCommissionPct: number; // dipotong dari fee artis
}
export const DEFAULT_COMMISSION: CommissionPolicy = { promotorServiceFeePct: 4, artistCommissionPct: 7 };
export const PRO_COMMISSION: CommissionPolicy = { promotorServiceFeePct: 3, artistCommissionPct: 5 };

export function bookingInvoice(fee: Idr, dpPct: number, policy: CommissionPolicy = DEFAULT_COMMISSION) {
  const serviceFee = pct(fee, policy.promotorServiceFeePct);
  const dp = pct(fee, dpPct);
  const settlement = fee - dp;
  return {
    fee,
    serviceFee,
    dp,
    settlement,
    totalPromotor: fee + serviceFee,
    artistCommission: pct(fee, policy.artistCommissionPct),
  };
}

/** PPh: 21 untuk orang pribadi (disederhanakan 2,5% efektif), 23 untuk badan 2% — wajib dikonfirmasi konsultan pajak (§8.5). */
export function withholdingTax(gross: Idr, payee: 'individual' | 'company'): Idr {
  return pct(gross, payee === 'company' ? 2 : 2.5);
}
