import type { FastifyInstance } from 'fastify';
import { audit, conflict, forbidden, notFound, publish, requirePermission, unauthorized, z, type Client, type Job, type ServiceContext } from '@gema/service-kit';
import { isUuid, releaseFull } from './queries.js';

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
      const { status = 'IN_REVIEW' } = req.query as { status?: string };
      const ids = await db.query(`SELECT id FROM releases WHERE status = $1 ORDER BY submitted_at NULLS LAST, created_at`, [status]);
      const data = [];
      for (const { id } of ids) {
        const r = await releaseFull(db, id);
        // Sinyal untuk reviewer: duplikasi judul/ISRC di katalog (pengganti fingerprint audio di MVP).
        r.qc_signals = await db.query(
          `SELECT t.title, t.isrc, x.release_id AS duplicate_release_id, x.title AS duplicate_title
           FROM tracks t JOIN tracks x ON x.id <> t.id AND x.release_id <> t.release_id AND (x.isrc = t.isrc OR lower(x.title) = lower(t.title) AND x.artist_id <> t.artist_id)
           WHERE t.release_id = $1 LIMIT 10`,
          [id],
        );
        delete r.artist_id;
        data.push(r);
      }
      return { data };
    });

    s.post('/v1/admin/qc/releases/:id/decision', async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Rilis');
      const b = z.object({ approve: z.boolean(), reason: z.string().max(1000).optional() }).parse(req.body);
      return db.tx(async (tx) => {
        const cur = (await tx.query(`SELECT id, status, artist_id, title, to_char(release_date,'YYYY-MM-DD') AS d FROM releases WHERE id = $1 FOR UPDATE`, [id])).rows[0];
        if (!cur) throw notFound('Rilis');
        if (cur.status !== 'IN_REVIEW') throw conflict(`Rilis berstatus ${cur.status}, bukan IN_REVIEW`);
        if (b.approve) {
          if (cur.d > todayWib()) await tx.query(`UPDATE releases SET status = 'SCHEDULED', qc_reason = NULL, updated_at = now() WHERE id = $1`, [id]);
          else await goLive(tx, id);
        } else {
          const reason = b.reason?.trim() || 'Tidak memenuhi pedoman konten';
          await tx.query(`UPDATE releases SET status = 'REJECTED', qc_reason = $2, updated_at = now() WHERE id = $1`, [id, reason]);
          await publish(tx, 'catalog.release.rejected', id, { releaseId: id, artistId: cur.artist_id, reason });
        }
        await audit(tx, { actorId: req.user!.sub, action: b.approve ? 'qc.approve' : 'qc.reject', entity: 'release', entityId: id, data: b, ip: req.ip });
        const out = await releaseFull(tx, id);
        delete out.artist_id;
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
      const t = await db.one(
        `SELECT t.id, r.status, t.audio_url, t.duration_ms, t.artist_id, t.loudness_gain_db, t.title, t.release_id
         FROM tracks t JOIN releases r ON r.id = t.release_id WHERE t.id = $1`,
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
         UNION SELECT '/v1/catalog/media/' || stored_name FROM uploads WHERE created_at > now() - interval '24 hours'`,
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
