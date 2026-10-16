import {
  bookingInvoice,
  computeContractTax,
  requiresEMeterai,
  termAmounts,
  termDueDate,
  validateFeeSplit,
  validateTerms,
  type FeeSplit,
  type PaymentTerm,
  type TaxPayee,
  type ValueBasis,
} from '@gema/domain';
import { settings, type Client } from '@gema/service-kit';
import { commissionPolicy, todayWib, type BookingRow } from './common.js';
import { managementOrgId } from './repo.js';

export const SPK_TEMPLATE_ID = 'spk';
export const SPK_TEMPLATE_VERSION = 'spk-v2';

/** Variabel yang boleh diedit lewat whitelist (lihat CONTRACT_EDITABLE_FIELDS di domain). */
export interface ContractTerms {
  fee: number;
  value_basis: ValueBasis;
  payment_terms: PaymentTerm[];
  special_clauses: string;
  require_artist_ack: boolean;
  fee_split: FeeSplit;
}

export interface PartyData {
  org_id: string | null;
  legal_name: string;
  rep_name: string;
  rep_title: string | null;
  nik_mask: string | null; // hanya versi samar yang masuk snapshot
  npwp_mask: string | null;
  address: string | null;
  email: string | null;
  whatsapp: string | null;
  bank?: { name: string; account_mask: string; holder: string } | null;
}

/** Snapshot seluruh variabel yang dipakai saat render. JSON murni; tidak memuat data sensitif utuh. */
export interface ContractData {
  contract_no: string;
  version: number;
  template: { id: string; version: string };
  generated_at: string;
  booking: {
    id: string;
    event_name: string;
    category: string;
    event_date: string;
    start_time: string;
    duration_min: number;
    venue: string;
    city: string;
    capacity: number;
    format: string;
  };
  promotor: PartyData;
  management: PartyData;
  artist: { id: string; stage_name: string; city: string | null };
  terms: ContractTerms;
  schedule: { label: string; pct: number; amount: number; due_date: string; due_text: string }[];
  money: {
    fee: number;
    service_fee: number;
    total_promotor: number;
    tax: { kind: 'PPH21' | 'PPH23'; pct: number; gross: number; tax: number; nett: number; payee: TaxPayee };
    emeterai: { required: boolean; threshold: number; payer: string };
  };
  rider: {
    hospitality: Record<string, unknown>;
    technical: Record<string, unknown>;
    hospitality_version: number | null; // null = disalin dari EPK (belum ada rider berversi)
    technical_version: number | null;
    notes: string | null;
  };
  commission: { promotor_service_fee_pct: number; artist_commission_pct: number };
}

const HOSPITALITY_KEYS = ['hospitality', 'personnel'];

function splitRider(rider: Record<string, any>) {
  const hospitality: Record<string, unknown> = {};
  const technical: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rider ?? {})) (HOSPITALITY_KEYS.includes(k) ? hospitality : technical)[k] = v;
  return { hospitality, technical };
}

async function legalOf(c: Client, orgId: string | null, kind: 'PROMOTOR' | 'MANAGEMENT', fallbackName: string, fallbackRep?: string): Promise<PartyData> {
  const lp = orgId ? (await c.query(`SELECT * FROM legal_profiles WHERE org_id=$1 AND kind=$2`, [orgId, kind])).rows[0] : null;
  return {
    org_id: orgId,
    legal_name: lp?.legal_name ?? fallbackName,
    rep_name: lp?.rep_name ?? fallbackRep ?? '-',
    rep_title: lp?.rep_title ?? null,
    nik_mask: lp?.nik_mask ?? null,
    npwp_mask: lp?.npwp_mask ?? null,
    address: lp?.address ?? null,
    email: lp?.email ?? null,
    whatsapp: lp?.whatsapp ?? null,
    bank: kind === 'MANAGEMENT' && lp?.bank_name ? { name: lp.bank_name, account_mask: lp.bank_account_mask ?? '****', holder: lp.bank_holder ?? lp.legal_name } : null,
  };
}

function dueText(t: PaymentTerm, days: number): string {
  if (t.due.type === 'ON_SIGN') return `paling lambat ${days}×24 jam setelah kontrak ditandatangani`;
  if (t.due.type === 'EVENT_DAY') return 'pada hari-H pertunjukan';
  return `paling lambat H-${t.due.days} sebelum pertunjukan`;
}
const SIGN_GRACE_DAYS = 3;

/** Termin bawaan dari kesepakatan negosiasi (DP% + pelunasan H-n). */
export function defaultTerms(b: BookingRow, fee: number, mgmtPct: number | null): ContractTerms {
  const dp = b.dp_pct;
  const payment_terms: PaymentTerm[] = [{ label: 'Down Payment (DP)', pct: dp, due: { type: 'ON_SIGN' } }];
  if (dp < 100) payment_terms.push({ label: 'Pelunasan', pct: 100 - dp, due: { type: 'DAYS_BEFORE_EVENT', days: b.settlement_days_before } });
  const platform_pct = commissionPolicy().artistCommissionPct;
  const management_pct = mgmtPct ?? 0;
  return {
    fee,
    value_basis: 'GROSS',
    payment_terms,
    special_clauses: '',
    require_artist_ack: false,
    fee_split: { management_pct, artist_pct: Math.round((100 - management_pct - platform_pct) * 100) / 100, platform_pct },
  };
}

/** Validasi semua aturan angka; melempar Error ber-pesan Indonesia (pemanggil mengubahnya jadi 422). */
export function assertTermsValid(t: ContractTerms): void {
  if (!Number.isSafeInteger(t.fee) || t.fee <= 0) throw new Error('Nilai kontrak tidak valid');
  const v = validateTerms(t.payment_terms);
  if (!v.ok) throw new Error(v.errors.join('; '));
  if (!validateFeeSplit(t.fee_split).ok) throw new Error('Total split fee harus 100%');
  if (t.special_clauses.length > 4000) throw new Error('Klausul khusus terlalu panjang (maks 4000 karakter)');
}

export function contractNumber(bookingId: string, now = new Date()): string {
  const ym = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 7).replace('-', '');
  return `GEMA/SPK/${ym}/${bookingId.replace(/-/g, '').slice(-8).toUpperCase()}`;
}

/**
 * Kumpulkan seluruh variabel kontrak. Rider disalin sebagai snapshot versi terbaru (rider_versions) saat generate;
 * bila artis belum punya rider berversi, jatuh ke rider di EPK. Pajak/termin/jatuh tempo dihitung di sini (backend),
 * bukan diterima dari klien.
 */
export async function buildContractData(
  c: Client,
  b: BookingRow,
  opts: { version: number; terms?: ContractTerms; riderNotes?: string | null; now?: Date },
): Promise<ContractData> {
  const now = opts.now ?? new Date();
  const fee = opts.terms?.fee ?? b.agreed_fee!;
  const artist = (await c.query(`SELECT id, name, city FROM artists WHERE id=$1`, [b.artist_id])).rows[0];
  const promoOrg = (await c.query(`SELECT name FROM orgs WHERE id=$1`, [b.promotor_org_id])).rows[0];
  const mgmtId = await managementOrgId(c, b);
  const epk = (await c.query(`SELECT content, contact FROM epk WHERE artist_id=$1`, [b.artist_id])).rows[0];

  const promotor = await legalOf(c, b.promotor_org_id, 'PROMOTOR', promoOrg?.name ?? 'Promotor', b.promotor_contact?.name);
  const management = await legalOf(c, mgmtId, 'MANAGEMENT', epk?.contact?.name ?? `Manajemen ${artist?.name ?? ''}`.trim(), epk?.contact?.name);
  const mgmtPct = mgmtId ? (await c.query(`SELECT mgmt_fee_pct FROM legal_profiles WHERE org_id=$1 AND kind='MANAGEMENT'`, [mgmtId])).rows[0]?.mgmt_fee_pct : null;

  const terms = opts.terms ?? defaultTerms(b, fee, mgmtPct == null ? null : Number(mgmtPct));
  assertTermsValid(terms);

  // Rider berversi (terbaru per jenis); fallback EPK.
  const rv = (await c.query(
    `SELECT DISTINCT ON (kind) kind, version, content FROM rider_versions WHERE artist_id=$1 ORDER BY kind, version DESC`,
    [b.artist_id],
  )).rows;
  const hosp = rv.find((r) => r.kind === 'hospitality');
  const tech = rv.find((r) => r.kind === 'technical');
  const fallback = splitRider(epk?.content?.rider ?? {});

  const payee: TaxPayee = 'company'; // penerima fee adalah badan manajemen (PPh 23); artis perorangan menerima lewat split internal
  const tax = computeContractTax(fee, terms.value_basis, payee, { pph21Pct: settings.num('contract.pph21_pct'), pph23Pct: settings.num('contract.pph23_pct') });
  const inv = bookingInvoice(tax.gross, terms.payment_terms[0].pct, commissionPolicy());
  const threshold = settings.num('contract.emeterai_threshold');

  const signDate = todayWib();
  const amounts = termAmounts(tax.gross, terms.payment_terms);
  const schedule = terms.payment_terms.map((t, i) => ({
    label: t.label,
    pct: t.pct,
    amount: amounts[i],
    due_date: termDueDate(t.due, b.event_date, signDate, SIGN_GRACE_DAYS),
    due_text: dueText(t, SIGN_GRACE_DAYS),
  }));

  return {
    contract_no: contractNumber(b.id, now),
    version: opts.version,
    template: { id: SPK_TEMPLATE_ID, version: SPK_TEMPLATE_VERSION },
    generated_at: now.toISOString(),
    booking: {
      id: b.id,
      event_name: b.event_name,
      category: b.category,
      event_date: b.event_date,
      start_time: b.start_time,
      duration_min: b.duration_min,
      venue: b.venue,
      city: b.city,
      capacity: b.capacity,
      format: b.format,
    },
    promotor,
    management,
    artist: { id: artist.id, stage_name: artist.name, city: artist.city },
    terms: { ...terms, fee },
    schedule,
    money: {
      fee: tax.gross,
      service_fee: inv.serviceFee,
      total_promotor: tax.gross + inv.serviceFee,
      tax: { kind: tax.kind, pct: tax.taxPct, gross: tax.gross, tax: tax.tax, nett: tax.nett, payee },
      emeterai: { required: requiresEMeterai(tax.gross, threshold), threshold, payer: settings.get<string>('contract.emeterai_payer') },
    },
    rider: {
      hospitality: hosp?.content ?? fallback.hospitality,
      technical: tech?.content ?? fallback.technical,
      hospitality_version: hosp?.version ?? null,
      technical_version: tech?.version ?? null,
      notes: opts.riderNotes ?? null,
    },
    commission: { promotor_service_fee_pct: commissionPolicy().promotorServiceFeePct, artist_commission_pct: commissionPolicy().artistCommissionPct },
  };
}
