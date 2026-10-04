import type { Consumers, ServiceContext } from '@gema/service-kit';
import { BOOKING_STATUS_LABEL, type BookingStatus } from '@gema/domain/booking';
import { artistRecipients, notifyUsers, orgRecipients, rupiah } from './notify.js';

export function consumers(_ctx: ServiceContext): Consumers {
  return {
    // ---- Read model ----
    'iam.org.created': async (e, tx) => {
      const p = e.payload;
      if (!p.ownerUserId) return; // org belum diklaim
      await tx.query(
        `INSERT INTO org_members (org_id, user_id, org_type, artist_id) VALUES ($1,$2,$3,$4) ON CONFLICT (org_id, user_id) DO UPDATE SET artist_id = EXCLUDED.artist_id`,
        [p.orgId, p.ownerUserId, p.type, p.artistId ?? null],
      );
    },
    'iam.org.member_added': async (e, tx) => {
      const p = e.payload;
      await tx.query(
        `INSERT INTO org_members (org_id, user_id, org_type, artist_id) VALUES ($1,$2,$3,$4) ON CONFLICT (org_id, user_id) DO UPDATE SET artist_id = EXCLUDED.artist_id`,
        [p.orgId, p.userId, p.type, p.artistId ?? null],
      );
    },
    'iam.user.onboarded': async (e, tx) => {
      await tx.query(`INSERT INTO user_cities (user_id, city) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET city = EXCLUDED.city`, [
        e.payload.userId,
        e.payload.city,
      ]);
      for (const a of e.payload.artistIds) {
        await tx.query(`INSERT INTO artist_followers VALUES ($1,$2) ON CONFLICT DO NOTHING`, [a, e.payload.userId]);
      }
    },
    'iam.user.registered': async (e, tx) => {
      await notifyUsers(tx, [e.payload.userId], e.id, {
        category: 'system',
        title: 'Selamat datang di GEMA',
        body: 'Dengar gratis. Datang ke panggungnya. Dukung langsung.',
        link: '/app',
      });
    },
    'library.artist.followed': async (e, tx) => {
      await tx.query(`INSERT INTO artist_followers VALUES ($1,$2) ON CONFLICT DO NOTHING`, [e.payload.artistId, e.payload.userId]);
    },

    // ---- Booking (B2B) ----
    'booking.inquiry.created': async (e, tx) => {
      const p = e.payload;
      await notifyUsers(tx, await artistRecipients(tx, p.artistId), e.id, {
        category: 'booking',
        title: 'Inquiry booking baru',
        body: `Tawaran manggung di ${p.city} pada ${p.eventDate} dengan budget ${rupiah(p.budget)}.`,
        link: `/studio/bookings/${p.bookingId}`,
      });
    },
    'booking.offer.sent': async (e, tx) => {
      const p = e.payload;
      const to = p.byParty === 'promotor' ? await artistRecipients(tx, p.artistId) : await orgRecipients(tx, p.promotorOrgId);
      await notifyUsers(tx, to, e.id, {
        category: 'booking',
        title: p.byParty === 'promotor' ? 'Counter-offer dari promotor' : 'Offer baru dari manajemen',
        body: `Fee diajukan: ${rupiah(p.fee)}`,
        link: p.byParty === 'promotor' ? `/studio/bookings/${p.bookingId}` : `/promotor/bookings/${p.bookingId}`,
      });
    },
    'booking.status.changed': async (e, tx) => {
      const p = e.payload;
      const label = BOOKING_STATUS_LABEL[p.to as BookingStatus] ?? p.to;
      const artistSide = await artistRecipients(tx, p.artistId);
      const promotorSide = await orgRecipients(tx, p.promotorOrgId);
      await notifyUsers(tx, artistSide, e.id, {
        category: 'booking',
        title: `Status booking: ${label}`,
        body: `Booking tanggal ${p.eventDate} kini berstatus ${label}.`,
        link: `/studio/bookings/${p.bookingId}`,
      });
      await notifyUsers(tx, promotorSide, e.id, {
        category: 'booking',
        title: `Status booking: ${label}`,
        body: `Booking tanggal ${p.eventDate} kini berstatus ${label}.`,
        link: `/promotor/bookings/${p.bookingId}`,
      });
    },

    // ---- Finance ----
    'finance.payment.succeeded': async (e, tx) => {
      const p = e.payload;
      await notifyUsers(tx, [p.payerUserId], e.id, {
        category: 'payment',
        title: 'Pembayaran berhasil',
        body: `Pembayaran ${rupiah(p.amount)} telah diterima rekening bersama (escrow).`,
      });
    },
    'finance.escrow.released': async (e, tx) => {
      for (const l of e.payload.lines) {
        // partyId = org/user penerima; kirim ke anggota org bila ada, atau langsung ke user
        const members = await orgRecipients(tx, l.partyId);
        await notifyUsers(tx, members.length ? members : [l.partyId], e.id, {
          category: 'payment',
          title: 'Dana dicairkan',
          body: `${rupiah(l.amount)} masuk ke wallet Anda.`,
          link: '/studio/finance',
        });
      }
    },

    // ---- Event & rilis untuk fan (REQ-EVT-02) ----
    'ticketing.event.published': async (e, tx) => {
      const p = e.payload;
      const r = await tx.query(
        `SELECT DISTINCT f.user_id FROM artist_followers f
         LEFT JOIN user_cities c ON c.user_id = f.user_id
         WHERE f.artist_id = ANY($1) AND (c.city IS NULL OR lower(c.city) = lower($2))`,
        [p.artistIds, p.city],
      );
      await notifyUsers(
        tx,
        r.rows.map((x) => x.user_id),
        e.id,
        { category: 'event', title: 'Manggung dekatmu!', body: `${p.title} — ${p.city}`, link: `/app/events/${p.eventId}` },
      );
    },
    'catalog.release.published': async (e, tx) => {
      const p = e.payload;
      const r = await tx.query(`SELECT user_id FROM artist_followers WHERE artist_id=$1`, [p.artistId]);
      await notifyUsers(
        tx,
        r.rows.map((x) => x.user_id),
        e.id,
        { category: 'release', title: 'Rilis baru', body: `${p.title} sudah bisa didengar.`, link: `/app/album/${p.releaseId}` },
      );
    },
  };
}
