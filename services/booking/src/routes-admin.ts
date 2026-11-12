import type { FastifyInstance } from 'fastify';
import { audit, conflict, notFound, publish, requirePermission, z, type ServiceContext } from '@rave/service-kit';
import { pickDispute } from './routes-bookings.js';
import { feeSplits, loadBooking, transition, releaseTerms } from './repo.js';

/** Dispute center untuk tim mediasi RAVE (REQ-B2B-12, SLA keputusan ≤ 14 hari kerja). */
export async function adminRoutes(app: FastifyInstance, { db }: ServiceContext) {
  app.get('/v1/admin/disputes', { preHandler: requirePermission('dispute.resolve') }, async (req) => {
    const { status } = req.query as { status?: string };
    const rows = await db.query(
      `SELECT d.*, b.event_name, b.event_date, b.agreed_fee, b.status AS booking_status, a.name AS artist_name
       FROM disputes d JOIN bookings b ON b.id=d.booking_id JOIN artists a ON a.id=b.artist_id
       ${status ? 'WHERE d.status=$1' : ''} ORDER BY d.created_at DESC LIMIT 200`,
      status ? [status] : [],
    );
    return {
      data: rows.map((r) => ({
        ...pickDispute(r),
        booking: { event_name: r.event_name, event_date: r.event_date, fee: r.agreed_fee, status: r.booking_status, artist_name: r.artist_name },
      })),
    };
  });

  app.post('/v1/admin/disputes/:id/resolve', { preHandler: requirePermission('dispute.resolve') }, async (req) => {
    const { id } = req.params as { id: string };
    const p = z
      .object({
        outcome: z.enum(['RELEASE_TO_ARTIST', 'REFUND_PROMOTOR', 'FORCE_MAJEURE']),
        note: z.string().min(3).max(4000),
        // FORCE_MAJEURE: biaya riil artis yang disetujui mediator (dibayar dari escrow; sisanya refund ke promotor).
        awarded_costs: z.number().int().min(0).optional(),
      })
      .parse(req.body);
    return db.tx(async (c) => {
      const d = (await c.query(`SELECT * FROM disputes WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!d) throw notFound('Dispute');
      if (d.status !== 'OPEN') throw conflict('Dispute sudah diputus');
      const b = await loadBooking(c, d.booking_id, true);
      if (p.outcome === 'FORCE_MAJEURE') {
        if (d.kind !== 'FORCE_MAJEURE') throw conflict('Putusan force majeure hanya untuk klaim force majeure');
        const paid = Number(b.dp_paid) + Number(b.settlement_paid);
        const award = Math.min(p.awarded_costs ?? 0, paid);
        await transition(c, b, 'FORCE_MAJEURE', 'admin', { actorId: req.user!.sub, note: `Mediasi: force majeure terbukti — ${p.note}`, set: { cancellation: JSON.stringify({ rule: 'FORCE_MAJEURE', toArtist: award, refundToPromotor: paid - award, artistPenalty: 0, holdForReschedule: false, reason: p.note }) } });
        const r = await c.query(`UPDATE disputes SET status='RESOLVED', outcome=$2, note=$3, awarded_costs=$4, resolved_at=now() WHERE id=$1 RETURNING *`, [id, p.outcome, p.note, award]);
        const rt = await releaseTerms(c, b);
        await publish(c, 'booking.cancelled', b.id, {
          bookingId: b.id, party: 'force_majeure', daysBeforeEvent: 0, toArtist: award, refundToPromotor: paid - award, artistPenalty: 0, holdForReschedule: false,
          artistId: b.artist_id, artistOrgId: b.artist_org_id, promotorOrgId: b.promotor_org_id, taxPct: rt.taxPct, commissionPct: rt.commissionPct, splits: rt.splits,
        });
        await audit(c, { actorId: req.user!.sub, action: 'dispute.resolve', entity: 'dispute', entityId: id, data: { ...p, awarded_costs: award }, ip: req.ip });
        return pickDispute(r.rows[0]);
      }
      const to = p.outcome === 'RELEASE_TO_ARTIST' ? 'SETTLED' : 'CANCELLED_BY_ARTIST';
      await transition(c, b, to, 'admin', { actorId: req.user!.sub, note: `Mediasi: ${p.outcome} — ${p.note}` });
      const r = await c.query(`UPDATE disputes SET status='RESOLVED', outcome=$2, note=$3, resolved_at=now() WHERE id=$1 RETURNING *`, [id, p.outcome, p.note]);
      await publish(c, 'booking.dispute.resolved', b.id, {
        bookingId: b.id,
        disputeId: id,
        outcome: p.outcome,
        fee: b.agreed_fee ?? 0,
        ...(await releaseTerms(c, b).then((rt) => ({ splits: rt.splits, payeeType: rt.payeeType, taxPct: rt.taxPct, commissionPct: rt.commissionPct }))),
        promotorOrgId: b.promotor_org_id,
        artistId: b.artist_id,
      });
      await audit(c, { actorId: req.user!.sub, action: 'dispute.resolve', entity: 'dispute', entityId: id, data: p, ip: req.ip });
      return pickDispute(r.rows[0]);
    });
  });
}
