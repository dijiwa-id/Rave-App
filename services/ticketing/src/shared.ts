import type { Client } from '@gema/service-kit';

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
  };
}

/** Lepaskan reservasi kuota sebuah order (kedaluwarsa / gagal bayar). */
export async function releaseReservation(tx: Client, orderId: string) {
  const items = await tx.query(`SELECT ticket_type_id, quantity FROM order_items WHERE order_id = $1`, [orderId]);
  for (const it of items.rows)
    await tx.query(`UPDATE ticket_types SET reserved = greatest(reserved - $2, 0) WHERE id = $1`, [it.ticket_type_id, it.quantity]);
}
