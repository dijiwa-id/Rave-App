import { open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { finished, Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { validateShares } from '@rave/domain';
import {
  audit,
  badRequest,
  conflict,
  forbidden,
  idempotent,
  isAdmin,
  notFound,
  publish,
  requireAuth,
  settings,
  unprocessable,
  uuidv7,
  z,
  type Client,
  type ServiceContext,
  isSuperAdmin,
  hasPermission,
  signMediaUrl,
  MEDIA_PREFIX,
  wakeJob,
} from '@rave/service-kit';
import { isUuid, releaseFull, releasesFull } from './queries.js';
import { canManageArtist } from './routes.js';
import { imageSize, UPLOAD_DIR, uploadsBytes, wavInfo } from './storage.js';
import { ffmpegPath, initialTranscodeStatus, probeAudio } from './audio.js';
import { AUDIO_UPLOAD_TYPES, type AudioMeta } from '@rave/domain/audio';
import { publishArtist } from './artists.js';
import { normalizeArtistLinks } from './artist-links.js';
import { lyricsToText, parseLyrics } from './lyrics.js';
import { formatIsrc, ISRC_MAX_DESIGNATION, normalizeIsrc, normalizeRegistrant, normalizeUpc } from './codes.js';

const trackInput = z.object({
  title: z.string().trim().min(1).max(200),
  duration_ms: z.number().int().min(0).max(4 * 3600_000).optional(),
  // ISO 3901: CC-XXX-YY-NNNNN (atau 12 karakter tanpa tanda hubung) → disimpan dalam bentuk bertanda hubung.
  isrc: z
    .string()
    .trim()
    .max(20)
    .transform((v, ctx) => {
      if (!v) return null;
      const n = normalizeIsrc(v);
      if (!n) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Format ISRC tidak valid (CC-XXX-YY-NNNNN, mis. ID-A1B-26-00001)' });
      return n;
    })
    .optional()
    .nullable(),
  explicit: z.boolean().optional(),
  // Hanya berkas yang diunggah lewat Studio (lolos validasi & transcoding) — URL eksternal ditolak (audit go-live B7).
  audio_url: z
    .string()
    .max(1000)
    .regex(/^\/v1\/catalog\/media\/[\w.-]+$/, 'Audio harus berupa file yang diunggah lewat Artist Studio')
    .optional()
    .nullable(),
});

const releaseInput = z.object({
  artist_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  type: z.enum(['SINGLE', 'EP', 'ALBUM']),
  release_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  genre: z.string().trim().max(60),
  label: z.string().trim().max(120).optional().nullable(),
  cover_url: z.string().max(1000).optional().nullable(),
  explicit: z.boolean().optional(),
  // UPC-A (12 digit) / EAN-13 (13 digit) dengan digit periksa valid; kosong = belum ada (tidak dibuat otomatis).
  upc: z
    .string()
    .trim()
    .max(20)
    .transform((v, ctx) => {
      if (!v) return null;
      const n = normalizeUpc(v);
      if (!n) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'UPC/EAN tidak valid (12 atau 13 digit dengan digit periksa yang benar)' });
      return n;
    })
    .optional()
    .nullable(),
  tracks: z.array(trackInput).max(40).default([]),
});

const splitInput = z.object({ party_name: z.string().trim().min(1).max(120), email: z.string().email().optional().nullable(), pct: z.number().positive().max(100) });

const EDITABLE = ['DRAFT', 'REJECTED'];
/** Rilis yang sudah lolos QC: perubahan metadata lewat pengajuan yang ditinjau QC. */
const PUBLISHED = ['SCHEDULED', 'LIVE'];
const todayWib = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/** Bidang yang boleh diubah setelah rilis lolos QC (UPC, ISRC, audio & tipe rilis terkunci demi distribusi/royalti). */
const releaseChangeInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  genre: z.string().trim().min(1).max(60).optional(),
  label: z.string().trim().max(120).nullable().optional(),
  explicit: z.boolean().optional(),
  release_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tracks: z
    .array(z.object({ id: z.string().uuid(), title: z.string().trim().min(1).max(200).optional(), explicit: z.boolean().optional() }))
    .max(40)
    .optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * Validasi master audio. Dengan ffmpeg: semua format yang dikenali (WAV, FLAC, AIFF, ALAC/AAC-M4A, MP3, OGG, Opus).
 * Tanpa ffmpeg (fallback): hanya header WAV. Master lossless wajib memenuhi minimum `transcoding.min_*`.
 */
async function inspectAudio(path: string, head: Buffer, warnings: string[]): Promise<AudioMeta> {
  let m: AudioMeta | null = null;
  if (ffmpegPath()) m = await probeAudio(path);
  else {
    const w = wavInfo(head);
    if (w) m = { format: 'wav', codec: `pcm_s${w.bitDepth}le`, lossless: true, sample_rate: w.sampleRate, bit_depth: w.bitDepth, channels: 2, bitrate_kbps: 0, duration_ms: w.durationMs };
  }
  if (!m) throw unprocessable('File audio tidak dikenali (didukung: WAV, FLAC, AIFF, ALAC/AAC M4A, MP3, OGG, Opus)');
  if (!m.duration_ms && m.codec !== 'unknown') warnings.push('Durasi tidak terbaca dari berkas');
  if (m.duration_ms && m.duration_ms < 1000) throw unprocessable('Audio terlalu pendek (minimal 1 detik)');
  const minRate = settings.num('transcoding.min_sample_rate_hz') || 44_100;
  const minBits = settings.num('transcoding.min_bit_depth') || 16;
  if (m.lossless) {
    if (m.sample_rate < minRate || m.bit_depth < minBits) throw unprocessable(`Master minimal ${minBits}-bit/${minRate / 1000} kHz (diterima ${m.bit_depth}-bit/${m.sample_rate / 1000} kHz)`);
    if (m.bit_depth < 24) warnings.push('Disarankan master 24-bit');
  } else {
    if (m.sample_rate && m.sample_rate < minRate) throw unprocessable(`Sample rate minimal ${minRate / 1000} kHz (diterima ${m.sample_rate / 1000} kHz)`);
    warnings.push(`Master lossy (${m.codec.toUpperCase()}${m.bitrate_kbps ? ' ' + m.bitrate_kbps + ' kbps' : ''}): hanya tersedia kualitas standar — unggah WAV/FLAC/AIFF/ALAC agar tersedia Lossless untuk pelanggan Premium`);
    if (m.bitrate_kbps && m.bitrate_kbps < 256) warnings.push('Bitrate di bawah 256 kbps: kualitas tinggi (AAC 320) tidak dibuat');
  }
  return m;
}

/** Sampul playlist pengguna: ringan (≤ 8 MB) namun tetap tajam di layar retina (≥ 300 px). */
const PLAYLIST_COVER_MAX_MB = 8;
const PLAYLIST_COVER_MIN_PX = 300;

/** Header yang ditahan di memori untuk validasi (WAV fmt/data, dimensi PNG/JPEG). */
const HEAD_BYTES = 512 * 1024;

/** Hitung byte yang lewat (tolak bila melebihi batas, walau content-length hilang/bohong) dan simpan potongan awal. */
class UploadMeter extends Transform {
  bytes = 0;
  private parts: Buffer[] = [];
  private headLen = 0;
  constructor(private max: number, private maxMb: number) {
    super();
  }
  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
    this.bytes += chunk.length;
    if (this.bytes > this.max) return cb(unprocessable(`Ukuran file melebihi batas ${this.maxMb} MB`));
    if (this.headLen < HEAD_BYTES) {
      const part = Buffer.from(chunk.subarray(0, HEAD_BYTES - this.headLen)); // salin: jangan menahan chunk besar
      this.parts.push(part);
      this.headLen += part.length;
    }
    cb(null, chunk);
  }
  head() {
    return Buffer.concat(this.parts);
  }
}

/**
 * Alirkan body request ke file sementara tanpa buffering penuh.
 * Sumber tidak ikut di-destroy saat batas terlampaui (agar respons 422 tetap terkirim; koneksi ditutup setelahnya).
 */
async function receiveUpload(src: Readable, path: string, maxMb: number) {
  const meter = new UploadMeter(maxMb * 1024 * 1024, maxMb);
  // Buka file lebih dulu (bukan open async di dalam stream) agar rm() pemanggil tidak kalah balapan dengan pembuatan file.
  const fh = await open(path, 'w');
  const done = pipeline(meter, fh.createWriteStream());
  // Klien putus di tengah upload → hentikan pipeline (file .part dibersihkan pemanggil).
  const stop = finished(src, (err) => {
    if (err) meter.destroy(err);
  });
  src.pipe(meter);
  try {
    await done;
  } finally {
    stop();
    src.unpipe(meter);
  }
  return { bytes: meter.bytes, head: meter.head() };
}

/**
 * RAVE sebagai pendaftar ISRC bila artis tidak punya (REQ-STU-01) — hanya bila Super Admin mengisi kode pendaftar resmi
 * (`catalog.isrc_registrant_code`). Kosong/tidak valid → null (tidak ada ISRC palsu; QC melihat "ISRC kosong").
 * Nomor urut per pendaftar & tahun, tidak berputar ulang; kode yang sudah dipakai lagu lain dilewati.
 */
async function generateIsrc(tx: Client): Promise<string | null> {
  const registrant = normalizeRegistrant(settings.get<string>('catalog.isrc_registrant_code'));
  if (!registrant) return null;
  const year = new Date().getFullYear();
  for (;;) {
    const r = await tx.query(
      `INSERT INTO isrc_counters (registrant, year, last_n) VALUES ($1, $2, 1)
       ON CONFLICT (registrant, year) DO UPDATE SET last_n = isrc_counters.last_n + 1, updated_at = now()
       WHERE isrc_counters.last_n < ${ISRC_MAX_DESIGNATION}
       RETURNING last_n`,
      [registrant, year],
    );
    if (!r.rowCount) throw unprocessable(`Kuota ISRC ${registrant} tahun ${year} habis (${ISRC_MAX_DESIGNATION}). Hubungi admin RAVE.`);
    const isrc = formatIsrc(registrant, year, r.rows[0].last_n);
    const used = await tx.query(`SELECT 1 FROM tracks WHERE isrc = $1 LIMIT 1`, [isrc]);
    if (!used.rowCount) return isrc;
  }
}

/** Nama berkas di bucket uploads dari audio_url Studio (`/v1/catalog/media/<file>`), atau null. */
const storedNameOf = (url: string | null | undefined) => (url && url.startsWith(MEDIA_PREFIX) ? url.slice(MEDIA_PREFIX.length) : null);

/**
 * Audio lagu wajib berkas yang diunggah sendiri lewat Studio (upload audio selesai & lolos validasi, bukan gagal transcoding).
 * Mencegah URL eksternal yang melewati validasi/transcoding, dan memakai master milik pengguna lain.
 */
async function assertOwnAudioUpload(q: { query: (sql: string, params: unknown[]) => Promise<any> }, userId: string, url: string | null | undefined) {
  if (url == null) return;
  const name = storedNameOf(url);
  const res = name
    ? await q.query(`SELECT user_id, kind, completed_at, transcode_status FROM uploads WHERE stored_name = $1`, [name])
    : null;
  const u = res ? (Array.isArray(res) ? res[0] : res.rows[0]) : null;
  if (!u || u.kind !== 'audio' || !u.completed_at || u.user_id !== userId) throw unprocessable('Audio harus berupa file master yang Anda unggah lewat Artist Studio');
  if (u.transcode_status === 'failed') throw unprocessable('Pengolahan audio file ini gagal — unggah ulang file master');
}

/** Info pengajuan sampul (khusus Studio/back office — tidak ditampilkan di API publik). */
export async function withCoverReview(q: { query: (sql: string, params: unknown[]) => Promise<any> }, out: any) {
  if (!out) return out;
  const res = await q.query(
    `SELECT pending_cover_url, pending_cover_at, cover_review_note, pending_changes, pending_changes_at, changes_review_note FROM releases WHERE id = $1`,
    [out.id],
  );
  const r = Array.isArray(res) ? res[0] : res.rows[0];
  out.pending_cover = r?.pending_cover_url ? { url: r.pending_cover_url, submitted_at: r.pending_cover_at } : null;
  out.cover_review_note = r?.cover_review_note ?? null;
  out.pending_changes = r?.pending_changes ? { ...r.pending_changes, submitted_at: r.pending_changes_at } : null;
  out.changes_review_note = r?.changes_review_note ?? null;
  return out;
}

/**
 * Sampul rilis harus artwork yang diunggah lewat Artist Studio oleh artis/pengelola rilis ini (bukan URL eksternal /
 * berkas milik orang lain). `null` = hapus sampul (hanya draf).
 */
async function assertOwnArtworkUpload(
  q: { query: (sql: string, params: unknown[]) => Promise<any> },
  userId: string,
  url: string | null | undefined,
  message = 'Sampul harus berupa gambar (JPG/PNG) yang Anda unggah lewat Artist Studio',
) {
  if (url == null) return;
  const name = storedNameOf(url);
  const res = name ? await q.query(`SELECT user_id, kind, completed_at, purpose FROM uploads WHERE stored_name = $1`, [name]) : null;
  const u = res ? (Array.isArray(res) ? res[0] : res.rows[0]) : null;
  if (!u || u.kind !== 'artwork' || !u.completed_at || u.user_id !== userId || u.purpose !== 'release')
    throw unprocessable(message);
}

/** Durasi lagu kosong (0) diisi dari metadata master yang terbaca server — browser tidak bisa membaca durasi AIFF/ALAC dll. */
async function syncAudioDurations(q: { query: (sql: string, params: unknown[]) => Promise<unknown> }, releaseId: string) {
  await q.query(
    `UPDATE tracks t SET duration_ms = (u.audio_meta->>'duration_ms')::int
       FROM uploads u
      WHERE t.release_id = $1 AND t.duration_ms = 0 AND u.audio_meta IS NOT NULL
        AND (u.audio_meta->>'duration_ms')::int > 0
        AND u.stored_name = split_part(t.audio_url, '/v1/catalog/media/', 2)`,
    [releaseId],
  );
}

async function insertTracks(tx: Client, userId: string, releaseId: string, artistId: string, tracks: z.infer<typeof trackInput>[], startNo = 1) {
  let n = startNo;
  for (const t of tracks) {
    await assertOwnAudioUpload(tx, userId, t.audio_url);
    await tx.query(
      `INSERT INTO tracks (id, release_id, artist_id, title, track_number, duration_ms, explicit, isrc, audio_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [uuidv7(), releaseId, artistId, t.title, n++, t.duration_ms ?? 0, t.explicit ?? false, t.isrc ?? (await generateIsrc(tx)), t.audio_url ?? null],
    );
  }
  await syncAudioDurations(tx, releaseId);
}

async function splitsOf(db: { query: (s: string, p?: unknown[]) => Promise<any[]> }, trackId: string) {
  const rows = await db.query(
    `SELECT id, type, party_name, email, pct, approved_at FROM rights_shares WHERE track_id = $1 ORDER BY type, created_at`,
    [trackId],
  );
  const master = rows.filter((r) => r.type === 'MASTER');
  const publishing = rows.filter((r) => r.type === 'PUBLISHING');
  const ok = (s: any[]) => s.length > 0 && validateShares(s.map((x) => ({ partyId: x.id, pct: x.pct }))).ok;
  return { master, publishing, fully_approved: ok(master) && ok(publishing) && rows.every((r) => r.approved_at) };
}

export async function studioRoutes(app: FastifyInstance, ctx: ServiceContext) {
  const { db } = ctx;

  app.register(async (s) => {
    s.addHook('preHandler', requireAuth);

    const assertArtist = (req: any, artistId: string) => {
      if (!canManageArtist(req.user, artistId)) throw forbidden('Anda tidak mengelola artis ini');
    };
    const loadRelease = async (req: any, id: string) => {
      if (!isUuid(id)) throw notFound('Rilis');
      const r = await db.one(`SELECT * FROM releases WHERE id = $1`, [id]);
      if (!r) throw notFound('Rilis');
      assertArtist(req, r.artist_id);
      return r;
    };
    const loadTrack = async (req: any, id: string) => {
      if (!isUuid(id)) throw notFound('Lagu');
      const t = await db.one(`SELECT t.*, r.status AS release_status FROM tracks t JOIN releases r ON r.id = t.release_id WHERE t.id = $1`, [id]);
      if (!t) throw notFound('Lagu');
      assertArtist(req, t.artist_id);
      return t;
    };

    s.get('/v1/studio/artists/:artistId/releases', async (req) => {
      const { artistId } = req.params as { artistId: string };
      assertArtist(req, artistId);
      // Batch (2 query) — sebelumnya 3+ query per rilis secara berurutan.
      const ids = await db.query(`SELECT id FROM releases WHERE artist_id = $1 ORDER BY created_at DESC LIMIT 500`, [artistId]);
      const list = await releasesFull(
        db,
        ids.map((x: { id: string }) => x.id),
        'r.pending_cover_url, r.pending_cover_at, r.cover_review_note, r.pending_changes, r.pending_changes_at, r.changes_review_note',
      );
      const data = list.map(({ artist_id: _a, pending_cover_url, pending_cover_at, cover_review_note, pending_changes, pending_changes_at, changes_review_note, ...r }) => ({
        ...r,
        pending_cover: pending_cover_url ? { url: pending_cover_url, submitted_at: pending_cover_at } : null,
        cover_review_note: cover_review_note ?? null,
        pending_changes: pending_changes ? { ...pending_changes, submitted_at: pending_changes_at } : null,
        changes_review_note: changes_review_note ?? null,
      }));
      return { data };
    });

    s.patch('/v1/studio/artists/:artistId', async (req) => {
      const { artistId } = req.params as { artistId: string };
      assertArtist(req, artistId);
      const b = z
        .object({
          bio: z.string().max(5000).nullable().optional(),
          image_url: z.string().max(1000).nullable().optional(),
          cover_url: z.string().max(1000).nullable().optional(),
          city: z.string().trim().max(80).nullable().optional(),
          genres: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
          links: z.array(z.object({ platform: z.string().max(30), url: z.string().max(1000) })).max(20).optional(),
        })
        .parse(req.body);
      const patch: Record<string, unknown> = { ...b };
      if (b.genres) patch.genres = [...new Set(b.genres)];
      if (b.links) {
        const r = normalizeArtistLinks(b.links);
        if (!r.ok) throw unprocessable(r.error, { field: `links.${r.index}` });
        patch.links = JSON.stringify(r.links);
      }
      return db.tx(async (tx) => {
        const cur = await tx.query(`SELECT image_url, cover_url FROM artists WHERE id = $1 FOR UPDATE`, [artistId]);
        if (!cur.rowCount) throw notFound('Artis');
        // Foto & banner hanya dari unggahan artwork Studio milik pengguna ini; nilai lama (mis. demo-art seed) tetap sah bila tidak diubah.
        for (const k of ['image_url', 'cover_url'] as const) {
          if (b[k] !== undefined && b[k] !== cur.rows[0][k])
            await assertOwnArtworkUpload(tx, req.user!.sub, b[k], 'Foto profil & banner harus berupa gambar (JPG/PNG) yang Anda unggah lewat Artist Studio');
        }
        const sets: string[] = [];
        const vals: unknown[] = [];
        for (const [k, v] of Object.entries(patch)) {
          vals.push(v);
          sets.push(k === 'links' ? `links = $${vals.length}::jsonb` : `${k} = $${vals.length}`);
        }
        if (!sets.length) throw badRequest('Tidak ada perubahan');
        vals.push(artistId);
        await tx.query(`UPDATE artists SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals);
        await audit(tx, { actorId: req.user!.sub, action: 'artist.update', entity: 'artist', entityId: artistId, data: b, ip: req.ip });
        return publishArtist(tx, artistId);
      });
    });

    s.post('/v1/studio/releases', async (req, reply) => {
      const b = releaseInput.parse(req.body);
      assertArtist(req, b.artist_id);
      await assertOwnArtworkUpload(db, req.user!.sub, b.cover_url);
      return idempotent(
        db,
        req,
        reply,
        'release.create',
        async (tx) => {
          const a = await tx.query(`SELECT 1 FROM artists WHERE id = $1`, [b.artist_id]);
          if (!a.rowCount) throw notFound('Artis');
          const id = uuidv7();
          await tx.query(
            `INSERT INTO releases (id, artist_id, title, type, release_date, genre, label, cover_url, explicit, upc)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [id, b.artist_id, b.title, b.type, b.release_date, b.genre, b.label ?? null, b.cover_url ?? null, b.explicit ?? false, b.upc ?? null],
          );
          await insertTracks(tx, req.user!.sub, id, b.artist_id, b.tracks);
          await audit(tx, { actorId: req.user!.sub, action: 'release.create', entity: 'release', entityId: id, ip: req.ip });
          const r = await releaseFull(tx, id);
          delete r.artist_id;
          return { status: 201, body: r };
        },
        { required: false },
      );
    });

    s.patch('/v1/studio/releases/:id', async (req) => {
      const { id } = req.params as { id: string };
      const r = await loadRelease(req, id);
      if (!EDITABLE.includes(r.status)) throw conflict(`Rilis berstatus ${r.status} tidak dapat diubah`);
      const b = releaseInput.omit({ artist_id: true, tracks: true }).partial().parse(req.body);
      if (b.cover_url !== undefined && b.cover_url !== r.cover_url) await assertOwnArtworkUpload(db, req.user!.sub, b.cover_url);
      return db.tx(async (tx) => {
        const sets: string[] = [];
        const vals: unknown[] = [];
        for (const [k, v] of Object.entries(b)) {
          vals.push(v);
          sets.push(`${k} = $${vals.length}`);
        }
        if (sets.length) {
          vals.push(id);
          await tx.query(`UPDATE releases SET ${sets.join(', ')}, status = 'DRAFT', updated_at = now() WHERE id = $${vals.length}`, vals);
        }
        const out = await releaseFull(tx, id);
        delete out.artist_id;
        return out;
      });
    });

    /**
     * Ganti sampul rilis (semua status kecuali diturunkan). DRAFT/REJECTED/IN_REVIEW → langsung diganti.
     * SCHEDULED/LIVE → masuk antrean tinjauan QC; sampul lama tetap tayang sampai disetujui (mencegah penukaran artwork
     * setelah lolos QC). Mengajukan lagi menggantikan pengajuan sebelumnya.
     */
    s.put('/v1/studio/releases/:id/cover', async (req) => {
      const { id } = req.params as { id: string };
      const r = await loadRelease(req, id);
      const { cover_url } = z.object({ cover_url: z.string().max(1000) }).parse(req.body);
      if (r.status === 'TAKEN_DOWN') throw conflict('Rilis yang diturunkan tidak dapat diubah');
      await assertOwnArtworkUpload(db, req.user!.sub, cover_url);
      return db.tx(async (tx) => {
        const live = r.status === 'LIVE' || r.status === 'SCHEDULED';
        if (live) {
          await tx.query(
            `UPDATE releases SET pending_cover_url = $2, pending_cover_at = now(), pending_cover_by = $3, cover_review_note = NULL, updated_at = now() WHERE id = $1`,
            [id, cover_url, req.user!.sub],
          );
          await publish(tx, 'catalog.release.cover_submitted', id, { releaseId: id, artistId: r.artist_id, title: r.title });
        } else {
          await tx.query(`UPDATE releases SET cover_url = $2, pending_cover_url = NULL, pending_cover_at = NULL, pending_cover_by = NULL, updated_at = now() WHERE id = $1`, [id, cover_url]);
        }
        await audit(tx, { actorId: req.user!.sub, action: live ? 'release.cover_submit' : 'release.cover_update', entity: 'release', entityId: id, data: { cover_url }, ip: req.ip });
        const out = await releaseFull(tx, id);
        delete out.artist_id;
        return withCoverReview(tx, out);
      });
    });

    /** Batalkan pengajuan sampul yang belum ditinjau. */
    s.delete('/v1/studio/releases/:id/cover/pending', async (req) => {
      const { id } = req.params as { id: string };
      const r = await loadRelease(req, id);
      if (!r.pending_cover_url) throw conflict('Tidak ada pengajuan sampul yang menunggu');
      await db.query(`UPDATE releases SET pending_cover_url = NULL, pending_cover_at = NULL, pending_cover_by = NULL, updated_at = now() WHERE id = $1`, [id]);
      await audit(db, { actorId: req.user!.sub, action: 'release.cover_withdraw', entity: 'release', entityId: id, ip: req.ip });
      const out = await releaseFull(db, id);
      delete out.artist_id;
      return withCoverReview(db, out);
    });

    /** Tarik rilis dari antrean QC (IN_REVIEW → DRAFT) agar bisa diedit lalu diajukan ulang. */
    s.post('/v1/studio/releases/:id/withdraw', async (req) => {
      const { id } = req.params as { id: string };
      await loadRelease(req, id);
      return db.tx(async (tx) => {
        const u = await tx.query(`UPDATE releases SET status = 'DRAFT', updated_at = now() WHERE id = $1 AND status = 'IN_REVIEW' RETURNING id`, [id]);
        if (!u.rowCount) throw conflict('Hanya rilis yang sedang ditinjau (IN_REVIEW) yang dapat ditarik');
        await audit(tx, { actorId: req.user!.sub, action: 'release.withdraw', entity: 'release', entityId: id, ip: req.ip });
        const out = await releaseFull(tx, id);
        delete out.artist_id;
        return withCoverReview(tx, out);
      });
    });

    /**
     * Ajukan perubahan metadata rilis yang sudah lolos QC (SCHEDULED/LIVE): judul, genre, label, konten eksplisit,
     * tanggal rilis (hanya SCHEDULED, tidak boleh mundur ke masa lalu), judul & eksplisit tiap lagu. Hanya bidang
     * yang benar-benar berubah disimpan; mengajukan lagi menggantikan pengajuan sebelumnya. Data lama tetap tayang.
     */
    s.put('/v1/studio/releases/:id/changes', async (req) => {
      const { id } = req.params as { id: string };
      const r = await loadRelease(req, id);
      if (!PUBLISHED.includes(r.status)) throw conflict(EDITABLE.includes(r.status) ? 'Rilis draf diubah langsung (PATCH), bukan lewat pengajuan' : `Rilis berstatus ${r.status} tidak dapat diubah`);
      const b = releaseChangeInput.parse(req.body);
      const rel: Record<string, unknown> = {};
      const cur = (await db.query(`SELECT title, genre, label, explicit, to_char(release_date,'YYYY-MM-DD') AS release_date FROM releases WHERE id = $1`, [id]))[0];
      for (const k of ['title', 'genre', 'label', 'explicit'] as const) if (b[k] !== undefined && b[k] !== cur[k]) rel[k] = b[k];
      if (b.release_date !== undefined && b.release_date !== cur.release_date) {
        if (r.status !== 'SCHEDULED') throw unprocessable('Tanggal rilis yang sudah tayang tidak dapat diubah');
        if (b.release_date <= todayWib()) throw unprocessable('Tanggal rilis baru harus setelah hari ini');
        rel.release_date = b.release_date;
      }
      const tracks: Record<string, Record<string, unknown>> = {};
      if (b.tracks?.length) {
        const cur = await db.query(`SELECT id, title, explicit FROM tracks WHERE release_id = $1`, [id]);
        const byId = new Map(cur.map((t: any) => [t.id, t]));
        for (const t of b.tracks) {
          const c: any = byId.get(t.id);
          if (!c) throw unprocessable('Lagu tidak termasuk dalam rilis ini', { field: `tracks.${t.id}` });
          const d: Record<string, unknown> = {};
          if (t.title !== undefined && t.title !== c.title) d.title = t.title;
          if (t.explicit !== undefined && t.explicit !== c.explicit) d.explicit = t.explicit;
          if (Object.keys(d).length) tracks[t.id] = d;
        }
      }
      if (!Object.keys(rel).length && !Object.keys(tracks).length) throw badRequest('Tidak ada perubahan');
      const changes = { release: rel, tracks, note: b.note ?? null };
      return db.tx(async (tx) => {
        await tx.query(
          `UPDATE releases SET pending_changes = $2, pending_changes_at = now(), pending_changes_by = $3, changes_review_note = NULL, updated_at = now() WHERE id = $1`,
          [id, JSON.stringify(changes), req.user!.sub],
        );
        await publish(tx, 'catalog.release.changes_submitted', id, { releaseId: id, artistId: r.artist_id, title: r.title });
        await audit(tx, { actorId: req.user!.sub, action: 'release.changes_submit', entity: 'release', entityId: id, data: changes, ip: req.ip });
        const out = await releaseFull(tx, id);
        delete out.artist_id;
        return withCoverReview(tx, out);
      });
    });

    /** Batalkan pengajuan perubahan yang belum ditinjau. */
    s.delete('/v1/studio/releases/:id/changes', async (req) => {
      const { id } = req.params as { id: string };
      const r = await loadRelease(req, id);
      if (!r.pending_changes) throw conflict('Tidak ada pengajuan perubahan yang menunggu');
      await db.query(`UPDATE releases SET pending_changes = NULL, pending_changes_at = NULL, pending_changes_by = NULL, updated_at = now() WHERE id = $1`, [id]);
      await audit(db, { actorId: req.user!.sub, action: 'release.changes_withdraw', entity: 'release', entityId: id, ip: req.ip });
      const out = await releaseFull(db, id);
      delete out.artist_id;
      return withCoverReview(db, out);
    });

    // ---- Lirik (teks biasa / LRC tersinkron) — dikelola artis langsung, semua status kecuali diturunkan ----
    s.get('/v1/studio/tracks/:id/lyrics', async (req) => {
      const { id } = req.params as { id: string };
      await loadTrack(req, id);
      const l = await db.one(`SELECT synced, lines, language, updated_at FROM lyrics WHERE track_id = $1`, [id]);
      if (!l) return { lyrics: null };
      return { lyrics: { synced: l.synced, language: l.language, updated_at: l.updated_at, line_count: l.lines.length, text: lyricsToText(l.synced, l.lines) } };
    });

    s.put('/v1/studio/tracks/:id/lyrics', async (req) => {
      const { id } = req.params as { id: string };
      const t = await loadTrack(req, id);
      if (t.release_status === 'TAKEN_DOWN') throw conflict('Lirik lagu pada rilis yang diturunkan tidak dapat diubah');
      const b = z
        .object({ mode: z.enum(['plain', 'synced']), text: z.string().max(25_000), language: z.string().trim().regex(/^[a-z]{2,3}$/).nullable().optional() })
        .parse(req.body);
      const p = parseLyrics(b.mode, b.text);
      if (!p.ok) throw unprocessable(p.error, { field: 'text', line: p.line });
      if (p.synced && t.duration_ms > 0 && p.lines[p.lines.length - 1]!.time_ms > t.duration_ms + 5000)
        throw unprocessable('Stempel waktu terakhir melebihi durasi lagu — periksa sinkronisasi', { field: 'text' });
      await db.tx(async (tx) => {
        await tx.query(
          `INSERT INTO lyrics (track_id, synced, lines, plain, language, updated_at, updated_by) VALUES ($1,$2,$3,$4,$5, now(), $6)
           ON CONFLICT (track_id) DO UPDATE SET synced = $2, lines = $3, plain = $4, language = $5, updated_at = now(), updated_by = $6`,
          [id, p.synced, JSON.stringify(p.lines), p.plain, b.language ?? null, req.user!.sub],
        );
        await audit(tx, { actorId: req.user!.sub, action: 'track.lyrics_update', entity: 'track', entityId: id, data: { synced: p.synced, lines: p.lines.length }, ip: req.ip });
      });
      return { lyrics: { synced: p.synced, language: b.language ?? null, line_count: p.lines.length, text: lyricsToText(p.synced, p.lines) } };
    });

    s.delete('/v1/studio/tracks/:id/lyrics', async (req) => {
      const { id } = req.params as { id: string };
      const t = await loadTrack(req, id);
      if (t.release_status === 'TAKEN_DOWN') throw conflict('Lirik lagu pada rilis yang diturunkan tidak dapat diubah');
      const d = await db.query(`DELETE FROM lyrics WHERE track_id = $1 RETURNING track_id`, [id]);
      if (!d.length) throw notFound('Lirik');
      await audit(db, { actorId: req.user!.sub, action: 'track.lyrics_delete', entity: 'track', entityId: id, ip: req.ip });
      return { ok: true };
    });

    // Aditif: kelola lagu dalam rilis.
    s.post('/v1/studio/releases/:id/tracks', async (req, reply) => {
      const { id } = req.params as { id: string };
      const r = await loadRelease(req, id);
      if (!EDITABLE.includes(r.status)) throw conflict(`Rilis berstatus ${r.status} tidak dapat diubah`);
      const t = trackInput.parse(req.body);
      return db.tx(async (tx) => {
        const n = await tx.query(`SELECT coalesce(max(track_number), 0) + 1 AS n FROM tracks WHERE release_id = $1`, [id]);
        await insertTracks(tx, req.user!.sub, id, r.artist_id, [t], n.rows[0].n);
        const out = await releaseFull(tx, id);
        delete out.artist_id;
        reply.status(201);
        return out;
      });
    });

    s.patch('/v1/studio/tracks/:id', async (req) => {
      const { id } = req.params as { id: string };
      const t = await loadTrack(req, id);
      if (!EDITABLE.includes(t.release_status)) throw conflict('Lagu pada rilis yang sudah diajukan tidak dapat diubah');
      const b = trackInput.partial().extend({ track_number: z.number().int().min(1).optional() }).parse(req.body);
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const [k, v] of Object.entries(b)) {
        vals.push(v);
        sets.push(`${k} = $${vals.length}`);
      }
      if (!sets.length) throw badRequest('Tidak ada perubahan');
      if (b.audio_url && b.audio_url !== t.audio_url) await assertOwnAudioUpload(db, req.user!.sub, b.audio_url);
      vals.push(id);
      await db.query(`UPDATE tracks SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
      if ('audio_url' in b) await syncAudioDurations(db, t.release_id);
      const out = await releaseFull(db, t.release_id);
      delete out.artist_id;
      return out;
    });

    s.delete('/v1/studio/tracks/:id', async (req) => {
      const { id } = req.params as { id: string };
      const t = await loadTrack(req, id);
      if (!EDITABLE.includes(t.release_status)) throw conflict('Lagu pada rilis yang sudah diajukan tidak dapat dihapus');
      await db.query(`DELETE FROM tracks WHERE id = $1`, [id]);
      return { ok: true };
    });

    // Pratinjau audio lagu (termasuk rilis yang belum tayang) untuk artis pengelola atau reviewer QC (qc.review).
    // Master tidak publik → URL bertanda tangan berumur pendek; tidak membuat sesi playback (tidak tercatat sebagai stream).
    s.get('/v1/studio/tracks/:id/preview', async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Lagu');
      const t = await db.one(
        `SELECT t.artist_id, t.audio_url, u.audio_meta, coalesce(u.renditions, '{}'::jsonb) AS renditions
           FROM tracks t LEFT JOIN uploads u ON t.audio_url LIKE '/v1/catalog/media/%' AND u.stored_name = split_part(t.audio_url, '/v1/catalog/media/', 2)
          WHERE t.id = $1`,
        [id],
      );
      if (!t) throw notFound('Lagu');
      if (!canManageArtist(req.user, t.artist_id) && !hasPermission(req.user, 'qc.review')) throw forbidden('Anda tidak mengelola artis ini');
      if (!t.audio_url) throw notFound('Audio');
      const ttl = 3600;
      const sign = (url: string) => (url.startsWith(MEDIA_PREFIX) ? signMediaUrl(url, ttl) : url);
      // Rendisi standar diputar semua browser; master (AIFF/ALAC dll.) belum tentu — tetap disertakan untuk diperiksa.
      const std = t.renditions?.normal?.url ?? t.renditions?.low?.url ?? null;
      return {
        url: sign(std ?? t.audio_url),
        master_url: sign(t.audio_url),
        expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
      };
    });

    // ---------- Upload (dev: simpan lokal; produksi: presigned URL ke bucket quarantine) ----------
    s.post('/v1/studio/uploads', async (req, reply) => {
      const b = z
        .object({
          kind: z.enum(['audio', 'artwork']),
          /** playlist = sampul playlist pengguna (fan); category = gambar kategori Jelajahi (Super Admin). Gambar saja, ≤ 8 MB, ≥ 300 px. */
          purpose: z.enum(['release', 'playlist', 'category']).default('release'),
          filename: z.string().min(1).max(200),
          // Boleh kosong: browser sering tidak mengenali .flac/.aiff → MIME ditentukan dari ekstensi di bawah.
          content_type: z.string().max(100),
          size: z.number().int().positive(),
        })
        .parse(req.body);
      if (b.kind === 'audio') {
        const ext0 = (b.filename.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? '').toLowerCase();
        const ct = b.content_type.toLowerCase();
        // MIME tak baku/kosong dari browser (x-flac, x-aiff, x-m4a, octet-stream) → MIME standar menurut ekstensi.
        if (AUDIO_UPLOAD_TYPES[ext0] && (!ct.startsWith('audio/') || /^audio\/x-(flac|aiff|m4a)$/.test(ct))) b.content_type = AUDIO_UPLOAD_TYPES[ext0];
      }
      if (b.purpose !== 'release' && b.kind !== 'artwork') throw badRequest('Sampul harus berupa gambar');
      if (b.purpose === 'category' && !hasPermission(req.user, 'catalog.curate')) throw forbidden('Gambar kategori memerlukan izin Kurasi katalog');
      // Kebijakan upload dari pengaturan platform (Super Admin → Storage & Retensi). Sampul playlist dibatasi lebih kecil.
      const maxMb = b.purpose !== 'release' ? Math.min(PLAYLIST_COVER_MAX_MB, settings.num('storage.max_upload_mb')) : settings.num('storage.max_upload_mb');
      if (b.size > maxMb * 1024 * 1024) throw unprocessable(`Ukuran file melebihi batas ${maxMb} MB`);
      const allowed = settings.get<string[]>(b.kind === 'audio' ? 'storage.allowed_audio_types' : 'storage.allowed_image_types');
      if (!allowed.includes(b.content_type.toLowerCase())) throw unprocessable(`Tipe file ${b.content_type} tidak diizinkan untuk ${b.kind} (diizinkan: ${allowed.join(', ')})`);
      if ((await uploadsBytes(db)) + b.size > settings.num('storage.quota_uploads_gb') * 1024 ** 3) throw unprocessable('Kuota penyimpanan upload platform penuh. Hubungi admin RAVE.');
      const id = uuidv7();
      const ext = (b.filename.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? (b.kind === 'audio' ? '.wav' : '.jpg')).toLowerCase();
      // Ekstensi menentukan apakah berkas publik (gambar/rendisi gratis) atau wajib URL bertanda tangan (master) —
      // audio berekstensi gambar (atau sebaliknya) ditolak agar master tidak bisa disajikan tanpa tanda tangan.
      if (b.kind === 'audio' && !AUDIO_UPLOAD_TYPES[ext]) throw unprocessable(`Ekstensi file audio ${ext} tidak didukung (didukung: ${Object.keys(AUDIO_UPLOAD_TYPES).join(', ')})`);
      if (b.kind === 'artwork' && !['.jpg', '.jpeg', '.png'].includes(ext)) throw unprocessable('Gambar harus berekstensi .jpg, .jpeg, atau .png');
      const stored = `${id}${ext}`;
      await db.query(`INSERT INTO uploads (id, user_id, kind, filename, content_type, size, stored_name, purpose) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
        id,
        req.user!.sub,
        b.kind,
        b.filename,
        b.content_type,
        b.size,
        stored,
        b.purpose,
      ]);
      reply.status(201);
      return { upload_id: id, upload_url: `/v1/studio/uploads/${id}`, public_url: `/v1/catalog/media/${stored}` };
    });

    // Status pengolahan audio (format master, rendisi, transcoding) — dipolling Studio setelah upload.
    s.get('/v1/studio/uploads/:id', async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Upload');
      const u = await db.one(
        `SELECT id, kind, filename, size, completed_at, audio_meta, renditions, transcode_status, transcode_error, transcoded_at
           FROM uploads WHERE id = $1 AND user_id = $2`,
        [id, req.user!.sub],
      );
      if (!u) throw notFound('Upload');
      const r = (u.renditions ?? {}) as Record<string, { codec_label: string; bytes?: number }>;
      return { ...u, renditions: Object.fromEntries(Object.entries(r).map(([q, x]) => [q, { codec_label: x.codec_label, bytes: x.bytes ?? null }])) };
    });

    // Body biner upload (audio/artwork) diteruskan sebagai stream mentah — parser hanya berlaku di scope ini, rute JSON lain tidak terpengaruh.
    s.register(async (up) => {
      for (const ct of ['application/octet-stream', /^audio\//, /^image\//] as const) {
        up.addContentTypeParser(ct, (_req, payload, done) => done(null, payload));
      }

      up.put(
        '/v1/studio/uploads/:id',
        {
          // Tolak sebelum body dibaca bila content-length sudah melebihi batas pengaturan.
          // bodyLimit Fastify tidak berlaku untuk parser stream → batas sebenarnya ditegakkan UploadMeter.
          onRequest: async (req) => {
            const len = Number(req.headers['content-length']);
            const maxMb = settings.num('storage.max_upload_mb');
            if (Number.isFinite(len) && len > maxMb * 1024 * 1024) throw unprocessable(`Ukuran file melebihi batas ${maxMb} MB`);
          },
        },
        async (req, reply) => {
          const src = req.body;
          try {
            const { id } = req.params as { id: string };
            if (!isUuid(id)) throw notFound('Upload');
            const u = await db.one(`SELECT * FROM uploads WHERE id = $1 AND user_id = $2`, [id, req.user!.sub]);
            if (!u) throw notFound('Upload');
            // URL media disajikan immutable & bisa sudah lolos QC: file yang selesai tidak boleh ditimpa — buat upload baru.
            if (u.completed_at) throw conflict('Upload ini sudah selesai; buat upload baru untuk mengganti file');
            if (!(src instanceof Readable)) throw badRequest('Body biner kosong (kirim dengan content-type audio/* atau image/*)');
            src.on('error', () => {}); // error socket ditangani lewat finished(); cegah crash bila muncul setelahnya
            const part = join(UPLOAD_DIR, `${u.stored_name}.${uuidv7()}.part`);
            const warnings: string[] = [];
            let meta: Record<string, unknown> = {};
            let audioMeta: AudioMeta | null = null;
            let size = 0;
            try {
              const { bytes, head } = await receiveUpload(src, part, u.purpose !== 'release' ? Math.min(PLAYLIST_COVER_MAX_MB, settings.num('storage.max_upload_mb')) : settings.num('storage.max_upload_mb'));
              size = bytes;
              if (!bytes) throw badRequest('Body biner kosong (kirim dengan content-type audio/* atau image/*)');
              if (u.kind === 'artwork') {
                const dim = imageSize(head);
                if (!dim) throw unprocessable(u.purpose !== 'release' ? 'Sampul harus JPEG/PNG yang valid' : 'Artwork harus JPEG/PNG yang valid');
                meta = dim;
                if (u.purpose !== 'release') {
                  if (Math.min(dim.width, dim.height) < PLAYLIST_COVER_MIN_PX) throw unprocessable(`Sampul minimal ${PLAYLIST_COVER_MIN_PX}×${PLAYLIST_COVER_MIN_PX} px (diterima ${dim.width}×${dim.height})`);
                  if (dim.width !== dim.height) warnings.push('Sampul bukan persegi — ditampilkan terpotong di tengah (1:1)');
                } else {
                  if (dim.width !== dim.height) warnings.push('Artwork sebaiknya persegi (1:1)');
                  if (dim.width < 3000) warnings.push(`Resolusi ${dim.width}×${dim.height} di bawah standar 3000×3000 px`);
                }
              } else {
                audioMeta = await inspectAudio(part, head, warnings);
                meta = { ...audioMeta };
              }
              await rename(part, join(UPLOAD_DIR, u.stored_name)); // atomik: file final tidak pernah setengah jadi
            } catch (e) {
              await rm(part, { force: true }).catch(() => {});
              throw e;
            }
            const transcode = u.kind === 'audio' && audioMeta ? initialTranscodeStatus() : 'none';
            await db.query(`UPDATE uploads SET completed_at = now(), size = $2, audio_meta = $3, transcode_status = $4 WHERE id = $1`, [
              id,
              size,
              audioMeta ? JSON.stringify(audioMeta) : null,
              transcode,
            ]);
            if (transcode === 'pending') await wakeJob(db, 'audio-transcode');
            return { public_url: `/v1/catalog/media/${u.stored_name}`, meta, warnings, transcode_status: transcode };
          } catch (e) {
            // Body belum habis dibaca (ditolak lebih awal) → tutup koneksi setelah respons, jangan menguras sisa upload.
            if (src instanceof Readable && !src.readableEnded) reply.header('connection', 'close');
            throw e;
          }
        },
      );
    });

    // ---------- Submit → IN_REVIEW (validasi §7.4) ----------
    s.post('/v1/studio/releases/:id/submit', async (req) => {
      const { id } = req.params as { id: string };
      const r = await loadRelease(req, id);
      if (!EDITABLE.includes(r.status)) throw conflict(`Rilis sudah berstatus ${r.status}`);
      const tracks = await db.query(
        `SELECT t.id, t.title, t.audio_url, t.isrc, u.id AS upload_id, u.kind AS upload_kind, u.completed_at AS upload_completed_at,
                u.transcode_status, u.transcode_error
           FROM tracks t LEFT JOIN uploads u ON t.audio_url LIKE '/v1/catalog/media/%' AND u.stored_name = split_part(t.audio_url, '/v1/catalog/media/', 2)
          WHERE t.release_id = $1 ORDER BY t.track_number`,
        [id],
      );
      const errors: { path: string; message: string }[] = [];
      if (!r.cover_url) errors.push({ path: 'cover_url', message: 'Artwork wajib diunggah' });
      if (!tracks.length) errors.push({ path: 'tracks', message: 'Minimal satu lagu' });
      if (r.type === 'SINGLE' && tracks.length > 3) errors.push({ path: 'tracks', message: 'Single maksimal 3 lagu' });
      if (!tracks.some((t) => t.audio_url)) errors.push({ path: 'tracks', message: 'Minimal satu lagu memiliki file audio' });
      for (const t of tracks) {
        if (!t.audio_url) errors.push({ path: `tracks.${t.id}.audio_url`, message: `"${t.title}" belum memiliki audio` });
        // Hanya master yang diunggah & lolos validasi Studio — URL eksternal/berkas tak dikenal melewati validasi & transcoding.
        else if (!t.upload_id || t.upload_kind !== 'audio' || !t.upload_completed_at)
          errors.push({ path: `tracks.${t.id}.audio_url`, message: `"${t.title}": audio harus berupa file master yang diunggah lewat Artist Studio` });
        // Tanpa rendisi standar, master lossless tidak bisa diputar pengguna Gratis — unggah ulang bila transcoding gagal.
        if (t.transcode_status === 'failed') errors.push({ path: `tracks.${t.id}.audio_url`, message: `"${t.title}": pengolahan audio gagal (${String(t.transcode_error ?? '').slice(0, 120)}) — unggah ulang file master` });
        const sp = await splitsOf(db, t.id);
        for (const [type, list] of [
          ['MASTER', sp.master],
          ['PUBLISHING', sp.publishing],
        ] as const) {
          const v = validateShares(list.map((x: any) => ({ partyId: x.id, pct: x.pct })));
          if (!v.ok) errors.push({ path: `tracks.${t.id}.splits.${type}`, message: `Split ${type} "${t.title}" harus 100% (sekarang ${v.total}%)` });
        }
      }
      if (errors.length) throw unprocessable('Rilis belum memenuhi syarat pengajuan', { errors });
      return db.tx(async (tx) => {
        await tx.query(`UPDATE releases SET status = 'IN_REVIEW', submitted_at = now(), qc_reason = NULL, updated_at = now() WHERE id = $1`, [id]);
        await publish(tx, 'catalog.release.submitted', id, { releaseId: id, artistId: r.artist_id, title: r.title });
        await audit(tx, { actorId: req.user!.sub, action: 'release.submit', entity: 'release', entityId: id, ip: req.ip });
        const out = await releaseFull(tx, id);
        delete out.artist_id;
        return out;
      });
    });

    // ---------- Split hak (REQ-STU-02) ----------
    s.get('/v1/studio/tracks/:id/splits', async (req) => {
      const { id } = req.params as { id: string };
      await loadTrack(req, id);
      return splitsOf(db, id);
    });

    s.put('/v1/studio/tracks/:id/splits', async (req) => {
      const { id } = req.params as { id: string };
      const t = await loadTrack(req, id);
      if (!EDITABLE.includes(t.release_status) && !isSuperAdmin(req.user)) throw conflict('Split rilis yang sudah diajukan hanya dapat diubah lewat dukungan');
      const b = z.object({ master: z.array(splitInput).min(1).max(20), publishing: z.array(splitInput).min(1).max(20) }).parse(req.body);
      for (const [type, list] of [
        ['MASTER', b.master],
        ['PUBLISHING', b.publishing],
      ] as const) {
        const v = validateShares(list.map((x, i) => ({ partyId: String(i), pct: x.pct })));
        if (!v.ok) throw unprocessable(`Total split ${type} harus 100% (sekarang ${v.total}%)`);
      }
      await db.tx(async (tx) => {
        await tx.query(`DELETE FROM rights_shares WHERE track_id = $1`, [id]);
        for (const [type, list] of [
          ['MASTER', b.master],
          ['PUBLISHING', b.publishing],
        ] as const) {
          for (const x of list) {
            // Pihak tanpa email = org artis/pengelola sendiri → otomatis disetujui oleh pengubah. Lainnya menunggu persetujuan.
            const self = !x.email || x.email.toLowerCase() === req.user!.email?.toLowerCase();
            const splitId = uuidv7();
            await tx.query(
              `INSERT INTO rights_shares (id, track_id, type, party_name, email, pct, invite_token, approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [splitId, id, type, x.party_name, x.email ?? null, x.pct, self ? null : uuidv7(), self ? new Date() : null],
            );
            // Undangan persetujuan dikirim ke email pihak (sebelumnya token dibuat tapi tidak pernah dikirim — audit go-live).
            if (!self && x.email) {
              const info = (await tx.query(`SELECT t.title, a.name FROM tracks t JOIN artists a ON a.id = t.artist_id WHERE t.id = $1`, [id])).rows[0];
              await publish(tx, 'catalog.split.invited', splitId, {
                splitId, trackId: id, trackTitle: info?.title ?? '', artistName: info?.name ?? '', email: x.email.toLowerCase(), type, pct: x.pct, invitedBy: req.user!.name ?? req.user!.email ?? 'Artist Studio',
              });
            }
          }
        }
        await audit(tx, { actorId: req.user!.sub, action: 'splits.update', entity: 'track', entityId: id, data: b, ip: req.ip });
      });
      return splitsOf(db, id);
    });

    s.post('/v1/studio/splits/:splitId/approve', async (req) => {
      const { splitId } = req.params as { splitId: string };
      if (!isUuid(splitId)) throw notFound('Split');
      const sp = await db.one(`SELECT rs.*, t.artist_id FROM rights_shares rs JOIN tracks t ON t.id = rs.track_id WHERE rs.id = $1`, [splitId]);
      if (!sp) throw notFound('Split');
      const mine = sp.email && sp.email.toLowerCase() === req.user!.email?.toLowerCase();
      if (!mine && !(canManageArtist(req.user, sp.artist_id) && !sp.email)) throw forbidden('Hanya pihak yang diundang dapat menyetujui split ini');
      const out = await db.one(
        `UPDATE rights_shares SET approved_at = coalesce(approved_at, now()) WHERE id = $1 RETURNING id, type, party_name, email, pct, approved_at`,
        [splitId],
      );
      await audit(db, { actorId: req.user!.sub, action: 'splits.approve', entity: 'rights_share', entityId: splitId, ip: req.ip });
      return out;
    });

    // Aditif: split yang menunggu persetujuan user (berdasar email token).
    s.get('/v1/studio/splits/pending', async (req) => {
      const data = await db.query(
        `SELECT rs.id, rs.type, rs.party_name, rs.email, rs.pct, rs.approved_at, t.id AS track_id, t.title AS track_title, a.name AS artist_name
         FROM rights_shares rs JOIN tracks t ON t.id = rs.track_id JOIN artists a ON a.id = t.artist_id
         WHERE lower(rs.email) = lower($1) AND rs.approved_at IS NULL ORDER BY rs.created_at`,
        [req.user!.email ?? ''],
      );
      return { data };
    });
  });
}
