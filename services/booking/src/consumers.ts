import { bookingInvoice } from '@gema/domain';
import type { Consumers, ServiceContext } from '@gema/service-kit';
import { commissionPolicy } from './common.js';
import { loadBooking, transition } from './repo.js';

export function consumers({ log }: ServiceContext): Consumers {
  return {
    // ---- Read model ----
    'catalog.artist.upserted': async (e, tx) => {
      const p = e.payload;
      await tx.query(
        `INSERT INTO artists (id, org_id, name, slug, city, genres, image_url) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET org_id=coalesce(EXCLUDED.org_id, artists.org_id), name=EXCLUDED.name, slug=EXCLUDED.slug,
           city=EXCLUDED.city, genres=EXCLUDED.genres, image_url=coalesce(EXCLUDED.image_url, artists.image_url), updated_at=now()`,
        [p.artistId, p.orgId, p.name, p.slug, p.city, p.genres, p.imageUrl],
      );
    },
    'iam.org.created': async (e, tx) => {
      const p = e.payload;
      await tx.query(`INSERT INTO orgs (id, type, name) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`, [p.orgId, p.type, p.name]);
      if (p.artistId) await tx.query(`UPDATE artists SET org_id=$2 WHERE id=$1 AND org_id IS NULL`, [p.artistId, p.orgId]);
    },
    'iam.kyc.verified': async (e, tx) => {
      if (e.payload.orgId) await tx.query(`UPDATE orgs SET verified=true WHERE id=$1`, [e.payload.orgId]);
    },

    // ---- Dana escrow masuk (REQ-B2B-04) ----
    'finance.payment.succeeded': async (e, tx) => {
      const p = e.payload;
      if (p.purpose !== 'BOOKING_DP' && p.purpose !== 'BOOKING_SETTLEMENT') return;
      const b = await loadBooking(tx, p.referenceId, true).catch(() => null);
      if (!b) return log.warn({ ref: p.referenceId }, 'payment untuk booking tak dikenal');
      const inv = bookingInvoice(b.agreed_fee ?? 0, b.dp_pct, commissionPolicy());
      if (p.purpose === 'BOOKING_DP') {
        if (b.status !== 'SIGNED') return log.warn({ id: b.id, status: b.status }, 'DP diterima di luar status SIGNED');
        await transition(tx, b, 'BOOKED', 'system', { note: 'DP diterima escrow — kontak dibuka', set: { dp_paid: inv.dp } });
      } else {
        if (!['BOOKED', 'AT_RISK'].includes(b.status)) return log.warn({ id: b.id, status: b.status }, 'pelunasan di luar status BOOKED');
        await transition(tx, b, 'BOOKED_AND_SECURED', 'system', { note: 'Pelunasan diterima — advancing dibuka', set: { settlement_paid: inv.settlement } });
      }
    },
    'finance.escrow.released': async (e, tx) => {
      const b = await loadBooking(tx, e.payload.referenceId, true).catch(() => null);
      if (b?.status === 'COMPLETED') await transition(tx, b, 'SETTLED', 'system', { note: 'Dana dicairkan sesuai split' });
    },
  };
}
