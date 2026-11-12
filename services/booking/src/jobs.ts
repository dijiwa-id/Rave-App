import { publish, settings, type Job } from '@rave/service-kit';
import { computeCancellation } from '@rave/domain';
import { AUTO_COMPLETE_MS, FAST_CLOCK, todayWib, type BookingRow } from './common.js';
import { completeBooking, } from './routes-bookings.js';
import { loadBooking, releaseTerms, transition } from './repo.js';

/**
 * Timer saga booking (§7.1, §10.6). Di produksi dijalankan Temporal workflow per booking;
 * di sini job periodik yang idempoten (FOR UPDATE SKIP LOCKED) agar aman untuk banyak replika.
 */
export const bookingTimers: Job = {
  name: 'booking-timers',
  everyMs: FAST_CLOCK ? 5_000 : 30_000,
  async run({ db, log }) {
    const step = async (sql: string, params: unknown[], fn: (c: any, b: BookingRow) => Promise<unknown>) => {
      const ids = (await db.query(sql, params)).map((r) => r.id);
      for (const id of ids) {
        await db
          .tx(async (c) => {
            const b = await loadBooking(c, id, true);
            await fn(c, b);
          })
          .catch((e) => log.warn({ err: e?.message, id }, 'timer booking gagal'));
      }
    };
    const today = todayWib();
    // Hold kedaluwarsa (default 72 jam) → EXPIRED; HOLD_2 naik ke HOLD_1 (releaseSlot).
    await step(`SELECT id FROM bookings WHERE status IN ('INQUIRY','NEGOTIATING') AND hold_expires_at < now()`, [], (c, b) =>
      ['INQUIRY', 'NEGOTIATING'].includes(b.status) ? transition(c, b, 'EXPIRED', 'system', { note: 'Hold kedaluwarsa' }) : Promise.resolve(),
    );
    // Inquiry/negosiasi TANPA hold yang tidak bergerak → EXPIRED (sebelumnya menggantung selamanya — audit go-live).
    await step(
      `SELECT id FROM bookings WHERE status IN ('INQUIRY','NEGOTIATING') AND hold_expires_at IS NULL AND updated_at < now() - make_interval(days => $1)`,
      [settings.num('booking.inquiry_ttl_days')],
      (c, b) => (['INQUIRY', 'NEGOTIATING'].includes(b.status) ? transition(c, b, 'EXPIRED', 'system', { note: 'Tidak ada respons dalam batas waktu inquiry' }) : Promise.resolve()),
    );
    // Kontrak tidak ditandatangani sampai batas waktu (contract.sign_window_days → contracts.expires_at) → EXPIRED.
    await step(
      `SELECT b.id FROM bookings b JOIN contracts k ON k.booking_id = b.id WHERE b.status='CONTRACT_SENT' AND k.expires_at < now() AND k.status NOT IN ('ACTIVE','SIGNED')`,
      [],
      async (c, b) => {
        if (b.status !== 'CONTRACT_SENT') return;
        await c.query(`UPDATE contracts SET status = CASE WHEN status='SENT' THEN 'VOID' ELSE 'CANCELLED' END WHERE booking_id=$1 AND status NOT IN ('ACTIVE','SIGNED','VOID','CANCELLED')`, [b.id]);
        await transition(c, b, 'EXPIRED', 'system', { note: 'Kontrak tidak ditandatangani semua pihak sampai batas waktu' });
      },
    );
    // AT_RISK sampai hari-H tanpa pelunasan → dibatalkan atas nama promotor; dana yang sudah masuk (DP) hangus ke artis
    // sesuai kontrak (§7.2), dipotong komisi & PPh sesuai kontrak.
    await step(`SELECT id FROM bookings WHERE status='AT_RISK' AND event_date <= $1::date`, [today], async (c, b) => {
      if (b.status !== 'AT_RISK') return;
      const out = computeCancellation({ party: 'promotor', daysBeforeEvent: 0, dpPaid: b.dp_paid, settlementPaid: b.settlement_paid, fee: b.agreed_fee ?? 0 });
      await transition(c, b, 'CANCELLED_BY_PROMOTOR', 'system', { note: 'Pelunasan tidak masuk sampai hari-H — DP hangus ke artis', set: { cancellation: JSON.stringify({ ...out, days_before_event: 0, reason: 'Pelunasan tidak dibayar' }) } });
      const rt = await releaseTerms(c, b);
      await publish(c, 'booking.cancelled', b.id, {
        bookingId: b.id, party: 'promotor', daysBeforeEvent: 0, toArtist: out.toArtist, refundToPromotor: out.refundToPromotor, artistPenalty: 0, holdForReschedule: false,
        artistId: b.artist_id, artistOrgId: b.artist_org_id, promotorOrgId: b.promotor_org_id, taxPct: rt.taxPct, commissionPct: rt.commissionPct, splits: rt.splits,
      });
    });
    // Pelunasan belum masuk pada H-N → AT_RISK (manajemen berhak membatalkan, DP tidak kembali).
    await step(`SELECT id FROM bookings WHERE status='BOOKED' AND event_date - settlement_days_before <= $1::date`, [today], (c, b) =>
      b.status === 'BOOKED' ? transition(c, b, 'AT_RISK', 'system', { note: 'Pelunasan terlambat' }) : Promise.resolve(),
    );
    // Hari-H.
    await step(`SELECT id FROM bookings WHERE status='BOOKED_AND_SECURED' AND event_date <= $1::date`, [today], (c, b) =>
      b.status === 'BOOKED_AND_SECURED' ? transition(c, b, 'SHOW_DAY', 'system', { set: { show_day_at: new Date().toISOString() } }) : Promise.resolve(),
    );
    // 24 jam (fast clock: 60 dtk) tanpa keberatan setelah hari-H → COMPLETED.
    await step(`SELECT id FROM bookings WHERE status='SHOW_DAY' AND coalesce(show_day_at, event_date::timestamptz) < now() - make_interval(secs => $1)`, [AUTO_COMPLETE_MS / 1000], (c, b) =>
      b.status === 'SHOW_DAY' ? completeBooking(c, b, 'system') : Promise.resolve(),
    );
  },
};
