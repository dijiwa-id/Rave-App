// Kebijakan penayangan iklan (BRD: tier Gratis didukung iklan; Premium bebas iklan).
// Mengikuti praktik umum platform streaming ber-iklan (jeda di antara lagu, batas ad load, frequency cap,
// masa bebas iklan, iklan dapat dilewati) serta aturan Indonesia: Etika Pariwara Indonesia (EPI),
// UU PDP (iklan bertarget butuh persetujuan), izin OJK/BPOM/Bappebti untuk kategori terbatas.

/** prohibited = selalu ditolak; restricted = butuh nomor izin + bisa diblokir Super Admin; general = boleh. */
export type AdCategoryTier = 'prohibited' | 'restricted' | 'general';

export const AD_CATEGORIES = {
  music: { label: 'Musik & rilis', tier: 'general' },
  events: { label: 'Event & konser', tier: 'general' },
  food_beverage: { label: 'Makanan & minuman', tier: 'general' },
  fashion: { label: 'Fashion & gaya hidup', tier: 'general' },
  technology: { label: 'Teknologi & gawai', tier: 'general' },
  telco: { label: 'Telekomunikasi', tier: 'general' },
  ecommerce: { label: 'E-commerce', tier: 'general' },
  education: { label: 'Pendidikan', tier: 'general' },
  travel: { label: 'Perjalanan', tier: 'general' },
  public_service: { label: 'Layanan masyarakat', tier: 'general' },
  finance: { label: 'Keuangan & pinjaman (izin OJK)', tier: 'restricted', license: 'Nomor izin OJK' },
  crypto: { label: 'Aset kripto (izin Bappebti/OJK)', tier: 'restricted', license: 'Nomor izin Bappebti/OJK' },
  health: { label: 'Kesehatan & suplemen (izin BPOM)', tier: 'restricted', license: 'Nomor izin edar BPOM' },
  alcohol: { label: 'Minuman beralkohol (21+)', tier: 'restricted', license: 'Nomor izin edar' },
  tobacco: { label: 'Rokok & produk tembakau', tier: 'restricted', license: 'Nomor izin edar' },
  political: { label: 'Politik & pemilu', tier: 'restricted', license: 'Nomor registrasi KPU/Bawaslu' },
  dating: { label: 'Aplikasi kencan', tier: 'restricted', license: 'Nomor PSE Kominfo' },
  gambling: { label: 'Perjudian & taruhan', tier: 'prohibited' },
  adult: { label: 'Konten dewasa', tier: 'prohibited' },
  illegal_drugs: { label: 'Narkotika & obat terlarang', tier: 'prohibited' },
  weapons: { label: 'Senjata & bahan peledak', tier: 'prohibited' },
  hate: { label: 'Ujaran kebencian / SARA', tier: 'prohibited' },
  unlicensed_lending: { label: 'Pinjaman online tanpa izin OJK', tier: 'prohibited' },
} as const satisfies Record<string, { label: string; tier: AdCategoryTier; license?: string }>;

export type AdCategory = keyof typeof AD_CATEGORIES;
export const AD_CATEGORY_KEYS = Object.keys(AD_CATEGORIES) as AdCategory[];

export type AdType = 'audio' | 'display';
export type AdPlacement = 'between_tracks' | 'podcast_preroll';

/** Aturan yang TIDAK dapat diubah lewat pengaturan (kepatuhan & pengalaman dasar). */
export const AD_FIXED_RULES = [
  'Pelanggan Premium tidak pernah menerima iklan.',
  'Iklan hanya diputar di antara lagu/episode — tidak pernah memotong lagu yang sedang diputar.',
  'Setiap iklan berlabel jelas "Iklan" (EPI); promosi internal berlabel "Dari GEMA".',
  'Penargetan kota/demografi hanya untuk pengguna yang memberi persetujuan iklan (UU PDP); tanpa persetujuan hanya kontekstual (genre).',
  'Kategori terlarang (judi, dewasa, narkotika, senjata, SARA, pinjol tanpa izin) selalu ditolak.',
  'Kategori terbatas wajib mencantumkan nomor izin; setiap kampanye wajib ditinjau admin sebelum tayang.',
  'Pengguna anonim (pratinjau 30 detik) dan konten Premium tidak disisipi iklan.',
] as const;

export interface AdPolicy {
  enabled: boolean;
  breakIntervalMinutes: number;
  minStreamsBetweenBreaks: number;
  maxAdsPerBreak: number;
  maxAdsPerHour: number;
  dailyGraceStreams: number;
  podcastPreroll: boolean;
}

export interface ListenerAdState {
  anonymous: boolean;
  premium: boolean;
  placement: AdPlacement;
  /** Konten berikutnya adalah konten Premium (mis. episode premium) — tidak disisipi iklan. */
  premiumContent?: boolean;
  streamsToday: number;
  streamsSinceBreak: number;
  /** null = belum pernah ada jeda iklan hari ini. */
  minutesSinceBreak: number | null;
  adsLastHour: number;
}

export type AdBreakOutcome =
  | 'serve'
  | 'disabled'
  | 'anonymous'
  | 'premium'
  | 'premium_content'
  | 'preroll_disabled'
  | 'grace'
  | 'too_soon'
  | 'too_few_streams'
  | 'hourly_cap';

export interface AdBreakDecision {
  outcome: AdBreakOutcome;
  /** Jumlah slot iklan maksimum di jeda ini (0 bila tidak menayangkan). */
  slots: number;
  /** Jejak evaluasi untuk simulator Super Admin. */
  trace: { rule: string; pass: boolean; detail: string }[];
}

export const AD_OUTCOME_LABEL: Record<AdBreakOutcome, string> = {
  serve: 'Iklan ditayangkan',
  disabled: 'Iklan dimatikan',
  anonymous: 'Pengguna anonim',
  premium: 'Pelanggan Premium',
  premium_content: 'Konten Premium',
  preroll_disabled: 'Pre-roll podcast dimatikan',
  grace: 'Masa bebas iklan harian',
  too_soon: 'Belum lewat jeda minimum',
  too_few_streams: 'Lagu sejak jeda terakhir belum cukup',
  hourly_cap: 'Batas iklan per jam tercapai',
};

/**
 * Keputusan jeda iklan (murni, tanpa I/O). Dievaluasi berurutan; aturan pertama yang gagal menentukan hasil.
 * Pemilihan kampanye (kategori, frequency cap, penargetan) dilakukan setelahnya oleh service iklan.
 */
export function evaluateAdBreak(policy: AdPolicy, s: ListenerAdState): AdBreakDecision {
  const trace: AdBreakDecision['trace'] = [];
  const check = (rule: string, pass: boolean, detail: string, fail: AdBreakOutcome): AdBreakOutcome | null => {
    trace.push({ rule, pass, detail });
    return pass ? null : fail;
  };
  const stop = (outcome: AdBreakOutcome): AdBreakDecision => ({ outcome, slots: 0, trace });

  let r: AdBreakOutcome | null;
  if ((r = check('Iklan aktif', policy.enabled, policy.enabled ? 'ads.enabled = aktif' : 'ads.enabled = mati', 'disabled'))) return stop(r);
  if ((r = check('Pengguna masuk', !s.anonymous, s.anonymous ? 'Pratinjau anonim tidak disisipi iklan' : 'Pengguna terdaftar', 'anonymous'))) return stop(r);
  if ((r = check('Tier Gratis', !s.premium, s.premium ? 'Premium selalu bebas iklan' : 'Pengguna Gratis', 'premium'))) return stop(r);
  if ((r = check('Konten berikutnya bukan Premium', !s.premiumContent, s.premiumContent ? 'Konten Premium tidak disisipi iklan' : 'Konten reguler', 'premium_content'))) return stop(r);
  if (s.placement === 'podcast_preroll')
    if ((r = check('Pre-roll podcast', policy.podcastPreroll, policy.podcastPreroll ? 'ads.podcast_preroll aktif' : 'ads.podcast_preroll mati', 'preroll_disabled'))) return stop(r);
  if (
    (r = check(
      'Masa bebas iklan harian',
      s.streamsToday >= policy.dailyGraceStreams,
      `${s.streamsToday} dari ${policy.dailyGraceStreams} putaran bebas iklan hari ini`,
      'grace',
    ))
  )
    return stop(r);
  if (
    (r = check(
      'Jeda minimum antar-iklan',
      s.minutesSinceBreak === null || s.minutesSinceBreak >= policy.breakIntervalMinutes,
      s.minutesSinceBreak === null ? 'Belum ada jeda iklan hari ini' : `${Math.floor(s.minutesSinceBreak)} dari ${policy.breakIntervalMinutes} menit`,
      'too_soon',
    ))
  )
    return stop(r);
  if (
    s.placement === 'between_tracks' &&
    (r = check(
      'Lagu sejak jeda terakhir',
      s.minutesSinceBreak === null || s.streamsSinceBreak >= policy.minStreamsBetweenBreaks,
      `${s.streamsSinceBreak} dari ${policy.minStreamsBetweenBreaks} lagu`,
      'too_few_streams',
    ))
  )
    return stop(r);
  const remaining = policy.maxAdsPerHour - s.adsLastHour;
  if ((r = check('Batas iklan per jam', remaining > 0, `${s.adsLastHour} dari ${policy.maxAdsPerHour} iklan dalam 60 menit terakhir`, 'hourly_cap'))) return stop(r);
  const slots = Math.min(policy.maxAdsPerBreak, remaining);
  trace.push({ rule: 'Slot jeda', pass: true, detail: `${slots} iklan (maks ${policy.maxAdsPerBreak} per jeda)` });
  return { outcome: 'serve', slots, trace };
}

/** Validasi kategori terhadap kebijakan. Mengembalikan pesan galat atau null. */
export function categoryViolation(category: string, blocked: readonly string[], licenseRef?: string | null): string | null {
  const def = (AD_CATEGORIES as Record<string, { label: string; tier: AdCategoryTier; license?: string }>)[category];
  if (!def) return `Kategori tidak dikenal: ${category}`;
  if (def.tier === 'prohibited') return `Kategori "${def.label}" dilarang di GEMA`;
  if (blocked.includes(category)) return `Kategori "${def.label}" sedang diblokir oleh kebijakan iklan platform`;
  if (def.tier === 'restricted' && !licenseRef?.trim()) return `Kategori "${def.label}" wajib mencantumkan ${def.license}`;
  return null;
}
