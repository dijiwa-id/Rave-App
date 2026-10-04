import type { Job } from '@gema/service-kit';
import { AUTO_COMPLETE_MS, FAST_CLOCK, todayWib, type BookingRow } from './common.js';
import { completeBooking, } from './routes-bookings.js';
import { loadBooking, transition } from './repo.js';

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
