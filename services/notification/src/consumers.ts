import type { Consumers, ServiceContext } from '@gema/service-kit';
import { BOOKING_STATUS_LABEL, type BookingStatus } from '@gema/domain/booking';
import { TICKET_REFUND_REASON_LABEL, type TicketRefundReason } from '@gema/domain';
import { artistRecipients, notifyFollowers, notifyUsers, orgRecipients, rupiah } from './notify.js';

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
    // Unfollow → berhenti menerima "Rilis baru" / "Sedang LIVE" dari artis ini.
    'library.artist.unfollowed': async (e, tx) => {
      await tx.query(`DELETE FROM artist_followers WHERE artist_id = $1 AND user_id = $2`, [e.payload.artistId, e.payload.userId]);
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
      if (p.purpose === 'TICKET_ORDER') return; // konfirmasi tiket dikirim dari ticketing.order.paid
      await notifyUsers(tx, [p.payerUserId], e.id, {
        category: 'payment',
        title: 'Pembayaran berhasil',
        body: `Pembayaran ${rupiah(p.amount)} telah diterima rekening bersama (escrow).`,
        link: '/promotor/invoices',
      });
    },
    'finance.payment.failed': async (e, tx) => {
      const p = e.payload;
      if (!p.payerUserId) return; // event lama tanpa payer
      const ticket = p.purpose === 'TICKET_ORDER';
      await notifyUsers(tx, [p.payerUserId], e.id, {
        category: 'payment',
        title: 'Pembayaran gagal',
        body: `${p.amount ? `Pembayaran ${rupiah(p.amount)}` : 'Pembayaran'} tidak berhasil. ${ticket ? 'Silakan pesan ulang tiketnya.' : 'Silakan coba bayar lagi.'}`,
        link: ticket ? '/app/tickets' : '/promotor/invoices',
      });
    },
    'finance.escrow.refunded': async (e, tx) => {
      const p = e.payload;
      if (!p.amount) return;
      const to = p.promotorOrgId ? await orgRecipients(tx, p.promotorOrgId) : [];
      if (!to.length && p.promotorUserId) to.push(p.promotorUserId);
      await notifyUsers(tx, to, e.id, {
        category: 'payment',
        title: 'Dana dikembalikan',
        body: `${rupiah(p.amount)} dari rekening bersama dikembalikan ke rekening sumber Anda.`,
        link: '/promotor/invoices',
      });
    },
    'finance.payout.completed': async (e, tx) => {
      const p = e.payload;
      const members = await orgRecipients(tx, p.partyId);
      await notifyUsers(tx, members.length ? members : [p.partyId], e.id, {
        category: 'payment',
        title: 'Penarikan dana berhasil',
        body: `${rupiah(p.amount)} sudah ditransfer ke rekening bank Anda.`,
        link: '/studio/finance',
      });
    },
    'iam.kyc.verified': async (e, tx) => {
      const p = e.payload;
      await notifyUsers(tx, [p.userId], e.id, {
        category: 'system',
        title: 'Verifikasi identitas disetujui',
        body: p.level === 'BUSINESS' ? 'Akun bisnis Anda terverifikasi — booking & pencairan dana sudah aktif.' : 'Identitas Anda terverifikasi — booking & pencairan dana sudah aktif.',
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

    // dispute.opened tidak perlu consumer: status DISPUTED sudah dikabarkan lewat booking.status.changed.
    'booking.dispute.resolved': async (e, tx) => {
      const p = e.payload;
      const outcome = p.outcome === 'RELEASE_TO_ARTIST' ? 'dana diteruskan ke artis' : 'dana dikembalikan ke promotor';
      const msg = { category: 'booking' as const, title: 'Hasil mediasi dispute', body: `Admin GEMA telah memutus dispute: ${outcome}.` };
      if (p.artistId) await notifyUsers(tx, await artistRecipients(tx, p.artistId), e.id, { ...msg, link: `/studio/bookings/${p.bookingId}` });
      await notifyUsers(tx, await orgRecipients(tx, p.promotorOrgId), e.id, { ...msg, link: `/promotor/bookings/${p.bookingId}` });
    },

    // ---- Tiket & rilis ----
    'ticketing.order.paid': async (e, tx) => {
      const p = e.payload;
      await notifyUsers(tx, [p.userId], e.id, {
        category: 'payment',
        title: 'Tiket kamu sudah terbit',
        body: `${p.quantity} tiket (${rupiah(p.amount)}) siap ditunjukkan di pintu masuk.`,
        link: '/app/tickets',
      });
    },
    'finance.refund.completed': async (e, tx) => {
      const p = e.payload;
      if (p.purpose !== 'TICKET_ORDER') return;
      const why = TICKET_REFUND_REASON_LABEL[p.reason as TicketRefundReason] ?? 'Refund tiket';
      await notifyUsers(tx, [p.payerUserId], e.id, {
        category: 'payment',
        title: 'Dana tiket dikembalikan',
        body: `${why}. ${rupiah(p.amount)} dikembalikan ke metode pembayaran asalmu.`,
        link: '/app/tickets',
      });
    },
    'ticketing.event.rescheduled': async (e, tx) => {
      const p = e.payload;
      const when = new Date(p.startsAt).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
      const until = p.optOutUntil ? new Date(p.optOutUntil).toLocaleDateString('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' }) : null;
      await notifyUsers(tx, p.userIds, e.id, {
        category: 'event',
        title: 'Jadwal event berubah',
        body: `${p.title} kini ${when} WIB di ${p.venueName}, ${p.city}.${until ? ` Tidak bisa hadir? Ajukan refund penuh sampai ${until}.` : ''}`,
        link: '/app/tickets',
      });
    },
    'catalog.release.rejected': async (e, tx) => {
      const p = e.payload;
      await notifyUsers(tx, await artistRecipients(tx, p.artistId), e.id, {
        category: 'release',
        title: 'Rilis perlu diperbaiki',
        body: `Tim QC menolak rilis: ${p.reason}`,
        link: `/studio/releases/${p.releaseId}`,
      });
    },

    // ---- Event & rilis untuk fan (REQ-EVT-02) ----
    'ticketing.event.published': async (e, tx) => {
      const p = e.payload;
      await notifyFollowers(tx, { artistIds: p.artistIds, city: p.city }, e.id, {
        category: 'event',
        title: 'Manggung dekatmu!',
        body: `${p.title} — ${p.city}`,
        link: `/app/events/${p.eventId}`,
      });
    },
    'live.stream.started': async (e, tx) => {
      const p = e.payload;
      if (!p.artistId) return;
      await notifyFollowers(tx, { artistIds: [p.artistId] }, e.id, { category: 'event', title: 'Sedang LIVE sekarang', body: p.title, link: `/app/live/${p.streamId}` });
    },
    'catalog.release.published': async (e, tx) => {
      const p = e.payload;
      await notifyFollowers(tx, { artistIds: [p.artistId] }, e.id, {
        category: 'release',
        title: 'Rilis baru',
        body: `${p.title} sudah bisa didengar.`,
        link: `/app/album/${p.releaseId}`,
      });
    },
  };
}
