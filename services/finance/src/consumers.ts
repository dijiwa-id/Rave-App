import type { Consumers, ServiceContext } from '@rave/service-kit';
import { createInvoice, refundEscrow, refundTicketOrder, releaseEscrow } from './escrow.js';
import { disputeWindowMs } from './jobs.js';

const endOfDayWib = (date: string) => new Date(`${date}T23:59:59+07:00`);

export function consumers({ log }: ServiceContext): Consumers {
  return {
    // Kontrak sah → escrow dibuka + invoice DP & pelunasan (§7.2 langkah 1, 4)
    'booking.contract.signed': async (e, tx) => {
      const p = e.payload;
      await tx.query(
        `INSERT INTO escrow_holds (reference_id, kind, artist_id, artist_org_id, management_org_id, promotor_org_id, promotor_user_id, fee, status)
         VALUES ($1,'BOOKING',$2,$3,$4,$5,$6,$7,'AWAITING_DP') ON CONFLICT (reference_id) DO NOTHING`,
        [p.bookingId, p.artistId, p.artistOrgId ?? null, p.managementOrgId, p.promotorOrgId, p.promotorUserId ?? null, p.fee],
      );
      const payer = p.promotorUserId!;
      const name = p.eventName ?? 'booking';
      const dp = await createInvoice(tx, {
        purpose: 'BOOKING_DP',
        referenceId: p.bookingId,
        escrowAmount: p.dpAmount,
        feeAmount: p.serviceFee,
        payerUserId: payer,
        payerOrgId: p.promotorOrgId,
        description: `DP ${name} (+ biaya layanan platform)`,
        dueAt: new Date(Date.now() + 72 * 3600_000),
      });
      let due = p.eventDate ? endOfDayWib(p.eventDate) : new Date(Date.now() + 14 * 86400_000);
      due = new Date(due.getTime() - (p.settlementDaysBefore ?? 7) * 86400_000);
      if (due.getTime() < Date.now() + 72 * 3600_000) due = new Date(Date.now() + 72 * 3600_000);
      if (p.settlementAmount > 0)
        await createInvoice(tx, {
          purpose: 'BOOKING_SETTLEMENT',
          referenceId: p.bookingId,
          escrowAmount: p.settlementAmount,
          payerUserId: payer,
          payerOrgId: p.promotorOrgId,
          description: `Pelunasan ${name}`,
          dueAt: due,
          dependsOn: dp.id,
        });
    },

    // Selesai → jadwalkan pencairan setelah jendela dispute (H+1)
    'booking.completed': async (e, tx) => {
      const p = e.payload;
      await tx.query(`UPDATE escrow_holds SET release_at = now() + make_interval(secs => $2), release_payload=$3, updated_at=now() WHERE reference_id=$1`, [
        p.bookingId,
        disputeWindowMs() / 1000,
        JSON.stringify({ fee: p.fee, splits: p.splits, payeeType: p.payeeType }),
      ]);
    },

    // Event tiket selesai → jadwalkan pencairan escrow tiket ke promotor setelah jendela dispute
    // Ticketing sudah membatalkan tiket order → kembalikan dana sesuai porsi (idempoten per invoice).
    'ticketing.order.refund_requested': async (e, tx) => {
      const p = e.payload;
      await refundTicketOrder(tx, { orderId: p.orderId, escrowPct: p.escrowPct, refundFee: p.refundFee, reason: p.reason });
    },

    'ticketing.event.completed': async (e, tx) => {
      const p = e.payload;
      await tx.query(
        `UPDATE escrow_holds SET release_at = now() + make_interval(secs => $2), promotor_org_id = coalesce(promotor_org_id, $3::uuid), updated_at=now()
         WHERE reference_id=$1 AND kind='EVENT' AND status='HELD'`,
        [`event:${p.eventId}`, disputeWindowMs() / 1000, p.orgId],
      );
    },

    'booking.cancelled': async (e, tx) => {
      const p = e.payload;
      if (p.holdForReschedule) {
        // Force majeure: dana ditahan untuk reschedule ≤ 90 hari / keputusan mediasi.
        await tx.query(`UPDATE escrow_holds SET frozen=true, release_at=null, updated_at=now() WHERE reference_id=$1`, [p.bookingId]);
        await tx.query(`UPDATE invoices SET status='EXPIRED' WHERE reference_id=$1 AND status='PENDING'`, [p.bookingId]);
        return;
      }
      await refundEscrow(tx, p.bookingId, p.toArtist ?? 0, p.artistOrgId ?? null, `Pembatalan (${p.party}, H-${p.daysBeforeEvent})`);
    },

    // Dana dibekukan selama sengketa (REQ-B2B-12)
    'booking.dispute.opened': async (e, tx) => {
      await tx.query(`UPDATE escrow_holds SET frozen=true, updated_at=now() WHERE reference_id=$1`, [e.payload.bookingId]);
    },
    'booking.dispute.resolved': async (e, tx) => {
      const p = e.payload;
      if (p.outcome === 'RELEASE_TO_ARTIST') {
        await releaseEscrow(tx, p.bookingId, { fee: p.fee, splits: p.splits, payeeType: p.payeeType }, 'Pencairan berdasarkan keputusan mediasi');
      } else {
        await refundEscrow(tx, p.bookingId, 0, null, 'Refund berdasarkan keputusan mediasi');
      }
      log.info({ booking: p.bookingId, outcome: p.outcome }, 'dispute dieksekusi');
    },
  };
}
