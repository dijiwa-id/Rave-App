import type { FastifyInstance } from 'fastify';
import { audit, badRequest, config, conflict, isSuperAdmin, requireSuperAdmin, forbidden, notFound, publish, requirePermission, settings, unauthorized, z, type Client, type Job, type ServiceContext } from '@rave/service-kit';
import { isUuid, releaseFull, releasesFull } from './queries.js';
import { open as fsOpen } from 'node:fs/promises';
import { join } from 'node:path';
import { imageSize, UPLOAD_DIR } from './storage.js';

/** Dimensi artwork dari header berkas lokal (tanpa memuat seluruh gambar). null = eksternal / tidak terbaca. */
async function artworkSize(url: string | null): Promise<{ width: number; height: number; bytes: number } | null> {
  const m = url ? /^\/v1\/catalog\/media\/([\w.-]+\.(?:jpe?g|png|webp))$/i.exec(url) : null;
  if (!m) return null;
  let fh;
  try {
    fh = await fsOpen(join(UPLOAD_DIR, m[1]!), 'r');
    const st = await fh.stat();
    const buf = Buffer.alloc(Math.min(st.size, 256 * 1024));
    await fh.read(buf, 0, buf.length, 0);
    const d = imageSize(buf);
    return d ? { ...d, bytes: st.size } : null;
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

/** Masalah kualitas artwork untuk kurasi. */
function artworkIssues(url: string | null, size: { width: number; height: number } | null): string[] {
  if (!url) return ['missing'];
  const out: string[] = [];
  if (!url.startsWith('/v1/catalog/')) out.push('external');
  if (size) {
    if (size.width !== size.height) out.push('not_square');
    if (Math.min(size.width, size.height) < 3000) out.push('low_res');
  }
  return out;
}

/**
 * Persetujuan split sebagai syarat QC diatur pengaturan `catalog.qc_require_split_approval`:
 * - mati (default, fase awal): persetujuan admin RAVE / Super Admin di QC sudah cukup — split tertunda TIDAK diubah
 *   (tetap tercatat, pihaknya bisa menyetujui kemudian) & jumlahnya dicatat di audit (`splits_pending`);
 * - aktif (REQ-STU-02): wajib menunggu semua pihak, kecuali Super Admin di lingkungan dev (NODE_ENV ≠ production) —
 *   split tertunda ditandai disetujui & dicatat di audit (`dev_split_bypass`).
 */
const splitsRequired = () => settings.bool('catalog.qc_require_split_approval');
const devSplitBypass = (u: Parameters<typeof isSuperAdmin>[0]) => config.isDev && isSuperAdmin(u);

/** Tanggal hari ini di WIB (rilis default 00:00 WIB, §7.4). */
const todayWib = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

export async function goLive(tx: Client, releaseId: string) {
  // Kondisional pada status: replika lain / klik ganda tidak menayangkan (dan mengumumkan) rilis yang sama dua kali.
  const r = await tx.query(
    `UPDATE releases SET status = 'LIVE', published_at = now(), updated_at = now() WHERE id = $1 AND status IN ('SCHEDULED','IN_REVIEW') RETURNING id, artist_id, title`,
    [releaseId],
  );
  const rel = r.rows[0];
  if (!rel) return false;
  const t = await tx.query(`SELECT id FROM tracks WHERE release_id = $1 ORDER BY track_number`, [releaseId]);
  await publish(tx, 'catalog.release.published', releaseId, {
    releaseId,
    artistId: rel.artist_id,
    title: rel.title,
    trackIds: t.rows.map((x) => x.id),
  });
  return true;
}

export async function adminRoutes(app: FastifyInstance, { db }: ServiceContext) {
  // ---------- QC konten (REQ-ADM-02) ----------
  app.register(async (s) => {
    s.addHook('preHandler', requirePermission('qc.review'));

    s.get('/v1/admin/qc/releases', async (req) => {
      const { status } = z
        .object({ status: z.enum(['DRAFT', 'IN_REVIEW', 'SCHEDULED', 'LIVE', 'REJECTED', 'TAKEN_DOWN']).default('IN_REVIEW') })
        .parse(req.query);
      // Dibatasi 100 & dimuat batch: status LIVE bisa berisi seluruh katalog.
      const ids = await db.query(`SELECT id FROM releases WHERE status = $1 ORDER BY submitted_at NULLS LAST, created_at LIMIT 100`, [status]);
      const full = await releasesFull(
        db,
        ids.map((x: { id: string }) => x.id),
      );
      const data = [];
      for (const r of full) {
        const id = r.id;
        // Sinyal untuk reviewer: duplikasi judul/ISRC di katalog (pengganti fingerprint audio di MVP).
        r.qc_signals = await db.query(
          `SELECT t.title, t.isrc, x.release_id AS duplicate_release_id, x.title AS duplicate_title
           FROM tracks t JOIN tracks x ON x.id <> t.id AND x.release_id <> t.release_id AND (x.isrc = t.isrc OR lower(x.title) = lower(t.title) AND x.artist_id <> t.artist_id)
           WHERE t.release_id = $1 LIMIT 10`,
          [id],
        );
        // Peringatan non-blokir untuk reviewer (mis. ISRC belum ada saat kode pendaftar RAVE belum diatur).
        r.qc_warnings = (r.tracks as { title: string; isrc: string | null }[])
          .filter((t) => !t.isrc)
          .map((t) => `"${t.title}": ISRC kosong`);
        const pendingSplits = await db.query(
          `SELECT t.title, rs.party_name, rs.type FROM rights_shares rs JOIN tracks t ON t.id = rs.track_id WHERE t.release_id = $1 AND rs.approved_at IS NULL`,
          [id],
        );
        // Dev saja: Super Admin boleh melewati persetujuan split (lihat devSplitBypass di bawah).
        const note = !splitsRequired()
          ? 'tidak menghalangi persetujuan — fase awal: persetujuan admin RAVE cukup'
          : devSplitBypass(req.user)
            ? 'dev: Super Admin dapat menyetujui — split ditandai disetujui otomatis'
            : 'rilis tidak dapat disetujui';
        for (const p of pendingSplits) r.qc_warnings.push(`"${p.title}": split ${p.type} ${p.party_name} belum disetujui (${note})`);
        delete r.artist_id;
        data.push(r);
      }
      return { data };
    });

    // ---- Kurasi artwork (Super Admin): galeri semua sampul + ganti / minta ganti ----
    s.get('/v1/admin/artwork', { preHandler: requireSuperAdmin }, async (req) => {
      const q = z
        .object({ filter: z.enum(['all', 'pending', 'issues']).default('all'), q: z.string().trim().max(100).optional(), status: z.string().max(20).optional() })
        .parse(req.query);
      const params: unknown[] = [];
      const where: string[] = [];
      if (q.filter === 'pending') where.push('r.pending_cover_url IS NOT NULL');
      if (q.status) where.push(`r.status = $${params.push(q.status)}`);
      if (q.q) where.push(`(r.title ILIKE $${params.push(`%${q.q}%`)} OR a.name ILIKE $${params.length})`);
      const rows = await db.query(
        `SELECT r.id, r.title, r.status, r.cover_url, r.pending_cover_url, r.pending_cover_at, r.cover_review_note, r.updated_at, a.name AS artist_name, a.id AS artist_id
           FROM releases r JOIN artists a ON a.id = r.artist_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY (r.pending_cover_url IS NOT NULL) DESC, r.updated_at DESC LIMIT 120`,
        params,
      );
      const data = [];
      for (const r of rows) {
        const size = await artworkSize(r.cover_url);
        const issues = artworkIssues(r.cover_url, size);
        if (q.filter === 'issues' && !issues.length) continue;
        data.push({
          id: r.id, title: r.title, status: r.status, artist_name: r.artist_name, artist_id: r.artist_id,
          cover_url: r.cover_url, size, issues,
          pending_cover: r.pending_cover_url ? { url: r.pending_cover_url, submitted_at: r.pending_cover_at, size: await artworkSize(r.pending_cover_url) } : null,
          review_note: r.cover_review_note, updated_at: r.updated_at,
        });
      }
      return { data };
    });

    /** Super Admin mengganti artwork langsung (mis. melanggar pedoman, kualitas buruk, salah unggah). Wajib beralasan; artis dinotifikasi. */
    s.post('/v1/admin/artwork/:id/replace', { preHandler: requireSuperAdmin }, async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Rilis');
      const b = z.object({ cover_url: z.string().max(1000), reason: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(1000) }).parse(req.body);
      const name = /^\/v1\/catalog\/media\/([\w.-]+)$/.exec(b.cover_url)?.[1];
      const up = name ? await db.one(`SELECT kind, completed_at, purpose FROM uploads WHERE stored_name = $1`, [name]) : null;
      if (!up || up.kind !== 'artwork' || !up.completed_at || up.purpose === 'playlist') throw badRequest('Artwork harus berupa gambar yang sudah diunggah (JPG/PNG)');
      return db.tx(async (tx) => {
        const r = (await tx.query(`SELECT id, title, artist_id, cover_url FROM releases WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (!r) throw notFound('Rilis');
        await tx.query(
          `UPDATE releases SET cover_url = $2, pending_cover_url = NULL, pending_cover_at = NULL, pending_cover_by = NULL, cover_review_note = $3, updated_at = now() WHERE id = $1`,
          [id, b.cover_url, `Diganti tim kurasi RAVE: ${b.reason}`],
        );
        await publish(tx, 'catalog.release.cover_curated', id, { releaseId: id, artistId: r.artist_id, title: r.title, action: 'replaced', reason: b.reason });
        await audit(tx, { actorId: req.user!.sub, action: 'artwork.replace', entity: 'release', entityId: id, data: { from: r.cover_url, to: b.cover_url, reason: b.reason }, ip: req.ip });
        return { id, cover_url: b.cover_url };
      });
    });

    /** Minta artis/manajemen mengganti artwork (sampul lama tetap tayang sampai artis mengajukan yang baru). */
    s.post('/v1/admin/artwork/:id/request-change', { preHandler: requireSuperAdmin }, async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Rilis');
      const b = z.object({ reason: z.string().trim().min(5, 'Alasan minimal 5 karakter').max(1000) }).parse(req.body);
      return db.tx(async (tx) => {
        const r = (await tx.query(`SELECT id, title, artist_id FROM releases WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (!r) throw notFound('Rilis');
        await tx.query(`UPDATE releases SET cover_review_note = $2, updated_at = now() WHERE id = $1`, [id, `Diminta ganti oleh tim kurasi RAVE: ${b.reason}`]);
        await publish(tx, 'catalog.release.cover_curated', id, { releaseId: id, artistId: r.artist_id, title: r.title, action: 'change_requested', reason: b.reason });
        await audit(tx, { actorId: req.user!.sub, action: 'artwork.request_change', entity: 'release', entityId: id, data: b, ip: req.ip });
        return { id, requested: true };
      });
    });

    // ---- Pengajuan ganti sampul rilis yang sudah tayang ----
    s.get('/v1/admin/qc/covers', async () => {
      const rows = await db.query(
        `SELECT r.id, r.title, r.status, r.cover_url, r.pending_cover_url, r.pending_cover_at, a.name AS artist_name
           FROM releases r JOIN artists a ON a.id = r.artist_id WHERE r.pending_cover_url IS NOT NULL ORDER BY r.pending_cover_at`,
      );
      return { data: rows.map((r: any) => ({ id: r.id, title: r.title, status: r.status, artist_name: r.artist_name, current_cover: r.cover_url, pending_cover: r.pending_cover_url, submitted_at: r.pending_cover_at })) };
    });

    s.post('/v1/admin/qc/covers/:id/decision', async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Rilis');
      const b = z.object({ approve: z.boolean(), reason: z.string().trim().max(1000).optional() }).parse(req.body);
      if (!b.approve && (b.reason ?? '').length < 5) throw badRequest('Alasan penolakan sampul wajib diisi (min. 5 karakter)');
      return db.tx(async (tx) => {
        const r = (await tx.query(`SELECT id, title, artist_id, pending_cover_url FROM releases WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (!r) throw notFound('Rilis');
        if (!r.pending_cover_url) throw conflict('Tidak ada pengajuan sampul untuk rilis ini');
        if (b.approve)
          await tx.query(`UPDATE releases SET cover_url = pending_cover_url, pending_cover_url = NULL, pending_cover_at = NULL, pending_cover_by = NULL, cover_review_note = NULL, updated_at = now() WHERE id = $1`, [id]);
        else
          await tx.query(`UPDATE releases SET pending_cover_url = NULL, pending_cover_at = NULL, pending_cover_by = NULL, cover_review_note = $2, updated_at = now() WHERE id = $1`, [id, b.reason]);
        await publish(tx, 'catalog.release.cover_reviewed', id, { releaseId: id, artistId: r.artist_id, title: r.title, approved: b.approve, reason: b.approve ? null : b.reason! });
        await audit(tx, { actorId: req.user!.sub, action: b.approve ? 'qc.cover_approve' : 'qc.cover_reject', entity: 'release', entityId: id, data: b, ip: req.ip });
        return { id, approved: b.approve };
      });
    });

    // ---- Pengajuan perubahan metadata rilis yang sudah lolos QC (Artist Studio) ----
    s.get('/v1/admin/qc/changes', async () => {
      const rows = await db.query(
        `SELECT r.id, r.title, r.status, r.genre, r.label, r.explicit, to_char(r.release_date,'YYYY-MM-DD') AS release_date,
                r.cover_url, r.pending_changes, r.pending_changes_at, a.name AS artist_name,
                (SELECT coalesce(json_agg(json_build_object('id', t.id, 'title', t.title, 'explicit', t.explicit, 'track_number', t.track_number) ORDER BY t.track_number), '[]')
                   FROM tracks t WHERE t.release_id = r.id) AS tracks
           FROM releases r JOIN artists a ON a.id = r.artist_id WHERE r.pending_changes IS NOT NULL ORDER BY r.pending_changes_at`,
      );
      return {
        data: rows.map((r: any) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          artist_name: r.artist_name,
          cover_url: r.cover_url,
          submitted_at: r.pending_changes_at,
          current: { title: r.title, genre: r.genre, label: r.label, explicit: r.explicit, release_date: r.release_date, tracks: r.tracks },
          changes: r.pending_changes,
        })),
      };
    });

    s.post('/v1/admin/qc/changes/:id/decision', async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Rilis');
      const b = z.object({ approve: z.boolean(), reason: z.string().trim().max(1000).optional() }).parse(req.body);
      if (!b.approve && (b.reason ?? '').length < 5) throw badRequest('Alasan penolakan perubahan wajib diisi (min. 5 karakter)');
      return db.tx(async (tx) => {
        const r = (await tx.query(`SELECT id, title, status, artist_id, pending_changes FROM releases WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (!r) throw notFound('Rilis');
        if (!r.pending_changes) throw conflict('Tidak ada pengajuan perubahan untuk rilis ini');
        const ch = r.pending_changes as { release: Record<string, unknown>; tracks: Record<string, Record<string, unknown>> };
        if (b.approve) {
          if (!['LIVE', 'SCHEDULED'].includes(r.status)) throw conflict(`Rilis berstatus ${r.status} — pengajuan tidak dapat diterapkan`);
          // Kunci kolom dibatasi daftar putih — pengajuan disimpan oleh server, tetapi tetap divalidasi ulang di sini.
          const REL = ['title', 'genre', 'label', 'explicit', 'release_date'];
          const TRK = ['title', 'explicit'];
          const rel = Object.entries(ch.release ?? {}).filter(([k]) => REL.includes(k));
          if (rel.some(([k]) => k === 'release_date') && r.status !== 'SCHEDULED') throw conflict('Rilis sudah tayang — tanggal rilis tidak dapat diubah');
          if (rel.length)
            await tx.query(`UPDATE releases SET ${rel.map(([k], i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [id, ...rel.map(([, v]) => v)]);
          for (const [trackId, d] of Object.entries(ch.tracks ?? {})) {
            const f = Object.entries(d).filter(([k]) => TRK.includes(k));
            if (f.length && isUuid(trackId))
              await tx.query(`UPDATE tracks SET ${f.map(([k], i) => `${k} = $${i + 3}`).join(', ')} WHERE id = $1 AND release_id = $2`, [trackId, id, ...f.map(([, v]) => v)]);
          }
          await tx.query(`UPDATE releases SET pending_changes = NULL, pending_changes_at = NULL, pending_changes_by = NULL, changes_review_note = NULL WHERE id = $1`, [id]);
        } else {
          await tx.query(`UPDATE releases SET pending_changes = NULL, pending_changes_at = NULL, pending_changes_by = NULL, changes_review_note = $2, updated_at = now() WHERE id = $1`, [id, b.reason]);
        }
        const title = (ch.release?.title as string | undefined) && b.approve ? (ch.release.title as string) : r.title;
        await publish(tx, 'catalog.release.changes_reviewed', id, { releaseId: id, artistId: r.artist_id, title, approved: b.approve, reason: b.approve ? null : b.reason! });
        await audit(tx, { actorId: req.user!.sub, action: b.approve ? 'qc.changes_approve' : 'qc.changes_reject', entity: 'release', entityId: id, data: { ...b, changes: ch }, ip: req.ip });
        return { id, approved: b.approve };
      });
    });

    s.post('/v1/admin/qc/releases/:id/decision', async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Rilis');
      const b = z.object({ approve: z.boolean(), reason: z.string().max(1000).optional() }).parse(req.body);
      let devBypassed = 0;
      let splitsPending = 0;
      return db.tx(async (tx) => {
        const cur = (await tx.query(`SELECT id, status, artist_id, title, to_char(release_date,'YYYY-MM-DD') AS d FROM releases WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (!cur) throw notFound('Rilis');
        if (cur.status !== 'IN_REVIEW') throw conflict(`Rilis berstatus ${cur.status}, bukan IN_REVIEW`);
        if (b.approve) {
          // Split hak: wajib disetujui semua pihak hanya bila catalog.qc_require_split_approval aktif (REQ-STU-02); fase awal cukup admin.
          const pending = (
            await tx.query(`SELECT count(*)::int AS n FROM rights_shares rs JOIN tracks t ON t.id = rs.track_id WHERE t.release_id = $1 AND rs.approved_at IS NULL`, [id])
          ).rows[0].n;
          if (pending > 0 && !splitsRequired()) splitsPending = pending;
          else if (pending > 0) {
            if (!devSplitBypass(req.user)) throw conflict(`Masih ada ${pending} pihak split yang belum menyetujui bagiannya — rilis belum dapat disetujui`);
            // Lingkungan dev: undangan split (MASTER/PUBLISHING) tidak perlu ditunggu agar rilis demo bisa diuji ujung-ke-ujung.
            await tx.query(
              `UPDATE rights_shares rs SET approved_at = now() FROM tracks t WHERE t.id = rs.track_id AND t.release_id = $1 AND rs.approved_at IS NULL`,
              [id],
            );
            devBypassed = pending;
          }
          if (cur.d > todayWib()) await tx.query(`UPDATE releases SET status = 'SCHEDULED', qc_reason = NULL, updated_at = now() WHERE id = $1`, [id]);
          else await goLive(tx, id);
        } else {
          const reason = b.reason?.trim() || 'Tidak memenuhi pedoman konten';
          await tx.query(`UPDATE releases SET status = 'REJECTED', qc_reason = $2, updated_at = now() WHERE id = $1`, [id, reason]);
          await publish(tx, 'catalog.release.rejected', id, { releaseId: id, artistId: cur.artist_id, reason });
        }
        await audit(tx, { actorId: req.user!.sub, action: b.approve ? 'qc.approve' : 'qc.reject', entity: 'release', entityId: id, data: { ...b, ...(devBypassed ? { dev_split_bypass: devBypassed } : {}), ...(splitsPending ? { splits_pending: splitsPending } : {}) }, ip: req.ip });
        const out = await releaseFull(tx, id);
        delete out.artist_id;
        if (devBypassed) out.dev_split_bypass = devBypassed;
        return out;
      });
    });

    s.post('/v1/admin/qc/releases/:id/takedown', async (req) => {
      const { id } = req.params as { id: string };
      const b = z.object({ reason: z.string().min(3).max(1000) }).parse(req.body);
      const r = await db.one(`UPDATE releases SET status = 'TAKEN_DOWN', qc_reason = $2, updated_at = now() WHERE id = $1 RETURNING id`, [id, b.reason]);
      if (!r) throw notFound('Rilis');
      await audit(db, { actorId: req.user!.sub, action: 'qc.takedown', entity: 'release', entityId: id, data: b, ip: req.ip });
      return releaseFull(db, id);
    });
  });

  // ---------- Internal (antar-service; tidak diekspos gateway) ----------
  app.register(async (s) => {
    s.addHook('preHandler', async (req) => {
      if (!req.user) throw unauthorized();
      if (!req.user.roles.includes('service') && !req.user.roles.includes('admin')) throw forbidden('Khusus service');
    });

    s.get('/internal/tracks/:id/media', async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Lagu');
      // Master + metadata + rendisi (bila audio_url menunjuk berkas upload; URL eksternal/demo → null).
      const t = await db.one(
        `SELECT t.id, r.status, t.audio_url, t.duration_ms, t.artist_id, t.loudness_gain_db, t.title, t.release_id,
                u.audio_meta, coalesce(u.renditions, '{}'::jsonb) AS renditions, u.transcode_status
         FROM tracks t JOIN releases r ON r.id = t.release_id
         LEFT JOIN uploads u ON u.stored_name = split_part(t.audio_url, '/v1/catalog/media/', 2)
         WHERE t.id = $1`,
        [id],
      );
      if (!t) throw notFound('Lagu');
      return t;
    });

    s.get('/internal/episodes/:id/media', async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Episode');
      const e = await db.one(`SELECT id, is_premium, audio_url, duration_ms, show_id, title FROM episodes WHERE id = $1`, [id]);
      if (!e) throw notFound('Episode');
      return e;
    });

    // File di bucket uploads yang masih dipakai (panel storage Super Admin → deteksi file yatim).
    // Upload < 24 jam dianggap dipakai: mungkin masih dalam draf yang sedang disusun.
    s.get('/internal/media/references', async () => {
      const rows = await db.query(
        `SELECT u FROM (
           SELECT image_url AS u FROM artists UNION ALL SELECT cover_url FROM artists
           UNION ALL SELECT cover_url FROM releases UNION ALL SELECT audio_url FROM tracks
           UNION ALL SELECT cover_url FROM shows UNION ALL SELECT audio_url FROM episodes UNION ALL SELECT cover_url FROM episodes
           UNION ALL SELECT image_url FROM categories
         ) x WHERE u LIKE '%/v1/catalog/media/%'
         UNION SELECT '/v1/catalog/media/' || stored_name FROM uploads WHERE created_at > now() - interval '24 hours'
         -- Rendisi streaming milik master yang masih dipakai (atau upload < 24 jam) bukan file yatim.
         UNION SELECT r.value->>'url' FROM uploads up CROSS JOIN LATERAL jsonb_each(up.renditions) r
          WHERE up.created_at > now() - interval '24 hours'
             OR EXISTS (SELECT 1 FROM tracks t WHERE t.audio_url = '/v1/catalog/media/' || up.stored_name)
             OR EXISTS (SELECT 1 FROM episodes e WHERE e.audio_url = '/v1/catalog/media/' || up.stored_name)`,
      );
      return { files: [...new Set(rows.map((r) => String(r.u).split('/v1/catalog/media/')[1].split(/[?#]/)[0]))] };
    });

    s.get('/internal/artists/:id', async (req) => {
      const { id } = req.params as { id: string };
      const a = await db.one(`SELECT id, org_id, slug, name, image_url, city, genres, verified, monthly_listeners, followers FROM artists WHERE id = $1`, [id]);
      if (!a) throw notFound('Artis');
      return a;
    });
  });
}

/** Rilis SCHEDULED otomatis LIVE pada tanggalnya (00:00 WIB). */
export const scheduledReleaseJob: Job = {
  name: 'scheduled-releases',
  everyMs: 60_000,
  async run({ db, log }) {
    const due = await db.query(`SELECT id FROM releases WHERE status = 'SCHEDULED' AND release_date <= $1::date`, [todayWib()]);
    for (const { id } of due) {
      if (await db.tx((tx) => goLive(tx, id))) log.info({ releaseId: id }, 'rilis terjadwal tayang');
    }
  },
};
