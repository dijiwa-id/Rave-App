// CMS landing page (Super Admin → Platform → Landing). Satu kunci pengaturan `content.landing` berisi seluruh konten
// yang dapat diedit tanpa deploy, dalam dua bahasa (id/en). Dipakai service `platform` untuk validasi dan web untuk
// default + render. Menambah field = tambah di LandingContent, LANDING_DEFAULT, dan coerceLanding.

export type LandingLocale = 'id' | 'en';
export interface L10n {
  id: string;
  en: string;
}

export const LANDING_SECTIONS = [
  { id: 'stats', label: 'Statistik', hint: 'Tiga angka di bawah pita kuning.' },
  { id: 'why', label: 'Kenapa RAVE', hint: 'Keunggulan utama platform.' },
  { id: 'spotlight', label: 'Sorotan rilis', hint: 'Rilis & artis pilihan dari katalog.' },
  { id: 'roles', label: 'Ekosistem (3 peran)', hint: 'Pendengar, artis, promotor.' },
  { id: 'how', label: 'Cara kerja', hint: 'Alur dengar → booking → panggung.' },
  { id: 'events', label: 'Event mendatang', hint: 'Diambil otomatis dari modul tiket.' },
  { id: 'testimonial', label: 'Testimoni', hint: 'Kutipan dari scene.' },
  { id: 'sponsor', label: 'Banner sponsor', hint: 'Slot iklan display berlabel “Iklan” — tampil hanya bila kreatif diisi & penayangan iklan aktif.' },
  { id: 'movement', label: 'Gerakan', hint: 'Kolase ajakan bergabung.' },
  { id: 'pricing', label: 'Harga', hint: 'Paket Gratis & Premium (harga dari pengaturan langganan).' },
  { id: 'faq', label: 'FAQ', hint: 'Pertanyaan umum.' },
  { id: 'waitlist', label: 'Waitlist', hint: 'Formulir pra-registrasi (juga bisa dimatikan di Modul).' },
] as const;
export type LandingSectionId = (typeof LANDING_SECTIONS)[number]['id'];

export interface LandingStat {
  value: number;
  suffix: L10n;
  label: L10n;
}
export interface LandingFaq {
  q: L10n;
  a: L10n;
}
export interface LandingContent {
  sections: Record<LandingSectionId, boolean>;
  /** Urutan section di bawah hero & pita (drag-and-drop di editor). Hero & pita selalu paling atas. */
  order: LandingSectionId[];
  hero: {
    kicker: L10n;
    badge: L10n;
    badge_link: L10n;
    badge_href: string;
    line1: L10n;
    line2: L10n;
    prefix: L10n;
    /** Kata berganti di baris ketiga (2–6 kata). */
    words: L10n[];
    lead: L10n;
    cta_primary: L10n;
    cta_primary_href: string;
    cta_secondary: L10n;
    cta_secondary_href: string;
  };
  /** Slogan pita kuning saat belum ada partner (content.partners). */
  band: L10n[];
  stats: LandingStat[];
  testimonial: { quote: L10n; name: string; role: L10n; stamp: L10n };
  faq: LandingFaq[];
  sponsor: { advertiser: string; handle: string; headline: L10n; body: L10n; cta: L10n; href: string };
}

export const LANDING_LIMITS = {
  words: { min: 2, max: 6 },
  band: { min: 1, max: 12 },
  stats: { min: 1, max: 4 },
  faq: { min: 1, max: 12 },
} as const;

const l = (id: string, en: string): L10n => ({ id, en });

export const LANDING_DEFAULT: LandingContent = {
  sections: Object.fromEntries(LANDING_SECTIONS.map((s) => [s.id, true])) as Record<LandingSectionId, boolean>,
  order: LANDING_SECTIONS.map((s) => s.id),
  hero: {
    kicker: l('Musik DIY · Indie · Off-air', 'DIY music · Indie · Off-air'),
    badge: l('Baru', 'New'),
    badge_link: l('Live konser', 'Live concerts'),
    badge_href: '/app/live',
    line1: l('Dari kamar,', 'From bedrooms,'),
    line2: l('ke playlist,', 'to playlists,'),
    prefix: l('ke', 'to'),
    words: [l('panggung.', 'stages.'), l('kotamu.', 'your city.'), l('gigs.', 'gigs.'), l('festival.', 'festivals.')],
    lead: l(
      'Dengarkan rilisan musisi independen Indonesia secara gratis, temukan scene di kotamu, lalu datang dan dukung mereka langsung di panggung.',
      "Stream releases from Indonesia's independent musicians for free, discover your city's scene, then show up and support them live.",
    ),
    cta_primary: l('Mulai mendengarkan', 'Start listening'),
    cta_primary_href: '/app',
    cta_secondary: l('Untuk artis & promotor', 'For artists & promoters'),
    cta_secondary_href: '#ekosistem',
  },
  band: [
    l('Musik DIY', 'DIY music'),
    l('Indie kamar', 'Bedroom indie'),
    l('Gigs kotamu', 'Gigs in your city'),
    l('Streaming gratis', 'Free streaming'),
    l('Noise & tape', 'Noise & tape'),
    l('Dukung langsung', 'Support directly'),
  ],
  stats: [
    { value: 500, suffix: l('+', '+'), label: l('artis indie terkurasi', 'curated indie artists') },
    { value: 5, suffix: l(' kota', ' cities'), label: l('peluncuran closed beta', 'closed beta launch') },
    { value: 100, suffix: l('+', '+'), label: l('promotor & EO kampus', 'promoters & campus organizers') },
  ],
  testimonial: {
    quote: l(
      '“Akhirnya data pendengar kami di Bandung bisa jadi bahan pitching ke promotor — dan DP-nya aman di rekening bersama.”',
      '“Finally our Bandung listener data can be used to pitch promoters — and the deposit is safe in escrow.”',
    ),
    name: 'Senja Kolektif',
    role: l('Band indie, Bandung', 'Indie band, Bandung'),
    stamp: l('Suara scene · Bandung', 'Voice of the scene · Bandung'),
  },
  faq: [
    {
      q: l('Apakah musik benar-benar gratis?', 'Is the music really free?'),
      a: l(
        'Ya. Streaming on-demand (AAC hingga 160 kbps), playlist, dan lirik gratis untuk semua pengguna terdaftar, dengan iklan sesekali. Premium membuka kualitas Tinggi (AAC 320) dan Lossless/Hi-Res (FLAC), bebas iklan, serta podcast & audio fiksi premium.',
        'Yes. On-demand streaming (AAC up to 160 kbps), playlists and lyrics are free for every registered user, with occasional ads. Premium unlocks High quality (AAC 320) and Lossless/Hi-Res (FLAC), no ads, and premium podcasts & audio fiction.',
      ),
    },
    {
      q: l('Bagaimana royalti streaming dihitung?', 'How are streaming royalties calculated?'),
      a: l(
        'RAVE memakai model user-centric (hybrid): pendapatan dari seorang pendengar hanya dibagi ke artis yang ia dengarkan. Hanya pemutaran ≥30 detik yang lolos deteksi fraud yang dihitung. Laporan royalti untuk artis sedang disiapkan dan akan tersedia di Artist Studio.',
        "RAVE uses a user-centric (hybrid) model: a listener's revenue is shared only among the artists they actually listen to. Only plays of 30 seconds or more that pass fraud detection count. Royalty reports for artists are being prepared and will be available in Artist Studio.",
      ),
    },
    {
      q: l('Apakah dana booking aman?', 'Is booking money safe?'),
      a: l(
        'Pembayaran promotor ditahan di rekening bersama (escrow) milik mitra pembayaran berizin — bukan rekening operasional RAVE. Dana baru masuk saldo wallet H+1 setelah show selesai tanpa sengketa, dibagi sesuai kontrak, lalu dapat ditarik ke rekening setelah verifikasi.',
        "Promoter payments are held in escrow by a licensed payment partner — not in RAVE's operating account. Funds are released one day after the show ends without dispute, and split automatically according to the contract.",
      ),
    },
    {
      q: l('Bagaimana RAVE melindungi hak cipta?', 'How does RAVE protect copyright?'),
      a: l(
        'Setiap unggahan melewati audio fingerprint, verifikasi identitas pengunggah, dan persetujuan split hak. Klaim pelanggaran ditangani dengan mekanisme notice-and-takedown maksimal 2×24 jam.',
        "Every upload goes through audio fingerprinting, uploader identity verification and rights-split approval. Infringement claims are handled through notice-and-takedown within 48 hours.",
      ),
    },
    {
      q: l('Katalog saya sudah ada di RAVE, bagaimana klaim profil?', 'My catalogue is already on RAVE — how do I claim my profile?'),
      a: l(
        'Masuk ke Artist Studio, pilih "Klaim profil", lalu verifikasi melalui akun media sosial resmi atau konfirmasi dari label/distributor Anda.',
        'Sign in to Artist Studio, choose "Claim profile", then verify through your official social media account or a confirmation from your label/distributor.',
      ),
    },
  ],
  // Kosong = tidak ada banner sponsor sampai Super Admin mengisi kreatif di Editor Landing (tanpa kreatif bawaan).
  sponsor: { advertiser: '', handle: '', headline: l('', ''), body: l('', ''), cta: l('', ''), href: '' },
};

/** Pilih teks sesuai bahasa; jatuh ke Bahasa Indonesia bila terjemahan kosong. */
export const pick = (v: L10n | undefined, locale: LandingLocale): string => (v ? (locale === 'en' && v.en.trim() ? v.en : v.id) : '');

// ---------------------------------------------------------------------------------------------
// Validasi
// ---------------------------------------------------------------------------------------------
const HREF_RE = /^(https:\/\/[^\s]{3,300}|\/(?!\/)[^\s]{0,300}|#[a-z0-9-]{1,60})$/i;

function str(v: unknown, path: string, max: number, required = true): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) throw new Error(`${path}: wajib diisi`);
  if (s.length > max) throw new Error(`${path}: maksimal ${max} karakter`);
  return s;
}
function l10n(v: unknown, path: string, max: number, opts: { enRequired?: boolean } = {}): L10n {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { id: str(o.id, `${path} (ID)`, max), en: str(o.en, `${path} (EN)`, max, opts.enRequired ?? false) };
}
function href(v: unknown, path: string): string {
  const s = str(v, path, 300);
  if (!HREF_RE.test(s)) throw new Error(`${path}: tautan harus https://…, path internal /…, atau #anchor`);
  return s;
}
function list<T>(v: unknown, path: string, lim: { min: number; max: number }, each: (x: unknown, i: number) => T): T[] {
  if (!Array.isArray(v)) throw new Error(`${path}: harus daftar`);
  if (v.length < lim.min) throw new Error(`${path}: minimal ${lim.min} item`);
  if (v.length > lim.max) throw new Error(`${path}: maksimal ${lim.max} item`);
  return v.map(each);
}

/** Sponsor opsional: pengiklan kosong = tidak ada banner (semua field lain diabaikan & dikosongkan). */
function coerceSponsor(sp: Record<string, unknown>): LandingContent['sponsor'] {
  const advertiser = str(sp.advertiser, 'Sponsor · pengiklan', 60, false);
  if (!advertiser) return { advertiser: '', handle: '', headline: { id: '', en: '' }, body: { id: '', en: '' }, cta: { id: '', en: '' }, href: '' };
  return {
    advertiser,
    handle: str(sp.handle, 'Sponsor · akun', 60, false),
    headline: l10n(sp.headline, 'Sponsor · judul', 70),
    body: l10n(sp.body, 'Sponsor · deskripsi', 160),
    cta: l10n(sp.cta, 'Sponsor · tombol', 24),
    href: href(sp.href, 'Sponsor · tautan'),
  };
}

/** Validasi & normalisasi konten landing. Melempar Error berbahasa Indonesia (path field disertakan). */
export function coerceLanding(value: unknown): LandingContent {
  if (!value || typeof value !== 'object') throw new Error('Konten landing: format tidak valid');
  const v = value as Record<string, any>;
  const sec = (v.sections ?? {}) as Record<string, unknown>;
  const sections = Object.fromEntries(LANDING_SECTIONS.map((s) => [s.id, sec[s.id] === undefined ? true : sec[s.id] === true])) as LandingContent['sections'];
  // Urutan: ambil id valid & unik dari input, lalu tambahkan section yang belum tercantum (mis. section baru).
  const ids = LANDING_SECTIONS.map((s) => s.id) as LandingSectionId[];
  const given = (Array.isArray(v.order) ? v.order : []).filter((x: unknown, i: number, a: unknown[]): x is LandingSectionId => ids.includes(x as LandingSectionId) && a.indexOf(x) === i);
  const order = [...given, ...ids.filter((id) => !given.includes(id))];
  const h = (v.hero ?? {}) as Record<string, unknown>;
  const t = (v.testimonial ?? {}) as Record<string, unknown>;
  const sp = (v.sponsor ?? {}) as Record<string, unknown>;
  return {
    sections,
    order,
    hero: {
      kicker: l10n(h.kicker, 'Hero · kicker', 60),
      badge: l10n(h.badge, 'Hero · lencana', 16),
      badge_link: l10n(h.badge_link, 'Hero · teks tautan lencana', 40),
      badge_href: href(h.badge_href, 'Hero · tautan lencana'),
      line1: l10n(h.line1, 'Hero · judul baris 1', 22),
      line2: l10n(h.line2, 'Hero · judul baris 2', 22),
      prefix: l10n(h.prefix, 'Hero · awalan baris 3', 8),
      words: list(h.words, 'Hero · kata berganti', LANDING_LIMITS.words, (x, i) => l10n(x, `Hero · kata #${i + 1}`, 14)),
      lead: l10n(h.lead, 'Hero · paragraf', 280),
      cta_primary: l10n(h.cta_primary, 'Hero · tombol utama', 32),
      cta_primary_href: href(h.cta_primary_href, 'Hero · tautan tombol utama'),
      cta_secondary: l10n(h.cta_secondary, 'Hero · tombol kedua', 32),
      cta_secondary_href: href(h.cta_secondary_href, 'Hero · tautan tombol kedua'),
    },
    band: list(v.band, 'Pita · slogan', LANDING_LIMITS.band, (x, i) => l10n(x, `Pita · slogan #${i + 1}`, 30)),
    stats: list(v.stats, 'Statistik', LANDING_LIMITS.stats, (x, i) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const n = Number(o.value);
      if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new Error(`Statistik #${i + 1}: angka 0–1.000.000.000`);
      const suffix = (o.suffix ?? {}) as Record<string, unknown>;
      return {
        value: Math.round(n),
        suffix: { id: str(suffix.id, `Statistik #${i + 1} · akhiran (ID)`, 12, false), en: str(suffix.en, `Statistik #${i + 1} · akhiran (EN)`, 12, false) },
        label: l10n(o.label, `Statistik #${i + 1} · label`, 40),
      };
    }),
    testimonial: {
      quote: l10n(t.quote, 'Testimoni · kutipan', 300),
      name: str(t.name, 'Testimoni · nama', 60),
      role: l10n(t.role, 'Testimoni · keterangan', 60),
      stamp: l10n(t.stamp, 'Testimoni · cap', 40),
    },
    faq: list(v.faq, 'FAQ', LANDING_LIMITS.faq, (x, i) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return { q: l10n(o.q, `FAQ #${i + 1} · pertanyaan`, 140), a: l10n(o.a, `FAQ #${i + 1} · jawaban`, 800) };
    }),
    sponsor: coerceSponsor(sp),
  };
}
