import { SEED, SEED_ARTIST_COVER, SEED_ARTIST_IMAGE, SEED_RELEASES, seedId } from '@rave/domain';
import type { ServiceContext } from '@rave/service-kit';
import { publishArtist } from './artists.js';
import { BIOS, CATEGORIES, GENRES, LYRICS, MONTHLY_LISTENERS, SHOWS, VERIFIED } from './seed-data.js';

const SH = (n: number) => `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${((n - 1) % 16) + 1}.mp3`;

/** Seed katalog demo (idempoten). */
export async function seed({ db, log }: ServiceContext) {
  await db.tx(async (tx) => {
    for (const [id, name] of GENRES) await tx.query(`INSERT INTO genres (id, name) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`, [id, name]);
    for (const [i, c] of CATEGORIES.entries()) {
      await tx.query(
        `INSERT INTO categories (id, name, color, image_url, href, genres, position) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET name=$2, color=$3, image_url=$4, href=$5, genres=$6, position=$7`,
        [c.id, c.name, c.color, `https://picsum.photos/seed/rave-cat-${c.id}/300/300`, c.href, c.genres, i],
      );
    }

    for (const a of SEED.artists) {
      const ml = MONTHLY_LISTENERS[a.slug] ?? 5000;
      await tx.query(
        `INSERT INTO artists (id, org_id, slug, name, bio, image_url, cover_url, city, genres, verified, monthly_listeners, listeners_base, followers)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12)
         ON CONFLICT (id) DO UPDATE SET org_id=$2, slug=$3, name=$4, bio=$5, image_url=$6, cover_url=$7, city=$8, genres=$9, verified=$10,
           listeners_base=$11, monthly_listeners=greatest(artists.monthly_listeners, $11)`,
        [a.id, a.orgId, a.slug, a.name, BIOS[a.slug], SEED_ARTIST_IMAGE(a.slug), SEED_ARTIST_COVER(a.slug), a.city, [...a.genres], VERIFIED.has(a.slug), ml, Math.round(ml * 0.18)],
      );
    }

    for (const r of SEED_RELEASES) {
      await tx.query(
        `INSERT INTO releases (id, artist_id, title, type, status, release_date, cover_url, label, genre, upc, published_at, submitted_at)
         VALUES ($1,$2,$3,$4,'LIVE',$5,$6,$7,$8,$9,$5::date,$5::date)
         ON CONFLICT (id) DO UPDATE SET title=$3, type=$4, status='LIVE', release_date=$5, cover_url=$6, label=$7, genre=$8, upc=$9`,
        [r.id, r.artistId, r.title, r.type, r.releaseDate, r.coverUrl, r.label, r.genre, r.upc],
      );
      for (const t of r.tracks) {
        const plays = 500 + ((parseInt(t.id.slice(-6), 10) * 7919) % 90_000);
        await tx.query(
          `INSERT INTO tracks (id, release_id, artist_id, title, track_number, duration_ms, explicit, isrc, audio_url, loudness_gain_db, play_count)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (id) DO UPDATE SET title=$4, track_number=$5, duration_ms=$6, explicit=$7, isrc=$8, audio_url=$9, loudness_gain_db=$10`,
          [t.id, r.id, r.artistId, t.title, t.trackNumber, t.durationMs, t.explicit, t.isrc, t.audioUrl, -((t.trackNumber % 4) + 1.5), plays],
        );
        // Split 100% disetujui: master milik artis (indie), publishing dibagi pencipta & penerbit.
        const has = await tx.query(`SELECT 1 FROM rights_shares WHERE track_id = $1 LIMIT 1`, [t.id]);
        if (!has.rowCount) {
          const artist = SEED.artists.find((x) => x.id === r.artistId)!;
          const rows: [string, string, number][] = [
            ['MASTER', artist.name, r.label === 'Mandiri' ? 100 : 65],
            ...(r.label === 'Mandiri' ? [] : ([['MASTER', r.label, 35]] as [string, string, number][])),
            ['PUBLISHING', `Pencipta — ${artist.name}`, 70],
            ['PUBLISHING', 'Nada Publishing', 30],
          ];
          for (const [i, [type, party, pct]] of rows.entries()) {
            await tx.query(
              `INSERT INTO rights_shares (id, track_id, type, party_name, pct, approved_at) VALUES ($1,$2,$3,$4,$5, now())`,
              [seedId(510, parseInt(t.id.slice(-6), 10) * 10 + i), t.id, type, party, pct],
            );
          }
        }
        const lyr = LYRICS[t.title];
        if (lyr) {
          const lines = lyr.map(([s, text]) => ({ time_ms: s * 1000, text }));
          await tx.query(
            `INSERT INTO lyrics (track_id, synced, lines, plain) VALUES ($1, true, $2, $3)
             ON CONFLICT (track_id) DO UPDATE SET lines = $2, plain = $3`,
            [t.id, JSON.stringify(lines), lyr.map((l) => l[1]).join('\n')],
          );
        }
      }
    }

    let audioN = 3;
    for (const [si, s] of SHOWS.entries()) {
      const showId = seedId(450, si + 1);
      await tx.query(
        `INSERT INTO shows (id, kind, title, publisher, description, cover_url, category, age_rating, content_warning, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() - ($10 || ' days')::interval)
         ON CONFLICT (id) DO UPDATE SET kind=$2, title=$3, publisher=$4, description=$5, cover_url=$6, category=$7, age_rating=$8, content_warning=$9`,
        [showId, s.kind, s.title, s.publisher, s.description, `https://picsum.photos/seed/rave-show-${si + 1}/640/640`, s.category, s.age_rating ?? null, s.content_warning ?? null, 60 - si],
      );
      for (const [ei, e] of s.episodes.entries()) {
        await tx.query(
          `INSERT INTO episodes (id, show_id, title, description, duration_ms, published_at, is_premium, season, episode_number, audio_url)
           VALUES ($1,$2,$3,$4,$5, now() - ($6 || ' days')::interval, $7,$8,$9,$10)
           ON CONFLICT (id) DO UPDATE SET title=$3, description=$4, duration_ms=$5, is_premium=$7, season=$8, episode_number=$9, audio_url=$10`,
          [seedId(460, (si + 1) * 100 + ei + 1), showId, e.title, e.description, e.minutes * 60_000, (s.episodes.length - ei) * 7 + si, !!e.premium, e.season ?? null, e.ep ?? null, SH(audioN++)],
        );
      }
    }

    for (const a of SEED.artists) await publishArtist(tx, a.id);
  });
  log.info(`seed katalog: ${SEED.artists.length} artis, ${SEED_RELEASES.length} rilis, ${SHOWS.length} show`);
}
