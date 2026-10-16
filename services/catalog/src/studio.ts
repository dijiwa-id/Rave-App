import { open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { finished, Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { validateShares } from '@gema/domain';
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
} from '@gema/service-kit';
import { isUuid, releaseFull } from './queries.js';
import { canManageArtist } from './routes.js';
import { imageSize, UPLOAD_DIR, uploadsBytes, wavInfo } from './storage.js';
import { publishArtist } from './artists.js';

const trackInput = z.object({
  title: z.string().trim().min(1).max(200),
  duration_ms: z.number().int().min(0).max(4 * 3600_000).optional(),
  isrc: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}-?[A-Z0-9]{3}-?\d{2}-?\d{5}$/i, 'Format ISRC tidak valid')
    .optional()
    .nullable(),
  explicit: z.boolean().optional(),
  audio_url: z.string().max(1000).optional().nullable(),
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
  tracks: z.array(trackInput).max(40).default([]),
});

const splitInput = z.object({ party_name: z.string().trim().min(1).max(120), email: z.string().email().optional().nullable(), pct: z.number().positive().max(100) });

const EDITABLE = ['DRAFT', 'REJECTED'];

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

/** GEMA sebagai pendaftar ISRC bila artis tidak punya (REQ-STU-01). Format ID-GM1-YY-NNNNN. */
async function generateIsrc(tx: Client) {
  const yy = String(new Date().getFullYear()).slice(2);
  const r = await tx.query(`SELECT nextval('isrc_seq') AS n`);
  return `ID-GM1-${yy}-${String(r.rows[0].n).padStart(5, '0')}`;
}

async function insertTracks(tx: Client, releaseId: string, artistId: string, tracks: z.infer<typeof trackInput>[], startNo = 1) {
  let n = startNo;
  for (const t of tracks) {
    await tx.query(
      `INSERT INTO tracks (id, release_id, artist_id, title, track_number, duration_ms, explicit, isrc, audio_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [uuidv7(), releaseId, artistId, t.title, n++, t.duration_ms ?? 0, t.explicit ?? false, t.isrc ?? (await generateIsrc(tx)), t.audio_url ?? null],
    );
  }
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
      const ids = await db.query(`SELECT id FROM releases WHERE artist_id = $1 ORDER BY created_at DESC`, [artistId]);
      const data = [];
      for (const { id } of ids) {
        const r = await releaseFull(db, id);
        delete r.artist_id;
        data.push(r);
      }
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
          city: z.string().max(80).nullable().optional(),
          genres: z.array(z.string().max(40)).max(10).optional(),
        })
        .parse(req.body);
      return db.tx(async (tx) => {
        const sets: string[] = [];
        const vals: unknown[] = [];
        for (const [k, v] of Object.entries(b)) {
          vals.push(v);
          sets.push(`${k} = $${vals.length}`);
        }
        if (!sets.length) throw badRequest('Tidak ada perubahan');
        vals.push(artistId);
        const r = await tx.query(`UPDATE artists SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length} RETURNING id`, vals);
        if (!r.rowCount) throw notFound('Artis');
        await audit(tx, { actorId: req.user!.sub, action: 'artist.update', entity: 'artist', entityId: artistId, data: b, ip: req.ip });
        return publishArtist(tx, artistId);
      });
    });

    s.post('/v1/studio/releases', async (req, reply) => {
      const b = releaseInput.parse(req.body);
      assertArtist(req, b.artist_id);
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
            [id, b.artist_id, b.title, b.type, b.release_date, b.genre, b.label ?? null, b.cover_url ?? null, b.explicit ?? false, `899${Date.now().toString().slice(-9)}`],
          );
          await insertTracks(tx, id, b.artist_id, b.tracks);
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

    // Aditif: kelola lagu dalam rilis.
    s.post('/v1/studio/releases/:id/tracks', async (req, reply) => {
      const { id } = req.params as { id: string };
      const r = await loadRelease(req, id);
      if (!EDITABLE.includes(r.status)) throw conflict(`Rilis berstatus ${r.status} tidak dapat diubah`);
      const t = trackInput.parse(req.body);
      return db.tx(async (tx) => {
        const n = await tx.query(`SELECT coalesce(max(track_number), 0) + 1 AS n FROM tracks WHERE release_id = $1`, [id]);
        await insertTracks(tx, id, r.artist_id, [t], n.rows[0].n);
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
      vals.push(id);
      await db.query(`UPDATE tracks SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
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

    // ---------- Upload (dev: simpan lokal; produksi: presigned URL ke bucket quarantine) ----------
    s.post('/v1/studio/uploads', async (req, reply) => {
      const b = z
        .object({
          kind: z.enum(['audio', 'artwork']),
          filename: z.string().min(1).max(200),
          content_type: z.string().min(3).max(100),
          size: z.number().int().positive(),
        })
        .parse(req.body);
      // Kebijakan upload dari pengaturan platform (Super Admin → Storage & Retensi).
      const maxMb = settings.num('storage.max_upload_mb');
      if (b.size > maxMb * 1024 * 1024) throw unprocessable(`Ukuran file melebihi batas ${maxMb} MB`);
      const allowed = settings.get<string[]>(b.kind === 'audio' ? 'storage.allowed_audio_types' : 'storage.allowed_image_types');
      if (!allowed.includes(b.content_type.toLowerCase())) throw unprocessable(`Tipe file ${b.content_type} tidak diizinkan untuk ${b.kind} (diizinkan: ${allowed.join(', ')})`);
      if ((await uploadsBytes(db)) + b.size > settings.num('storage.quota_uploads_gb') * 1024 ** 3) throw unprocessable('Kuota penyimpanan upload platform penuh. Hubungi admin GEMA.');
      const id = uuidv7();
      const ext = (b.filename.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? (b.kind === 'audio' ? '.wav' : '.jpg')).toLowerCase();
      const stored = `${id}${ext}`;
      await db.query(`INSERT INTO uploads (id, user_id, kind, filename, content_type, size, stored_name) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
        id,
        req.user!.sub,
        b.kind,
        b.filename,
        b.content_type,
        b.size,
        stored,
      ]);
      reply.status(201);
      return { upload_id: id, upload_url: `/v1/studio/uploads/${id}`, public_url: `/v1/catalog/media/${stored}` };
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
            let size = 0;
            try {
              const { bytes, head } = await receiveUpload(src, part, settings.num('storage.max_upload_mb'));
              size = bytes;
              if (!bytes) throw badRequest('Body biner kosong (kirim dengan content-type audio/* atau image/*)');
              if (u.kind === 'artwork') {
                const dim = imageSize(head);
                if (!dim) throw unprocessable('Artwork harus JPEG/PNG yang valid');
                meta = dim;
                if (dim.width !== dim.height) warnings.push('Artwork sebaiknya persegi (1:1)');
                if (dim.width < 3000) warnings.push(`Resolusi ${dim.width}×${dim.height} di bawah standar 3000×3000 px`);
              } else {
                // Durasi WAV dari ukuran chunk data di header (bukan panjang buffer).
                const w = wavInfo(head);
                if (w) {
                  meta = w;
                  if (w.sampleRate < 44100 || w.bitDepth < 16) throw unprocessable(`Master minimal 16-bit/44,1 kHz (diterima ${w.bitDepth}-bit/${w.sampleRate} Hz)`);
                  if (w.bitDepth < 24) warnings.push('Disarankan master 24-bit');
                } else if (!/flac|mpeg|mp3|mp4|m4a/.test(u.content_type)) {
                  throw unprocessable('File audio tidak dikenali');
                } else if (/mpeg|mp3|mp4|m4a/.test(u.content_type)) {
                  warnings.push('Format lossy hanya untuk dev; produksi wajib WAV/FLAC');
                }
              }
              await rename(part, join(UPLOAD_DIR, u.stored_name)); // atomik: file final tidak pernah setengah jadi
            } catch (e) {
              await rm(part, { force: true }).catch(() => {});
              throw e;
            }
            await db.query(`UPDATE uploads SET completed_at = now(), size = $2 WHERE id = $1`, [id, size]);
            return { public_url: `/v1/catalog/media/${u.stored_name}`, meta, warnings };
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
      const tracks = await db.query(`SELECT id, title, audio_url FROM tracks WHERE release_id = $1 ORDER BY track_number`, [id]);
      const errors: { path: string; message: string }[] = [];
      if (!r.cover_url) errors.push({ path: 'cover_url', message: 'Artwork wajib diunggah' });
      if (!tracks.length) errors.push({ path: 'tracks', message: 'Minimal satu lagu' });
      if (r.type === 'SINGLE' && tracks.length > 3) errors.push({ path: 'tracks', message: 'Single maksimal 3 lagu' });
      if (!tracks.some((t) => t.audio_url)) errors.push({ path: 'tracks', message: 'Minimal satu lagu memiliki file audio' });
      for (const t of tracks) {
        if (!t.audio_url) errors.push({ path: `tracks.${t.id}.audio_url`, message: `"${t.title}" belum memiliki audio` });
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
      if (!EDITABLE.includes(t.release_status) && !isAdmin(req.user)) throw conflict('Split rilis yang sudah diajukan hanya dapat diubah lewat dukungan');
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
            await tx.query(
              `INSERT INTO rights_shares (id, track_id, type, party_name, email, pct, invite_token, approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [uuidv7(), id, type, x.party_name, x.email ?? null, x.pct, self ? null : uuidv7(), self ? new Date() : null],
            );
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
      if (!mine && !isAdmin(req.user) && !(canManageArtist(req.user, sp.artist_id) && !sp.email)) throw forbidden('Hanya pihak yang diundang dapat menyetujui split ini');
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
