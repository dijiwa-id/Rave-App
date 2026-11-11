import type { FastifyInstance } from 'fastify';
import { resolvePlayback, type AudioMeta, type Renditions } from '@rave/domain/audio';
import { callService, HttpError, notFound, settings, signMediaUrl, uuidv7, z, type ServiceContext } from '@rave/service-kit';
import { signStream, verifyStream } from './util.js';

const body = z
  .object({
    track_id: z.string().uuid().optional(),
    episode_id: z.string().uuid().optional(),
    quality: z.enum(['auto', 'low', 'normal', 'high', 'lossless']).default('auto'),
    source: z.enum(['editorial', 'search', 'profile', 'library', 'playlist', 'radio', 'other']).optional(),
  })
  .refine((b) => !!b.track_id !== !!b.episode_id, 'Isi salah satu: track_id atau episode_id');

export async function sessionRoutes(app: FastifyInstance, { db, name }: ServiceContext) {
  /** Entitlement + token pemutaran + URL bertanda tangan (TDD §11.3 alur pemutaran). */
  app.post('/v1/playback/sessions', async (req, reply) => {
    const b = body.parse(req.body ?? {});
    const user = req.user;
    let media: {
      audio_url: string | null;
      duration_ms: number;
      artist_id?: string;
      loudness_gain_db?: number;
      audio_meta?: AudioMeta | null;
      renditions?: Renditions | null;
    };
    if (b.track_id) {
      const t = await callService<any>(name, 'catalog', `/internal/tracks/${b.track_id}/media`).catch((e) => {
        if (e instanceof HttpError && e.status === 404) throw notFound('Lagu');
        throw e;
      });
      if (t.status !== 'LIVE' || !t.audio_url) throw notFound('Lagu');
      media = t;
    } else {
      const e = await callService<any>(name, 'catalog', `/internal/episodes/${b.episode_id}/media`).catch((err) => {
        if (err instanceof HttpError && err.status === 404) throw notFound('Episode');
        throw err;
      });
      if (!e.audio_url) throw notFound('Episode');
      // REQ-POD-02: episode premium hanya untuk pelanggan Premium.
      if (e.is_premium && !user?.premium) throw new HttpError(402, 'Payment Required', 'Episode ini khusus pelanggan Premium', { upgrade_url: '/premium' });
      media = e;
    }

    const id = uuidv7();
    const previewOnly = !user; // REQ-WEB-04: anonim mendapat pratinjau (durasi: streaming.preview_seconds)
    const ttlSec = Math.max(15 * 60, Math.ceil(media.duration_ms / 1000) + 10 * 60);
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    // Hak kualitas: AAC 320 & Lossless (FLAC) khusus Premium; pratinjau anonim selalu standar (packages/domain/src/audio.ts).
    const choice = resolvePlayback({
      requested: b.quality,
      premium: !!user?.premium,
      preview: previewOnly,
      losslessEnabled: settings.bool('streaming.lossless_enabled'),
      renditions: media.renditions,
      master: { url: media.audio_url!, meta: media.audio_meta ?? null },
    });
    if (!choice) {
      // Master lossless tanpa rendisi standar (transcoding belum selesai/dimatikan): jangan bocorkan FLAC ke non-Premium.
      throw new HttpError(503, 'Service Unavailable', 'Versi streaming standar lagu ini sedang diproses. Coba lagi sebentar lagi.', { retry_after_s: 30 });
    }
    const quality = choice.quality;
    // Berkas khusus Premium hanya bisa diambil lewat URL bertanda tangan (catalog memverifikasi; kedaluwarsa bersama sesi).
    const audioUrl = /\.(high\.m4a|lossless\.flac)$/.test(choice.url) ? signMediaUrl(choice.url, ttlSec) : choice.url;
    await db.tx(async (tx) => {
      await tx.query(
        `INSERT INTO sessions (id, user_id, track_id, episode_id, artist_id, quality, codec_label, city, source, preview_only, audio_url, duration_ms, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, to_timestamp($13))`,
        [
          id,
          user && !user.roles.includes('service') ? user.sub : null,
          b.track_id ?? null,
          b.episode_id ?? null,
          media.artist_id ?? null,
          quality,
          choice.codec_label,
          user?.city ?? null,
          b.source ?? 'library',
          previewOnly,
          audioUrl,
          media.duration_ms,
          exp,
        ],
      );
      if (b.track_id && media.artist_id) {
        await tx.query(`INSERT INTO track_artists (track_id, artist_id) VALUES ($1,$2) ON CONFLICT (track_id) DO NOTHING`, [b.track_id, media.artist_id]);
      }
    });
    reply.status(201);
    return {
      session_id: id,
      stream_url: `/v1/playback/stream/${id}?exp=${exp}&sig=${signStream(id, exp)}`,
      expires_at: new Date(exp * 1000).toISOString(),
      quality,
      codec_label: choice.codec_label,
      requested_quality: b.quality,
      /** premium | preview | disabled | unavailable — klien menampilkan alasan (mis. ajakan Premium). */
      quality_capped: choice.capped,
      loudness_gain_db: Number(media.loudness_gain_db ?? 0),
      preview_only: previewOnly,
      preview_ms: previewOnly ? settings.num('streaming.preview_seconds') * 1000 : null,
      duration_ms: media.duration_ms,
    };
  });

  /**
   * URL bertanda tangan TTL pendek → 302 ke origin media.
   * Produksi: manifest HLS/DASH (CMAF, CENC) di CDN + lisensi DRM via proxy; di MVP diarahkan ke file sumber.
   */
  app.get('/v1/playback/stream/:sessionId', async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const q = req.query as { exp?: string; sig?: string };
    if (!q.sig || !verifyStream(sessionId, Number(q.exp), q.sig)) {
      throw new HttpError(403, 'Forbidden', 'Tautan streaming tidak valid atau kedaluwarsa');
    }
    const s = await db.one(`SELECT audio_url FROM sessions WHERE id = $1`, [sessionId]);
    if (!s) throw notFound('Sesi');
    reply.header('cache-control', 'private, no-store');
    return reply.redirect(s.audio_url, 302);
  });
}
