// State machine booking off-air — BRD/TDD §7.1.
// Setiap transisi hanya boleh dipicu oleh aktor tertentu; service booking wajib
// memanggil assertTransition() sebelum mengubah status.

export const BOOKING_STATUSES = [
  'DRAFT',
  'INQUIRY',
  'NEGOTIATING',
  'AGREED',
  'CONTRACT_SENT',
  'SIGNED',
  'BOOKED',
  'BOOKED_AND_SECURED',
  'AT_RISK',
  'SHOW_DAY',
  'COMPLETED',
  'SETTLED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED_BY_PROMOTOR',
  'CANCELLED_BY_ARTIST',
  'FORCE_MAJEURE',
  'DISPUTED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export type BookingActor = 'promotor' | 'management' | 'system' | 'both' | 'admin';

interface Transition {
  from: BookingStatus | BookingStatus[];
  to: BookingStatus;
  actors: BookingActor[];
  description: string;
}

const POST_SIGN: BookingStatus[] = ['SIGNED', 'BOOKED', 'BOOKED_AND_SECURED', 'AT_RISK'];

export const BOOKING_TRANSITIONS: Transition[] = [
  { from: 'DRAFT', to: 'INQUIRY', actors: ['promotor'], description: 'Promotor (KYC lolos) mengirim inquiry' },
  { from: ['INQUIRY', 'NEGOTIATING'], to: 'NEGOTIATING', actors: ['management', 'promotor'], description: 'Offer / counter-offer' },
  { from: 'NEGOTIATING', to: 'AGREED', actors: ['management', 'promotor', 'both'], description: 'Fee, termin, rider disepakati' },
  { from: ['INQUIRY', 'NEGOTIATING'], to: 'DECLINED', actors: ['management', 'promotor'], description: 'Ditolak' },
  { from: ['AGREED', 'CONTRACT_SENT'], to: 'DECLINED', actors: ['management', 'promotor'], description: 'Batal sebelum kontrak ditandatangani (tanpa dana)' },
  { from: ['INQUIRY', 'NEGOTIATING'], to: 'EXPIRED', actors: ['system'], description: 'Melewati batas waktu respons/hold' },
  { from: 'AGREED', to: 'CONTRACT_SENT', actors: ['system'], description: 'Kontrak digenerate & dikirim' },
  { from: 'CONTRACT_SENT', to: 'SIGNED', actors: ['system', 'both'], description: 'Semua pihak menandatangani' },
  { from: 'SIGNED', to: 'BOOKED', actors: ['system'], description: 'DP diterima escrow' },
  { from: ['BOOKED', 'AT_RISK'], to: 'BOOKED_AND_SECURED', actors: ['system'], description: 'Pelunasan diterima' },
  { from: 'BOOKED', to: 'AT_RISK', actors: ['system'], description: 'Pelunasan terlambat' },
  { from: 'BOOKED_AND_SECURED', to: 'SHOW_DAY', actors: ['system'], description: 'Hari-H' },
  { from: 'SHOW_DAY', to: 'COMPLETED', actors: ['both', 'system'], description: 'Show Done dikonfirmasi / 24 jam tanpa keberatan' },
  { from: 'COMPLETED', to: 'SETTLED', actors: ['system'], description: 'H+1 tanpa dispute → disbursement' },
  { from: POST_SIGN, to: 'CANCELLED_BY_PROMOTOR', actors: ['promotor'], description: 'Dibatalkan promotor' },
  { from: POST_SIGN, to: 'CANCELLED_BY_ARTIST', actors: ['management'], description: 'Dibatalkan artis/manajemen' },
  { from: POST_SIGN, to: 'FORCE_MAJEURE', actors: ['admin', 'both'], description: 'Force majeure (terbukti dokumen)' },
  { from: [...POST_SIGN, 'SHOW_DAY', 'COMPLETED'], to: 'DISPUTED', actors: ['promotor', 'management'], description: 'Dispute dalam jendela' },
  { from: 'DISPUTED', to: 'SETTLED', actors: ['admin'], description: 'Keputusan mediasi: dana dicairkan' },
  { from: 'DISPUTED', to: 'CANCELLED_BY_ARTIST', actors: ['admin'], description: 'Keputusan mediasi: refund promotor' },
  { from: 'DISPUTED', to: 'CANCELLED_BY_PROMOTOR', actors: ['admin'], description: 'Keputusan mediasi: hangus ke artis' },
  { from: 'DISPUTED', to: 'FORCE_MAJEURE', actors: ['admin'], description: 'Keputusan mediasi: force majeure terbukti (biaya riil ke artis, sisa refund)' },
];

export function findTransition(from: BookingStatus, to: BookingStatus): Transition | undefined {
  return BOOKING_TRANSITIONS.find((t) => (Array.isArray(t.from) ? t.from.includes(from) : t.from === from) && t.to === to);
}

export function canTransition(from: BookingStatus, to: BookingStatus, actor: BookingActor): boolean {
  const t = findTransition(from, to);
  if (!t) return false;
  return actor === 'admin' ? t.actors.includes('admin') || t.actors.includes('system') : t.actors.includes(actor);
}

export class InvalidTransitionError extends Error {
  constructor(public from: BookingStatus, public to: BookingStatus, public actor: BookingActor) {
    super(`Transisi ${from} → ${to} tidak diizinkan untuk aktor ${actor}`);
  }
}

export function assertTransition(from: BookingStatus, to: BookingStatus, actor: BookingActor): void {
  if (!canTransition(from, to, actor)) throw new InvalidTransitionError(from, to, actor);
}

export const TERMINAL_STATUSES: BookingStatus[] = [
  'SETTLED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED_BY_PROMOTOR',
  'CANCELLED_BY_ARTIST',
  'FORCE_MAJEURE',
];

// ---- Kalender (REQ-B2B-02) ----
export const CALENDAR_STATUSES = [
  'AVAILABLE',
  'HOLD_1',
  'HOLD_2',
  'PENDING_CONTRACT',
  'BOOKED',
  'BOOKED_AND_SECURED',
  'BLOCKED',
  'TRAVEL',
] as const;
export type CalendarStatus = (typeof CALENDAR_STATUSES)[number];

/** Status kalender yang tidak boleh tumpang tindih (dijaga exclusion constraint di DB). */
export const EXCLUSIVE_CALENDAR_STATUSES: CalendarStatus[] = ['PENDING_CONTRACT', 'BOOKED', 'BOOKED_AND_SECURED', 'BLOCKED'];

/** Status kalender mengikuti status booking (§7.1). */
export function calendarStatusFor(status: BookingStatus): CalendarStatus | null {
  switch (status) {
    case 'AGREED':
    case 'CONTRACT_SENT':
    case 'SIGNED':
      return 'PENDING_CONTRACT';
    case 'BOOKED':
    case 'AT_RISK':
      return 'BOOKED';
    case 'BOOKED_AND_SECURED':
    case 'SHOW_DAY':
    case 'COMPLETED':
    case 'SETTLED':
    case 'DISPUTED':
      return 'BOOKED_AND_SECURED';
    default:
      return null;
  }
}

/** Kontak pribadi disamarkan sampai BOOKED (REQ-B2B-08). */
export function contactRevealed(status: BookingStatus): boolean {
  return ['BOOKED', 'BOOKED_AND_SECURED', 'AT_RISK', 'SHOW_DAY', 'COMPLETED', 'SETTLED', 'DISPUTED'].includes(status);
}

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  DRAFT: 'Draf',
  INQUIRY: 'Inquiry',
  NEGOTIATING: 'Negosiasi',
  AGREED: 'Disepakati',
  CONTRACT_SENT: 'Kontrak Dikirim',
  SIGNED: 'Ditandatangani',
  BOOKED: 'Booked (DP diterima)',
  BOOKED_AND_SECURED: 'Booked & Secured',
  AT_RISK: 'Berisiko (pelunasan telat)',
  SHOW_DAY: 'Hari-H',
  COMPLETED: 'Selesai',
  SETTLED: 'Dana Dicairkan',
  DECLINED: 'Ditolak',
  EXPIRED: 'Kedaluwarsa',
  CANCELLED_BY_PROMOTOR: 'Dibatalkan Promotor',
  CANCELLED_BY_ARTIST: 'Dibatalkan Artis',
  FORCE_MAJEURE: 'Force Majeure',
  DISPUTED: 'Dalam Sengketa',
};

export const EVENT_CATEGORIES = ['KAMPUS', 'PENSI', 'FESTIVAL', 'KORPORAT', 'WEDDING', 'CAFE_CLUB', 'SHOWCASE'] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export const PERFORMANCE_FORMATS = ['FULL_BAND', 'AKUSTIK', 'DJ_SOLO'] as const;
export type PerformanceFormat = (typeof PERFORMANCE_FORMATS)[number];
export const RATE_ZONES = ['DALAM_KOTA', 'JAWA', 'LUAR_JAWA', 'LUAR_NEGERI'] as const;
export type RateZone = (typeof RATE_ZONES)[number];

export const DEFAULT_HOLD_HOURS = 72;
export const DEFAULT_DP_PCT = 50;
export const DEFAULT_SETTLEMENT_DAYS_BEFORE = 7;
