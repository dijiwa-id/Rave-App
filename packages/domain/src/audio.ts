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

/** Rendisi yang layak dibuat dari master: lossless hanya dari master lossless; 320 hanya bila sumbernya sepadan. */
export function plannedRenditions(m: AudioMeta, enabled: RenditionQuality[]): RenditionQuality[] {
  return enabled.filter((q) => {
    if (q === 'lossless') return m.lossless;
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
}

/**
 * Pilih berkas yang diputar. Aturan:
 * 1. `auto` = normal (AAC 160, hemat data/CDN).
 * 2. Non-Premium & pratinjau anonim tidak pernah mendapat `high`/`lossless` — termasuk master lossless mentah.
 * 3. Lossless bisa dimatikan Super Admin (`streaming.lossless_enabled`) → turun ke `high`.
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
}): PlaybackChoice | null {
  let target: RenditionQuality = o.requested === 'auto' ? 'normal' : o.requested;
  let capped: CapReason | null = null;
  if (isPremiumQuality(target) && (o.preview || !o.premium)) {
    target = 'normal';
    capped = o.preview ? 'preview' : 'premium';
  }
  if (target === 'lossless' && !o.losslessEnabled) {
    target = 'high';
    capped = 'disabled';
  }
  const allowedMax = RENDITION_ORDER.indexOf(target);
  const r = o.renditions ?? {};
  const has = Object.keys(r).length > 0;
  if (has) {
    const down = RENDITION_ORDER.slice(0, allowedMax + 1).reverse();
    const pick = down.find((q) => r[q]?.url);
    if (pick) return { quality: pick, url: r[pick]!.url, codec_label: r[pick]!.codec_label, capped: pick === target ? capped : capped ?? 'unavailable' };
  }
  const m = o.master.meta;
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
