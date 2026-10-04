// Kontrak event domain yang dipublikasikan lewat outbox → event bus.
// Nama topik: <bounded-context>.<entity>.<past-tense>. Payload bersifat additive (jangan hapus field).

export interface DomainEvents {
  // IAM
  'iam.user.registered': { userId: string; email: string; displayName: string; city?: string | null };
  'iam.user.onboarded': { userId: string; city: string; genres: string[]; artistIds: string[] };
  'iam.org.created': { orgId: string; type: OrgType; name: string; ownerUserId: string | null; artistId?: string | null };
  'iam.org.member_added': { orgId: string; type: OrgType; userId: string; role: string; artistId?: string | null };
  'iam.kyc.verified': { userId: string; orgId?: string | null; level: 'INDIVIDUAL' | 'BUSINESS' };
  'iam.waitlist.joined': { email: string; segment: string; city?: string | null };

  // Catalog
  'catalog.release.submitted': { releaseId: string; artistId: string; title: string };
  'catalog.release.published': { releaseId: string; artistId: string; title: string; trackIds: string[] };
  'catalog.release.rejected': { releaseId: string; artistId: string; reason: string };
  'catalog.artist.upserted': { artistId: string; name: string; slug: string; city: string | null; genres: string[]; orgId: string | null; imageUrl: string | null };

  // Library
  'library.artist.followed': { userId: string; artistId: string };
  'library.track.liked': { userId: string; trackId: string };

  // Playback & analytics
  'playback.stream.qualified': { userId: string; trackId: string; artistId: string; city: string | null; playedMs: number; at: string };

  // Booking (off-air)
  'booking.inquiry.created': { bookingId: string; artistId: string; promotorOrgId: string; eventDate: string; city: string; budget: number };
  'booking.offer.sent': { bookingId: string; artistId: string; promotorOrgId: string; byParty: 'promotor' | 'management'; fee: number };
  'booking.status.changed': { bookingId: string; artistId: string; promotorOrgId: string; from: string; to: string; fee: number; eventDate: string };
  'booking.contract.signed': {
    bookingId: string; contractId: string; fee: number; dpAmount: number; settlementAmount: number; serviceFee: number;
    promotorOrgId: string; artistId: string; managementOrgId: string | null;
    // aditif (finance butuh untuk invoice & otorisasi escrow)
    artistOrgId?: string | null; promotorUserId?: string; eventDate?: string; settlementDaysBefore?: number; eventName?: string;
  };
  'booking.completed': { bookingId: string; artistId: string; fee: number; splits: { partyId: string; pct: number }[]; payeeType: 'individual' | 'company' };
  'booking.cancelled': {
    bookingId: string; party: 'promotor' | 'artist' | 'force_majeure'; daysBeforeEvent: number;
    // aditif: hasil computeCancellation (§7.3) agar finance mengeksekusi tanpa menghitung ulang
    toArtist?: number; refundToPromotor?: number; artistPenalty?: number; holdForReschedule?: boolean;
    artistId?: string; artistOrgId?: string | null; promotorOrgId?: string;
  };
  'booking.dispute.opened': { bookingId: string; disputeId: string; byParty: string };
  'booking.dispute.resolved': {
    bookingId: string; disputeId: string; outcome: 'RELEASE_TO_ARTIST' | 'REFUND_PROMOTOR';
    fee: number; splits: { partyId: string; pct: number }[]; payeeType: 'individual' | 'company'; promotorOrgId: string;
  };

  // Finance
  'finance.payment.succeeded': { intentId: string; purpose: PaymentPurpose; referenceId: string; amount: number; payerUserId: string };
  'finance.payment.failed': { intentId: string; purpose: PaymentPurpose; referenceId: string };
  'finance.escrow.released': { referenceId: string; amount: number; lines: { partyId: string; amount: number }[] };
  'finance.escrow.refunded': { referenceId: string; amount: number };
  'finance.payout.completed': { payoutId: string; partyId: string; amount: number };

  // Ticketing
  'ticketing.event.published': { eventId: string; title: string; city: string; startsAt: string; artistIds: string[]; slug: string };
  'ticketing.order.paid': { orderId: string; eventId: string; userId: string; quantity: number; amount: number };
  'ticketing.ticket.checked_in': { ticketId: string; eventId: string; gate: string };
}

export type Topic = keyof DomainEvents;
export type OrgType = 'ARTIST' | 'MANAGEMENT' | 'LABEL' | 'PROMOTOR' | 'VENUE' | 'CREATOR';
export type PaymentPurpose = 'BOOKING_DP' | 'BOOKING_SETTLEMENT' | 'TICKET_ORDER' | 'SUBSCRIPTION' | 'TIP';

export interface EventEnvelope<T extends Topic = Topic> {
  id: string; // uuid, juga dipakai sebagai idempotency key konsumen
  topic: T;
  key: string; // partition key (mis. bookingId)
  payload: DomainEvents[T];
  occurredAt: string;
  producer: string;
}
