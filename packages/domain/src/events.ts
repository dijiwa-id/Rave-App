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
  // Ganti sampul rilis yang sudah tayang: diajukan artis → ditinjau QC.
  'catalog.release.cover_submitted': { releaseId: string; artistId: string; title: string };
  'catalog.release.cover_curated': { releaseId: string; artistId: string; title: string; action: 'replaced' | 'change_requested'; reason: string };
  'catalog.release.cover_reviewed': { releaseId: string; artistId: string; title: string; approved: boolean; reason: string | null };
  // Undangan persetujuan split hak (REQ-STU-02): dikirim ke email pihak yang diundang.
  'catalog.split.invited': { splitId: string; trackId: string; trackTitle: string; artistName: string; email: string; type: 'MASTER' | 'PUBLISHING'; pct: number; invitedBy: string };
  'catalog.artist.upserted': { artistId: string; name: string; slug: string; city: string | null; genres: string[]; orgId: string | null; imageUrl: string | null };

  // Library
  'library.artist.followed': { userId: string; artistId: string };
  /** Hanya bila baris follow benar-benar dihapus (unfollow berulang tidak mengurangi dua kali). */
  'library.artist.unfollowed': { userId: string; artistId: string };
  'library.track.liked': { userId: string; trackId: string };

  // Playback & analytics
  'playback.stream.qualified': { userId: string; trackId: string; artistId: string; city: string | null; playedMs: number; at: string };

  // Booking (off-air)
  'booking.inquiry.created': { bookingId: string; artistId: string; promotorOrgId: string; eventDate: string; city: string; budget: number };
  'booking.offer.sent': { bookingId: string; artistId: string; promotorOrgId: string; byParty: 'promotor' | 'management'; fee: number };
  'booking.status.changed': { bookingId: string; artistId: string; promotorOrgId: string; from: string; to: string; fee: number; eventDate: string };
  // Satu pihak sudah menandatangani; giliran pihak berikutnya (notifikasi agar kontrak tidak menggantung).
  'booking.contract.sign_requested': { bookingId: string; contractId: string; artistId: string; promotorOrgId: string; signedBy: string; nextParty: 'promotor' | 'management' | 'artist'; eventName?: string };
  'booking.contract.signed': {
    bookingId: string; contractId: string; fee: number; dpAmount: number; settlementAmount: number; serviceFee: number;
    promotorOrgId: string; artistId: string; managementOrgId: string | null;
    // aditif (finance butuh untuk invoice & otorisasi escrow)
    artistOrgId?: string | null; promotorUserId?: string; eventDate?: string; settlementDaysBefore?: number; eventName?: string;
  };
  // taxPct/commissionPct: dari kontrak yang ditandatangani (aditif; event lama tanpa nilai ini memakai tarif bawaan).
  'booking.completed': { bookingId: string; artistId: string; fee: number; splits: { partyId: string; pct: number }[]; payeeType: 'individual' | 'company'; taxPct?: number; commissionPct?: number };
  'booking.cancelled': {
    bookingId: string; party: 'promotor' | 'artist' | 'force_majeure'; daysBeforeEvent: number;
    // aditif: hasil computeCancellation (§7.3) agar finance mengeksekusi tanpa menghitung ulang
    toArtist?: number; refundToPromotor?: number; artistPenalty?: number; holdForReschedule?: boolean;
    artistId?: string; artistOrgId?: string | null; promotorOrgId?: string;
    // aditif: syarat kontrak agar dana yang hangus ke artis dipotong komisi & PPh dan dibagi sesuai split (audit B4/B6)
    taxPct?: number; commissionPct?: number; splits?: { partyId: string; pct: number }[];
  };
  'booking.dispute.opened': { bookingId: string; disputeId: string; byParty: string };
  'booking.dispute.resolved': {
    bookingId: string; disputeId: string; outcome: 'RELEASE_TO_ARTIST' | 'REFUND_PROMOTOR';
    fee: number; splits: { partyId: string; pct: number }[]; payeeType: 'individual' | 'company'; promotorOrgId: string;
    taxPct?: number; commissionPct?: number;
    artistId?: string; // aditif (notifikasi hasil mediasi ke sisi artis)
  };

  // Finance
  'finance.payment.succeeded': { intentId: string; purpose: PaymentPurpose; referenceId: string; amount: number; payerUserId: string };
  'finance.payment.failed': { intentId: string; purpose: PaymentPurpose; referenceId: string; payerUserId?: string; amount?: number };
  'finance.escrow.released': { referenceId: string; amount: number; lines: { partyId: string; amount: number }[] };
  'finance.escrow.refunded': { referenceId: string; amount: number; promotorOrgId?: string | null; promotorUserId?: string | null };
  'finance.payout.completed': { payoutId: string; partyId: string; amount: number };
  'finance.payout.rejected': { payoutId: string; partyId: string; amount: number; reason: string };
  // Refund ke pembeli (dana keluar dari escrow lewat mitra ke metode pembayaran asal). Satu refund per invoice.
  'finance.refund.completed': { refundId: string; invoiceId: string; purpose: PaymentPurpose; referenceId: string; amount: number; payerUserId: string; reason: string };
  'finance.refund.failed': { invoiceId: string | null; purpose: PaymentPurpose; referenceId: string; reason: string; error: string };

  // Live streaming
  'live.stream.started': { streamId: string; orgId: string; artistId: string | null; title: string };
  'live.stream.ended': { streamId: string; reason: string; durationS: number; peakViewers: number };

  // Platform (Super Admin)
  'platform.settings.updated': { changes: Record<string, unknown>; version: number; byUserId: string };

  // Ticketing
  'ticketing.event.published': { eventId: string; title: string; city: string; startsAt: string; artistIds: string[]; slug: string };
  'ticketing.order.paid': { orderId: string; eventId: string; userId: string; quantity: number; amount: number };
  'ticketing.ticket.checked_in': { ticketId: string; eventId: string; gate: string };
  // Event lewat ends_at → COMPLETED; finance mencairkan escrow tiket ke promotor setelah jendela dispute.
  'ticketing.event.completed': { eventId: string; orgId: string; endedAt: string };
  'ticketing.event.cancelled': { eventId: string; orgId: string; title: string; reason: string };
  /** Jadwal/venue event PUBLISHED berubah. `userIds` = pemegang tiket (dipecah per batch bila banyak). */
  'ticketing.event.rescheduled': { eventId: string; title: string; startsAt: string; venueName: string; city: string; optOutUntil: string | null; userIds: string[] };
  /** Ticketing sudah membatalkan tiket order ini; finance mengembalikan dana sesuai porsi. */
  'ticketing.order.refund_requested': { orderId: string; eventId: string; userId: string; escrowPct: number; refundFee: boolean; reason: string };
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
