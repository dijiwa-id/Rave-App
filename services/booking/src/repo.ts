import { assertTransition, calendarStatusFor, type BookingActor, type BookingStatus } from '@rave/domain';
import { notFound, publish, uuidv7, type Client } from '@rave/service-kit';
import type { BookingRow } from './common.js';

const TERMINAL_FREE: BookingStatus[] = ['DECLINED', 'EXPIRED', 'CANCELLED_BY_PROMOTOR', 'CANCELLED_BY_ARTIST', 'FORCE_MAJEURE'];

export async function loadBooking(c: Client, id: string, lock = false): Promise<BookingRow> {
  const r = await c.query(`SELECT * FROM bookings WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
  if (!r.rows[0]) throw notFound('Booking');
  return r.rows[0];
}

/** Lepas slot kalender booking; bila slot itu HOLD_1, naikkan HOLD_2 pada tanggal yang sama (REQ-B2B-02). */
export async function releaseSlot(c: Client, bookingId: string) {
  const r = await c.query(`DELETE FROM calendar_slots WHERE booking_id=$1 RETURNING artist_id, period, status`, [bookingId]);
  const s = r.rows[0];
  if (s?.status === 'HOLD_1') {
    await c.query(
      `UPDATE calendar_slots SET status='HOLD_1' WHERE id = (
         SELECT id FROM calendar_slots WHERE artist_id=$1 AND status='HOLD_2' AND period && $2::daterange ORDER BY created_at LIMIT 1)`,
      [s.artist_id, s.period],
    );
  }
}

/** Sinkron status kalender mengikuti status booking (§7.1). Konflik → 23P01 (exclusion) → 409. */
export async function syncCalendar(c: Client, b: BookingRow, to: BookingStatus) {
  if (TERMINAL_FREE.includes(to)) return releaseSlot(c, b.id);
  const cal = calendarStatusFor(to);
  if (!cal) return;
  await c.query(
    `INSERT INTO calendar_slots (id, artist_id, period, status, booking_id, note)
     VALUES ($1,$2, daterange($3::date, $3::date, '[]'), $4, $5, $6)
     ON CONFLICT (booking_id) DO UPDATE SET status = EXCLUDED.status`,
    [uuidv7(), b.artist_id, b.event_date, cal, b.id, b.event_name],
  );
}

/**
 * Satu-satunya jalan mengubah status booking: validasi state machine, update, timeline,
 * sinkron kalender, event outbox — semuanya dalam transaksi pemanggil.
 */
export async function transition(
  c: Client,
  b: BookingRow,
  to: BookingStatus,
  actor: BookingActor,
  opts: { actorId?: string | null; note?: string | null; set?: Record<string, unknown> } = {},
): Promise<BookingRow> {
  assertTransition(b.status as BookingStatus, to, actor);
  const set = { ...(opts.set ?? {}) };
  const cols = Object.keys(set);
  const r = await c.query(
    `UPDATE bookings SET status=$2, updated_at=now() ${cols.map((k, i) => `, ${k}=$${i + 3}`).join('')} WHERE id=$1 RETURNING *`,
    [b.id, to, ...cols.map((k) => set[k])],
  );
  const nb: BookingRow = r.rows[0];
  await c.query(`INSERT INTO booking_events (booking_id, from_status, to_status, actor, actor_id, note) VALUES ($1,$2,$3,$4,$5,$6)`, [
    b.id,
    b.status,
    to,
    actor,
    opts.actorId ?? null,
    opts.note ?? null,
  ]);
  await syncCalendar(c, nb, to);
  await publish(c, 'booking.status.changed', b.id, {
    bookingId: b.id,
    artistId: b.artist_id,
    promotorOrgId: b.promotor_org_id,
    from: b.status,
    to,
    fee: nb.agreed_fee ?? nb.latest_fee ?? nb.budget,
    eventDate: b.event_date,
  });
  return nb;
}

/** Split fee untuk pencairan; default 100% ke org artis (REQ-B2B-13). */
export async function feeSplits(c: Client, b: BookingRow): Promise<{ partyId: string; pct: number }[]> {
  const r = await c.query(`SELECT party_id, pct FROM fee_splits WHERE artist_id=$1 ORDER BY position`, [b.artist_id]);
  const fallback = b.artist_org_id ?? b.artist_id;
  if (!r.rows.length) return [{ partyId: fallback, pct: 100 }];
  return r.rows.map((x) => ({ partyId: x.party_id ?? fallback, pct: Number(x.pct) }));
}

export async function managementOrgId(c: Client, b: BookingRow): Promise<string | null> {
  const r = await c.query(
    `SELECT f.party_id FROM fee_splits f JOIN orgs o ON o.id = f.party_id WHERE f.artist_id=$1 AND o.type='MANAGEMENT' LIMIT 1`,
    [b.artist_id],
  );
  return r.rows[0]?.party_id ?? null;
}
