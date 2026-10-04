import type { Consumers, Job, ServiceContext } from '@gema/service-kit';
import { publishArtist, uniqueSlug } from './artists.js';

export function consumers(_ctx: ServiceContext): Consumers {
  return {
    // Org ARTIST baru di IAM → profil artis di katalog (REQ-IAM-03/05).
    'iam.org.created': async (e, tx) => {
      const p = e.payload;
      if (p.type !== 'ARTIST' || !p.artistId) return;
      const exists = await tx.query(`SELECT 1 FROM artists WHERE id = $1`, [p.artistId]);
      if (exists.rowCount) {
        await tx.query(`UPDATE artists SET org_id = coalesce(org_id, $2) WHERE id = $1`, [p.artistId, p.orgId]);
        return;
      }
      const slug = await uniqueSlug(tx, p.name);
      await tx.query(`INSERT INTO artists (id, org_id, slug, name) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`, [p.artistId, p.orgId, slug, p.name]);
      await publishArtist(tx, p.artistId);
    },

    // Qualified stream → play_count & pendengar bulanan (unik 28 hari).
    'playback.stream.qualified': async (e, tx) => {
      const p = e.payload;
      await tx.query(`UPDATE tracks SET play_count = play_count + 1 WHERE id = $1`, [p.trackId]);
      if (!p.userId) return;
      await tx.query(
        `INSERT INTO artist_listeners (artist_id, user_id, last_at) VALUES ($1,$2,$3)
         ON CONFLICT (artist_id, user_id) DO UPDATE SET last_at = greatest(artist_listeners.last_at, EXCLUDED.last_at)`,
        [p.artistId, p.userId, p.at],
      );
      await tx.query(
        `UPDATE artists SET monthly_listeners = listeners_base +
           (SELECT count(*) FROM artist_listeners WHERE artist_id = $1 AND last_at > now() - interval '28 days')
         WHERE id = $1`,
        [p.artistId],
      );
    },

    'library.artist.followed': async (e, tx) => {
      await tx.query(`UPDATE artists SET followers = followers + 1 WHERE id = $1`, [e.payload.artistId]);
    },
  };
}

/** Pendengar yang tidak kembali dalam 28 hari keluar dari hitungan monthly_listeners. */
export const listenersDecayJob: Job = {
  name: 'monthly-listeners-decay',
  everyMs: 3600_000,
  async run({ db }) {
    await db.query(
      `UPDATE artists a SET monthly_listeners = a.listeners_base +
         (SELECT count(*) FROM artist_listeners l WHERE l.artist_id = a.id AND l.last_at > now() - interval '28 days')`,
    );
  },
};
