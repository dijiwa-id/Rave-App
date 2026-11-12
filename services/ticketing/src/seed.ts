import { SEED, seedId, seedSchedule, demoArt } from '@rave/domain';
import { publish, type ServiceContext } from '@rave/service-kit';

const A = Object.fromEntries(SEED.artists.map((a) => [a.slug, a.id]));

const EVENTS_RAW = [
  {
    n: 1, slug: 'pulang-ke-utara-tour-bandung', title: 'Pulang ke Utara Tour — Bandung', city: 'Bandung', venue: 'Dago Tea House', address: 'Jl. Bukit Dago Selatan No. 53, Bandung',
    start: '2026-10-24T19:00:00+07:00', end: '2026-10-24T23:00:00+07:00', artists: [A['senja-kolektif'], A['arunika']],
    types: [{ name: 'Presale Fan Setia', price: 75_000, quota: 100, presale: true }, { name: 'Early Bird', price: 100_000, quota: 200 }, { name: 'Reguler', price: 150_000, quota: 400 }],
  },
  {
    n: 2, slug: 'malam-beton-jakarta', title: 'Malam Beton: Kota Mati & Lalu Lintas', city: 'Jakarta', venue: 'Rossi Musik Fatmawati', address: 'Jl. RS. Fatmawati No. 30, Jakarta Selatan',
    start: '2026-11-07T19:30:00+07:00', end: '2026-11-07T23:30:00+07:00', artists: [A['kota-mati'], A['lalu-lintas']],
    types: [{ name: 'Early Bird', price: 120_000, quota: 150 }, { name: 'Reguler', price: 175_000, quota: 350 }],
  },
  {
    n: 3, slug: 'embun-pertama-showcase-yogyakarta', title: 'Embun Pertama Showcase', city: 'Yogyakarta', venue: 'Taman Budaya Yogyakarta', address: 'Jl. Sriwedani No. 1, Yogyakarta',
    start: '2026-11-14T19:00:00+07:00', end: '2026-11-14T22:00:00+07:00', artists: [A['arunika'], A['gelombang-pagi']],
    types: [{ name: 'Presale', price: 80_000, quota: 100, presale: true }, { name: 'Reguler', price: 110_000, quota: 300 }],
  },
  {
    n: 4, slug: 'pensi-tunjungan-surabaya', title: 'Pensi Tunjungan 2026', city: 'Surabaya', venue: 'Grand City Convex', address: 'Jl. Walikota Mustajab No. 1, Surabaya',
    start: '2026-11-28T15:00:00+07:00', end: '2026-11-28T23:00:00+07:00', artists: [A['lalu-lintas'], A['mc-rantau'], A['nirmala']],
    types: [{ name: 'Early Bird', price: 150_000, quota: 500 }, { name: 'Reguler', price: 225_000, quota: 1500 }, { name: 'VIP', price: 350_000, quota: 200 }],
  },
  {
    n: 5, slug: 'pasang-surut-sunset-bali', title: 'Pasang Surut Sunset Session', city: 'Bali', venue: 'Potato Head Beach Club', address: 'Jl. Petitenget No. 51B, Seminyak, Bali',
    start: '2026-12-05T16:00:00+08:00', end: '2026-12-05T22:00:00+08:00', artists: [A['dara-laut'], A['nirmala']],
    types: [{ name: 'Early Bird', price: 200_000, quota: 200 }, { name: 'Reguler', price: 300_000, quota: 400 }],
  },
  {
    n: 6, slug: 'kabut-batu-malang', title: 'Kabut Batu: Malam Shoegaze', city: 'Malang', venue: 'Houtenhand Malang', address: 'Jl. Raya Tlogomas, Malang',
    start: '2026-12-19T19:00:00+07:00', end: '2026-12-19T23:00:00+07:00', artists: [A['gelombang-pagi'], A['senja-kolektif']],
    types: [{ name: 'Presale', price: 75_000, quota: 80, presale: true }, { name: 'Reguler', price: 120_000, quota: 250 }],
  },
];

const EVENTS = EVENTS_RAW.map((e) => ({ ...e, start: seedSchedule(e.start), end: seedSchedule(e.end) }));

export async function seed({ db, log }: ServiceContext) {
  await db.tx(async (tx) => {
    for (const a of SEED.artists) await tx.query(`INSERT INTO artists (id, name, slug) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`, [a.id, a.name, a.slug]);
    for (const e of EVENTS) {
      const id = seedId(700, e.n);
      const r = await tx.query(
        `INSERT INTO events (id, slug, org_id, title, description, city, venue_name, venue_address, starts_at, ends_at, poster_url, artist_ids, rules, status, created_by, published_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'PUBLISHED',$14, now()) ON CONFLICT (id) DO NOTHING`,
        [
          id, e.slug, SEED.orgs.pensiPromotor, e.title,
          `${e.title} menghadirkan penampilan langsung dari artis independen terbaik. Dipersembahkan oleh Pensi Nusantara bersama RAVE.`,
          e.city, e.venue, e.address, e.start, e.end, demoArt(`event-${e.n}`, 800, 1000), e.artists,
          'Usia 17+. Tiket QR berputar di aplikasi RAVE — screenshot tidak berlaku. Dilarang membawa makanan & minuman dari luar.',
          SEED.users.promotor,
        ],
      );
      if (!r.rowCount) continue;
      for (let i = 0; i < e.types.length; i++) {
        const t = e.types[i] as { name: string; price: number; quota: number; presale?: boolean };
        await tx.query(
          `INSERT INTO ticket_types (id, event_id, name, price, quota, max_per_account, presale, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [seedId(701, e.n * 10 + i), id, t.name, t.price, t.quota, t.presale ? 2 : 4, t.presale ?? false, i],
        );
      }
      await publish(tx, 'ticketing.event.published', id, { eventId: id, title: e.title, city: e.city, startsAt: new Date(e.start).toISOString(), artistIds: e.artists, slug: e.slug });
    }
  });
  log.info('seed ticketing: 6 event');
}
