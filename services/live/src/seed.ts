import { SEED, demoArt, seedId, seedSchedule } from '@rave/domain';
import type { ServiceContext } from '@rave/service-kit';
import { keyHash, newStreamKey } from './manager.js';

const L = SEED.liveStreams;
const senja = SEED.artists[0];

/**
 * Data demo (idempoten). Nama org/artis/event didenormalisasi seperti saat dibuat lewat API
 * (service lain tidak berjalan ketika seed). Kunci stream acak & tidak disimpan — pemilik merotasi kunci di Studio;
 * kanal demo mendapat kunci baru dari server setiap start.
 */
export async function seed({ db, log }: ServiceContext) {
  const artist = [senja.id, senja.name, senja.slug, demoArt('artist-senja-kolektif', 600)];
  const rows: unknown[][] = [
    [
      L.demo, senja.orgId, 'Senja Kolektif', 'ARTIST', ...artist,
      'Senja Kolektif — Live Session dari Studio',
      'Sesi akustik langsung dari studio kami di Bandung: lagu-lagu dari EP "Pulang ke Utara" dan satu lagu baru yang belum pernah dirilis. Ngobrol di chat ya!',
      'PUBLIC', null, null, null, null, null, new Date().toISOString(), 'SCHEDULED', null, 0, 0, true,
    ],
    [
      L.tourBandung, SEED.orgs.pensiPromotor, 'Pensi Nusantara', 'PROMOTOR', ...artist,
      'Pulang ke Utara Tour — Bandung (Live)',
      'Siaran langsung konser penuh dari Dago Tea House. Khusus pemegang tiket — tiket fisik juga berlaku untuk menonton online.',
      'TICKET', seedId(700, 1), 'pulang-ke-utara-tour-bandung', 'Pulang ke Utara Tour — Bandung', 'Bandung', seedSchedule('2026-10-24T19:00:00+07:00'),
      seedSchedule('2026-10-24T19:00:00+07:00'), 'SCHEDULED', null, 0, 0, false,
    ],
    [
      L.pastSession, senja.orgId, 'Senja Kolektif', 'ARTIST', ...artist,
      'Dengar Bareng: Rilis "Hujan di Dago"',
      'Malam peluncuran single "Hujan di Dago" — cerita di balik lagu & sesi tanya jawab.',
      'PUBLIC', null, null, null, null, null, '2026-09-10T20:00:00+07:00', 'ENDED', 'ended_by_host', 1342, 4817, false,
    ],
  ];
  for (const r of rows) {
    const key = newStreamKey();
    const ended = r[17] === 'ENDED';
    await db.query(
      `INSERT INTO streams (id, org_id, org_name, org_type, artist_id, artist_name, artist_slug, artist_image, title, description, access,
         event_id, event_slug, event_title, event_city, event_starts_at, scheduled_at, status, ended_reason, peak_viewers, total_views, is_demo,
         started_at, ended_at, stream_key_hash, key_hint, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
         ${ended ? `$17::timestamptz, $17::timestamptz + interval '74 minutes'` : 'NULL, NULL'}, $23, $24, $25)
       ON CONFLICT (id) DO NOTHING`,
      [...r, keyHash(key), key.slice(-4), r[1] === SEED.orgs.pensiPromotor ? SEED.users.promotor : SEED.users.artist],
    );
  }
  log.info('seed live: kanal demo, 1 siaran bertiket terjadwal, 1 siaran selesai');
}
