// Registri pengaturan platform (BRD §12.3 Back Office "Konfigurasi Kebijakan", §17 "konfigurasi kebijakan tanpa deploy").
// Satu sumber kebenaran: dipakai service `platform` untuk validasi, service lain untuk default,
// dan frontend Super Admin untuk merender form. Menambah kunci = menambah entri di sini.

export type SettingType = 'boolean' | 'number' | 'string' | 'text' | 'enum' | 'list';

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
}

export const SETTING_GROUPS = {
  general: { label: 'Umum', description: 'Identitas platform, pengumuman, dan registrasi.' },
  maintenance: { label: 'Pemeliharaan', description: 'Mode pemeliharaan ditegakkan di API Gateway.' },
  modules: { label: 'Modul & Fitur', description: 'Nyalakan/matikan modul tanpa deploy (feature flag).' },
  commission: { label: 'Komisi & Biaya', description: 'Take rate off-air (Bab 4.1, keputusan D-02).' },
  booking: { label: 'Booking Off-Air', description: 'Parameter saga booking & escrow (§7.1–7.3).' },
  streaming: { label: 'Streaming', description: 'Pratinjau, kualitas audio, dan anti-fraud (§6.3, REQ-ADM-03).' },
  security: { label: 'Keamanan', description: 'OTP, rate limit, dan MFA (§11.5).' },
  storage: { label: 'Storage & Retensi', description: 'Upload, kuota, retensi data, dan backup (§9 durabilitas).' },
} as const;
export type SettingGroup = keyof typeof SETTING_GROUPS;

export const SETTINGS: SettingDef[] = [
  // ---- Umum ----
  { key: 'general.platform_name', group: 'general', label: 'Nama platform', description: 'Ditampilkan di judul & email.', type: 'string', default: 'GEMA', public: true, consumers: ['web', 'notification'] },
  { key: 'general.support_email', group: 'general', label: 'Email dukungan', description: 'Kontak bantuan untuk pengguna.', type: 'string', default: 'bantuan@gema.id', public: true, consumers: ['web'] },
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
  { key: 'general.registrations_open', group: 'general', label: 'Pendaftaran akun baru dibuka', description: 'Bila mati, OTP hanya untuk akun yang sudah ada.', type: 'boolean', default: true, public: true, consumers: ['iam', 'web'] },

  // ---- Pemeliharaan ----
  { key: 'maintenance.enabled', group: 'maintenance', label: 'Mode pemeliharaan', description: 'Semua operasi tulis (selain login & admin) ditolak 503 di gateway. Baca tetap jalan.', type: 'boolean', default: false, public: true, consumers: ['gateway', 'web'], dangerous: true },
  { key: 'maintenance.message', group: 'maintenance', label: 'Pesan pemeliharaan', description: 'Ditampilkan ke pengguna saat mode pemeliharaan aktif.', type: 'text', default: 'GEMA sedang dalam pemeliharaan terjadwal. Streaming tetap berjalan; transaksi dibuka kembali segera.', public: true, consumers: ['gateway', 'web'] },

  // ---- Modul ----
  { key: 'modules.booking', group: 'modules', label: 'Booking off-air', description: 'Inquiry, negosiasi, kontrak (Promotor Hub & Inbox Booking).', type: 'boolean', default: true, public: true, consumers: ['gateway', 'web'], dangerous: true },
  { key: 'modules.ticketing', group: 'modules', label: 'Ticketing', description: 'Penjualan tiket & check-in.', type: 'boolean', default: true, public: true, consumers: ['gateway', 'web'], dangerous: true },
  { key: 'modules.podcasts', group: 'modules', label: 'Podcast & audio fiksi', description: 'Katalog podcast & cerita di aplikasi fan.', type: 'boolean', default: true, public: true, consumers: ['web'] },
  { key: 'modules.waitlist', group: 'modules', label: 'Waitlist landing page', description: 'Formulir pra-registrasi di landing page.', type: 'boolean', default: true, public: true, consumers: ['gateway', 'web'] },

  // ---- Komisi ----
  { key: 'commission.promotor_service_fee_pct', group: 'commission', label: 'Service fee promotor', description: 'Ditagihkan di atas fee artis.', type: 'number', default: 4, min: 0, max: 20, step: 0.5, unit: '%', consumers: ['booking', 'finance'] },
  { key: 'commission.artist_commission_pct', group: 'commission', label: 'Komisi dari fee artis', description: 'Dipotong saat pencairan escrow.', type: 'number', default: 7, min: 0, max: 30, step: 0.5, unit: '%', consumers: ['booking', 'finance'] },

  // ---- Booking ----
  { key: 'booking.default_dp_pct', group: 'booking', label: 'DP default', description: 'Persentase down payment saat kontrak ditandatangani.', type: 'number', default: 50, min: 10, max: 100, step: 5, unit: '%', consumers: ['booking'] },
  { key: 'booking.settlement_days_before', group: 'booking', label: 'Pelunasan sebelum hari-H', description: 'Batas pelunasan default (H-n).', type: 'number', default: 7, min: 0, max: 60, unit: 'hari', consumers: ['booking'] },
  { key: 'booking.hold_hours', group: 'booking', label: 'Masa berlaku hold', description: 'Hold tanggal kedaluwarsa otomatis setelah ini.', type: 'number', default: 72, min: 1, max: 336, unit: 'jam', consumers: ['booking'] },
  { key: 'booking.dispute_window_hours', group: 'booking', label: 'Jendela dispute', description: 'Dana ditahan selama jendela ini setelah COMPLETED sebelum dicairkan.', type: 'number', default: 24, min: 1, max: 336, unit: 'jam', consumers: ['finance'] },

  // ---- Streaming ----
  { key: 'streaming.preview_seconds', group: 'streaming', label: 'Durasi pratinjau anonim', description: 'REQ-WEB-04.', type: 'number', default: 30, min: 10, max: 120, unit: 'detik', public: true, consumers: ['playback'] },
  { key: 'streaming.lossless_enabled', group: 'streaming', label: 'Lossless gratis', description: 'Keputusan D-03. Bila mati, permintaan lossless diturunkan ke AAC 320.', type: 'boolean', default: true, public: true, consumers: ['playback', 'web'] },
  { key: 'streaming.fraud_max_streams_per_hour', group: 'streaming', label: 'Batas stream qualified per jam', description: 'Di atas ini stream ditandai fraud (RATE_LIMIT) dan tidak dihitung royalti.', type: 'number', default: 120, min: 10, max: 1000, unit: 'stream', consumers: ['playback'] },

  // ---- Keamanan ----
  { key: 'security.otp_max_per_window', group: 'security', label: 'Maks OTP per alamat', description: 'Dalam satu jendela waktu.', type: 'number', default: 5, min: 1, max: 50, unit: 'OTP', consumers: ['iam'] },
  { key: 'security.otp_window_minutes', group: 'security', label: 'Jendela batas OTP', description: '', type: 'number', default: 15, min: 1, max: 1440, unit: 'menit', consumers: ['iam'] },
  { key: 'security.rate_limit_per_minute', group: 'security', label: 'Rate limit umum', description: 'Permintaan per menit per token/IP di gateway.', type: 'number', default: 600, min: 30, max: 10000, unit: 'req/mnt', consumers: ['gateway'] },
  { key: 'security.rate_limit_otp_per_minute', group: 'security', label: 'Rate limit endpoint OTP', description: 'Per IP di gateway.', type: 'number', default: 10, min: 1, max: 100, unit: 'req/mnt', consumers: ['gateway'] },

  // ---- Storage ----
  { key: 'storage.max_upload_mb', group: 'storage', label: 'Ukuran upload maksimum', description: 'Master audio & artwork di Artist Studio.', type: 'number', default: 50, min: 1, max: 2048, unit: 'MB', public: true, consumers: ['catalog', 'web'] },
  { key: 'storage.allowed_audio_types', group: 'storage', label: 'Format audio diizinkan', description: 'MIME type, pisahkan dengan koma.', type: 'list', default: ['audio/wav', 'audio/x-wav', 'audio/flac', 'audio/mpeg'], consumers: ['catalog'] },
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
      return arr.map((x) => String(x).trim()).filter(Boolean);
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
