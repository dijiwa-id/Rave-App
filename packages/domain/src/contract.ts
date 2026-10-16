// Generated Contract (SPK booking artis) — aturan murni: state machine kontrak, termin, split, pajak, whitelist, diff versi.
// Status kontrak berdiri sendiri; status booking (booking.ts) mengikutinya: CONTRACT_SENT selama kontrak belum ACTIVE, SIGNED saat ACTIVE.
// Lihat docs/generated-contract.md untuk asumsi.

import { pct, type Idr } from './money.js';

// ---------- State machine kontrak ----------
export const CONTRACT_STATUSES = [
  'CONTRACT_GENERATED',
  'AWAITING_PROMOTOR_SIGN',
  'AWAITING_MANAGEMENT_SIGN',
  'AWAITING_ARTIST_ACK',
  'ACTIVE',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export type ContractActor = 'promotor' | 'management' | 'artist' | 'system';
export type SignParty = 'promotor' | 'management' | 'artist';

interface ContractTransition {
  from: ContractStatus | ContractStatus[];
  to: ContractStatus;
  actors: ContractActor[];
  description: string;
}

const OPEN: ContractStatus[] = ['CONTRACT_GENERATED', 'AWAITING_PROMOTOR_SIGN', 'AWAITING_MANAGEMENT_SIGN', 'AWAITING_ARTIST_ACK'];

export const CONTRACT_TRANSITIONS: ContractTransition[] = [
  { from: 'CONTRACT_GENERATED', to: 'AWAITING_PROMOTOR_SIGN', actors: ['management'], description: 'Manajemen meninjau pratinjau PDF lalu mengirim ke promotor' },
  { from: 'AWAITING_PROMOTOR_SIGN', to: 'AWAITING_MANAGEMENT_SIGN', actors: ['system'], description: 'Promotor menandatangani' },
  { from: 'AWAITING_MANAGEMENT_SIGN', to: 'AWAITING_ARTIST_ACK', actors: ['system'], description: 'Manajemen menandatangani; artis wajib mengetahui' },
  { from: 'AWAITING_MANAGEMENT_SIGN', to: 'ACTIVE', actors: ['system'], description: 'Manajemen menandatangani; tanpa acknowledgement artis' },
  { from: 'AWAITING_ARTIST_ACK', to: 'ACTIVE', actors: ['system'], description: 'Artis mengetahui' },
  { from: 'CONTRACT_GENERATED', to: 'REJECTED', actors: ['management'], description: 'Manajemen membuang draf untuk direvisi (versi baru)' },
  { from: 'AWAITING_PROMOTOR_SIGN', to: 'REJECTED', actors: ['promotor'], description: 'Promotor menolak draf, minta revisi (versi baru)' },
  { from: OPEN, to: 'CANCELLED', actors: ['promotor', 'management'], description: 'Dibatalkan sebelum aktif' },
  { from: OPEN, to: 'EXPIRED', actors: ['system'], description: 'Melewati batas waktu tanda tangan' },
];

export function findContractTransition(from: ContractStatus, to: ContractStatus) {
  return CONTRACT_TRANSITIONS.find((t) => (Array.isArray(t.from) ? t.from.includes(from) : t.from === from) && t.to === to);
}
export function canContractTransition(from: ContractStatus, to: ContractStatus, actor: ContractActor): boolean {
  return !!findContractTransition(from, to)?.actors.includes(actor);
}
export class InvalidContractTransitionError extends Error {
  constructor(public from: ContractStatus, public to: ContractStatus, public actor: ContractActor) {
    super(`Transisi kontrak ${from} → ${to} tidak diizinkan untuk aktor ${actor}`);
  }
}
export function assertContractTransition(from: ContractStatus, to: ContractStatus, actor: ContractActor): void {
  if (!canContractTransition(from, to, actor)) throw new InvalidContractTransitionError(from, to, actor);
}

/** Kontrak ACTIVE dan semua status akhir tidak boleh diubah (perubahan hanya lewat addendum). */
export const CONTRACT_TERMINAL: ContractStatus[] = ['ACTIVE', 'REJECTED', 'CANCELLED', 'EXPIRED'];
export const isContractLocked = (s: ContractStatus) => CONTRACT_TERMINAL.includes(s);

/** Pihak yang berhak menandatangani pada status tertentu (urutan: Promotor → Manajemen → Artis). */
export function expectedSigner(s: ContractStatus): SignParty | null {
  switch (s) {
    case 'AWAITING_PROMOTOR_SIGN':
      return 'promotor';
    case 'AWAITING_MANAGEMENT_SIGN':
      return 'management';
    case 'AWAITING_ARTIST_ACK':
      return 'artist';
    default:
      return null;
  }
}

/** Status berikutnya setelah `signer` menandatangani; melempar bila bukan gilirannya. */
export function statusAfterSign(s: ContractStatus, signer: SignParty, requireArtistAck: boolean): ContractStatus {
  if (expectedSigner(s) !== signer) throw new Error(`Bukan giliran ${signer} menandatangani (status ${s})`);
  if (s === 'AWAITING_PROMOTOR_SIGN') return 'AWAITING_MANAGEMENT_SIGN';
  if (s === 'AWAITING_MANAGEMENT_SIGN') return requireArtistAck ? 'AWAITING_ARTIST_ACK' : 'ACTIVE';
  return 'ACTIVE';
}

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  CONTRACT_GENERATED: 'Draf Dibuat',
  AWAITING_PROMOTOR_SIGN: 'Menunggu Tanda Tangan Promotor',
  AWAITING_MANAGEMENT_SIGN: 'Menunggu Tanda Tangan Manajemen',
  AWAITING_ARTIST_ACK: 'Menunggu Artis',
  ACTIVE: 'Kontrak Aktif',
  REJECTED: 'Ditolak (Revisi)',
  CANCELLED: 'Dibatalkan',
  EXPIRED: 'Kedaluwarsa',
};

/** Langkah progress bar Status Tracker. Langkah artis hanya ada bila acknowledgement diwajibkan. */
export function trackerSteps(requireArtistAck: boolean): ContractStatus[] {
  return requireArtistAck
    ? ['AWAITING_PROMOTOR_SIGN', 'AWAITING_MANAGEMENT_SIGN', 'AWAITING_ARTIST_ACK', 'ACTIVE']
    : ['AWAITING_PROMOTOR_SIGN', 'AWAITING_MANAGEMENT_SIGN', 'ACTIVE'];
}

// ---------- Termin pembayaran & split fee ----------
export type TermDue = { type: 'ON_SIGN' } | { type: 'DAYS_BEFORE_EVENT'; days: number } | { type: 'EVENT_DAY' };
export interface PaymentTerm {
  label: string;
  pct: number; // 0..100, maks 2 desimal
  due: TermDue;
}

const bp = (n: number) => Math.round(n * 100);

/** Total termin wajib 100% dan tiap termin > 0. Termin pertama harus ON_SIGN (menjadi dasar invoice DP). */
export function validateTerms(terms: PaymentTerm[]): { ok: boolean; total: number; errors: string[] } {
  const errors: string[] = [];
  const total = terms.reduce((s, t) => s + bp(t.pct), 0) / 100;
  if (terms.length === 0) errors.push('Minimal satu termin');
  if (terms.some((t) => !(t.pct > 0))) errors.push('Persentase termin harus > 0');
  if (terms.some((t) => t.due.type === 'DAYS_BEFORE_EVENT' && (!Number.isInteger(t.due.days) || t.due.days < 0))) errors.push('Jatuh tempo H-n tidak valid');
  if (terms.length > 0 && terms[0].due.type !== 'ON_SIGN') errors.push('Termin pertama harus jatuh tempo saat tanda tangan');
  if (Math.abs(total - 100) > 0.001) errors.push(`Total termin ${total}% (harus 100%)`);
  return { ok: errors.length === 0, total, errors };
}

/** Pecah nilai kontrak per termin; sisa pembulatan masuk ke termin terakhir sehingga jumlah selalu persis. */
export function termAmounts(value: Idr, terms: PaymentTerm[]): Idr[] {
  const out = terms.map((t) => pct(value, t.pct));
  const rest = value - out.reduce((s, n) => s + n, 0);
  if (out.length) out[out.length - 1] += rest;
  return out;
}

/** Tanggal jatuh tempo (YYYY-MM-DD, WIB) satu termin; ON_SIGN dihitung dari tanggal tanda tangan + graceDays. */
export function termDueDate(due: TermDue, eventDate: string, signDate: string, graceDays = 3): string {
  const shift = (d: string, days: number) => new Date(new Date(d + 'T00:00:00Z').getTime() + days * 86_400_000).toISOString().slice(0, 10);
  if (due.type === 'ON_SIGN') return shift(signDate, graceDays);
  if (due.type === 'EVENT_DAY') return eventDate;
  return shift(eventDate, -due.days);
}

export interface FeeSplit {
  management_pct: number;
  artist_pct: number;
  platform_pct: number;
}
export function validateFeeSplit(s: FeeSplit): { ok: boolean; total: number } {
  const parts = [s.management_pct, s.artist_pct, s.platform_pct];
  const total = parts.reduce((a, n) => a + bp(n), 0) / 100;
  return { ok: parts.every((n) => n >= 0) && Math.abs(total - 100) < 0.001, total };
}

// ---------- Pajak & e-Meterai (dihitung di backend; tarif dari pengaturan platform) ----------
export interface TaxRates {
  pph21Pct: number; // penerima orang pribadi
  pph23Pct: number; // penerima badan
}
export type TaxPayee = 'individual' | 'company';
export type ValueBasis = 'GROSS' | 'NETT';

export interface TaxResult {
  gross: Idr;
  tax: Idr;
  nett: Idr;
  taxPct: number;
  kind: 'PPH21' | 'PPH23';
}

/**
 * Nilai kontrak bisa dinyatakan GROSS (pajak dipotong dari nilai) atau NETT (nilai diterima bersih; gross di-gross-up).
 * Pembulatan: gross-up dibulatkan ke atas agar nett yang diterima tidak kurang dari yang disepakati.
 */
export function computeContractTax(value: Idr, basis: ValueBasis, payee: TaxPayee, rates: TaxRates): TaxResult {
  const taxPct = payee === 'company' ? rates.pph23Pct : rates.pph21Pct;
  const kind = payee === 'company' ? 'PPH23' : 'PPH21';
  const gross = basis === 'GROSS' ? value : Math.ceil((value * 10000) / (10000 - bp(taxPct)));
  const tax = pct(gross, taxPct);
  return { gross, tax, nett: gross - tax, taxPct, kind };
}

/** e-Meterai wajib bila nilai dokumen melebihi ambang (default Rp 5.000.000). */
export function requiresEMeterai(value: Idr, threshold = 5_000_000): boolean {
  return value > threshold;
}

// ---------- Whitelist field & klausul terkunci ----------
export const CONTRACT_EDITABLE_FIELDS = {
  management: ['fee', 'value_basis', 'payment_terms', 'special_clauses', 'require_artist_ack', 'fee_split'],
  promotor: ['fee', 'payment_terms'], // counter-offer; klausul standar dan klausul khusus tidak boleh disentuh
} as const;
export type ContractEditor = keyof typeof CONTRACT_EDITABLE_FIELDS;

/** Klausul standar yang terkunci di templat — tidak bisa dipatch siapa pun lewat variabel. */
export const LOCKED_CLAUSES = ['force_majeure', 'cancellation_penalty', 'late_payment_penalty', 'copyright_documentation'] as const;

export class ForbiddenFieldError extends Error {
  constructor(public fields: string[]) {
    super(`Field tidak boleh diubah: ${fields.join(', ')}`);
  }
}

/** Tolak patch yang memuat field di luar whitelist editor (termasuk klausul terkunci). */
export function assertEditableFields(editor: ContractEditor, patch: Record<string, unknown>): void {
  const allowed = new Set<string>(CONTRACT_EDITABLE_FIELDS[editor]);
  const bad = Object.keys(patch).filter((k) => !allowed.has(k));
  if (bad.length) throw new ForbiddenFieldError(bad);
}

// ---------- Diff antar versi ----------
export interface VarChange {
  path: string;
  before: unknown;
  after: unknown;
}
function flatten(v: unknown, path: string, out: Map<string, unknown>) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(x, path ? `${path}.${k}` : k, out);
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => flatten(x, `${path}[${i}]`, out));
    if (v.length === 0) out.set(path, []);
  } else out.set(path, v);
}
/** Perbedaan variabel antara dua snapshot data (untuk Riwayat Versi). Urutan stabil menurut path. */
export function diffSnapshots(before: unknown, after: unknown): VarChange[] {
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  flatten(before, '', a);
  flatten(after, '', b);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  return paths
    .filter((p) => JSON.stringify(a.get(p)) !== JSON.stringify(b.get(p)))
    .map((path) => ({ path, before: a.get(path), after: b.get(path) }));
}
