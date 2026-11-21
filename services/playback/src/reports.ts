import type { FastifyInstance } from 'fastify';
import { L, dailySql, fillDaily, type ServiceReport } from '@rave/domain/reports';
import { callService, requireSuperAdmin, type ServiceContext } from '@rave/service-kit';

/** Nama lagu & artis dari catalog (satu panggilan batch); gagal → tampilkan id singkat. */
async function names(tracks: string[], artists: string[]) {
  try {
    return await callService<{ tracks: Record<string, string>; artists: Record<string, string> }>('playback', 'catalog', '/internal/names', { method: 'POST', body: { tracks, artists } });
  } catch {
    return { tracks: {}, artists: {} };
  }
}
const short = (id: string) => `${id.slice(0, 8)}…`;

/** Laporan Streaming & Royalti (Super Admin → Pengaturan Layanan). */
export async function reportRoutes(app: FastifyInstance, { db }: ServiceContext) {
  app.get('/v1/admin/reports/streaming', { preHandler: requireSuperAdmin }, async (): Promise<ServiceReport> => {
    const k = await db.one(
      // Satu pindaian per tabel (FILTER), sessions memakai indeks BRIN created_at (migrasi 004).
      `SELECT q.streams, q.listeners, q.suspicious, s.sessions_24h, s.preview_pct
         FROM (SELECT count(*) FILTER (WHERE NOT suspicious)::int AS streams, count(DISTINCT user_id) FILTER (WHERE NOT suspicious)::int AS listeners,
                      count(*) FILTER (WHERE suspicious)::int AS suspicious
                 FROM qualified_streams WHERE at >= now() - interval '30 days') q,
              (SELECT count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS sessions_24h,
                      (count(*) FILTER (WHERE preview_only) * 100.0 / greatest(count(*), 1))::float AS preview_pct
                 FROM sessions WHERE created_at >= now() - interval '30 days') s`,
    );
    const total = (k?.streams ?? 0) + (k?.suspicious ?? 0);
    const series = await db.query(dailySql('qualified_streams', 'at', 'count(*)', 'NOT suspicious'));
    const top = await db.query(
      `SELECT track_id, artist_id, count(*) FILTER (WHERE NOT suspicious)::int AS streams, count(DISTINCT user_id) FILTER (WHERE NOT suspicious)::int AS listeners,
              count(*) FILTER (WHERE suspicious)::int AS suspicious
         FROM qualified_streams WHERE at >= now() - interval '30 days' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20`,
    );
    const n = await names(top.map((r) => r.track_id), top.map((r) => r.artist_id));
    return {
      kpis: [
        { label: L('Stream qualified (30 hari)', 'Qualified streams (30 days)'), value: k?.streams ?? 0, format: 'num' },
        { label: L('Pendengar unik (30 hari)', 'Unique listeners (30 days)'), value: k?.listeners ?? 0, format: 'num' },
        { label: L('Ditandai fraud', 'Flagged as fraud'), value: total ? ((k?.suspicious ?? 0) * 100) / total : 0, format: 'pct', tone: (k?.suspicious ?? 0) > 0 ? 'warn' : 'good', hint: L(`${k?.suspicious ?? 0} stream tidak dihitung royalti`, `${k?.suspicious ?? 0} streams excluded from royalties`) },
        { label: L('Sesi putar (24 jam)', 'Play sessions (24 h)'), value: k?.sessions_24h ?? 0, format: 'num' },
        { label: L('Sesi pratinjau tamu', 'Guest preview sessions'), value: k?.preview_pct ?? 0, format: 'pct' },
      ],
      series: { label: L('Stream qualified per hari', 'Qualified streams per day'), points: fillDaily(series) },
      table: {
        title: L('Lagu teratas — 30 hari', 'Top tracks — 30 days'),
        columns: [
          { key: 'track', label: L('Lagu', 'Track') },
          { key: 'artist', label: L('Artis', 'Artist') },
          { key: 'streams', label: L('Stream', 'Streams'), format: 'num' },
          { key: 'listeners', label: L('Pendengar', 'Listeners'), format: 'num' },
          { key: 'suspicious', label: L('Fraud', 'Fraud'), format: 'num' },
        ],
        rows: top.map((r) => ({ track: n.tracks[r.track_id] ?? short(r.track_id), artist: n.artists[r.artist_id] ?? short(r.artist_id), streams: r.streams, listeners: r.listeners, suspicious: r.suspicious })),
        empty: L('Belum ada stream qualified', 'No qualified streams yet'),
      },
      generated_at: new Date().toISOString(),
    };
  });

  // Pratinjau dasar royalti (perhitungan & statement belum dibangun): stream qualified per artis bulan berjalan.
  // Laporan royalti dilayani finance (pemilik periode & statement): GET /v1/admin/reports/royalty.
}
