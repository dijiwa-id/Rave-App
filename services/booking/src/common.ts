import pg from 'pg';
import { config, forbidden, isAdmin, managedArtistIds, type AuthUser } from '@gema/service-kit';

// Kolom DATE dikembalikan sebagai string 'YYYY-MM-DD' (bukan Date lokal yang bergeser zona).
pg.types.setTypeParser(1082, (v) => v);

/**
 * Jam dipercepat untuk demo lokal (default aktif bila NODE_ENV≠production; matikan dengan GEMA_FAST_CLOCK=0):
 * - show-done boleh kapan saja setelah BOOKED_AND_SECURED (sistem memajukan ke SHOW_DAY),
 * - jendela auto-complete 24 jam diperpendek jadi 60 detik.
 */
export const FAST_CLOCK = (process.env.GEMA_FAST_CLOCK ?? (config.isDev ? '1' : '0')) === '1';
export const AUTO_COMPLETE_MS = FAST_CLOCK ? 60_000 : 24 * 3600_000;
export const RATING_REVEAL_DAYS = 14;

export type Party = 'promotor' | 'management' | 'admin';

export interface BookingRow {
  id: string;
  artist_id: string;
  artist_org_id: string | null;
  promotor_org_id: string;
  promotor_user_id: string;
  promotor_contact: { name?: string; email?: string; phone?: string };
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

export function canManageArtist(u: AuthUser | null, artistId: string): boolean {
  return isAdmin(u) || managedArtistIds(u).includes(artistId);
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
