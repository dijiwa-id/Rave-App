// ID tetap untuk data demo agar seed di tiap service (schema terpisah) saling konsisten.
// Hanya untuk development/demo — jangan dipakai di logika produksi.

export const SEED = {
  users: {
    fan: '01900000-0000-7000-8000-000000000001',
    artist: '01900000-0000-7000-8000-000000000002', // pemilik org artis "Senja Kolektif"
    manager: '01900000-0000-7000-8000-000000000003',
    promotor: '01900000-0000-7000-8000-000000000004',
    admin: '01900000-0000-7000-8000-000000000005',
  },
  emails: {
    fan: 'fan@gema.id',
    artist: 'artis@gema.id',
    manager: 'manajer@gema.id',
    promotor: 'promotor@gema.id',
    admin: 'admin@gema.id',
  },
  orgs: {
    senjaArtist: '01900000-0000-7000-8000-000000000101',
    nadaManagement: '01900000-0000-7000-8000-000000000102',
    pensiPromotor: '01900000-0000-7000-8000-000000000103',
    indieLabel: '01900000-0000-7000-8000-000000000104',
  },
  // Artis fiktif (bukan artis nyata).
  artists: [
    { id: '01900000-0000-7000-8000-000000000201', slug: 'senja-kolektif', name: 'Senja Kolektif', city: 'Bandung', genres: ['indie-pop', 'folk'] },
    { id: '01900000-0000-7000-8000-000000000202', slug: 'arunika', name: 'Arunika', city: 'Yogyakarta', genres: ['folk', 'akustik'] },
    { id: '01900000-0000-7000-8000-000000000203', slug: 'kota-mati', name: 'Kota Mati', city: 'Jakarta', genres: ['rock', 'post-punk'] },
    { id: '01900000-0000-7000-8000-000000000204', slug: 'lalu-lintas', name: 'Lalu Lintas', city: 'Surabaya', genres: ['indie-rock'] },
    { id: '01900000-0000-7000-8000-000000000205', slug: 'dara-laut', name: 'Dara Laut', city: 'Bali', genres: ['r-n-b', 'soul'] },
    { id: '01900000-0000-7000-8000-000000000206', slug: 'gelombang-pagi', name: 'Gelombang Pagi', city: 'Malang', genres: ['shoegaze', 'dream-pop'] },
    { id: '01900000-0000-7000-8000-000000000207', slug: 'mc-rantau', name: 'MC Rantau', city: 'Medan', genres: ['hip-hop'] },
    { id: '01900000-0000-7000-8000-000000000208', slug: 'nirmala', name: 'Nirmala', city: 'Jakarta', genres: ['pop', 'electronic'] },
  ],
} as const;

export const SEED_ARTIST_IDS = SEED.artists.map((a) => a.id);
