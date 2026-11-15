/**
 * Registri integrasi pihak ketiga yang diatur Super Admin (Platform → Integrasi).
 * Satu sumber untuk validasi server (service platform) dan form dasbor (web). Kunci field = nama env yang sama
 * (EMAIL_FROM, RESEND_API_KEY, MIDTRANS_SERVER_KEY, …) sehingga konfigurasi dasbor dan env saling menggantikan.
 */

export type IntegrationKind = 'email' | 'payment' | 'social';
export const INTEGRATION_KINDS: IntegrationKind[] = ['email', 'payment', 'social'];

export interface IntegrationField {
  key: string;
  label: string;
  /** secret = disimpan terenkripsi, tidak pernah dikirim balik ke browser (hanya ••••1234). */
  type: 'text' | 'email' | 'url' | 'secret' | 'select';
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  default?: string;
}

export interface IntegrationProviderDef {
  label: string;
  description: string;
  /** Tautan dokumentasi/dasbor vendor untuk mendapatkan kunci. */
  docs?: string;
  fields: IntegrationField[];
  /** Provider "kosong" (log/sandbox) — tidak mengirim/memindahkan uang sungguhan. */
  inert?: boolean;
}

const FROM: IntegrationField = {
  key: 'EMAIL_FROM',
  label: 'Alamat pengirim',
  type: 'text',
  required: true,
  placeholder: 'RAVE <no-reply@rave.id>',
  hint: 'Domain pengirim harus sudah diverifikasi di provider (SPF & DKIM) agar tidak masuk spam.',
};

export const INTEGRATION_PROVIDERS: Record<IntegrationKind, Record<string, IntegrationProviderDef>> = {
  email: {
    log: { label: 'Log (tidak mengirim)', description: 'Email hanya dicatat di log server. Di produksi tidak ada yang bisa login.', fields: [], inert: true },
    resend: {
      label: 'Resend',
      description: 'API email transaksional sederhana; cocok untuk OTP & notifikasi.',
      docs: 'https://resend.com/api-keys',
      fields: [FROM, { key: 'RESEND_API_KEY', label: 'API key', type: 'secret', required: true, placeholder: 're_…' }],
    },
    mailgun: {
      label: 'Mailgun',
      description: 'Pengiriman email bervolume besar dengan domain khusus.',
      docs: 'https://app.mailgun.com/settings/api_security',
      fields: [
        FROM,
        { key: 'MAILGUN_DOMAIN', label: 'Domain pengirim', type: 'text', required: true, placeholder: 'mg.rave.id' },
        { key: 'MAILGUN_API_KEY', label: 'API key', type: 'secret', required: true },
        {
          key: 'MAILGUN_BASE_URL',
          label: 'Region',
          type: 'select',
          default: 'https://api.mailgun.net',
          options: [
            { value: 'https://api.mailgun.net', label: 'US (api.mailgun.net)' },
            { value: 'https://api.eu.mailgun.net', label: 'EU (api.eu.mailgun.net)' },
          ],
        },
      ],
    },
    postmark: {
      label: 'Postmark',
      description: 'Email transaksional dengan tingkat terkirim tinggi.',
      docs: 'https://account.postmarkapp.com/servers',
      fields: [FROM, { key: 'POSTMARK_SERVER_TOKEN', label: 'Server token', type: 'secret', required: true }],
    },
    webhook: {
      label: 'Webhook (relay sendiri)',
      description: 'RAVE mengirim JSON bertanda tangan HMAC ke relay Anda (mis. SES/SMTP gateway internal).',
      fields: [
        FROM,
        { key: 'EMAIL_WEBHOOK_URL', label: 'URL relay', type: 'url', required: true, placeholder: 'https://relay.example.id/send' },
        { key: 'MESSAGING_WEBHOOK_SECRET', label: 'Secret HMAC', type: 'secret', hint: 'Header x-rave-signature = HMAC-SHA256(secret, "<x-rave-timestamp>.<body>"). Kosong = INTERNAL_SERVICE_SECRET.' },
      ],
    },
  },
  social: {
    off: { label: 'Nonaktif', description: 'Hanya login OTP email. Tombol Google/Facebook/Apple disembunyikan.', fields: [], inert: true },
    oauth: {
      label: 'OAuth / OpenID Connect',
      description:
        'Isi kredensial provider yang ingin diaktifkan — provider dengan field lengkap langsung tampil di halaman Masuk. Daftarkan Redirect URI di bawah pada konsol masing-masing provider.',
      docs: 'https://console.cloud.google.com/apis/credentials',
      fields: [
        { key: 'GOOGLE_CLIENT_ID', label: 'Google · Client ID', type: 'text', placeholder: '1234…apps.googleusercontent.com', hint: 'Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application).' },
        { key: 'GOOGLE_CLIENT_SECRET', label: 'Google · Client secret', type: 'secret', placeholder: 'GOCSPX-…' },
        { key: 'FACEBOOK_APP_ID', label: 'Facebook · App ID', type: 'text', placeholder: '123456789012345', hint: 'developers.facebook.com → App → Facebook Login → Settings (Valid OAuth Redirect URIs).' },
        { key: 'FACEBOOK_APP_SECRET', label: 'Facebook · App secret', type: 'secret' },
        { key: 'APPLE_SERVICES_ID', label: 'Apple · Services ID', type: 'text', placeholder: 'id.rave.web', hint: 'Apple Developer → Identifiers → Services IDs (Sign in with Apple, Return URLs).' },
        { key: 'APPLE_TEAM_ID', label: 'Apple · Team ID', type: 'text', placeholder: 'ABCDE12345' },
        { key: 'APPLE_KEY_ID', label: 'Apple · Key ID', type: 'text', placeholder: 'XYZ987ABCD' },
        { key: 'APPLE_PRIVATE_KEY', label: 'Apple · Private key (.p8)', type: 'secret', hint: 'Tempel isi berkas AuthKey_….p8 (boleh satu baris; baris BEGIN/END PRIVATE KEY ikut).' },
      ],
    },
  },
  payment: {
    sandbox: { label: 'Sandbox (simulasi)', description: 'Tidak ada uang yang berpindah. Simulasi bayar hanya tersedia di development.', fields: [], inert: true },
    midtrans: {
      label: 'Midtrans',
      description: 'Snap (VA, QRIS, e-wallet, kartu). Refund otomatis untuk kartu, GoPay, ShopeePay & QRIS; VA diselesaikan manual oleh Finance.',
      docs: 'https://dashboard.midtrans.com/settings/access-keys',
      fields: [
        {
          key: 'MIDTRANS_MODE',
          label: 'Mode',
          type: 'select',
          required: true,
          default: 'sandbox',
          options: [
            { value: 'sandbox', label: 'Sandbox (uji, tanpa uang nyata)' },
            { value: 'production', label: 'Produksi (uang nyata)' },
          ],
        },
        { key: 'MIDTRANS_MERCHANT_ID', label: 'Merchant ID', type: 'text', placeholder: 'G123456789' },
        { key: 'MIDTRANS_CLIENT_KEY', label: 'Client key', type: 'text', placeholder: 'SB-Mid-client-… / Mid-client-…' },
        { key: 'MIDTRANS_SERVER_KEY', label: 'Server key', type: 'secret', required: true, placeholder: 'SB-Mid-server-… / Mid-server-…', hint: 'Dipakai untuk membuat transaksi, memverifikasi notifikasi, dan refund. Jangan bagikan.' },
      ],
    },
  },
};

export const INTEGRATION_LABEL: Record<IntegrationKind, string> = { email: 'Email (OTP & notifikasi)', payment: 'Payment gateway', social: 'Login sosial (Google, Facebook, Apple)' };

/** Provider login sosial & field kredensial wajibnya (provider aktif bila semua field ini terisi). */
export type SocialProvider = 'google' | 'facebook' | 'apple';
export const SOCIAL_PROVIDERS: SocialProvider[] = ['google', 'facebook', 'apple'];
export const SOCIAL_FIELDS: Record<SocialProvider, string[]> = {
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  facebook: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
  apple: ['APPLE_SERVICES_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'],
};
/** Provider yang kredensialnya lengkap, dari pembaca nilai (dasbor atau env). */
export function enabledSocialProviders(get: (key: string) => string | undefined): SocialProvider[] {
  return SOCIAL_PROVIDERS.filter((p) => SOCIAL_FIELDS[p].every((k) => !!get(k)?.trim()));
}

/**
 * Validasi konfigurasi. `config` = nilai non-rahasia; `secretKeys` = kunci rahasia yang akan tersimpan setelah
 * perubahan (lama yang dipertahankan + baru). Mengembalikan daftar galat (kosong = valid).
 */
export function validateIntegration(kind: IntegrationKind, provider: string, config: Record<string, string>, secretKeys: Set<string>): { path: string; message: string }[] {
  const def = INTEGRATION_PROVIDERS[kind]?.[provider];
  if (!def) return [{ path: 'provider', message: `Provider tidak dikenal: ${provider}` }];
  const errors: { path: string; message: string }[] = [];
  const known = new Set(def.fields.map((f) => f.key));
  for (const k of Object.keys(config)) if (!known.has(k)) errors.push({ path: k, message: 'Field tidak dikenal untuk provider ini' });
  for (const f of def.fields) {
    const v = f.type === 'secret' ? undefined : config[f.key]?.trim();
    if (f.required && (f.type === 'secret' ? !secretKeys.has(f.key) : !v)) {
      errors.push({ path: f.key, message: `${f.label} wajib diisi` });
      continue;
    }
    if (!v) continue;
    if (v.length > 500) errors.push({ path: f.key, message: 'Terlalu panjang' });
    // https wajib; http hanya untuk relay di host yang sama (loopback).
    if (f.type === 'url' && !/^https:\/\/\S+$/i.test(v) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/i.test(v)) errors.push({ path: f.key, message: 'Harus URL https:// (http hanya untuk localhost)' });
    if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors.push({ path: f.key, message: 'Email tidak valid' });
    if (f.type === 'select' && f.options && !f.options.some((o) => o.value === v)) errors.push({ path: f.key, message: 'Pilihan tidak valid' });
  }
  if (kind === 'social' && provider === 'oauth') {
    const has = (k: string) => !!config[k]?.trim() || secretKeys.has(k);
    const complete = enabledSocialProviders((k) => (has(k) ? 'x' : undefined));
    if (!complete.length) errors.push({ path: 'GOOGLE_CLIENT_ID', message: 'Lengkapi kredensial minimal satu provider (Google, Facebook, atau Apple)' });
    for (const p of SOCIAL_PROVIDERS) {
      const f = SOCIAL_FIELDS[p];
      const n = f.filter(has).length;
      if (n > 0 && n < f.length) for (const k of f.filter((k) => !has(k))) errors.push({ path: k, message: 'Wajib diisi agar provider ini aktif' });
    }
  }
  if (kind === 'email' && config.EMAIL_FROM && !/[^\s@<]+@[^\s@>]+\.[^\s@>]+/.test(config.EMAIL_FROM)) errors.push({ path: 'EMAIL_FROM', message: 'Alamat pengirim harus memuat email, mis. RAVE <no-reply@rave.id>' });
  return errors;
}
