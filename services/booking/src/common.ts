import pg from 'pg';
import { commissionFor, type CommissionPolicy } from '@rave/domain';
import { config, forbidden, isAdmin, managedArtistIds, settings, type AuthUser } from '@rave/service-kit';

// Kolom DATE dikembalikan sebagai string 'YYYY-MM-DD' (bukan Date lokal yang bergeser zona).
pg.types.setTypeParser(1082, (v) => v);

/**
 * Jam dipercepat untuk demo lokal (default aktif bila NODE_ENV≠production; matikan dengan RAVE_FAST_CLOCK=0):
 * - show-done boleh kapan saja setelah BOOKED_AND_SECURED (sistem memajukan ke SHOW_DAY),
 * - jendela auto-complete 24 jam diperpendek jadi 60 detik.
 */
export const FAST_CLOCK = (process.env.RAVE_FAST_CLOCK ?? (config.isDev ? '1' : '0')) === '1';
export const AUTO_COMPLETE_MS = FAST_CLOCK ? 60_000 : 24 * 3600_000;
export const RATING_REVEAL_DAYS = 14;

/** Take rate off-air standar dari pengaturan platform (Super Admin → Komisi & Biaya). */
export const commissionPolicy = (): CommissionPolicy => ({
  promotorServiceFeePct: settings.num('commission.promotor_service_fee_pct'),
  artistCommissionPct: settings.num('commission.artist_commission_pct'),
});
/** Take rate RAVE Pro (Super Admin → Pengaturan Layanan → RAVE Pro). */
export const proCommissionPolicy = (): CommissionPolicy => ({
  promotorServiceFeePct: settings.num('subscription.pro_promotor_service_fee_pct'),
  artistCommissionPct: settings.num('subscription.pro_artist_commission_pct'),
});

type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
export interface BookingCommission extends CommissionPolicy {
  /** Pihak yang mendapat tarif RAVE Pro (untuk ditampilkan di rincian & kontrak). */
  pro: { promotor: boolean; artist: boolean };
  locked: boolean;
}

/** Org berlangganan RAVE Pro (hak berlaku termasuk masa tenggang) menurut proyeksi finance.pro.changed. */
async function proOrgs(c: Q, ids: (string | null | undefined)[]): Promise<Set<string>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Set();
  const r = await c.query(`SELECT id FROM orgs WHERE id = ANY($1::uuid[]) AND pro_plan IS NOT NULL AND (pro_until IS NULL OR pro_until > now())`, [list]);
  return new Set(r.rows.map((x) => x.id));
}

/**
 * Take rate satu booking (BRD §4.1): service fee promotor turun bila org promotor RAVE Pro; komisi artis turun bila org artis
 * atau manajemen yang mengelola artis RAVE Pro. Setelah kontrak dibuat tarif dikunci di booking (tidak berubah walau
 * langganan berakhir/berubah sebelum pencairan) — kontrak adalah sumber kebenaran.
 */
export async function bookingCommission(c: Q, b: Pick<BookingRow, 'artist_id' | 'artist_org_id' | 'promotor_org_id'> & Partial<Pick<BookingRow, 'commission_promotor_pct' | 'commission_artist_pct' | 'commission_pro'>>): Promise<BookingCommission> {
  if (b.commission_promotor_pct != null && b.commission_artist_pct != null)
    return {
      promotorServiceFeePct: Number(b.commission_promotor_pct),
      artistCommissionPct: Number(b.commission_artist_pct),
      pro: { promotor: !!b.commission_pro?.promotor, artist: !!b.commission_pro?.artist },
      locked: true,
    };
  const mgmt = (await c.query(`SELECT f.party_id FROM fee_splits f JOIN orgs o ON o.id = f.party_id WHERE f.artist_id=$1 AND o.type IN ('MANAGEMENT','LABEL')`, [b.artist_id])).rows.map((r) => r.party_id);
  const pro = await proOrgs(c, [b.promotor_org_id, b.artist_org_id, ...mgmt]);
  const parties = { promotorPro: pro.has(b.promotor_org_id), artistPro: (!!b.artist_org_id && pro.has(b.artist_org_id)) || mgmt.some((m) => pro.has(m)) };
  return { ...commissionFor(commissionPolicy(), proCommissionPolicy(), parties), pro: { promotor: parties.promotorPro, artist: parties.artistPro }, locked: false };
}

export type Party = 'promotor' | 'management' | 'admin';

export interface BookingRow {
  id: string;
  artist_id: string;
  artist_org_id: string | null;
  promotor_org_id: string;
  promotor_user_id: string;
  promotor_contact: { name?: string; email?: string; phone?: string };
  commission_promotor_pct?: string | number | null;
  commission_artist_pct?: string | number | null;
  commission_pro?: { promotor?: boolean; artist?: boolean } | null;
  status: string;
  prev_status: string | null;
  event_name: string;
  event_date: string;
  start_time: string;
  duration_min: number;
  city: string;
  venue: string;
  capacity: number;
  category: string;
  format: string;
  budget: number;
  notes: string | null;
  hold_expires_at: string | null;
  latest_offer_id: string | null;
  latest_fee: number | null;
  agreed_fee: number | null;
  dp_pct: number;
  settlement_days_before: number;
  dp_paid: number;
  settlement_paid: number;
  show_done_promotor: boolean;
  show_done_management: boolean;
  show_day_at: string | null;
  completed_at: string | null;
  cancellation: unknown;
  source: string;
  created_at: string;
  updated_at: string;
}

/** Mengelola artis = anggota org artis/manajemen yang mengelolanya. Admin back office tidak (audit go-live A1). */
export function canManageArtist(u: AuthUser | null, artistId: string): boolean {
  return !!u?.roles.includes('service') || managedArtistIds(u).includes(artistId);
}
export function assertManageArtist(u: AuthUser | null, artistId: string) {
  if (!canManageArtist(u, artistId)) throw forbidden('Anda tidak mengelola artis ini');
}
export function isPromotorMember(u: AuthUser | null, orgId: string): boolean {
  return !!u?.orgs.some((o) => o.id === orgId && o.type === 'PROMOTOR');
}
/** Promotor terverifikasi (KYC lolos) — berhak melihat metrik & rate card terbatas. */
export function isVerifiedPromotor(u: AuthUser | null): boolean {
  return !!u && !!u.kyc && u.orgs.some((o) => o.type === 'PROMOTOR');
}

export function partyOf(u: AuthUser | null, b: Pick<BookingRow, 'artist_id' | 'promotor_org_id'>): Party | null {
  if (!u) return null;
  if (isPromotorMember(u, b.promotor_org_id)) return 'promotor';
  if (managedArtistIds(u).includes(b.artist_id)) return 'management';
  if (isAdmin(u)) return 'admin';
  return null;
}
export function requireParty(u: AuthUser | null, b: BookingRow, allowAdmin = true): Party {
  const p = partyOf(u, b);
  if (!p || (p === 'admin' && !allowAdmin)) throw forbidden('Bukan pihak dalam booking ini');
  return p;
}

export function daysUntil(date: string, now = new Date()): number {
  const d = new Date(date + 'T00:00:00+07:00').getTime();
  return Math.floor((d - now.getTime()) / 86_400_000);
}
export function todayWib(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}
