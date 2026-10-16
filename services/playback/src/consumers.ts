import { callService, type Consumers, type ServiceContext } from '@gema/service-kit';
import { bumpArtistDaily } from './aggregates.js';
import { todayWib } from './util.js';

export function consumers(ctx: ServiceContext): Consumers {
  return {
    // Save rate (REQ-STU-03): like lagu dihitung sebagai "save".
    'library.track.liked': async (e, tx) => {
      let r = await tx.query(`SELECT artist_id FROM track_artists WHERE track_id = $1`, [e.payload.trackId]);
      let artistId: string | undefined = r.rows[0]?.artist_id;
      if (!artistId) {
        const t = await callService<{ artist_id: string }>(ctx.name, 'catalog', `/internal/tracks/${e.payload.trackId}/media`).catch(() => null);
        if (!t) return;
        artistId = t.artist_id;
        await tx.query(`INSERT INTO track_artists (track_id, artist_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [e.payload.trackId, artistId]);
      }
      await bumpArtistDaily(tx, artistId, todayWib(), 'saves');
    },
    'library.artist.followed': async (e, tx) => {
      await bumpArtistDaily(tx, e.payload.artistId, todayWib(), 'followers_gained');
    },
  };
}
