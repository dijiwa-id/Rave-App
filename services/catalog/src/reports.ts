import type { FastifyInstance } from 'fastify';
import { L, dailySql, fillDaily, type ServiceReport } from '@rave/domain/reports';
import { requireService, requireSuperAdmin, z, type ServiceContext } from '@rave/service-kit';

/** Laporan Transcoding Audio + lookup nama untuk laporan service lain. */
export async function reportRoutes(app: FastifyInstance, { db }: ServiceContext) {
  app.get('/v1/admin/reports/transcoding', { preHandler: requireSuperAdmin }, async (): Promise<ServiceReport> => {
    const k = await db.one(
      `SELECT count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS uploads,
              count(*) FILTER (WHERE kind = 'audio' AND completed_at IS NOT NULL)::int AS masters,
              count(*) FILTER (WHERE transcode_status IN ('pending','processing'))::int AS queue,
              count(*) FILTER (WHERE transcode_status = 'failed')::int AS failed,
              count(*) FILTER (WHERE transcode_status = 'done')::int AS done,
              coalesce(sum(size) FILTER (WHERE completed_at IS NOT NULL), 0)::bigint AS bytes
         FROM uploads`,
    );
    const series = await db.query(dailySql('uploads', 'created_at'));
    const rows = await db.query(
      `SELECT filename, kind, purpose, size, transcode_status, transcode_error, audio_meta->>'codec' AS codec, audio_meta->>'sample_rate' AS sample_rate,
              created_at, transcoded_at, completed_at IS NOT NULL AS completed
         FROM uploads ORDER BY created_at DESC LIMIT 30`,
    );
    return {
      kpis: [
        { label: L('Unggahan (30 hari)', 'Uploads (30 days)'), value: k?.uploads ?? 0, format: 'num' },
        { label: L('Master audio', 'Audio masters'), value: k?.masters ?? 0, format: 'num' },
        { label: L('Rendisi selesai', 'Renditions done'), value: k?.done ?? 0, format: 'num', tone: 'good' },
        { label: L('Antrean transcoding', 'Transcoding queue'), value: k?.queue ?? 0, format: 'num', tone: (k?.queue ?? 0) > 5 ? 'warn' : 'neutral' },
        { label: L('Gagal', 'Failed'), value: k?.failed ?? 0, format: 'num', tone: (k?.failed ?? 0) > 0 ? 'bad' : 'good' },
        { label: L('Total ukuran berkas', 'Total file size'), value: Number(k?.bytes ?? 0), format: 'bytes' },
      ],
      series: { label: L('Unggahan per hari', 'Uploads per day'), points: fillDaily(series) },
      table: {
        title: L('Unggahan terbaru', 'Latest uploads'),
        columns: [
          { key: 'filename', label: L('Berkas', 'File') },
          { key: 'type', label: L('Jenis', 'Type') },
          { key: 'format', label: L('Format', 'Format') },
          { key: 'size', label: L('Ukuran', 'Size'), format: 'bytes' },
          { key: 'status', label: L('Status', 'Status'), format: 'status' },
          { key: 'created_at', label: L('Diunggah', 'Uploaded'), format: 'datetime' },
        ],
        rows: rows.map((r) => ({
          filename: r.filename,
          type: r.kind === 'audio' ? 'Audio' : ({ release: 'Artwork', playlist: 'Sampul playlist', category: 'Gambar kategori', avatar: 'Foto profil' } as Record<string, string>)[r.purpose] ?? r.purpose,
          format: r.codec ? `${r.codec}${r.sample_rate ? ` · ${Math.round(Number(r.sample_rate) / 100) / 10} kHz` : ''}` : '—',
          size: Number(r.size),
          status: !r.completed ? 'UPLOADING' : r.kind === 'audio' ? String(r.transcode_status ?? 'none').toUpperCase() : 'READY',
          created_at: r.created_at,
        })),
        empty: L('Belum ada unggahan', 'No uploads yet'),
      },
      generated_at: new Date().toISOString(),
    };
  });

  // Registri hak untuk royalti (finance): lagu + ISRC + artis + org artis + split MASTER/PUBLISHING (REQ-ROY-01).
  app.post('/internal/royalty/rights', { preHandler: requireService }, async (req) => {
    const b = z.object({ track_ids: z.array(z.string().uuid()).max(5000) }).parse(req.body);
    if (!b.track_ids.length) return { data: [] };
    const tracks = await db.query(
      `SELECT t.id AS track_id, t.title, t.isrc, t.duration_ms, t.artist_id, a.name AS artist_name, a.org_id AS artist_org_id, r.title AS release_title, r.upc, r.label
         FROM tracks t JOIN artists a ON a.id = t.artist_id JOIN releases r ON r.id = t.release_id WHERE t.id = ANY($1)`,
      [b.track_ids],
    );
    const shares = await db.query(`SELECT track_id, type, party_name, lower(email) AS email, pct, approved_at FROM rights_shares WHERE track_id = ANY($1) ORDER BY type, created_at`, [b.track_ids]);
    const by = new Map<string, any[]>();
    for (const s of shares) by.set(s.track_id, [...(by.get(s.track_id) ?? []), { type: s.type, party_name: s.party_name, email: s.email, pct: Number(s.pct), approved: !!s.approved_at }]);
    return { data: tracks.map((t) => ({ ...t, shares: by.get(t.track_id) ?? [] })) };
  });

  // Nama lagu & artis untuk laporan service lain (token service).
  app.post('/internal/names', { preHandler: requireService }, async (req) => {
    const b = z.object({ tracks: z.array(z.string().uuid()).max(200).default([]), artists: z.array(z.string().uuid()).max(200).default([]) }).parse(req.body);
    const [t, a] = await Promise.all([
      b.tracks.length ? db.query(`SELECT id, title FROM tracks WHERE id = ANY($1)`, [b.tracks]) : [],
      b.artists.length ? db.query(`SELECT id, name FROM artists WHERE id = ANY($1)`, [b.artists]) : [],
    ]);
    return { tracks: Object.fromEntries(t.map((r: any) => [r.id, r.title])), artists: Object.fromEntries(a.map((r: any) => [r.id, r.name])) };
  });
}
