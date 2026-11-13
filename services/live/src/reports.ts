import type { FastifyInstance } from 'fastify';
import { L, dailySql, fillDaily, type ServiceReport } from '@rave/domain/reports';
import { requireSuperAdmin, type ServiceContext } from '@rave/service-kit';

/** Laporan Live Streaming (Super Admin → Pengaturan Layanan). Moderasi tetap di Divisi Konten → Moderasi Live. */
export async function reportRoutes(app: FastifyInstance, { db }: ServiceContext) {
  app.get('/v1/admin/reports/live', { preHandler: requireSuperAdmin }, async (): Promise<ServiceReport> => {
    const k = await db.one(
      `SELECT count(*) FILTER (WHERE status IN ('LIVE','INTERRUPTED'))::int AS on_air,
              count(*) FILTER (WHERE status = 'SCHEDULED')::int AS scheduled,
              count(*) FILTER (WHERE status = 'ENDED' AND ended_at >= now() - interval '30 days')::int AS ended_30,
              coalesce(max(peak_viewers) FILTER (WHERE started_at >= now() - interval '30 days'), 0)::int AS peak,
              coalesce(sum(total_views) FILTER (WHERE started_at >= now() - interval '30 days'), 0)::int AS views
         FROM streams`,
    );
    const series = await db.query(dailySql('streams', 'started_at'));
    const rows = await db.query(
      `SELECT title, coalesce(artist_name, org_name) AS host, status, access, peak_viewers, total_views, coalesce(started_at, scheduled_at) AS at, is_demo
         FROM streams ORDER BY (status IN ('LIVE','INTERRUPTED')) DESC, coalesce(started_at, scheduled_at, created_at) DESC NULLS LAST LIMIT 30`,
    );
    return {
      kpis: [
        { label: L('Sedang tayang', 'On air'), value: k?.on_air ?? 0, format: 'num', tone: (k?.on_air ?? 0) > 0 ? 'good' : 'neutral' },
        { label: L('Terjadwal', 'Scheduled'), value: k?.scheduled ?? 0, format: 'num' },
        { label: L('Selesai (30 hari)', 'Ended (30 days)'), value: k?.ended_30 ?? 0, format: 'num' },
        { label: L('Puncak penonton (30 hari)', 'Peak viewers (30 days)'), value: k?.peak ?? 0, format: 'num' },
        { label: L('Total tayangan (30 hari)', 'Total views (30 days)'), value: k?.views ?? 0, format: 'num' },
      ],
      series: { label: L('Siaran dimulai per hari', 'Streams started per day'), points: fillDaily(series) },
      table: {
        title: L('Siaran', 'Streams'),
        columns: [
          { key: 'title', label: L('Judul', 'Title') },
          { key: 'host', label: L('Artis / penyelenggara', 'Artist / host') },
          { key: 'status', label: L('Status', 'Status'), format: 'status' },
          { key: 'access', label: L('Akses', 'Access'), format: 'status' },
          { key: 'peak_viewers', label: L('Puncak', 'Peak'), format: 'num' },
          { key: 'total_views', label: L('Tayangan', 'Views'), format: 'num' },
          { key: 'at', label: L('Waktu', 'Time'), format: 'datetime' },
        ],
        rows,
        empty: L('Belum ada siaran', 'No streams yet'),
        link: { label: L('Moderasi siaran', 'Moderate streams'), href: '/admin/live' },
      },
      generated_at: new Date().toISOString(),
    };
  });
}
