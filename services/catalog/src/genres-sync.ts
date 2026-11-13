import { GENRES } from '@rave/domain';
import type { ServiceContext } from '@rave/service-kit';

/**
 * Sinkronkan taksonomi genre bersama (packages/domain/src/genres.ts) ke `catalog.genres` saat service mulai.
 * Produksi tidak menjalankan seed, jadi genre baru di taksonomi masuk lewat sini. Hanya menambah (ON CONFLICT DO
 * NOTHING): genre yang sudah ada tidak diubah, aman dijalankan paralel oleh beberapa replika.
 */
export async function syncGenres({ db, log }: ServiceContext) {
  const r = await db.query(
    `INSERT INTO genres (id, name) SELECT * FROM unnest($1::text[], $2::text[]) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [GENRES.map((g) => g.id), GENRES.map((g) => g.name)],
  );
  if (r.length) log.info({ added: r.length }, 'taksonomi genre disinkronkan');
}
