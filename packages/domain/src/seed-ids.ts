// ID tetap untuk data demo agar seed di tiap service (schema terpisah) saling konsisten.
// Hanya untuk development/demo — jangan dipakai di logika produksi.

/** UUID deterministik: kind (3 digit) + n (9 digit). */
export function seedId(kind: number, n: number): string {
  return `01900000-0000-7000-8${String(kind).padStart(3, '0')}-${String(n).padStart(12, '0')}`;
}

export const SEED = {
  users: {
    fan: '01900000-0000-7000-8000-000000000001',
    artist: '01900000-0000-7000-8000-000000000002', // pemilik org artis "Senja Kolektif"
    manager: '01900000-0000-7000-8000-000000000003',
    promotor: '01900000-0000-7000-8000-000000000004',
    admin: '01900000-0000-7000-8000-000000000005', // admin_role OPS
    superadmin: '01900000-0000-7000-8000-000000000006', // admin_role SUPER_ADMIN
    premium: '01900000-0000-7000-8000-000000000007', // fan berlangganan Premium (HQ/Lossless, bebas iklan)
  },
  emails: {
    fan: 'fan@rave.id',
    artist: 'artis@rave.id',
    manager: 'manajer@rave.id',
    promotor: 'promotor@rave.id',
    admin: 'admin@rave.id',
    superadmin: 'superadmin@rave.id',
    premium: 'premium@rave.id',
  },
  /** Siaran live demo (service live). */
  liveStreams: {
    demo: '01900000-0000-7000-8000-000000000801',
    tourBandung: '01900000-0000-7000-8000-000000000802',
    pastSession: '01900000-0000-7000-8000-000000000803',
  },
  orgs: {
    senjaArtist: '01900000-0000-7000-8000-000000000101',
    nadaManagement: '01900000-0000-7000-8000-000000000102',
    pensiPromotor: '01900000-0000-7000-8000-000000000103',
    indieLabel: '01900000-0000-7000-8000-000000000104',
  },
  // Artis fiktif (bukan artis nyata). orgId = org ARTIST pemilik profil.
  artists: [
    { id: '01900000-0000-7000-8000-000000000201', orgId: '01900000-0000-7000-8000-000000000101', slug: 'senja-kolektif', name: 'Senja Kolektif', city: 'Bandung', genres: ['indie-pop', 'folk'] },
    { id: '01900000-0000-7000-8000-000000000202', orgId: '01900000-0000-7000-8000-000000000302', slug: 'arunika', name: 'Arunika', city: 'Yogyakarta', genres: ['folk', 'akustik'] },
    { id: '01900000-0000-7000-8000-000000000203', orgId: '01900000-0000-7000-8000-000000000303', slug: 'kota-mati', name: 'Kota Mati', city: 'Jakarta', genres: ['rock', 'post-punk'] },
    { id: '01900000-0000-7000-8000-000000000204', orgId: '01900000-0000-7000-8000-000000000304', slug: 'lalu-lintas', name: 'Lalu Lintas', city: 'Surabaya', genres: ['indie-rock'] },
    { id: '01900000-0000-7000-8000-000000000205', orgId: '01900000-0000-7000-8000-000000000305', slug: 'dara-laut', name: 'Dara Laut', city: 'Bali', genres: ['r-n-b', 'soul'] },
    { id: '01900000-0000-7000-8000-000000000206', orgId: '01900000-0000-7000-8000-000000000306', slug: 'gelombang-pagi', name: 'Gelombang Pagi', city: 'Malang', genres: ['shoegaze', 'dream-pop'] },
    { id: '01900000-0000-7000-8000-000000000207', orgId: '01900000-0000-7000-8000-000000000307', slug: 'mc-rantau', name: 'MC Rantau', city: 'Medan', genres: ['hip-hop'] },
    { id: '01900000-0000-7000-8000-000000000208', orgId: '01900000-0000-7000-8000-000000000308', slug: 'nirmala', name: 'Nirmala', city: 'Jakarta', genres: ['pop', 'electronic'] },
  ],
} as const;

/**
 * Tanggal jadwal data demo ditulis relatif terhadap jangkar 2026-10-24 (event pertama). Agar seed tidak "basi"
 * (event demo sudah lewat), semua tanggal digeser per minggu penuh — hari & jam tetap — hingga event pertama
 * minimal 14 hari ke depan. Hanya memengaruhi baris baru (seed idempoten, ON CONFLICT DO NOTHING).
 */
export function seedSchedule(iso: string, now = Date.now()): string {
  const WEEK = 7 * 86_400_000;
  const anchor = Date.parse('2026-10-24T00:00:00+07:00');
  const min = now + 14 * 86_400_000;
  const weeks = anchor >= min ? 0 : Math.ceil((min - anchor) / WEEK);
  return new Date(Date.parse(iso) + weeks * WEEK).toISOString();
}

export const SEED_ARTIST_IDS = SEED.artists.map((a) => a.id);

export const SEED_CITIES = ['Jakarta', 'Bandung', 'Yogyakarta', 'Surabaya', 'Malang', 'Bali', 'Medan', 'Semarang', 'Makassar', 'Solo'];

// ---------------- Katalog demo deterministik ----------------
// Audio demo: SoundHelix (CC, contoh publik). Produksi: rendisi HLS/DASH ber-DRM dari CDN.
const audio = (n: number) => `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${((n - 1) % 16) + 1}.mp3`;
/** Karya demo lokal (service catalog) — bukan host pihak ketiga yang bisa tidak terjangkau. */
export const demoArt = (seed: string, w = 640, h = w) => `/v1/catalog/demo-art/rave-${seed}-${w}x${h}.jpg`;
const img = (seed: string, size = 640) => demoArt(seed, size);

const TITLES: Record<string, { ep: string; single: string; tracks: string[] }> = {
  'senja-kolektif': { ep: 'Pulang ke Utara', single: 'Hujan di Dago', tracks: ['Pulang ke Utara', 'Kopi Pukul Dua', 'Lampu Kota', 'Surat yang Tak Terkirim', 'Hujan di Dago'] },
  arunika: { ep: 'Embun Pertama', single: 'Kabut Merapi', tracks: ['Embun Pertama', 'Sepeda Tua', 'Malioboro Tengah Malam', 'Rumah Nenek', 'Kabut Merapi'] },
  'kota-mati': { ep: 'Beton & Debu', single: 'Sirene', tracks: ['Beton & Debu', 'Jam Pulang Kantor', 'Gedung Kosong', 'Asap', 'Sirene'] },
  'lalu-lintas': { ep: 'Lampu Merah', single: 'Pelabuhan', tracks: ['Lampu Merah', 'Jalan Tunjungan', 'Klakson', 'Putar Balik', 'Pelabuhan'] },
  'dara-laut': { ep: 'Pasang Surut', single: 'Garam', tracks: ['Pasang Surut', 'Senja Kuta', 'Ombak Kecil', 'Biru', 'Garam'] },
  'gelombang-pagi': { ep: 'Kabut Batu', single: 'Dingin', tracks: ['Kabut Batu', 'Apel Hijau', 'Gema Lembah', 'Pelan-Pelan', 'Dingin'] },
  'mc-rantau': { ep: 'Tanah Seberang', single: 'Horas', tracks: ['Tanah Seberang', 'Logat', 'Kereta Malam', 'Rantau', 'Horas'] },
  nirmala: { ep: 'Neon Jakarta', single: 'Satu Pesan', tracks: ['Neon Jakarta', 'Layar Ponsel', 'Lantai Dansa', 'Pukul Tiga', 'Satu Pesan'] },
};

export interface SeedTrack {
  id: string;
  title: string;
  trackNumber: number;
  durationMs: number;
  audioUrl: string;
  isrc: string;
  explicit: boolean;
}
export interface SeedRelease {
  id: string;
  artistId: string;
  title: string;
  type: 'EP' | 'SINGLE';
  releaseDate: string;
  coverUrl: string;
  label: string;
  genre: string;
  upc: string;
  tracks: SeedTrack[];
}

let audioN = 1;
export const SEED_RELEASES: SeedRelease[] = SEED.artists.flatMap((a, ai) => {
  const t = TITLES[a.slug];
  const mk = (ri: number, ti: number, title: string): SeedTrack => ({
    id: seedId(500, ai * 100 + ri * 10 + ti + 1),
    title,
    trackNumber: ti + 1,
    durationMs: 180_000 + ((ai * 7 + ti * 13) % 120) * 1000,
    audioUrl: audio(audioN++),
    isrc: `ID-GM1-26-${String(ai * 100 + ri * 10 + ti + 1).padStart(5, '0')}`,
    explicit: a.slug === 'mc-rantau' && ti === 1,
  });
  return [
    {
      id: seedId(400, ai * 10 + 1),
      artistId: a.id,
      title: t.ep,
      type: 'EP' as const,
      releaseDate: `2026-0${(ai % 8) + 1}-15`,
      coverUrl: img(`${a.slug}-ep`),
      label: ai % 2 === 0 ? 'Rekam Pinggir' : 'Mandiri',
      genre: a.genres[0],
      upc: `8990000${String(ai * 10 + 1).padStart(5, '0')}`,
      tracks: t.tracks.slice(0, 4).map((title, ti) => mk(0, ti, title)),
    },
    {
      id: seedId(400, ai * 10 + 2),
      artistId: a.id,
      title: t.single,
      type: 'SINGLE' as const,
      releaseDate: `2026-09-${String(10 + ai).padStart(2, '0')}`,
      coverUrl: img(`${a.slug}-single`),
      label: 'Mandiri',
      genre: a.genres[0],
      upc: `8990000${String(ai * 10 + 2).padStart(5, '0')}`,
      tracks: [mk(1, 0, t.tracks[4])],
    },
  ];
});

export const SEED_TRACKS = SEED_RELEASES.flatMap((r) => r.tracks.map((t) => ({ ...t, releaseId: r.id, artistId: r.artistId })));

export const SEED_ARTIST_IMAGE = (slug: string) => img(`artist-${slug}`, 640);
export const SEED_ARTIST_COVER = (slug: string) => demoArt(`cover-${slug}`, 1600, 600);
