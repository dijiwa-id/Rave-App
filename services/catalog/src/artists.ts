import { publish, slugify, type Client } from '@rave/service-kit';
import { ARTIST_SUMMARY_COLS } from './queries.js';

/** Publikasikan read model artis (booking/ticketing/library memakai event ini) & kembalikan data artis. */
export async function publishArtist(tx: Client, artistId: string) {
  const r = await tx.query(`SELECT ${ARTIST_SUMMARY_COLS}, a.bio, a.cover_url, a.followers, a.org_id, a.links FROM artists a WHERE a.id = $1`, [artistId]);
  const a = r.rows[0];
  if (!a) return null;
  await publish(tx, 'catalog.artist.upserted', a.id, {
    artistId: a.id,
    name: a.name,
    slug: a.slug,
    city: a.city,
    genres: a.genres,
    orgId: a.org_id,
    imageUrl: a.image_url,
  });
  return a;
}

/** Slug unik: tambahkan sufiks angka bila sudah terpakai. */
export async function uniqueSlug(tx: Client, name: string): Promise<string> {
  const base = slugify(name) || 'artis';
  for (let i = 0; i < 50; i++) {
    const s = i === 0 ? base : `${base}-${i + 1}`;
    const r = await tx.query(`SELECT 1 FROM artists WHERE slug = $1`, [s]);
    if (!r.rowCount) return s;
  }
  return `${base}-${Date.now().toString(36)}`;
}
