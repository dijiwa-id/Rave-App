// Matriks pembatalan default — BRD §7.3 (dapat dikustomisasi per kontrak).
import type { Idr } from './money.js';

export type CancelParty = 'promotor' | 'artist' | 'force_majeure';

export interface CancellationInput {
  party: CancelParty;
  daysBeforeEvent: number;
  dpPaid: Idr;
  settlementPaid: Idr;
  /** Kompensasi tambahan bila artis membatalkan (% fee, kontrak 25–100%). */
  artistPenaltyPct?: number;
  fee?: Idr;
  /** Biaya riil yang sudah dikeluarkan artis (force majeure). */
  incurredCosts?: Idr;
  /**
   * Manajemen membatalkan karena pelunasan promotor terlambat (status AT_RISK, BRD §7.2): DP hangus ke artis sesuai
   * kontrak, pelunasan yang sudah masuk (bila ada) dikembalikan, tanpa denda artis.
   */
  settlementLate?: boolean;
}

export interface CancellationOutcome {
  toArtist: Idr;
  refundToPromotor: Idr;
  artistPenalty: Idr; // ditagihkan ke artis, dibayarkan ke promotor
  holdForReschedule: boolean;
  rule: string;
}

export function computeCancellation(i: CancellationInput): CancellationOutcome {
  const paid = i.dpPaid + i.settlementPaid;
  if (i.party === 'artist' && i.settlementLate) {
    return { toArtist: i.dpPaid, refundToPromotor: i.settlementPaid, artistPenalty: 0, holdForReschedule: false, rule: 'SETTLEMENT_LATE' };
  }
  if (i.party === 'artist') {
    const penalty = i.fee ? Math.floor((i.fee * (i.artistPenaltyPct ?? 25)) / 100) : 0;
    return { toArtist: 0, refundToPromotor: paid, artistPenalty: penalty, holdForReschedule: false, rule: 'ARTIST_ANYTIME' };
  }
  if (i.party === 'force_majeure') {
    const cost = Math.min(i.incurredCosts ?? 0, paid);
    return { toArtist: cost, refundToPromotor: paid - cost, artistPenalty: 0, holdForReschedule: true, rule: 'FORCE_MAJEURE' };
  }
  if (i.daysBeforeEvent > 30) {
    const forfeit = Math.floor(i.dpPaid / 2);
    return {
      toArtist: forfeit,
      refundToPromotor: i.dpPaid - forfeit + i.settlementPaid,
      artistPenalty: 0,
      holdForReschedule: false,
      rule: 'PROMOTOR_GT_30D',
    };
  }
  if (i.daysBeforeEvent >= 14) {
    const settleForfeit = Math.floor(i.settlementPaid / 2);
    return {
      toArtist: i.dpPaid + settleForfeit,
      refundToPromotor: i.settlementPaid - settleForfeit,
      artistPenalty: 0,
      holdForReschedule: false,
      rule: 'PROMOTOR_14_30D',
    };
  }
  return { toArtist: paid, refundToPromotor: 0, artistPenalty: 0, holdForReschedule: false, rule: 'PROMOTOR_LT_14D' };
}
