import type { FastifyInstance } from 'fastify';
import { L, dailySql, fillDaily, type ServiceReport } from '@rave/domain/reports';
import { requireSuperAdmin, type ServiceContext } from '@rave/service-kit';

/** Laporan Tiket & Refund (Super Admin → Pengaturan Layanan). */
export async function reportRoutes(app: FastifyInstance, { db }: ServiceContext) {
  app.get('/v1/admin/reports/ticketing', { preHandler: requireSuperAdmin }, async (): Promise<ServiceReport> => {
    const k = await db.one(
      `SELECT (SELECT count(*) FROM events WHERE status = 'PUBLISHED' AND starts_at >= now())::int AS upcoming,
              (SELECT count(*) FROM tickets t JOIN orders o ON o.id = t.order_id WHERE t.status <> 'REFUNDED' AND o.paid_at >= now() - interval '30 days')::int AS sold_30,
              (SELECT coalesce(sum(total), 0) FROM orders WHERE status = 'PAID' AND paid_at >= now() - interval '30 days')::bigint AS gmv_30,
              (SELECT count(*) FROM orders WHERE refund_status IN ('PENDING','REVIEW','FAILED'))::int AS refunds,
              (SELECT count(*) FROM checkins WHERE checked_in_at >= now() - interval '30 days')::int AS checkins`,
    );
    const series = await db.query(dailySql('orders', 'paid_at', 'coalesce(sum(total), 0)', "status = 'PAID'"));
    const rows = await db.query(
      `SELECT e.title, e.city, e.starts_at, e.status,
              (SELECT count(*) FROM tickets t WHERE t.event_id = e.id AND t.status <> 'REFUNDED')::int AS sold,
              (SELECT coalesce(sum(o.total), 0) FROM orders o WHERE o.event_id = e.id AND o.status = 'PAID')::bigint AS revenue,
              (SELECT count(*) FROM checkins c WHERE c.event_id = e.id)::int AS checkins
         FROM events e ORDER BY e.starts_at DESC LIMIT 30`,
    );
    return {
      kpis: [
        { label: L('Event mendatang', 'Upcoming events'), value: k?.upcoming ?? 0, format: 'num' },
        { label: L('Tiket terjual (30 hari)', 'Tickets sold (30 days)'), value: k?.sold_30 ?? 0, format: 'num' },
        { label: L('Penjualan (30 hari)', 'Sales (30 days)'), value: Number(k?.gmv_30 ?? 0), format: 'idr' },
        { label: L('Refund diproses', 'Refunds in progress'), value: k?.refunds ?? 0, format: 'num', tone: (k?.refunds ?? 0) > 0 ? 'warn' : 'good' },
        { label: L('Check-in (30 hari)', 'Check-ins (30 days)'), value: k?.checkins ?? 0, format: 'num' },
      ],
      series: { label: L('Penjualan tiket per hari', 'Ticket sales per day'), format: 'idr', points: fillDaily(series) },
      table: {
        title: L('Event', 'Events'),
        columns: [
          { key: 'title', label: L('Event', 'Event') },
          { key: 'city', label: L('Kota', 'City') },
          { key: 'starts_at', label: L('Mulai', 'Starts'), format: 'datetime' },
          { key: 'status', label: L('Status', 'Status'), format: 'status' },
          { key: 'sold', label: L('Terjual', 'Sold'), format: 'num' },
          { key: 'revenue', label: L('Pendapatan', 'Revenue'), format: 'idr' },
          { key: 'checkins', label: L('Check-in', 'Check-ins'), format: 'num' },
        ],
        rows: rows.map((r) => ({ ...r, revenue: Number(r.revenue) })),
        empty: L('Belum ada event', 'No events yet'),
        link: { label: L('Antrean refund', 'Refund queue'), href: '/admin/finance' },
      },
      generated_at: new Date().toISOString(),
    };
  });
}
