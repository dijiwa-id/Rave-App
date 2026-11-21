import type { FastifyInstance } from 'fastify';
import { L, dailySql, fillDaily, type ServiceReport } from '@rave/domain/reports';
import { SHARE_CLIENTS, SHARE_EVENT_PLATFORMS, SHARE_PLATFORMS, parseHashtags, renderShareText, shareIntentUrl, type TrackShare } from '@rave/domain/share';
import { notFound, publicWebUrl, requireSuperAdmin, settings, uuidv7, z, type ServiceContext } from '@rave/service-kit';
import { isUuid } from './queries.js';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { UPLOAD_DIR } from './storage.js';
import { demoArtFile } from './demo-art.js';
import { shareOgImage } from './image-variants.js';

/** Path lokal sampul (upload / demo-art) untuk komposit gambar pratinjau; sampul eksternal → null (kartu logo saja). */
async function localCover(cover: string | null): Promise<string | null> {
  const m = cover ? /^\/v1\/catalog\/(media|demo-art)\/([\w.-]+)$/.exec(cover.split('?')[0]) : null;
  if (!m) return null;
  if (m[1] === 'demo-art') return demoArtFile(m[2]);
  const p = join(UPLOAD_DIR, m[2]);
  return existsSync(p) && statSync(p).isFile() ? p : null;
}
/** Kunci cache gambar pratinjau: lagu + sampul (sampul berganti → URL & gambar baru). */
const ogKey = (id: string, cover: string | null) => `${id}-${(cover ?? 'none').split('/').pop()!.split('?')[0]}`;

const LIVE_TRACK = `FROM tracks t JOIN releases r ON r.id = t.release_id JOIN artists a ON a.id = r.artist_id WHERE t.id = $1 AND r.status = 'LIVE'`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** URL absolut sampul (media upload → varian WebP 1280 px untuk kartu pratinjau). */
function absoluteCover(cover: string | null): string | null {
  if (!cover) return null;
  if (/^https?:\/\//.test(cover)) return cover;
  const sized = cover.startsWith('/v1/catalog/media/') && !cover.includes('?') ? `${cover}?w=1280` : cover;
  return `${publicWebUrl()}${sized}`;
}

/**
 * Bagikan lagu ke Instagram, X & Facebook (player web, desktop, mobile):
 * - GET  /v1/catalog/tracks/:id/share  → teks/tagar/tautan siap pakai (template Super Admin, grup `share`)
 * - POST /v1/catalog/tracks/:id/share  → catat klik bagikan (statistik; anonim boleh, tidak pernah memblokir klien)
 * - GET  /v1/catalog/share/t/:id       → halaman publik ber-meta Open Graph (kartu pratinjau X/Facebook/WhatsApp),
 *                                        lalu mengarahkan pengunjung ke lagu di web player. Tautan pendek: /s/t/:id.
 * - GET  /v1/admin/reports/share       → laporan Super Admin.
 */
export async function shareRoutes(app: FastifyInstance, { db }: ServiceContext) {
  const enabledPlatforms = () => SHARE_PLATFORMS.filter((p) => settings.get<boolean>(`share.${p}_enabled`) !== false);

  async function trackInfo(id: string) {
    if (!isUuid(id)) return null;
    return db.one<{ id: string; title: string; artist: string; cover_url: string | null }>(`SELECT t.id, t.title, a.name AS artist, r.cover_url ${LIVE_TRACK}`, [id]);
  }

  app.get('/v1/catalog/tracks/:id/share', async (req): Promise<TrackShare> => {
    if (settings.get<boolean>('share.enabled') === false) throw notFound('Fitur bagikan');
    const t = await trackInfo((req.params as { id: string }).id);
    if (!t) throw notFound('Lagu');
    const url = `${publicWebUrl()}/s/t/${t.id}`;
    const text = renderShareText(settings.get<string>('share.message_template') || '"{title}" — {artist}', { title: t.title, artist: t.artist, app: settings.get<string>('general.platform_name') || 'RAVE' });
    const hashtags = parseHashtags(settings.get<string>('share.hashtags') ?? '');
    return {
      track_id: t.id,
      title: t.title,
      artist: t.artist,
      url,
      text,
      hashtags,
      image_url: absoluteCover(t.cover_url),
      platforms: enabledPlatforms().map((id) => ({ id, url: shareIntentUrl(id, { url, text, hashtags }) })),
    };
  });

  app.post('/v1/catalog/tracks/:id/share', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ platform: z.enum(SHARE_EVENT_PLATFORMS), client: z.enum(SHARE_CLIENTS) }).parse(req.body);
    if (!isUuid(id)) throw notFound('Lagu');
    // Hanya lagu tayang; tanpa baris = 404. Statistik saja → tidak ada efek samping lain.
    const ins = await db.query(`INSERT INTO track_shares (id, track_id, platform, client, user_id) SELECT $2, t.id, $3, $4, $5 ${LIVE_TRACK} RETURNING id`, [
      id,
      uuidv7(),
      b.platform,
      b.client,
      req.user?.sub ?? null,
    ]);
    if (!ins.length && !(await trackInfo(id))) throw notFound('Lagu');
    return reply.status(204).send();
  });

  app.get('/v1/catalog/share/t/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const web = publicWebUrl();
    const t = await trackInfo(id);
    const target = t ? `${web}/app/track/${t.id}` : `${web}/app`;
    const name = settings.get<string>('general.platform_name') || 'RAVE';
    const title = t ? `${t.title} — ${t.artist}` : name;
    const desc = t ? renderShareText(settings.get<string>('share.message_template') || '"{title}" — {artist}', { title: t.title, artist: t.artist, app: name }) : `Dengarkan musik DIY & indie di ${name}.`;
    // Gambar pratinjau dengan logo RAVE asli (komposit ffmpeg, di-cache); `v` ikut sampul agar crawler mengambil ulang.
    const img = t ? `${web}/v1/catalog/share/t/${t.id}/og.jpg?v=${encodeURIComponent(ogKey(t.id, t.cover_url).slice(37, 77))}` : null;
    const meta = [
      ['og:type', 'music.song'],
      ['og:site_name', name],
      ['og:title', title],
      ['og:description', desc],
      ['og:url', `${web}/s/t/${id}`],
      ...(img ? [['og:image', img]] : []),
      ['twitter:card', img ? 'summary_large_image' : 'summary'],
      ['twitter:title', title],
      ['twitter:description', desc],
      ...(img ? [['twitter:image', img]] : []),
    ]
      .map(([k, v]) => `<meta ${k.startsWith('og:') ? 'property' : 'name'}="${k}" content="${esc(v)}">`)
      .join('\n');
    const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(target)}">
${meta}
<meta http-equiv="refresh" content="0;url=${esc(target)}"></head>
<body style="background:#181818;color:#ededed;font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0">
<p><a href="${esc(target)}" style="color:#F4C21F">${esc(title)}</a></p>
<script>location.replace(${JSON.stringify(target).replace(/</g, '\\u003c')})</script></body></html>`;
    // Kartu pratinjau di-cache crawler; versi singkat agar judul/sampul baru cepat terbawa.
    return reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'public, max-age=300').status(t ? 200 : 404).send(html);
  });

  app.get('/v1/catalog/share/t/:id/og.jpg', async (req, reply) => {
    const t = await trackInfo((req.params as { id: string }).id);
    if (!t) throw notFound('Lagu');
    const file = await shareOgImage(ogKey(t.id, t.cover_url), await localCover(t.cover_url));
    if (!file) {
      // ffmpeg tidak tersedia → arahkan ke sampul apa adanya (pratinjau tetap bergambar).
      const cover = absoluteCover(t.cover_url);
      if (cover) return reply.redirect(cover, 302);
      throw notFound('Gambar');
    }
    return reply
      .header('content-type', 'image/jpeg')
      .header('cache-control', 'public, max-age=86400')
      .header('content-length', statSync(file).size)
      .send(createReadStream(file));
  });

  app.get('/v1/admin/reports/share', { preHandler: requireSuperAdmin }, async (): Promise<ServiceReport> => {
    const k = await db.one(
      `SELECT count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS total,
              count(*) FILTER (WHERE created_at >= now() - interval '30 days' AND platform = 'instagram')::int AS instagram,
              count(*) FILTER (WHERE created_at >= now() - interval '30 days' AND platform = 'x')::int AS x,
              count(*) FILTER (WHERE created_at >= now() - interval '30 days' AND platform = 'facebook')::int AS facebook,
              count(*) FILTER (WHERE created_at >= now() - interval '30 days' AND platform IN ('copy','system'))::int AS other,
              count(DISTINCT track_id) FILTER (WHERE created_at >= now() - interval '30 days')::int AS tracks
         FROM track_shares`,
    );
    const series = await db.query(dailySql('track_shares', 'created_at'));
    const rows = await db.query(
      `SELECT t.title, a.name AS artist, count(*)::int AS total,
              count(*) FILTER (WHERE s.platform = 'instagram')::int AS instagram,
              count(*) FILTER (WHERE s.platform = 'x')::int AS x,
              count(*) FILTER (WHERE s.platform = 'facebook')::int AS facebook,
              max(s.created_at) AS last_at
         FROM track_shares s JOIN tracks t ON t.id = s.track_id JOIN releases r ON r.id = t.release_id JOIN artists a ON a.id = r.artist_id
        WHERE s.created_at >= now() - interval '30 days'
        GROUP BY t.id, t.title, a.name ORDER BY total DESC, last_at DESC LIMIT 20`,
    );
    return {
      kpis: [
        { label: L('Dibagikan (30 hari)', 'Shares (30 days)'), value: k?.total ?? 0, format: 'num' },
        { label: L('Instagram', 'Instagram'), value: k?.instagram ?? 0, format: 'num' },
        { label: L('X', 'X'), value: k?.x ?? 0, format: 'num' },
        { label: L('Facebook', 'Facebook'), value: k?.facebook ?? 0, format: 'num' },
        { label: L('Salin tautan / lainnya', 'Copy link / other'), value: k?.other ?? 0, format: 'num' },
        { label: L('Lagu yang dibagikan', 'Tracks shared'), value: k?.tracks ?? 0, format: 'num' },
      ],
      series: { label: L('Bagikan per hari', 'Shares per day'), points: fillDaily(series) },
      table: {
        title: L('Lagu paling banyak dibagikan (30 hari)', 'Most shared tracks (30 days)'),
        columns: [
          { key: 'title', label: L('Lagu', 'Track') },
          { key: 'artist', label: L('Artis', 'Artist') },
          { key: 'total', label: L('Total', 'Total'), format: 'num' },
          { key: 'instagram', label: L('Instagram', 'Instagram'), format: 'num' },
          { key: 'x', label: L('X', 'X'), format: 'num' },
          { key: 'facebook', label: L('Facebook', 'Facebook'), format: 'num' },
          { key: 'last_at', label: L('Terakhir', 'Last'), format: 'datetime' },
        ],
        rows,
        empty: L('Belum ada lagu yang dibagikan.', 'No tracks shared yet.'),
      },
      generated_at: new Date().toISOString(),
    };
  });
}
