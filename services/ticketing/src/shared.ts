import type { TicketRefundReason } from '@rave/domain';
import { callService, publish, settings, type Client } from '@rave/service-kit';

export interface Q {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export const SUMMARY_SQL = `
  SELECT e.*,
    (SELECT min(price) FROM ticket_types t WHERE t.event_id = e.id) AS min_price,
    coalesce((SELECT json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY array_position(e.artist_ids, a.id))
              FROM artists a WHERE a.id = ANY(e.artist_ids)), '[]'::json) AS artists
  FROM events e`;

export function summaryOut(e: any) {
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    poster_url: e.poster_url,
    city: e.city,
    venue_name: e.venue_name,
    starts_at: e.starts_at,
    min_price: e.min_price ?? null,
    status: e.status,
    artists: e.artists ?? [],
  };
}

export async function detailOut(q: Q, e: any) {
  const types = await q.query(`SELECT * FROM ticket_types WHERE event_id = $1 ORDER BY sort_order, price`, [e.id]);
  return {
    ...summaryOut(e),
    description: e.description,
    venue_address: e.venue_address,
    ends_at: e.ends_at,
    rules: e.rules,
    org_id: e.org_id,
    booking_id: e.booking_id,
    ticket_types: types.rows.map((t) => ({
      id: t.id,
      name: t.name,
      price: t.price,
      quota: t.quota,
      remaining: t.quota - t.sold - t.reserved,
      max_per_account: t.max_per_account,
      sale_starts_at: t.sale_starts_at,
      presale: t.presale,
    })),
  };
}

export async function orderOut(q: Q, o: any) {
  const items = await q.query(
    `SELECT oi.ticket_type_id, t.name, oi.quantity, oi.price FROM order_items oi JOIN ticket_types t ON t.id = oi.ticket_type_id WHERE oi.order_id = $1`,
    [o.id],
  );
  return {
    id: o.id,
    event_id: o.event_id,
    status: o.status,
    total: o.total,
    reserved_until: o.reserved_until,
    invoice_id: o.invoice_id,
    items: items.rows,
    refund: refundOut(o),
  };
}

/** Status refund order untuk klien (null bila tidak pernah direfund). */
export function refundOut(o: any) {
  if (!o.refund_status) return null;
  return {
    status: o.refund_status as 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVIEW',
    reason: o.refund_reason as TicketRefundReason,
    pct: o.refund_pct === null ? null : Number(o.refund_pct),
    amount: o.refund_amount === null ? null : Number(o.refund_amount),
    requested_at: o.refund_requested_at,
    refunded_at: o.refunded_at,
  };
}

/** Kebijakan refund pembeli dari pengaturan Super Admin. */
export const refundPolicy = () => ({
  buyerRequestEnabled: settings.bool('refund.buyer_request_enabled'),
  buyerDeadlineDays: settings.num('refund.buyer_deadline_days'),
  buyerRefundPct: settings.num('refund.buyer_refund_pct'),
  rescheduleOptOutDays: settings.num('refund.reschedule_opt_out_days'),
});

/**
 * Batalkan order dan minta finance mengembalikan dana (dalam transaksi pemanggil, order sudah dikunci FOR UPDATE).
 * Order PAID: semua tiketnya jadi REFUNDED (tak bisa dipakai check-in) dan kuota dikembalikan ke penjualan.
 * Order tanpa tiket (pembayaran terlambat): cukup ditandai. Nominal pasti dihitung finance dari rincian invoice;
 * yang disimpan di sini perkiraan dari total order (ticketing tidak memungut biaya layanan terpisah).
 */
export async function requestRefund(tx: Client, o: any, q: { escrowPct: number; refundFee: boolean; reason: TicketRefundReason; note?: string | null }) {
  if (o.status === 'PAID') {
    const freed = await tx.query(
      `WITH t AS (UPDATE tickets SET status = 'REFUNDED' WHERE order_id = $1 AND status <> 'REFUNDED' RETURNING ticket_type_id)
       SELECT ticket_type_id, count(*)::int AS n FROM t GROUP BY ticket_type_id`,
      [o.id],
    );
    for (const f of freed.rows) await tx.query(`UPDATE ticket_types SET sold = greatest(sold - $2, 0) WHERE id = $1`, [f.ticket_type_id, f.n]);
  }
  const estimate = q.escrowPct >= 100 ? Number(o.total) : Math.floor((Number(o.total) * Math.round(q.escrowPct * 100)) / 10000);
  await tx.query(
    `UPDATE orders SET status = 'REFUNDED', refund_status = 'PENDING', refund_reason = $2, refund_pct = $3, refund_amount = $4,
       refund_note = $5, refund_requested_at = now() WHERE id = $1`,
    [o.id, q.reason, q.escrowPct, estimate, q.note ?? null],
  );
  await publish(tx, 'ticketing.order.refund_requested', o.id, {
    orderId: o.id,
    eventId: o.event_id,
    userId: o.user_id,
    escrowPct: q.escrowPct,
    refundFee: q.refundFee,
    reason: q.reason,
  });
}

/** Refund penuh semua order PAID milik event yang dibatalkan (per batch; sisanya diteruskan job). */
export async function refundCancelledOrders(tx: Client, eventId: string | null, limit: number) {
  const rows = (
    await tx.query(
      `SELECT o.* FROM orders o JOIN events e ON e.id = o.event_id
       WHERE e.status = 'CANCELLED' AND o.status = 'PAID' AND o.refund_status IS NULL ${eventId ? 'AND o.event_id = $2' : ''}
       ORDER BY o.paid_at LIMIT $1 FOR UPDATE OF o SKIP LOCKED`,
      eventId ? [limit, eventId] : [limit],
    )
  ).rows;
  for (const o of rows) await requestRefund(tx, o, { escrowPct: 100, refundFee: true, reason: 'event_cancelled' });
  return rows.length;
}

/** Lepaskan reservasi kuota sebuah order (kedaluwarsa / gagal bayar). */
export async function releaseReservation(tx: Client, orderId: string) {
  const items = await tx.query(`SELECT ticket_type_id, quantity FROM order_items WHERE order_id = $1`, [orderId]);
  for (const it of items.rows)
    await tx.query(`UPDATE ticket_types SET reserved = greatest(reserved - $2, 0) WHERE id = $1`, [it.ticket_type_id, it.quantity]);
}

/**
 * Batalkan order yang belum punya invoice — kondisional pada status, jadi kuota dilepas tepat sekali
 * walau dipanggil paralel (request gagal, job pemulihan, expiry). Idempotency-Key dikosongkan agar
 * retry dengan key yang sama membuat order baru, bukan melanjutkan order mati.
 */
export async function releasePendingOrder(tx: Client, orderId: string, status: 'CANCELLED' | 'EXPIRED') {
  const r = await tx.query(
    `UPDATE orders SET status = $2, idempotency_key = NULL WHERE id = $1 AND status = 'RESERVED' AND invoice_id IS NULL RETURNING id`,
    [orderId, status],
  );
  if (r.rowCount) await releaseReservation(tx, orderId);
  return !!r.rowCount;
}

/**
 * Minta invoice ke finance untuk order (dipanggil DI LUAR transaksi). Idempoten di finance per
 * (purpose, reference_id = order id): retry/pemulihan mengembalikan invoice yang sama.
 */
export async function requestInvoice(q: Q, o: any) {
  const d = (
    await q.query(
      `SELECT e.id AS event_id, e.org_id, e.title, string_agg(oi.quantity || '× ' || t.name, ', ' ORDER BY oi.ticket_type_id) AS lines
       FROM orders o JOIN events e ON e.id = o.event_id
       JOIN order_items oi ON oi.order_id = o.id JOIN ticket_types t ON t.id = oi.ticket_type_id
       WHERE o.id = $1 GROUP BY e.id, e.org_id, e.title`,
      [o.id],
    )
  ).rows[0];
  return callService<any>('ticketing', 'finance', '/internal/invoices', {
    method: 'POST',
    body: {
      purpose: 'TICKET_ORDER',
      reference_id: o.id,
      amount: Number(o.total),
      payer_user_id: o.user_id,
      payer_org_id: null,
      description: `Tiket ${d?.title ?? ''} — ${d?.lines ?? ''}`,
      due_at: new Date(o.reserved_until).toISOString(),
      // Escrow dikelompokkan per event (bukan per order) agar bisa dicairkan ke promotor / direfund per event.
      metadata: { event_id: d?.event_id ?? o.event_id, promotor_org_id: d?.org_id },
    },
  });
}
