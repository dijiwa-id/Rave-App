// Registri pengaturan platform (BRD §12.3 Back Office "Konfigurasi Kebijakan", §17 "konfigurasi kebijakan tanpa deploy").
// Satu sumber kebenaran: dipakai service `platform` untuk validasi, service lain untuk default,
// dan frontend Super Admin untuk merender form. Menambah kunci = menambah entri di sini.

import { coerceLanding, LANDING_DEFAULT } from './landing';

export type SettingType = 'boolean' | 'number' | 'string' | 'text' | 'enum' | 'list' | 'image' | 'partners' | 'landing';

/** Satu entri CMS partner (pita berjalan landing). `logo` = file di bucket branding (slot `partner`), `url` opsional. */
export interface PartnerEntry {
  name: string;
  logo: string;
  url: string;
}
export const PARTNERS_MAX = 40;

export interface SettingDef {
  key: string;
  group: SettingGroup;
  label: string;
  description: string;
  type: SettingType;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  /** Ikut dikirim ke klien lewat GET /v1/platform/config (tanpa login). Jangan tandai rahasia sebagai publik. */
  public?: boolean;
  /** Service yang membaca kunci ini (informasi untuk UI). */
  consumers: string[];
  /** Perubahan berisiko tinggi → UI meminta konfirmasi tambahan. */
  dangerous?: boolean;
  /**
   * Kebijakan sudah ditetapkan tetapi modul penegaknya belum dibangun: UI menandai "Disiapkan" dengan keterangan ini,
   * agar Super Admin tidak mengira nilai sudah berlaku. Hapus field ini ketika consumer sudah membacanya.
   */
  planned?: string;
  /** Khusus type 'image' / 'partners': slot upload di bucket branding & aturan file. */
  image?: { slot: BrandingSlot; square?: boolean; minPx: number; background: 'light' | 'dark' };
  /** Khusus type 'enum': opsi adalah pilihan font → UI menampilkan pratinjau tiap opsi dengan `fontFamily` ini (CSS). */
  fontPreview?: Record<string, string>;
  /** Bobot pratinjau per opsi (mis. stensil 800). */
  fontPreviewWeight?: Record<string, number>;
  /** `font-size-adjust` pratinjau per opsi — sama dengan yang diterapkan di aplikasi. */
  fontPreviewAdjust?: Record<string, string>;
}

export const SETTING_GROUPS = {
  general: { label: 'Umum', description: 'Identitas platform, pengumuman, dan registrasi.' },
  branding: { label: 'Branding & Tema', description: 'Logo, ikon/favicon, font primer, dan tema terang/gelap dasbor (Studio, Promotor Hub, Back Office).' },
  content: { label: 'Konten Landing', description: 'Konten halaman publik yang dikelola tanpa deploy lewat Editor Landing (Platform → Editor Landing): section, slogan & logo partner pita kuning.' },
  maintenance: { label: 'Pemeliharaan', description: 'Mode pemeliharaan ditegakkan di API Gateway.' },
  modules: { label: 'Modul & Fitur', description: 'Nyalakan/matikan modul tanpa deploy (feature flag).' },
  live: { label: 'Live Streaming', description: 'Siaran langsung konser & sesi studio: ingest RTMP/browser, latensi, chat, dan batas.' },
  ads: { label: 'Iklan', description: 'Kebijakan penayangan iklan untuk pengguna Gratis: ad load, frequency cap, masa bebas iklan, dan kategori.' },
  commission: { label: 'Komisi & Biaya', description: 'Take rate off-air (Bab 4.1, keputusan D-02).' },
  booking: { label: 'Booking Off-Air', description: 'Parameter saga booking & escrow (§7.1–7.3).' },
  payout: { label: 'Payout', description: 'Penarikan saldo wallet ke rekening bank: batas, kontrol ganda, dan jadwal pemrosesan.' },
  royalty: { label: 'Royalti', description: 'Perhitungan & statement royalti bulanan dari stream qualified (model user-centric, BRD §6.3).' },
  subscription: { label: 'Langganan Premium', description: 'Harga paket, masa coba, masa tenggang, dan RAVE Pro (REQ-PAY-03).' },
  refund: { label: 'Refund Tiket', description: 'Kebijakan pengembalian dana tiket: pembatalan event, permintaan pembeli, dan pembayaran terlambat.' },
  transcoding: { label: 'Transcoding Audio', description: 'Pengolahan master: standar kualitas upload, normalisasi loudness, dan rendisi streaming.' },
  streaming: { label: 'Streaming', description: 'Pratinjau, kualitas audio, dan anti-fraud (§6.3, REQ-ADM-03).' },
  security: { label: 'Keamanan', description: 'OTP, rate limit, dan MFA (§11.5).' },
  storage: { label: 'Storage & Retensi', description: 'Upload, kuota, retensi data, dan backup (§9 durabilitas).' },
  access: { label: 'Peran & Akses', description: 'Izin back office per peran admin. Platform (pengaturan, storage, backup, event bus, tim admin) selalu khusus Super Admin.' },
} as const;
export type SettingGroup = keyof typeof SETTING_GROUPS;

export const SETTINGS: SettingDef[] = [
  // ---- Umum ----
  { key: 'general.platform_name', group: 'general', label: 'Nama platform', description: 'Ditampilkan di judul & email.', type: 'string', default: 'RAVE', public: true, consumers: ['web', 'notification'] },
  { key: 'general.support_email', group: 'general', label: 'Email dukungan', description: 'Kontak bantuan untuk pengguna.', type: 'string', default: 'bantuan@rave.id', public: true, consumers: ['web'] },
  { key: 'general.announcement', group: 'general', label: 'Pengumuman global', description: 'Banner di semua halaman. Kosongkan untuk menyembunyikan.', type: 'text', default: '', public: true, consumers: ['web'] },
  {
    key: 'general.announcement_level',
    group: 'general',
    label: 'Tingkat pengumuman',
    description: 'Warna banner pengumuman.',
    type: 'enum',
    default: 'info',
    options: [
      { value: 'info', label: 'Info' },
      { value: 'warning', label: 'Peringatan' },
      { value: 'critical', label: 'Kritis' },
    ],
    public: true,
    consumers: ['web'],
  },
  {
    key: 'general.default_locale',
    group: 'general',
    label: 'Bahasa default',
    description: 'Bahasa antarmuka untuk pengunjung baru bila bahasa perangkatnya tidak didukung. Pengguna tetap bisa memilih sendiri (tersimpan di akun).',
    type: 'enum',
    default: 'id',
    options: [
      { value: 'id', label: 'Bahasa Indonesia' },
      { value: 'en', label: 'English' },
    ],
    public: true,
    consumers: ['web', 'notification'],
  },
  { key: 'general.registrations_open', group: 'general', label: 'Pendaftaran akun baru dibuka', description: 'Bila mati, OTP hanya untuk akun yang sudah ada.', type: 'boolean', default: true, public: true, consumers: ['iam', 'web'] },

  // ---- Konten Landing (CMS) ----
  {
    key: 'content.partners',
    group: 'content',
    label: 'Partner musik (pita berjalan)',
    description:
      'Label, kolektif, venue, media, dan komunitas yang benar-benar bermitra dengan RAVE — tampil sebagai logo (siluet hitam) di pita kuning landing. Dikelola di Editor Landing → Pita kuning. Kosong = pita menampilkan slogan RAVE.',
    type: 'partners',
    default: [],
    image: { slot: 'partner', minPx: 32, background: 'light' },
    public: true,
    consumers: ['web'],
  },

  {
    key: 'content.landing',
    group: 'content',
    label: 'Konten landing page',
    description: 'Hero, statistik, testimoni, FAQ, banner sponsor, slogan pita, dan visibilitas section — dalam Bahasa Indonesia & English. Diedit lewat Editor Landing (Platform → Landing).',
    type: 'landing',
    default: LANDING_DEFAULT,
    public: true,
    consumers: ['web'],
  },

  // ---- Branding & Tema ----
  {
    key: 'branding.logo_url',
    group: 'branding',
    label: 'Logo (latar terang)',
    description: 'Wordmark untuk dasbor tema terang & halaman berlatar putih. SVG atau PNG, tinggi ≥ 32 px. Kosong = logo bawaan RAVE.',
    type: 'image',
    default: '',
    image: { slot: 'logo', minPx: 32, background: 'light' },
    public: true,
    consumers: ['web'],
  },
  {
    key: 'branding.logo_dark_url',
    group: 'branding',
    label: 'Logo (latar gelap)',
    description: 'Wordmark untuk aplikasi dengar, landing, dan dasbor tema gelap. Kosong = memakai logo latar terang.',
    type: 'image',
    default: '',
    image: { slot: 'logo_dark', minPx: 32, background: 'dark' },
    public: true,
    consumers: ['web'],
  },
  {
    key: 'branding.icon_url',
    group: 'branding',
    label: 'Ikon platform & favicon',
    description: 'Tanda/ikon persegi: favicon tab browser, sidebar dasbor, dan avatar sistem. SVG atau PNG persegi ≥ 64 px.',
    type: 'image',
    default: '',
    image: { slot: 'icon', square: true, minPx: 64, background: 'light' },
    public: true,
    consumers: ['web'],
  },
  {
    key: 'branding.primary_font',
    group: 'branding',
    label: 'Font primer',
    description:
      'Huruf poster untuk judul, angka besar, dan wordmark di seluruh platform (landing, aplikasi dengar, semua dasbor). Paragraf & label tidak berubah. Primary Font 1 = poster konstruktivis, Primary Font 2 = huruf tebal bertekstur kasar ala sablon/flyer gig DIY (otomatis dinormalkan agar judul tetap muat); keduanya berkarakter Latin lengkap. Perubahan berlaku tanpa deploy.',
    type: 'enum',
    default: 'primary1',
    options: [
      { value: 'primary1', label: 'Primary Font 1 — Staatliches (bawaan)' },
      { value: 'primary2', label: 'Primary Font 2 — Rubik Dirt' },
    ],
    fontPreview: { primary1: 'var(--font-primary-1)', primary2: 'var(--font-primary-2)' },
    fontPreviewWeight: { primary1: 400, primary2: 400 },
    fontPreviewAdjust: { primary1: 'none', primary2: 'cap-height 0.5' },
    public: true,
    consumers: ['web'],
  },
  {
    key: 'appearance.dashboard_theme',
    group: 'branding',
    label: 'Tema dasbor default',
    description: 'Tema awal Artist Studio, Promotor Hub, dan Back Office. "Ikuti sistem" memakai preferensi OS pengguna. Aplikasi dengar tetap gelap.',
    type: 'enum',
    default: 'light',
    options: [
      { value: 'light', label: 'Terang' },
      { value: 'dark', label: 'Gelap' },
      { value: 'system', label: 'Ikuti sistem' },
    ],
    public: true,
    consumers: ['web'],
  },
  {
    key: 'appearance.allow_user_theme',
    group: 'branding',
    label: 'Pengguna boleh memilih tema sendiri',
    description: 'Bila mati, semua pengguna dasbor memakai tema default di atas dan pilihan tema di sidebar disembunyikan.',
    type: 'boolean',
    default: true,
    public: true,
    consumers: ['web'],
  },

  // ---- Pemeliharaan ----
  { key: 'maintenance.enabled', group: 'maintenance', label: 'Mode pemeliharaan', description: 'Semua operasi tulis (selain login & admin) ditolak 503 di gateway. Baca tetap jalan.', type: 'boolean', default: false, public: true, consumers: ['gateway', 'web'], dangerous: true },
  { key: 'maintenance.message', group: 'maintenance', label: 'Pesan pemeliharaan', description: 'Ditampilkan ke pengguna saat mode pemeliharaan aktif.', type: 'text', default: 'RAVE sedang dalam pemeliharaan terjadwal. Streaming tetap berjalan; transaksi dibuka kembali segera.', public: true, consumers: ['gateway', 'web'] },

  // ---- Modul ----
  { key: 'modules.booking', group: 'modules', label: 'Booking off-air', description: 'Inquiry, negosiasi, kontrak (Promotor Hub & Inbox Booking).', type: 'boolean', default: true, public: true, consumers: ['gateway', 'web'], dangerous: true },
  { key: 'modules.ticketing', group: 'modules', label: 'Ticketing', description: 'Penjualan tiket & check-in.', type: 'boolean', default: true, public: true, consumers: ['gateway', 'web'], dangerous: true },
  { key: 'modules.podcasts', group: 'modules', label: 'Podcast & audio fiksi', description: 'Katalog podcast & cerita di aplikasi fan.', type: 'boolean', default: true, public: true, consumers: ['web'] },
  { key: 'modules.live', group: 'modules', label: 'Live streaming', description: 'Siaran langsung (menu Live di aplikasi dengar, Studio, dan Promotor Hub).', type: 'boolean', default: true, public: true, consumers: ['gateway', 'live', 'web'], dangerous: true },
  { key: 'modules.waitlist', group: 'modules', label: 'Waitlist landing page', description: 'Formulir pra-registrasi di landing page.', type: 'boolean', default: true, public: true, consumers: ['gateway', 'web'] },

  // ---- Live streaming ----
  { key: 'live.max_concurrent', group: 'live', label: 'Siaran bersamaan maksimum', description: 'Batas stream LIVE serentak di seluruh platform (beban transcoding server).', type: 'number', default: 5, min: 1, max: 100, unit: 'stream', consumers: ['live'] },
  { key: 'live.max_duration_hours', group: 'live', label: 'Durasi siaran maksimum', description: 'Siaran dihentikan otomatis setelah durasi ini.', type: 'number', default: 4, min: 1, max: 24, unit: 'jam', consumers: ['live'] },
  {
    key: 'live.latency_mode',
    group: 'live',
    label: 'Mode latensi',
    description: 'Panjang segmen HLS. Rendah = jeda lebih kecil tetapi lebih rentan buffering di jaringan lemah. Berlaku untuk siaran yang dimulai setelah diubah.',
    type: 'enum',
    default: 'balanced',
    options: [
      { value: 'low', label: 'Rendah (segmen 1 dtk, ±4 dtk jeda)' },
      { value: 'balanced', label: 'Seimbang (segmen 2 dtk, ±8 dtk jeda)' },
      { value: 'stable', label: 'Stabil (segmen 4 dtk, ±15 dtk jeda)' },
    ],
    consumers: ['live'],
  },
  { key: 'live.reconnect_grace_seconds', group: 'live', label: 'Masa tunggu sambung ulang', description: 'Bila sinyal publisher putus, siaran berstatus INTERRUPTED selama ini sebelum diakhiri otomatis.', type: 'number', default: 90, min: 10, max: 900, unit: 'detik', consumers: ['live'] },
  { key: 'live.chat_enabled', group: 'live', label: 'Live chat', description: 'Chat penonton di halaman tonton.', type: 'boolean', default: true, public: true, consumers: ['live', 'web'] },
  { key: 'live.chat_slowmode_seconds', group: 'live', label: 'Slowmode chat', description: 'Jeda minimum antar-pesan per pengguna.', type: 'number', default: 2, min: 0, max: 120, unit: 'detik', consumers: ['live'] },
  { key: 'live.rtmp_enabled', group: 'live', label: 'Ingest RTMP (OBS/Larix)', description: 'Terima siaran dari encoder eksternal di port RTMP.', type: 'boolean', default: true, public: true, consumers: ['live', 'web'] },
  { key: 'live.browser_ingest_enabled', group: 'live', label: 'Siaran dari browser', description: 'Artis/promotor dapat siaran langsung dari kamera browser tanpa aplikasi tambahan.', type: 'boolean', default: true, public: true, consumers: ['live', 'web'] },
  { key: 'live.demo_channel', group: 'live', label: 'Kanal demo', description: 'Kanal "Senja Kolektif — Live Session" yang selalu siaran (sinyal uji dari server). Untuk demo & uji pemutar.', type: 'boolean', default: true, consumers: ['live'] },

  // ---- Iklan (tier Gratis) ----
  { key: 'ads.enabled', group: 'ads', label: 'Penayangan iklan', description: 'Iklan di antara lagu untuk pengguna Gratis. Premium selalu bebas iklan.', type: 'boolean', default: true, public: true, consumers: ['ads', 'web'], dangerous: true },
  { key: 'ads.break_interval_minutes', group: 'ads', label: 'Jeda minimum antar-iklan', description: 'Waktu minimum antara dua jeda iklan untuk satu pendengar. Praktik umum: 15–30 menit.', type: 'number', default: 15, min: 5, max: 120, unit: 'menit', consumers: ['ads'] },
  { key: 'ads.min_streams_between_breaks', group: 'ads', label: 'Lagu minimum antar-jeda', description: 'Jumlah lagu yang diputar penuh (≥ 30 dtk) sebelum jeda iklan berikutnya.', type: 'number', default: 3, min: 1, max: 20, unit: 'lagu', consumers: ['ads'] },
  { key: 'ads.max_ads_per_break', group: 'ads', label: 'Iklan per jeda', description: 'Jumlah iklan maksimum dalam satu jeda.', type: 'number', default: 2, min: 1, max: 4, unit: 'iklan', consumers: ['ads'] },
  { key: 'ads.max_ads_per_hour', group: 'ads', label: 'Ad load per jam', description: 'Batas total iklan per pendengar dalam 60 menit (setara ±2–3 menit iklan per jam).', type: 'number', default: 6, min: 1, max: 20, unit: 'iklan', consumers: ['ads'] },
  { key: 'ads.daily_grace_streams', group: 'ads', label: 'Masa bebas iklan harian', description: 'Jumlah lagu pertama setiap hari yang selalu bebas iklan.', type: 'number', default: 5, min: 0, max: 50, unit: 'lagu', consumers: ['ads'] },
  { key: 'ads.max_audio_seconds', group: 'ads', label: 'Durasi maksimum iklan audio', description: 'Kreatif audio lebih panjang ditolak saat peninjauan.', type: 'number', default: 30, min: 10, max: 60, unit: 'detik', consumers: ['ads'] },
  { key: 'ads.max_display_seconds', group: 'ads', label: 'Durasi maksimum iklan display', description: 'Lama kartu iklan display tampil di pemutar.', type: 'number', default: 15, min: 5, max: 30, unit: 'detik', consumers: ['ads'] },
  { key: 'ads.skip_after_seconds', group: 'ads', label: 'Bisa dilewati setelah', description: 'Iklan display dapat dilewati setelah detik ini. 0 = langsung.', type: 'number', default: 5, min: 0, max: 30, unit: 'detik', public: true, consumers: ['ads', 'web'] },
  { key: 'ads.audio_skippable', group: 'ads', label: 'Iklan audio dapat dilewati', description: 'Praktik umum tier gratis: iklan audio tidak dapat dilewati.', type: 'boolean', default: false, public: true, consumers: ['ads', 'web'] },
  { key: 'ads.frequency_cap_per_day', group: 'ads', label: 'Frequency cap per kampanye', description: 'Berapa kali satu kampanye boleh tampil ke pendengar yang sama per hari.', type: 'number', default: 3, min: 1, max: 20, unit: 'kali', consumers: ['ads'] },
  {
    key: 'ads.blocked_categories',
    group: 'ads',
    label: 'Kategori terbatas yang diblokir',
    description: 'Kategori berizin yang tidak diterima. Pilihan: finance, crypto, health, alcohol, tobacco, political, dating. Kategori terlarang (judi, dewasa, dll.) selalu ditolak.',
    type: 'list',
    default: ['alcohol', 'tobacco', 'political', 'dating'],
    consumers: ['ads'],
  },
  { key: 'ads.podcast_preroll', group: 'ads', label: 'Pre-roll podcast', description: 'Iklan sebelum episode podcast gratis (tidak pernah pada episode Premium).', type: 'boolean', default: true, consumers: ['ads'] },
  { key: 'ads.sensitive_adjacency', group: 'ads', label: 'Lindungi merek dari konten sensitif', description: 'Setelah konten berperingatan (horor, dewasa) hanya promosi internal RAVE yang ditayangkan.', type: 'boolean', default: true, consumers: ['ads'] },
  { key: 'ads.house_ads_enabled', group: 'ads', label: 'Promosi internal RAVE', description: 'Isi slot kosong dengan promosi RAVE (event, Premium, live) bila tidak ada kampanye berbayar yang cocok.', type: 'boolean', default: true, consumers: ['ads'] },

  // ---- Komisi ----
  { key: 'commission.promotor_service_fee_pct', group: 'commission', label: 'Service fee promotor', description: 'Ditagihkan di atas fee artis.', type: 'number', default: 4, min: 0, max: 20, step: 0.5, unit: '%', public: true, consumers: ['booking', 'finance', 'web'] },
  { key: 'commission.artist_commission_pct', group: 'commission', label: 'Komisi dari fee artis', description: 'Dipotong saat pencairan escrow.', type: 'number', default: 7, min: 0, max: 30, step: 0.5, unit: '%', public: true, consumers: ['booking', 'finance', 'web'] },

  // ---- Booking ----
  { key: 'booking.default_dp_pct', group: 'booking', label: 'DP default', description: 'Persentase down payment saat kontrak ditandatangani.', type: 'number', default: 50, min: 10, max: 100, step: 5, unit: '%', consumers: ['booking'] },
  { key: 'booking.settlement_days_before', group: 'booking', label: 'Pelunasan sebelum hari-H', description: 'Batas pelunasan default (H-n).', type: 'number', default: 7, min: 1, max: 60, step: 1, unit: 'hari', consumers: ['booking'] },
  { key: 'booking.hold_hours', group: 'booking', label: 'Masa berlaku hold', description: 'Hold tanggal kedaluwarsa otomatis setelah ini.', type: 'number', default: 72, min: 1, max: 336, unit: 'jam', consumers: ['booking'] },
  { key: 'booking.dispute_window_hours', group: 'booking', label: 'Jendela dispute', description: 'Dana ditahan selama jendela ini setelah COMPLETED sebelum dicairkan.', type: 'number', default: 24, min: 1, max: 336, unit: 'jam', consumers: ['finance'] },
  { key: 'contract.pph21_pct', group: 'booking', label: 'Tarif PPh 21 kontrak', description: 'Dipotong dari fee bila penerima orang pribadi (disederhanakan; konfirmasi konsultan pajak).', type: 'number', default: 2.5, min: 0, max: 30, step: 0.1, unit: '%', consumers: ['booking'] },
  { key: 'contract.pph23_pct', group: 'booking', label: 'Tarif PPh 23 kontrak', description: 'Dipotong dari fee bila penerima badan usaha.', type: 'number', default: 2, min: 0, max: 30, step: 0.1, unit: '%', consumers: ['booking'] },
  { key: 'contract.emeterai_threshold', group: 'booking', label: 'Ambang e-Meterai', description: 'Kontrak dengan nilai di atas ini wajib e-Meterai.', type: 'number', default: 5_000_000, min: 0, step: 500_000, unit: 'Rp', consumers: ['booking'] },
  {
    key: 'contract.emeterai_payer',
    group: 'booking',
    label: 'Penanggung e-Meterai',
    description: 'Pihak yang menanggung bea meterai elektronik kontrak.',
    type: 'enum',
    default: 'promotor',
    options: [
      { value: 'promotor', label: 'Promotor' },
      { value: 'management', label: 'Manajemen' },
      { value: 'split', label: 'Dibagi dua' },
    ],
    consumers: ['booking'],
  },
  { key: 'contract.sign_window_days', group: 'booking', label: 'Batas tanda tangan kontrak', description: 'Kontrak kedaluwarsa bila belum selesai ditandatangani dalam jangka ini.', type: 'number', default: 7, min: 1, max: 60, unit: 'hari', consumers: ['booking'] },
  { key: 'contract.file_url_ttl_sec', group: 'booking', label: 'Masa berlaku URL dokumen', description: 'Signed URL pratinjau/unduh PDF kontrak.', type: 'number', default: 600, min: 60, max: 3600, unit: 'detik', consumers: ['booking'] },
  { key: 'contract.sign_otp_ttl_sec', group: 'booking', label: 'Masa berlaku OTP tanda tangan', description: 'OTP tanda tangan kontrak berlaku singkat dan sekali pakai.', type: 'number', default: 300, min: 60, max: 900, unit: 'detik', consumers: ['booking'] },
  { key: 'contract.sign_otp_max_per_window', group: 'booking', label: 'Maks OTP tanda tangan', description: 'Permintaan OTP per pihak per kontrak dalam satu jendela.', type: 'number', default: 3, min: 1, max: 20, unit: 'OTP', consumers: ['booking'] },
  { key: 'contract.sign_otp_window_minutes', group: 'booking', label: 'Jendela batas OTP tanda tangan', description: '', type: 'number', default: 10, min: 1, max: 120, unit: 'menit', consumers: ['booking'] },

  // ---- Payout ----
  { key: 'payout.min_amount_idr', group: 'payout', label: 'Penarikan minimum', description: 'Nominal terkecil per permintaan penarikan.', type: 'number', default: 50_000, min: 10_000, max: 10_000_000, step: 10_000, unit: 'Rp', public: true, consumers: ['finance', 'web'] },
  { key: 'payout.daily_limit_idr', group: 'payout', label: 'Batas penarikan harian', description: 'Total penarikan per wallet (artis/org) dalam satu hari kalender WIB. Membatasi kerugian bila akun diambil alih.', type: 'number', default: 100_000_000, min: 1_000_000, max: 10_000_000_000, step: 1_000_000, unit: 'Rp', consumers: ['finance'], dangerous: true },
  { key: 'payout.approval_threshold_idr', group: 'payout', label: 'Ambang persetujuan admin', description: 'Penarikan di atas nominal ini menunggu persetujuan tim finance (dual control) sebelum diproses.', type: 'number', default: 25_000_000, min: 0, max: 10_000_000_000, step: 1_000_000, unit: 'Rp', consumers: ['finance'] },
  { key: 'payout.bank_change_cooldown_hours', group: 'payout', label: 'Masa tunggu rekening baru', description: 'Penarikan ke rekening yang baru diganti ditahan selama masa ini (mitigasi pengambilalihan akun, §11.5).', type: 'number', default: 24, min: 0, max: 168, unit: 'jam', consumers: ['finance'] },
  { key: 'payout.fee_idr', group: 'payout', label: 'Biaya transfer', description: 'Dipotong dari nominal penarikan. 0 = ditanggung RAVE.', type: 'number', default: 0, min: 0, max: 25_000, step: 500, unit: 'Rp', public: true, consumers: ['finance', 'web'], planned: 'Butuh adapter disbursement payment gateway (biaya riil per bank).' },
  { key: 'payout.sla_business_days', group: 'payout', label: 'Target dana diterima', description: 'Janji layanan yang ditampilkan ke artis & promotor saat menarik dana.', type: 'number', default: 2, min: 1, max: 14, unit: 'hari kerja', public: true, consumers: ['web'], planned: 'Ditampilkan setelah payout memakai disbursement riil.' },

  // ---- Royalti ----
  { key: 'royalty.qualified_stream_seconds', group: 'royalty', label: 'Durasi stream qualified', description: 'Pemutaran minimal agar dihitung sebagai stream yang berhak royalti & masuk analitik. Standar industri: 30 detik.', type: 'number', default: 30, min: 15, max: 120, unit: 'detik', consumers: ['playback'], dangerous: true },
  {
    key: 'royalty.model',
    group: 'royalty',
    label: 'Model pembagian',
    description: 'User-centric: langganan & iklan tiap pendengar dibagi ke artis yang ia dengarkan. Pro-rata: dikumpulkan lalu dibagi menurut pangsa stream total.',
    type: 'enum',
    default: 'user_centric',
    options: [
      { value: 'user_centric', label: 'User-centric (UCPS)' },
      { value: 'pro_rata', label: 'Pro-rata' },
    ],
    consumers: ['finance'],
    dangerous: true,
    planned: 'Butuh job statement royalti bulanan.',
  },
  { key: 'royalty.rightsholder_share_pct', group: 'royalty', label: 'Porsi pemegang hak', description: 'Bagian pendapatan bersih streaming (langganan + iklan) untuk pemegang hak rekaman & lagu. BRD: ±60–70%.', type: 'number', default: 65, min: 40, max: 90, step: 1, unit: '%', consumers: ['finance'], dangerous: true, planned: 'Butuh job statement royalti bulanan.' },
  { key: 'royalty.statement_day', group: 'royalty', label: 'Tanggal terbit statement', description: 'Statement periode bulan lalu diterbitkan pada tanggal ini setiap bulan (WIB).', type: 'number', default: 10, min: 1, max: 28, unit: 'tgl', consumers: ['finance'], planned: 'Butuh job statement royalti bulanan.' },
  { key: 'royalty.reserve_pct', group: 'royalty', label: 'Cadangan koreksi', description: 'Persentase royalti yang ditahan untuk koreksi fraud & klaim hak, lalu dilepas setelah masa cadangan.', type: 'number', default: 10, min: 0, max: 50, step: 1, unit: '%', consumers: ['finance'], planned: 'Butuh job statement royalti bulanan.' },
  { key: 'royalty.reserve_release_months', group: 'royalty', label: 'Masa cadangan', description: 'Cadangan koreksi dilepas ke wallet setelah sekian bulan.', type: 'number', default: 3, min: 1, max: 12, unit: 'bulan', consumers: ['finance'], planned: 'Butuh job statement royalti bulanan.' },
  { key: 'royalty.min_payable_idr', group: 'royalty', label: 'Ambang terutang', description: 'Royalti di bawah nominal ini dibawa ke statement berikutnya (tidak hangus).', type: 'number', default: 10_000, min: 0, max: 1_000_000, step: 1_000, unit: 'Rp', consumers: ['finance'], planned: 'Butuh job statement royalti bulanan.' },

  // ---- Langganan Premium ----
  { key: 'subscription.enabled', group: 'subscription', label: 'Pembelian Premium dibuka', description: 'Mati: halaman Premium hanya menawarkan waitlist. Nyala: tombol berlangganan aktif.', type: 'boolean', default: false, public: true, consumers: ['web'], dangerous: true, planned: 'Checkout langganan (billing) belum dibangun — biarkan mati.' },
  { key: 'subscription.price_individual_idr', group: 'subscription', label: 'Harga Individu', description: 'Per bulan, sudah termasuk PPN.', type: 'number', default: 49_900, min: 0, max: 1_000_000, step: 100, unit: 'Rp/bln', public: true, consumers: ['web'] },
  { key: 'subscription.price_student_idr', group: 'subscription', label: 'Harga Pelajar', description: 'Per bulan, sudah termasuk PPN. Wajib verifikasi status pelajar/mahasiswa.', type: 'number', default: 24_900, min: 0, max: 1_000_000, step: 100, unit: 'Rp/bln', public: true, consumers: ['web'] },
  { key: 'subscription.price_duo_idr', group: 'subscription', label: 'Harga Duo', description: 'Per bulan untuk dua akun dalam satu rumah, sudah termasuk PPN.', type: 'number', default: 64_900, min: 0, max: 2_000_000, step: 100, unit: 'Rp/bln', public: true, consumers: ['web'] },
  { key: 'subscription.trial_days', group: 'subscription', label: 'Masa coba gratis', description: 'Untuk pelanggan baru, satu kali per akun. 0 = tanpa masa coba.', type: 'number', default: 30, min: 0, max: 90, unit: 'hari', public: true, consumers: ['web'] },
  { key: 'subscription.student_verify_months', group: 'subscription', label: 'Masa berlaku verifikasi pelajar', description: 'Status pelajar wajib diverifikasi ulang setelah periode ini.', type: 'number', default: 12, min: 1, max: 48, unit: 'bulan', public: true, consumers: ['web'] },
  { key: 'subscription.download_devices', group: 'subscription', label: 'Perangkat unduhan', description: 'Jumlah perangkat yang boleh menyimpan unduhan offline per akun Premium.', type: 'number', default: 5, min: 1, max: 10, unit: 'perangkat', public: true, consumers: ['web'] },
  { key: 'subscription.grace_days', group: 'subscription', label: 'Masa tenggang gagal bayar', description: 'Akses Premium tetap aktif selama sekian hari sejak perpanjangan gagal, sambil penagihan diulang.', type: 'number', default: 7, min: 0, max: 30, unit: 'hari', consumers: ['iam', 'finance'], planned: 'Butuh billing langganan berulang.' },
  { key: 'subscription.renewal_reminder_days', group: 'subscription', label: 'Pengingat perpanjangan', description: 'Notifikasi dikirim sekian hari sebelum tagihan berikutnya (wajib untuk perpanjangan otomatis).', type: 'number', default: 3, min: 1, max: 14, unit: 'hari', consumers: ['notification'], planned: 'Butuh billing langganan berulang.' },
  { key: 'subscription.pro_promotor_service_fee_pct', group: 'subscription', label: 'RAVE Pro — service fee promotor', description: 'Pengganti service fee standar untuk organisasi pelanggan RAVE Pro.', type: 'number', default: 3, min: 0, max: 20, step: 0.5, unit: '%', public: true, consumers: ['booking', 'finance', 'web'], planned: 'Butuh langganan RAVE Pro untuk organisasi.' },
  { key: 'subscription.pro_artist_commission_pct', group: 'subscription', label: 'RAVE Pro — komisi artis', description: 'Pengganti komisi standar dari fee artis untuk organisasi pelanggan RAVE Pro.', type: 'number', default: 5, min: 0, max: 30, step: 0.5, unit: '%', public: true, consumers: ['booking', 'finance', 'web'], planned: 'Butuh langganan RAVE Pro untuk organisasi.' },

  // ---- Refund tiket ----
  { key: 'refund.event_cancel_sla_days', group: 'refund', label: 'Batas waktu refund event batal', description: 'Janji ke pembeli: dana kembali paling lambat sekian hari sejak event dibatalkan. Refund ini selalu penuh, termasuk biaya layanan, dan diajukan otomatis (sandbox: dana langsung kembali).', type: 'number', default: 14, min: 1, max: 30, unit: 'hari', public: true, consumers: ['ticketing', 'finance', 'web'] },
  { key: 'refund.reschedule_opt_out_days', group: 'refund', label: 'Opsi refund saat jadwal diubah', description: 'Pembeli boleh meminta refund penuh dalam sekian hari setelah tanggal/venue event diubah.', type: 'number', default: 7, min: 0, max: 30, unit: 'hari', public: true, consumers: ['ticketing', 'web'] },
  { key: 'refund.buyer_request_enabled', group: 'refund', label: 'Refund atas permintaan pembeli', description: 'Izinkan pembeli membatalkan tiket sendiri (event tetap berlangsung). Mati = tiket tidak dapat direfund kecuali event batal/berubah.', type: 'boolean', default: false, public: true, consumers: ['ticketing', 'web'] },
  { key: 'refund.buyer_deadline_days', group: 'refund', label: 'Batas permintaan pembeli', description: 'Permintaan refund pembeli hanya diterima hingga H-n sebelum event.', type: 'number', default: 7, min: 1, max: 60, unit: 'hari', public: true, consumers: ['ticketing', 'web'] },
  { key: 'refund.buyer_refund_pct', group: 'refund', label: 'Porsi refund pembeli', description: 'Persentase harga tiket yang dikembalikan untuk permintaan pembeli. Biaya layanan tidak dikembalikan.', type: 'number', default: 80, min: 0, max: 100, step: 5, unit: '%', public: true, consumers: ['ticketing', 'finance', 'web'] },
  { key: 'refund.late_payment_auto_refund', group: 'refund', label: 'Refund otomatis pembayaran terlambat', description: 'Pembayaran yang masuk setelah reservasi kedaluwarsa saat kuota habis, atau setelah event selesai, dikembalikan penuh otomatis. Mati = order masuk antrean tinjauan admin (Finance → Refund tiket).', type: 'boolean', default: true, consumers: ['ticketing', 'finance'] },

  // ---- Transcoding ----
  { key: 'transcoding.enabled', group: 'transcoding', label: 'Transcoding otomatis', description: 'Master yang diunggah diolah menjadi rendisi streaming (AAC 64/160/320 + FLAC dari master lossless). Mati = master diputar apa adanya; master lossless tidak bisa diputar pengguna Gratis sampai rendisi standar tersedia.', type: 'boolean', default: true, consumers: ['catalog'], dangerous: true },
  { key: 'transcoding.loudness_target_lufs', group: 'transcoding', label: 'Target loudness', description: 'Normalisasi integrated loudness (ITU-R BS.1770 / EBU R128). Standar layanan streaming: −14 LUFS.', type: 'number', default: -14, min: -23, max: -9, step: 0.5, unit: 'LUFS', consumers: ['catalog', 'playback'], planned: 'Butuh worker transcoding (ffmpeg).' },
  { key: 'transcoding.true_peak_dbtp', group: 'transcoding', label: 'Batas true peak', description: 'Puncak maksimum setelah normalisasi untuk mencegah clipping saat dikodekan ke format lossy.', type: 'number', default: -1, min: -3, max: 0, step: 0.1, unit: 'dBTP', consumers: ['catalog'], planned: 'Butuh worker transcoding (ffmpeg).' },
  { key: 'transcoding.renditions', group: 'transcoding', label: 'Rendisi streaming', description: 'Format yang dihasilkan dari master. Pilihan: aac_48 (Hemat, AAC 64), aac_160 (Normal), aac_320 (Tinggi — Premium), flac (Lossless — Premium, hanya dari master lossless).', type: 'list', default: ['aac_48', 'aac_160', 'aac_320', 'flac'], consumers: ['catalog', 'playback'] },
  { key: 'transcoding.segment_seconds', group: 'transcoding', label: 'Durasi segmen HLS', description: 'Segmen lebih pendek = mulai putar lebih cepat; lebih panjang = lebih hemat permintaan CDN.', type: 'number', default: 6, min: 2, max: 10, unit: 'detik', consumers: ['catalog'], planned: 'Butuh worker transcoding (ffmpeg).' },
  { key: 'transcoding.min_sample_rate_hz', group: 'transcoding', label: 'Sample rate master minimum', description: 'Master di bawah standar CD (44.100 Hz) ditolak saat QC teknis.', type: 'number', default: 44_100, min: 22_050, max: 192_000, unit: 'Hz', consumers: ['catalog'] },
  { key: 'transcoding.min_bit_depth', group: 'transcoding', label: 'Bit depth master minimum', description: 'Berlaku untuk master lossless (WAV/FLAC).', type: 'number', default: 16, min: 16, max: 32, step: 8, unit: 'bit', consumers: ['catalog'] },
  { key: 'transcoding.max_concurrent_jobs', group: 'transcoding', label: 'Job paralel', description: 'Jumlah transcoding yang berjalan bersamaan per instance worker.', type: 'number', default: 2, min: 1, max: 16, unit: 'job', consumers: ['catalog'] },

  // ---- Streaming ----
  { key: 'streaming.preview_seconds', group: 'streaming', label: 'Durasi pratinjau anonim', description: 'REQ-WEB-04.', type: 'number', default: 30, min: 10, max: 120, unit: 'detik', public: true, consumers: ['playback'] },
  { key: 'streaming.lossless_enabled', group: 'streaming', label: 'Lossless untuk Premium', description: 'Kualitas tinggi (AAC 320) & Lossless (FLAC) hanya untuk pelanggan Premium (menggantikan D-03 "lossless gratis"). Bila mati, permintaan lossless Premium diturunkan ke AAC 320.', type: 'boolean', default: true, public: true, consumers: ['playback', 'web'] },
  { key: 'streaming.fraud_max_streams_per_hour', group: 'streaming', label: 'Batas stream qualified per jam', description: 'Di atas ini stream ditandai fraud (RATE_LIMIT) dan tidak dihitung royalti.', type: 'number', default: 120, min: 10, max: 1000, unit: 'stream', consumers: ['playback'] },

  // ---- Keamanan ----
  { key: 'security.otp_max_per_window', group: 'security', label: 'Maks OTP per alamat', description: 'Dalam satu jendela waktu.', type: 'number', default: 5, min: 1, max: 50, unit: 'OTP', consumers: ['iam'] },
  { key: 'security.otp_window_minutes', group: 'security', label: 'Jendela batas OTP', description: '', type: 'number', default: 15, min: 1, max: 1440, unit: 'menit', consumers: ['iam'] },
  { key: 'security.rate_limit_per_minute', group: 'security', label: 'Rate limit umum', description: 'Permintaan per menit per token/IP di gateway.', type: 'number', default: 600, min: 30, max: 10000, unit: 'req/mnt', consumers: ['gateway'] },
  { key: 'security.rate_limit_otp_per_minute', group: 'security', label: 'Rate limit endpoint OTP', description: 'Per IP di gateway.', type: 'number', default: 10, min: 1, max: 100, unit: 'req/mnt', consumers: ['gateway'] },

  // ---- Storage ----
  { key: 'storage.max_upload_mb', group: 'storage', label: 'Ukuran upload maksimum', description: 'Master audio & artwork di Artist Studio.', type: 'number', default: 50, min: 1, max: 2048, unit: 'MB', public: true, consumers: ['catalog', 'web'] },
  { key: 'storage.allowed_audio_types', group: 'storage', label: 'Format audio diizinkan', description: 'MIME type, pisahkan dengan koma.', type: 'list', default: ['audio/wav', 'audio/x-wav', 'audio/flac', 'audio/aiff', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/ogg', 'audio/opus'], consumers: ['catalog'] },
  { key: 'storage.allowed_image_types', group: 'storage', label: 'Format gambar diizinkan', description: 'MIME type, pisahkan dengan koma.', type: 'list', default: ['image/jpeg', 'image/png'], consumers: ['catalog'] },
  { key: 'storage.quota_uploads_gb', group: 'storage', label: 'Kuota bucket uploads', description: 'Upload baru ditolak bila kuota terlampaui.', type: 'number', default: 10, min: 1, max: 100000, unit: 'GB', consumers: ['catalog', 'platform'] },
  { key: 'storage.quota_backups_gb', group: 'storage', label: 'Kuota bucket backups', description: 'Backup terlama dihapus otomatis bila terlampaui.', type: 'number', default: 20, min: 1, max: 100000, unit: 'GB', consumers: ['platform'] },
  { key: 'storage.disk_warn_pct', group: 'storage', label: 'Ambang peringatan disk', description: 'Dasbor menandai disk kritis di atas ambang ini.', type: 'number', default: 85, min: 50, max: 99, unit: '%', consumers: ['platform'] },
  { key: 'storage.bus_retention_days', group: 'storage', label: 'Retensi log event bus', description: 'Event yang sudah dikonsumsi semua consumer group & lebih tua dari ini dihapus.', type: 'number', default: 30, min: 1, max: 3650, unit: 'hari', consumers: ['platform'] },
  { key: 'storage.idempotency_retention_days', group: 'storage', label: 'Retensi idempotency key', description: '', type: 'number', default: 7, min: 1, max: 365, unit: 'hari', consumers: ['platform'] },
  { key: 'storage.backup_enabled', group: 'storage', label: 'Backup database otomatis', description: 'pg_dump terjadwal ke bucket backups.', type: 'boolean', default: true, consumers: ['platform'] },
  { key: 'storage.backup_interval_hours', group: 'storage', label: 'Interval backup', description: '', type: 'number', default: 24, min: 1, max: 720, unit: 'jam', consumers: ['platform'] },
  { key: 'storage.backup_keep', group: 'storage', label: 'Jumlah backup disimpan', description: 'Backup lebih lama dihapus otomatis.', type: 'number', default: 7, min: 1, max: 365, unit: 'file', consumers: ['platform'] },
];

// ---- Branding ----
export const BRANDING_SLOTS = ['logo', 'logo_dark', 'icon', 'partner'] as const;
export type BrandingSlot = (typeof BRANDING_SLOTS)[number];
export const BRANDING_PUBLIC_PREFIX = '/v1/platform/branding/';
export const BRANDING_URL_RE = /^\/v1\/platform\/branding\/[\w.-]+\.(svg|png)$/;
export const BRANDING_MAX_BYTES = { 'image/svg+xml': 512 * 1024, 'image/png': 2 * 1024 * 1024 } as const;

// ---- Peran internal back office (REQ-ADM-01) ----
export const ADMIN_ROLES = ['SUPER_ADMIN', 'OPS', 'CONTENT_QC', 'FINANCE', 'LEGAL', 'SUPPORT', 'EDITORIAL'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
export const ADMIN_ROLE_LABEL: Record<AdminRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  OPS: 'Operasional',
  CONTENT_QC: 'Content QC',
  FINANCE: 'Finance',
  LEGAL: 'Legal',
  SUPPORT: 'Support',
  EDITORIAL: 'Editorial',
};

/**
 * Izin back office yang dapat dibagikan ke peran admin (matriks diatur Super Admin di "Peran & Akses").
 * Area Platform (pengaturan, storage, backup, event bus, tim admin, peran & akses) TIDAK ada di sini:
 * selalu khusus Super Admin dan tidak dapat didelegasikan.
 */
export const ADMIN_PERMISSIONS = {
  'qc.review': { label: 'Antrean QC & takedown rilis', area: 'Konten' },
  'live.moderate': { label: 'Moderasi live streaming', area: 'Konten' },
  'ads.review': { label: 'Tinjau kampanye iklan', area: 'Iklan' },
  'ads.manage': { label: 'Buat & kelola kampanye iklan', area: 'Iklan' },
  'kyc.review': { label: 'Verifikasi KYC/KYB', area: 'Kepercayaan' },
  'dispute.resolve': { label: 'Mediasi dispute booking', area: 'Kepercayaan' },
  'finance.view': { label: 'Lihat ledger, rekonsiliasi & antrean refund', area: 'Keuangan' },
  'finance.refund': { label: 'Putuskan, kirim ulang & selesaikan refund', area: 'Keuangan' },
  'finance.payout': { label: 'Setujui / tolak penarikan dana (dual control)', area: 'Keuangan' },
  'users.view': { label: 'Lihat pengguna & organisasi', area: 'Pengguna' },
  'audit.view': { label: 'Lihat audit log', area: 'Pengguna' },
} as const;
export type AdminPermission = keyof typeof ADMIN_PERMISSIONS;
export const ADMIN_PERMISSION_KEYS = Object.keys(ADMIN_PERMISSIONS) as AdminPermission[];

/** Peran yang izinnya dapat diatur (Super Admin selalu memegang semuanya). */
export const CONFIGURABLE_ADMIN_ROLES = ADMIN_ROLES.filter((r) => r !== 'SUPER_ADMIN') as Exclude<AdminRole, 'SUPER_ADMIN'>[];

/** Default prinsip hak minimum: tiap peran hanya area kerjanya; pengeluaran uang (refund) hanya Finance. */
export const DEFAULT_ROLE_PERMISSIONS: Record<Exclude<AdminRole, 'SUPER_ADMIN'>, AdminPermission[]> = {
  OPS: ['qc.review', 'live.moderate', 'ads.review', 'ads.manage', 'kyc.review', 'dispute.resolve', 'finance.view', 'users.view', 'audit.view'],
  CONTENT_QC: ['qc.review', 'live.moderate', 'ads.review'],
  FINANCE: ['finance.view', 'finance.refund', 'finance.payout', 'kyc.review'],
  LEGAL: ['qc.review', 'kyc.review', 'dispute.resolve', 'audit.view'],
  SUPPORT: ['users.view', 'finance.view'],
  EDITORIAL: ['live.moderate', 'ads.manage'],
};

export const accessKey = (role: string) => `access.role.${role}`;

for (const role of CONFIGURABLE_ADMIN_ROLES)
  SETTINGS.push({
    key: accessKey(role),
    group: 'access',
    label: `Izin ${ADMIN_ROLE_LABEL[role]}`,
    description: `Area back office yang dapat dibuka dan diubah oleh admin berperan ${ADMIN_ROLE_LABEL[role]}.`,
    type: 'list',
    default: DEFAULT_ROLE_PERMISSIONS[role],
    options: ADMIN_PERMISSION_KEYS.map((k) => ({ value: k, label: ADMIN_PERMISSIONS[k].label })),
    consumers: ['iam', 'catalog', 'booking', 'finance', 'ticketing', 'live', 'ads', 'web'],
    dangerous: true,
  });

/** Izin efektif satu peran admin (`get` = pembaca nilai pengaturan terkini). Super Admin = semua; bukan admin = tidak ada. */
export function adminPermissions(role: string | null | undefined, get: (key: string) => unknown): AdminPermission[] {
  if (!role) return [];
  if (role === 'SUPER_ADMIN') return [...ADMIN_PERMISSION_KEYS];
  const v = get(accessKey(role));
  return Array.isArray(v) ? (v.filter((x) => x in ADMIN_PERMISSIONS) as AdminPermission[]) : [];
}

export const SETTINGS_BY_KEY: Record<string, SettingDef> = Object.fromEntries(SETTINGS.map((s) => [s.key, s]));

export function settingDefaults(): Record<string, unknown> {
  return Object.fromEntries(SETTINGS.map((s) => [s.key, s.default]));
}

/** Validasi & normalisasi satu nilai terhadap registri. Melempar Error berbahasa Indonesia bila tidak valid. */
export function coerceSetting(key: string, value: unknown): unknown {
  const def = SETTINGS_BY_KEY[key];
  if (!def) throw new Error(`Pengaturan tidak dikenal: ${key}`);
  switch (def.type) {
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error(`${def.label}: harus true/false`);
      return value;
    case 'number': {
      const n = typeof value === 'string' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`${def.label}: harus angka`);
      if (def.min !== undefined && n < def.min) throw new Error(`${def.label}: minimal ${def.min}${def.unit ? ' ' + def.unit : ''}`);
      if (def.max !== undefined && n > def.max) throw new Error(`${def.label}: maksimal ${def.max}${def.unit ? ' ' + def.unit : ''}`);
      return n;
    }
    case 'enum':
      if (!def.options?.some((o) => o.value === value)) throw new Error(`${def.label}: pilihan tidak valid`);
      return value;
    case 'list': {
      const arr = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
      if (!arr) throw new Error(`${def.label}: harus daftar`);
      const items = [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];
      // Daftar dengan pilihan tetap (mis. izin per peran): setiap item wajib salah satu pilihan.
      const bad = def.options ? items.filter((x) => !def.options!.some((o) => o.value === x)) : [];
      if (bad.length) throw new Error(`${def.label}: pilihan tidak dikenal (${bad.join(', ')})`);
      return items;
    }
    case 'image': {
      // Hanya file di bucket branding milik platform (bukan URL eksternal: cegah tracking & mixed content).
      if (typeof value !== 'string') throw new Error(`${def.label}: harus path file`);
      if (value !== '' && !BRANDING_URL_RE.test(value)) throw new Error(`${def.label}: unggah file lewat panel (path ${BRANDING_PUBLIC_PREFIX}…)`);
      return value;
    }
    case 'partners': {
      if (!Array.isArray(value)) throw new Error(`${def.label}: harus daftar partner`);
      if (value.length > PARTNERS_MAX) throw new Error(`${def.label}: maksimal ${PARTNERS_MAX} partner`);
      return value.map((raw, i): PartnerEntry => {
        const n = `${def.label} #${i + 1}`;
        if (!raw || typeof raw !== 'object') throw new Error(`${n}: format tidak valid`);
        const r = raw as Record<string, unknown>;
        const name = String(r.name ?? '').trim();
        const logo = String(r.logo ?? '').trim();
        const url = String(r.url ?? '').trim();
        if (!name) throw new Error(`${n}: nama wajib diisi`);
        if (name.length > 80) throw new Error(`${n}: nama maksimal 80 karakter`);
        if (logo && !BRANDING_URL_RE.test(logo)) throw new Error(`${n}: unggah logo lewat panel (path ${BRANDING_PUBLIC_PREFIX}…)`);
        // Tautan: HTTPS eksternal atau path internal — cegah javascript:/http polos.
        // Situs partner (label/venue/komunitas indie) belum tentu ber-HTTPS → http:// juga diterima.
        if (url && !/^https?:\/\/[^\s]{3,300}$/i.test(url) && !/^\/(?!\/)[^\s]{0,300}$/.test(url)) throw new Error(`${n}: tautan harus http(s)://… atau path internal /…`);
        return { name, logo, url };
      });
    }
    case 'landing':
      try {
        return coerceLanding(value);
      } catch (e) {
        throw new Error(`${def.label} — ${(e as Error).message}`);
      }
    case 'string':
    case 'text': {
      if (typeof value !== 'string') throw new Error(`${def.label}: harus teks`);
      const max = def.type === 'string' ? 200 : 2000;
      if (value.length > max) throw new Error(`${def.label}: maksimal ${max} karakter`);
      return value;
    }
  }
}


