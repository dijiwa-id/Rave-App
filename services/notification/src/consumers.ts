import { brandedEmail, publicWebUrl, sendEmail, type Client, type Consumers, type ServiceContext } from '@rave/service-kit';
import { BOOKING_STATUS_LABEL, type BookingStatus } from '@rave/domain/booking';
import { TICKET_REFUND_REASON_LABEL, type TicketRefundReason } from '@rave/domain';
import { artistRecipients, notifyFollowers, notifyUsers, orgRecipients, rupiah } from './notify.js';

export function consumers(ctx: ServiceContext): Consumers {
  const log = ctx.log;
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
        title: 'Selamat datang di RAVE',
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
    'booking.contract.sign_requested': async (e, tx) => {
      const p = e.payload;
      const to = p.nextParty === 'promotor' ? await orgRecipients(tx, p.promotorOrgId) : await artistRecipients(tx, p.artistId);
      const link = p.nextParty === 'promotor' ? `/promotor/bookings/${p.bookingId}` : `/studio/bookings/${p.bookingId}`;
      await notifyUsers(tx, to, e.id, {
        category: 'booking',
        title: 'Giliran Anda menandatangani kontrak',
        body: `${p.signedBy} sudah menandatangani kontrak${p.eventName ? ` "${p.eventName}"` : ''}. Tinjau PDF kontrak lalu tanda tangani dengan OTP.`,
        link,
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
    // ---- Royalti streaming (BRD §7.5) ----
    'finance.royalty.statement_issued': async (e, tx) => {
      const p = e.payload;
      const to = p.partyType === 'org' ? await orgRecipients(tx, p.partyId) : [p.partyId];
      if (!to.length) return;
      const bulan = periodeLabel(p.period);
      await notifyUsers(tx, to, e.id, {
        category: 'payment',
        title: `Statement royalti ${bulan} terbit`,
        body: p.payable > 0
          ? `${rupiah(p.payable)} masuk ke saldo royalti Anda (bruto ${rupiah(p.gross)}). Lihat rincian per lagu, kota & sumber.`
          : `Royalti ${rupiah(p.gross)} tercatat; total di bawah ambang terutang sehingga dibawa ke statement berikutnya (tidak hangus).`,
        link: p.partyType === 'org' ? '/studio/royalty' : '/settings',
      });
    },
    'finance.royalty.reserve_released': async (e, tx) => {
      const p = e.payload;
      const to = p.partyType === 'org' ? await orgRecipients(tx, p.partyId) : [p.partyId];
      if (!to.length) return;
      await notifyUsers(tx, to, e.id, {
        category: 'payment',
        title: 'Cadangan koreksi royalti dilepas',
        body: `${rupiah(p.payable)} dari cadangan periode ${periodeLabel(p.period)} masuk ke saldo royalti Anda.`,
        link: p.partyType === 'org' ? '/studio/royalty' : '/settings',
      });
    },
    // ---- RAVE Pro (langganan organisasi) ----
    'finance.pro.changed': async (e, tx) => {
      const p = e.payload;
      const members = await orgRecipients(tx, p.orgId);
      if (!members.length) return;
      const link = await proLink(tx, p.orgId);
      const plan = p.plan ? `RAVE Pro paket ${PLAN_NAME[p.plan]}` : 'RAVE Pro';
      const until = p.periodEnd ? tanggal(p.periodEnd) : '';
      const msg: Record<string, { title: string; body: string } | null> = {
        ACTIVATED: { title: `${plan} aktif`, body: `Take rate Pro, Insight Pro & fitur paket sudah berlaku hingga ${until}. Terima kasih telah berlangganan.` },
        RENEWED: { title: `${plan} diperpanjang`, body: `Pembayaran perpanjangan diterima. Periode berikutnya berlaku hingga ${until}.` },
        UPGRADED: { title: `Paket ditingkatkan: ${plan}`, body: `Fitur paket baru langsung berlaku hingga ${until}. Sisa periode lama sudah dikreditkan.` },
        COMPLIMENTARY: { title: `${plan} komplimen dari RAVE`, body: `Organisasi Anda menerima ${plan} hingga ${until}.` },
        GRACE: { title: 'Perpanjangan RAVE Pro belum dibayar', body: `Masa tenggang hingga ${p.graceUntil ? tanggal(p.graceUntil) : '-'} — bayar tagihan perpanjangan agar take rate Pro tidak berhenti.` },
        EXPIRED: { title: 'RAVE Pro berakhir', body: 'Booking baru kembali memakai take rate standar. Booking yang sudah berkontrak tetap memakai tarif di kontrak.' },
        CANCEL_SCHEDULED: { title: 'RAVE Pro akan berakhir di akhir periode', body: `Fitur Pro tetap berlaku hingga ${until}, lalu berakhir. Tagihan perpanjangan tidak akan dikirim.` },
        RESUMED: { title: 'Langganan RAVE Pro dilanjutkan', body: `Tagihan perpanjangan akan dikirim sebelum ${until}. Tidak ada debit otomatis.` },
        REVOKED: { title: 'RAVE Pro dicabut', body: 'Langganan dicabut oleh tim RAVE. Hubungi dukungan bila ada pertanyaan.' },
        PLAN_SCHEDULED: null,
      };
      const m = msg[p.reason];
      if (m) await notifyUsers(tx, members, e.id, { category: 'payment', title: m.title, body: m.body, link });
    },
    'finance.pro.renewal_due': async (e, tx) => {
      const p = e.payload;
      const members = await orgRecipients(tx, p.orgId);
      if (!members.length) return;
      await notifyUsers(tx, members, e.id, {
        category: 'payment',
        title: `Tagihan perpanjangan RAVE Pro paket ${PLAN_NAME[p.plan]}`,
        body: `${rupiah(p.amount)} (termasuk PPN) — periode berjalan berakhir ${tanggal(p.periodEnd)}. Bayar sebelum ${tanggal(p.dueAt)} agar layanan tidak terputus.`,
        link: await proLink(tx, p.orgId),
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
    'finance.payout.rejected': async (e, tx) => {
      const p = e.payload;
      const members = await orgRecipients(tx, p.partyId);
      await notifyUsers(tx, members.length ? members : [p.partyId], e.id, {
        category: 'payment',
        title: 'Penarikan dana ditolak',
        body: `${rupiah(p.amount)} dikembalikan ke saldo wallet. Alasan: ${p.reason}`,
        link: '/studio/finance',
      });
    },
    'catalog.release.cover_curated': async (e, tx) => {
      const p = e.payload;
      await notifyUsers(tx, await artistRecipients(tx, p.artistId), e.id, {
        category: 'release',
        title: p.action === 'replaced' ? 'Sampul rilis diganti tim kurasi RAVE' : 'Tim kurasi meminta sampul baru',
        body: p.action === 'replaced' ? `Sampul "${p.title}" diganti: ${p.reason}` : `Mohon unggah sampul baru untuk "${p.title}": ${p.reason}. Sampul saat ini tetap tayang sampai sampul baru disetujui.`,
        link: '/studio/releases',
      });
    },
    'catalog.release.cover_reviewed': async (e, tx) => {
      const p = e.payload;
      await notifyUsers(tx, await artistRecipients(tx, p.artistId), e.id, {
        category: 'release',
        title: p.approved ? 'Sampul rilis diperbarui' : 'Sampul rilis ditolak',
        body: p.approved ? `Sampul baru "${p.title}" sudah tayang.` : `Sampul baru "${p.title}" tidak disetujui: ${p.reason}. Sampul lama tetap tayang.`,
        link: '/studio/releases',
      });
    },
    'catalog.release.changes_reviewed': async (e, tx) => {
      const p = e.payload;
      await notifyUsers(tx, await artistRecipients(tx, p.artistId), e.id, {
        category: 'release',
        title: p.approved ? 'Perubahan rilis diterapkan' : 'Perubahan rilis ditolak',
        body: p.approved ? `Perubahan pada "${p.title}" sudah tayang.` : `Perubahan pada "${p.title}" tidak disetujui: ${p.reason}. Data lama tetap tayang.`,
        link: `/studio/releases/${p.releaseId}`,
      });
    },
    'catalog.split.invited': async (e) => {
      const p = e.payload;
      const url = `${publicWebUrl()}/studio`;
      const m = brandedEmail({
        heading: 'Persetujuan pembagian hak lagu',
        lines: [
          `${p.invitedBy} mencantumkan Anda sebagai pemegang hak ${p.type === 'MASTER' ? 'master' : 'publishing'} sebesar ${p.pct}% untuk lagu "${p.trackTitle}" (${p.artistName}).`,
          'Masuk ke RAVE dengan email ini, lalu setujui atau hubungi artis bila angkanya tidak sesuai. Rilis tidak dapat tayang sebelum semua pihak menyetujui.',
        ],
        cta: { label: 'Tinjau di RAVE', url },
      });
      await sendEmail({ to: p.email, subject: `Persetujuan split "${p.trackTitle}"`, ...m, tag: 'split-invite' }).catch((err: unknown) =>
        log.warn({ split: p.splitId, err: (err as Error).message }, 'undangan split gagal dikirim'),
      );
    },
    'iam.kyc.verified': async (e, tx) => {
      const p = e.payload;
      await notifyUsers(tx, [p.userId], e.id, {
        category: 'system',
        title: 'Verifikasi identitas disetujui',
        body: p.level === 'BUSINESS' ? 'Akun bisnis Anda terverifikasi — booking & pencairan dana sudah aktif.' : 'Identitas Anda terverifikasi — booking & pencairan dana sudah aktif.',
      });
    },
    'iam.verification.decided': async (e, tx) => {
      const p = e.payload;
      const copy =
        p.outcome === 'APPROVED'
          ? { title: 'Akunmu terverifikasi ✓', body: 'Badge Verified kini tampil di profilmu — tarik dana & event bertiket juga sudah terbuka.' }
          : p.outcome === 'REJECTED'
            ? { title: 'Verifikasi akun belum disetujui', body: p.reason ? `Alasan: ${p.reason}. Perbaiki datamu lalu ajukan lagi.` : 'Perbaiki datamu lalu ajukan lagi.' }
            : { title: 'Verifikasi akun dicabut', body: p.reason ? `Alasan: ${p.reason}.` : 'Hubungi dukungan RAVE untuk informasi lebih lanjut.' };
      await notifyUsers(tx, [p.userId], e.id, { category: 'system', ...copy, link: '/app/settings#set-verify' });
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
      const msg = { category: 'booking' as const, title: 'Hasil mediasi dispute', body: `Admin RAVE telah memutus dispute: ${outcome}.` };
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
      if (p.purpose === 'BOOKING_DP' || p.purpose === 'BOOKING_SETTLEMENT') {
        await notifyUsers(tx, [p.payerUserId], e.id, {
          category: 'payment',
          title: 'Dana booking dikembalikan',
          body: `${rupiah(p.amount)} dikembalikan ke metode pembayaran asal (${p.reason}).`,
          link: '/promotor/bookings',
        });
        return;
      }
      if (p.purpose === 'SUBSCRIPTION') {
        await notifyUsers(tx, [p.payerUserId], e.id, {
          category: 'payment',
          title: 'Pembayaran RAVE Pro dikembalikan',
          body: `${rupiah(p.amount)} dikembalikan ke metode pembayaran asal (${p.reason}). Langganan Anda tidak berubah.`,
        });
        return;
      }
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

const PLAN_NAME: Record<string, string> = { STARTER: 'Starter', PRO: 'Pro', LABEL: 'Label' };
const tanggal = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
/** Halaman RAVE Pro sesuai produk org: Promotor Hub untuk promotor/venue, Artist Studio untuk artis/manajemen/label. */
async function proLink(tx: Client, orgId: string): Promise<string> {
  const r = await tx.query(`SELECT org_type FROM org_members WHERE org_id=$1 LIMIT 1`, [orgId]);
  return ['PROMOTOR', 'VENUE'].includes(r.rows[0]?.org_type) ? '/promotor/pro' : '/studio/pro';
}
/** 'YYYY-MM' → 'November 2026'. */
const periodeLabel = (period: string) => new Date(`${period}-15T00:00:00Z`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });
