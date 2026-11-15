// Audio master, rendisi streaming, dan hak kualitas pemutaran (REQ-STR-02).
// Aturan bisnis: kualitas tinggi (AAC 320) & Lossless (FLAC) hanya untuk pelanggan Premium.
// Fungsi di sini murni (tanpa I/O) — dipakai catalog (transcoding) dan playback (pemilihan rendisi), dan diuji unit.

export type Quality = 'auto' | 'low' | 'normal' | 'high' | 'lossless';
export type RenditionQuality = Exclude<Quality, 'auto'>;

/** Urutan dari terendah ke tertinggi. */
export const RENDITION_ORDER: RenditionQuality[] = ['low', 'normal', 'high', 'lossless'];
/** Kualitas yang hanya boleh diputar pelanggan Premium. */
export const PREMIUM_QUALITIES: readonly RenditionQuality[] = ['high', 'lossless'];
export const isPremiumQuality = (q: Quality) => (PREMIUM_QUALITIES as readonly string[]).includes(q);

/** Nama rendisi di pengaturan `transcoding.renditions` → tingkat kualitas. */
export const RENDITION_SETTING: Record<string, RenditionQuality> = { aac_48: 'low', aac_160: 'normal', aac_320: 'high', flac: 'lossless' };

/** Profil encoder rendisi lossy (AAC-LC di kontainer M4A — diputar native di semua browser modern). */
export const LOSSY_PROFILE: Record<Exclude<RenditionQuality, 'lossless'>, { kbps: number; label: string }> = {
  low: { kbps: 64, label: 'AAC 64' },
  normal: { kbps: 160, label: 'AAC 160' },
  high: { kbps: 320, label: 'AAC 320' },
};

/** Label lama untuk media tanpa metadata (mis. URL eksternal data demo). */
export const LEGACY_LABEL: Record<RenditionQuality, string> = { low: 'HE-AAC 48', normal: 'AAC 160', high: 'AAC 320', lossless: 'FLAC 16/44.1' };

/** Format master yang diterima Artist Studio (ekstensi → MIME standar). */
export const AUDIO_UPLOAD_TYPES: Record<string, string> = {
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.m4a': 'audio/mp4',
  '.alac': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
};
/** Codec lossless (nama codec ffmpeg). */
export const isLosslessCodec = (codec: string) => /^(flac|alac|pcm_|wavpack|ape|tta|mlp|truehd)/.test(codec);

export interface AudioMeta {
  /** Kontainer (flac, wav, aiff, mov/mp4, mp3, ogg …). */
  format: string;
  /** Codec ffmpeg (flac, pcm_s24le, alac, mp3, aac, opus, vorbis …). */
  codec: string;
  lossless: boolean;
  sample_rate: number;
  /** 0 bila tidak relevan (codec lossy). */
  bit_depth: number;
  channels: number;
  bitrate_kbps: number;
  duration_ms: number;
}

export interface Rendition {
  url: string;
  codec_label: string;
  bytes?: number;
}
export type Renditions = Partial<Record<RenditionQuality, Rendition>>;

/** Label master/rendisi lossless: "FLAC 24/96", "WAV 16/44.1". */
export function losslessLabel(name: string, m: Pick<AudioMeta, 'bit_depth' | 'sample_rate'>): string {
  const khz = m.sample_rate ? +(m.sample_rate / 1000).toFixed(1) : 44.1;
  return `${name} ${m.bit_depth || 16}/${khz}`;
}

/** Label master apa adanya (dipakai bila belum ada rendisi). */
export function masterLabel(m: AudioMeta): string {
  if (m.lossless) return losslessLabel(m.codec.startsWith('pcm_') ? (m.format.includes('aiff') ? 'AIFF' : 'WAV') : m.codec.toUpperCase(), m);
  return `${m.codec.toUpperCase()}${m.bitrate_kbps ? ' ' + m.bitrate_kbps : ''}`;
}

// ───────────────────────── Kebijakan kualitas (Free vs Premium) ─────────────────────────
/**
 * Kebijakan kualitas streaming yang diatur Super Admin — demi efisiensi storage & bandwidth:
 * - `freeMax` / `premiumMax`: plafon kualitas per tier (Free tidak pernah Lossless).
 * - `losslessCap`: resolusi FLAC maksimum (hi-res 24/96 ≈ 3× ukuran 16/44.1).
 * - `losslessMode`: `eager` = FLAC dibuat saat upload; `on_demand` = dibuat saat pertama kali diminta Premium.
 * Di kedua mode, master FLAC yang sudah di dalam batas resolusi dipakai ulang sebagai versi Lossless (tanpa salinan kedua).
 */
export type LosslessMode = 'eager' | 'on_demand';
export type LosslessCap = '16_44' | '24_48' | '24_96';
export const LOSSLESS_CAPS: Record<LosslessCap, { bit_depth: number; sample_rate: number }> = {
  '16_44': { bit_depth: 16, sample_rate: 44_100 },
  '24_48': { bit_depth: 24, sample_rate: 48_000 },
  '24_96': { bit_depth: 24, sample_rate: 96_000 },
};
export interface QualityPolicy {
  freeMax: RenditionQuality;
  premiumMax: RenditionQuality;
  losslessEnabled: boolean;
  losslessCap: LosslessCap;
  losslessMode: LosslessMode;
}
export const DEFAULT_QUALITY_POLICY: QualityPolicy = { freeMax: 'normal', premiumMax: 'lossless', losslessEnabled: true, losslessCap: '24_96', losslessMode: 'on_demand' };

const rank = (q: RenditionQuality) => RENDITION_ORDER.indexOf(q);
const minQ = (a: RenditionQuality, b: RenditionQuality) => (rank(a) <= rank(b) ? a : b);

/** Normalisasi nilai pengaturan mentah (bisa salah ketik/kosong) menjadi kebijakan yang sah. */
export function normalizePolicy(p: Partial<Record<keyof QualityPolicy, unknown>> = {}): QualityPolicy {
  const q = (v: unknown, d: RenditionQuality) => (RENDITION_ORDER.includes(v as RenditionQuality) ? (v as RenditionQuality) : d);
  return {
    // Free tidak pernah Lossless, apa pun nilai pengaturannya.
    freeMax: minQ(q(p.freeMax, DEFAULT_QUALITY_POLICY.freeMax), 'high'),
    premiumMax: q(p.premiumMax, DEFAULT_QUALITY_POLICY.premiumMax),
    losslessEnabled: p.losslessEnabled === undefined ? true : !!p.losslessEnabled,
    losslessCap: typeof p.losslessCap === 'string' && p.losslessCap in LOSSLESS_CAPS ? (p.losslessCap as LosslessCap) : DEFAULT_QUALITY_POLICY.losslessCap,
    losslessMode: p.losslessMode === 'eager' ? 'eager' : 'on_demand',
  };
}

/** Kualitas tertinggi yang boleh diputar: pratinjau anonim ≤ AAC 160, Free ≤ `freeMax`, Premium ≤ `premiumMax`. */
export function tierMax(policy: QualityPolicy, o: { premium: boolean; preview: boolean }): RenditionQuality {
  if (o.preview) return minQ(policy.freeMax, 'normal');
  if (!o.premium) return policy.freeMax;
  return policy.losslessEnabled ? policy.premiumMax : minQ(policy.premiumMax, 'high');
}

/** Master FLAC yang sudah di dalam batas resolusi bisa langsung disajikan sebagai versi Lossless (hemat storage). */
export function masterReusableAsLossless(m: AudioMeta | null | undefined, cap: LosslessCap): boolean {
  if (!m?.lossless || m.codec !== 'flac') return false;
  const c = LOSSLESS_CAPS[cap];
  return (m.bit_depth || 16) <= c.bit_depth && (m.sample_rate || 44_100) <= c.sample_rate;
}

/** Resolusi FLAC yang dihasilkan dari master lossless dengan batas kebijakan. */
export function losslessTarget(m: Pick<AudioMeta, 'bit_depth' | 'sample_rate'>, cap: LosslessCap) {
  const c = LOSSLESS_CAPS[cap];
  return { bit_depth: Math.min(m.bit_depth > 16 ? 24 : 16, c.bit_depth), sample_rate: Math.min(m.sample_rate || 44_100, c.sample_rate) };
}

/**
 * Rendisi yang layak dibuat dari master: lossless hanya dari master lossless; 320 hanya bila sumbernya sepadan.
 * Dengan kebijakan: FLAC dilewati bila master bisa dipakai ulang, atau mode `on_demand` (dibuat saat diminta —
 * `wantLossless` = sudah ada permintaan Premium).
 */
export function plannedRenditions(m: AudioMeta, enabled: RenditionQuality[], policy?: Partial<QualityPolicy>, wantLossless = false): RenditionQuality[] {
  const p = policy ? normalizePolicy(policy) : null;
  return enabled.filter((q) => {
    if (q === 'lossless') {
      if (!m.lossless) return false;
      if (!p) return true;
      if (masterReusableAsLossless(m, p.losslessCap)) return false;
      return p.losslessMode === 'eager' || wantLossless;
    }
    if (q === 'high') return m.lossless || m.bitrate_kbps >= 256;
    return true;
  });
}

export type CapReason = 'premium' | 'preview' | 'disabled' | 'unavailable';

export interface PlaybackChoice {
  quality: RenditionQuality;
  url: string;
  codec_label: string;
  /** Diisi bila kualitas yang diminta diturunkan — klien bisa menjelaskan alasannya (mis. ajakan Premium). */
  capped: CapReason | null;
  /** `lossless`: versi FLAC belum ada (mode on_demand) → playback meminta catalog membuatnya; sementara diputar tingkat di bawahnya. */
  needs?: 'lossless' | null;
}

/**
 * Pilih berkas yang diputar. Aturan:
 * 1. `auto` = normal (AAC 160, hemat data/CDN).
 * 2. Plafon per tier dari kebijakan (`tierMax`): Free ≤ `freeMax` (default AAC 160, tidak pernah Lossless),
 *    pratinjau anonim ≤ AAC 160, Premium ≤ `premiumMax`; Lossless bisa dimatikan Super Admin → turun ke `high`.
 * 3. Lossless: rendisi FLAC → master FLAC dalam batas resolusi (dipakai ulang) → belum ada: turun ke tingkat di bawahnya
 *    dan `needs: 'lossless'` (dibuat on-demand). Master mentah di atas batas (WAV/hi-res besar) tidak dikirim bila ada
 *    rendisi lain — hemat bandwidth.
 * 4. Rendisi tidak ada → turun ke tingkat di bawahnya, lalu naik hanya di dalam tingkat yang diizinkan.
 * 5. Tanpa rendisi sama sekali: master lossy/tak dikenal diputar apa adanya; master lossless hanya untuk yang berhak
 *    Lossless — selain itu `null` (versi standar belum siap / transcoding belum selesai).
 */
export function resolvePlayback(o: {
  requested: Quality;
  premium: boolean;
  preview: boolean;
  losslessEnabled: boolean;
  renditions: Renditions | null | undefined;
  master: { url: string; meta: AudioMeta | null };
  policy?: Partial<QualityPolicy>;
}): PlaybackChoice | null {
  const policy = normalizePolicy({ ...o.policy, losslessEnabled: o.losslessEnabled && (o.policy?.losslessEnabled ?? true) });
  const requested: RenditionQuality = o.requested === 'auto' ? 'normal' : o.requested;
  const max = tierMax(policy, o);
  let target = requested;
  let capped: CapReason | null = null;
  if (rank(target) > rank(max)) {
    target = max;
    // Alasan: pratinjau → preview; Free → premium (ajakan upgrade); Premium yang dibatasi Super Admin → disabled.
    capped = o.preview ? 'preview' : !o.premium ? 'premium' : 'disabled';
  }
  const m = o.master.meta;
  const r = o.renditions ?? {};
  const has = Object.keys(r).length > 0;
  let needs: PlaybackChoice['needs'] = null;
  if (target === 'lossless') {
    if (r.lossless?.url) return { quality: 'lossless', url: r.lossless.url, codec_label: r.lossless.codec_label, capped };
    if (masterReusableAsLossless(m, policy.losslessCap)) return { quality: 'lossless', url: o.master.url, codec_label: masterLabel(m!), capped };
    if (m?.lossless && has) {
      // Belum ada FLAC dalam batas resolusi → minta dibuat; sementara turun ke rendisi terbaik di bawahnya.
      needs = 'lossless';
      target = 'high';
      capped = capped ?? 'unavailable';
    }
  }
  const allowedMax = rank(target);
  if (has) {
    const down = RENDITION_ORDER.slice(0, allowedMax + 1).reverse();
    const pick = down.find((q) => r[q]?.url);
    if (pick) return { quality: pick, url: r[pick]!.url, codec_label: r[pick]!.codec_label, capped: pick === target ? capped : capped ?? 'unavailable', needs };
  }
  if (m?.lossless) {
    if (target !== 'lossless') return null;
    return { quality: 'lossless', url: o.master.url, codec_label: masterLabel(m), capped };
  }
  // Master lossy / tanpa metadata: satu-satunya berkas. Tingkat premium tidak bisa dipenuhi lebih dari master itu sendiri.
  const quality: RenditionQuality = target === 'lossless' ? 'high' : target;
  return {
    quality,
    url: o.master.url,
    codec_label: m ? masterLabel(m) : LEGACY_LABEL[quality],
    capped: target === 'lossless' ? capped ?? 'unavailable' : capped,
  };
}
