import { SEED, SEED_RELEASES, SEED_TRACKS, seedId } from '@rave/domain';
import type { ServiceContext } from '@rave/service-kit';

const byArtist = (slug: string) => {
  const a = SEED.artists.find((x) => x.slug === slug)!;
  return SEED_TRACKS.filter((t) => t.artistId === a.id).map((t) => t.id);
};
const cover = (s: string) => `https://picsum.photos/seed/rave-pl-${s}/640/640`;
const pick = (arr: string[], n: number, off = 0) => Array.from({ length: Math.min(n, arr.length) }, (_, i) => arr[(i + off) % arr.length]);
const all = SEED_TRACKS.map((t) => t.id);
const singles = SEED_RELEASES.filter((r) => r.type === 'SINGLE').flatMap((r) => r.tracks.map((t) => t.id));

const EDITORIAL = [
  { n: 1, title: 'Indie Kotamu: Bandung', desc: 'Suara terbaik dari Kota Kembang minggu ini.', tags: ['home', 'city:bandung', 'indie'], tracks: [...byArtist('senja-kolektif'), ...pick(all, 6, 9)] },
  { n: 2, title: 'Senja Akustik', desc: 'Petikan gitar untuk menutup hari.', tags: ['home', 'mood', 'akustik'], tracks: [...byArtist('arunika'), ...byArtist('senja-kolektif').slice(0, 2)] },
  { n: 3, title: 'Fokus Kerja', desc: 'Tetap tenang dan fokus dengan instrumental lembut.', tags: ['home', 'focus'], tracks: [...byArtist('gelombang-pagi'), ...byArtist('dara-laut').slice(0, 3)] },
  { n: 4, title: 'Rock Ibu Kota', desc: 'Distorsi, beton, dan jam pulang kantor.', tags: ['home', 'rock', 'city:jakarta'], tracks: [...byArtist('kota-mati'), ...byArtist('lalu-lintas')] },
  { n: 5, title: 'Hip-Hop Nusantara', desc: 'Rima dari Sabang sampai Merauke.', tags: ['home', 'hip-hop'], tracks: [...byArtist('mc-rantau'), ...byArtist('nirmala').slice(0, 2)] },
  { n: 6, title: 'Rilis Baru Jumat', desc: 'Single terbaru dari artis independen.', tags: ['home', 'new'], tracks: singles },
  { n: 7, title: 'Dream Pop Malang', desc: 'Kabut, reverb, dan udara dingin.', tags: ['city:malang', 'focus', 'mood'], tracks: [...byArtist('gelombang-pagi'), ...byArtist('dara-laut')] },
  { n: 8, title: 'Lagu Hujan', desc: 'Untuk jendela berembun dan teh hangat.', tags: ['home', 'mood'], tracks: pick(all, 12, 3) },
];

export async function seed({ db, log }: ServiceContext) {
  await db.tx(async (tx) => {
    for (const p of EDITORIAL) {
      const id = seedId(600, p.n);
      const r = await tx.query(
        `INSERT INTO playlists (id, owner_id, owner_name, title, description, cover_url, visibility, is_editorial, tags, sort_order)
         VALUES ($1,'rave','RAVE',$2,$3,$4,'PUBLIC',true,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [id, p.title, p.desc, cover(String(p.n)), p.tags, p.n],
      );
      if (r.rowCount) {
        const uniq = [...new Set(p.tracks)];
        for (let i = 0; i < uniq.length; i++)
          await tx.query(`INSERT INTO playlist_items (id, playlist_id, track_id, position, added_by) VALUES ($1,$2,$3,$4,'rave')`, [seedId(601, p.n * 1000 + i), id, uniq[i], i + 1]);
      }
    }

    const fan = SEED.users.fan;
    for (const t of pick(all, 8, 1)) await tx.query(`INSERT INTO likes (user_id, track_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [fan, t]);
    // Sama dengan onboarding IAM (Senja Kolektif, Arunika, Gelombang Pagi)
    for (const a of [SEED.artists[0].id, SEED.artists[1].id, SEED.artists[5].id])
      await tx.query(`INSERT INTO follows (user_id, artist_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [fan, a]);
    for (const r of [SEED_RELEASES[0].id, SEED_RELEASES[2].id])
      await tx.query(`INSERT INTO saved_releases (user_id, release_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [fan, r]);

    const mine = [
      { n: 101, title: 'Perjalanan ke Lembang', vis: 'PUBLIC', tracks: pick(all, 7, 2) },
      { n: 102, title: 'Diam-diam Suka', vis: 'PRIVATE', tracks: pick(all, 5, 20) },
    ];
    for (const p of mine) {
      const id = seedId(600, p.n);
      const r = await tx.query(
        `INSERT INTO playlists (id, owner_id, owner_name, title, visibility) VALUES ($1,$2,'Raka Pendengar',$3,$4) ON CONFLICT (id) DO NOTHING`,
        [id, fan, p.title, p.vis],
      );
      if (r.rowCount)
        for (let i = 0; i < p.tracks.length; i++)
          await tx.query(`INSERT INTO playlist_items (id, playlist_id, track_id, position, added_by) VALUES ($1,$2,$3,$4,$5)`, [seedId(601, p.n * 1000 + i), id, p.tracks[i], i + 1, fan]);
    }
  });
  log.info('seed library: 8 editorial, playlist & likes fan');
}
