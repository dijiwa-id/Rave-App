/**
 * Taksonomi genre RAVE — satu sumber untuk seed katalog (`catalog.genres`), onboarding fan, dasbor B2B (studio,
 * promotor, iklan) dan aplikasi klien. ID = slug stabil (tersimpan di artis, rilis, kategori, target iklan):
 * JANGAN mengganti ID yang sudah ada; tambahkan yang baru saja. Nama tampilan boleh diubah.
 *
 * Disusun per rumpun agar daftar panjang tetap mudah dipindai. Mencakup arus utama indie lama (shoegaze, post-punk),
 * gelombang global 2020-an (hyperpop, bedroom pop, amapiano, afrobeats, phonk, jersey club, drill, K-pop) dan
 * skena Indonesia yang hidup di platform streaming & panggung (dangdut koplo, funkot, DJ remix/jedag-jedug,
 * pop Melayu, pop Sunda/Jawa, keroncong, campursari, city pop revival, musik religi).
 */
export type GenreGroup = 'pop' | 'indie' | 'rock' | 'hiphop' | 'rnb' | 'electronic' | 'global' | 'indonesia' | 'jazz' | 'other';

export interface Genre {
  id: string;
  name: string;
  group: GenreGroup;
  /** Ditampilkan sebagai pilihan cepat di onboarding (selera umum pendengar). */
  popular?: boolean;
}

export const GENRE_GROUP_NAMES: Record<GenreGroup, { id: string; en: string }> = {
  pop: { id: 'Pop', en: 'Pop' },
  indie: { id: 'Indie & Alternatif', en: 'Indie & Alternative' },
  rock: { id: 'Rock, Punk & Metal', en: 'Rock, Punk & Metal' },
  hiphop: { id: 'Hip-Hop & Rap', en: 'Hip-Hop & Rap' },
  rnb: { id: 'R&B & Soul', en: 'R&B & Soul' },
  electronic: { id: 'Elektronik & Dansa', en: 'Electronic & Dance' },
  global: { id: 'Global', en: 'Global' },
  indonesia: { id: 'Indonesia', en: 'Indonesian' },
  jazz: { id: 'Jazz, Folk & Akustik', en: 'Jazz, Folk & Acoustic' },
  other: { id: 'Lainnya', en: 'Other' },
};

export const GENRES: readonly Genre[] = [
  // Pop
  { id: 'pop', name: 'Pop', group: 'pop', popular: true },
  { id: 'indie-pop', name: 'Indie Pop', group: 'pop', popular: true },
  { id: 'bedroom-pop', name: 'Bedroom Pop', group: 'pop', popular: true },
  { id: 'dream-pop', name: 'Dream Pop', group: 'pop' },
  { id: 'synth-pop', name: 'Synth-pop', group: 'pop' },
  { id: 'hyperpop', name: 'Hyperpop', group: 'pop' },
  { id: 'dance-pop', name: 'Dance Pop', group: 'pop' },
  { id: 'city-pop', name: 'City Pop', group: 'pop', popular: true },
  { id: 'k-pop', name: 'K-Pop', group: 'pop', popular: true },
  { id: 'j-pop', name: 'J-Pop', group: 'pop' },

  // Indie & alternatif
  { id: 'indie-rock', name: 'Indie Rock', group: 'indie', popular: true },
  { id: 'indie-folk', name: 'Indie Folk', group: 'indie' },
  { id: 'shoegaze', name: 'Shoegaze', group: 'indie', popular: true },
  { id: 'post-punk', name: 'Post-Punk', group: 'indie' },
  { id: 'post-rock', name: 'Post-Rock', group: 'indie' },
  { id: 'math-rock', name: 'Math Rock', group: 'indie' },
  { id: 'midwest-emo', name: 'Midwest Emo', group: 'indie' },
  { id: 'art-pop', name: 'Art Pop', group: 'indie' },
  { id: 'lo-fi', name: 'Lo-fi', group: 'indie', popular: true },

  // Rock, punk & metal
  { id: 'rock', name: 'Rock', group: 'rock', popular: true },
  { id: 'alternative-rock', name: 'Rock Alternatif', group: 'rock' },
  { id: 'punk', name: 'Punk', group: 'rock' },
  { id: 'pop-punk', name: 'Pop Punk', group: 'rock' },
  { id: 'emo', name: 'Emo', group: 'rock' },
  { id: 'hardcore', name: 'Hardcore', group: 'rock' },
  { id: 'metal', name: 'Metal', group: 'rock' },
  { id: 'metalcore', name: 'Metalcore', group: 'rock' },
  { id: 'grunge', name: 'Grunge', group: 'rock' },
  { id: 'stoner-rock', name: 'Stoner Rock', group: 'rock' },

  // Hip-hop & rap
  { id: 'hip-hop', name: 'Hip-Hop', group: 'hiphop', popular: true },
  { id: 'trap', name: 'Trap', group: 'hiphop' },
  { id: 'drill', name: 'Drill', group: 'hiphop' },
  { id: 'boom-bap', name: 'Boom Bap', group: 'hiphop' },
  { id: 'phonk', name: 'Phonk', group: 'hiphop' },
  { id: 'rap-melodic', name: 'Rap Melodik', group: 'hiphop' },

  // R&B & soul
  { id: 'r-n-b', name: 'R&B', group: 'rnb', popular: true },
  { id: 'alt-r-n-b', name: 'Alternative R&B', group: 'rnb' },
  { id: 'soul', name: 'Soul', group: 'rnb' },
  { id: 'neo-soul', name: 'Neo-Soul', group: 'rnb' },
  { id: 'funk', name: 'Funk', group: 'rnb' },
  { id: 'disco', name: 'Disco', group: 'rnb' },

  // Elektronik & dansa
  { id: 'electronic', name: 'Elektronik', group: 'electronic', popular: true },
  { id: 'house', name: 'House', group: 'electronic' },
  { id: 'techno', name: 'Techno', group: 'electronic' },
  { id: 'drum-and-bass', name: 'Drum & Bass', group: 'electronic' },
  { id: 'uk-garage', name: 'UK Garage', group: 'electronic' },
  { id: 'jersey-club', name: 'Jersey Club', group: 'electronic' },
  { id: 'edm', name: 'EDM', group: 'electronic' },
  { id: 'ambient', name: 'Ambient', group: 'electronic' },
  { id: 'synthwave', name: 'Synthwave', group: 'electronic' },
  { id: 'future-bass', name: 'Future Bass', group: 'electronic' },

  // Global
  { id: 'afrobeats', name: 'Afrobeats', group: 'global' },
  { id: 'amapiano', name: 'Amapiano', group: 'global' },
  { id: 'reggaeton', name: 'Reggaeton', group: 'global' },
  { id: 'latin-pop', name: 'Latin Pop', group: 'global' },
  { id: 'reggae', name: 'Reggae', group: 'global' },
  { id: 'ska', name: 'Ska', group: 'global' },

  // Indonesia
  { id: 'dangdut', name: 'Dangdut', group: 'indonesia', popular: true },
  { id: 'dangdut-koplo', name: 'Dangdut Koplo', group: 'indonesia', popular: true },
  { id: 'funkot', name: 'Funkot', group: 'indonesia' },
  { id: 'dj-remix', name: 'DJ Remix / Jedag-Jedug', group: 'indonesia' },
  { id: 'pop-melayu', name: 'Pop Melayu', group: 'indonesia' },
  { id: 'pop-sunda', name: 'Pop Sunda', group: 'indonesia' },
  { id: 'pop-jawa', name: 'Pop Jawa', group: 'indonesia' },
  { id: 'campursari', name: 'Campursari', group: 'indonesia' },
  { id: 'keroncong', name: 'Keroncong', group: 'indonesia' },
  { id: 'gamelan-kontemporer', name: 'Gamelan Kontemporer', group: 'indonesia' },
  { id: 'religi', name: 'Religi', group: 'indonesia' },

  // Jazz, folk & akustik
  { id: 'jazz', name: 'Jazz', group: 'jazz', popular: true },
  { id: 'nu-jazz', name: 'Nu Jazz', group: 'jazz' },
  { id: 'folk', name: 'Folk', group: 'jazz', popular: true },
  { id: 'akustik', name: 'Akustik', group: 'jazz', popular: true },
  { id: 'singer-songwriter', name: 'Singer-Songwriter', group: 'jazz' },
  { id: 'blues', name: 'Blues', group: 'jazz' },
  { id: 'country', name: 'Country', group: 'jazz' },

  // Lainnya
  { id: 'soundtrack', name: 'Soundtrack', group: 'other' },
  { id: 'klasik', name: 'Klasik', group: 'other' },
  { id: 'worship', name: 'Worship', group: 'other' },
  { id: 'anak', name: 'Anak-anak', group: 'other' },
];

export const GENRE_IDS: readonly string[] = GENRES.map((g) => g.id);
export const POPULAR_GENRE_IDS: readonly string[] = GENRES.filter((g) => g.popular).map((g) => g.id);
const BY_ID = new Map(GENRES.map((g) => [g.id, g]));
/** Nama tampilan genre; ID tak dikenal (genre lama/khusus) dikembalikan apa adanya. */
export const genreName = (id: string) => BY_ID.get(id)?.name ?? id;
