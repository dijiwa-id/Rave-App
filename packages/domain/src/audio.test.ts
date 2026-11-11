import { describe, expect, it } from 'vitest';
import { masterLabel, plannedRenditions, resolvePlayback, type AudioMeta, type Renditions } from './audio.js';

const flac24: AudioMeta = { format: 'flac', codec: 'flac', lossless: true, sample_rate: 96000, bit_depth: 24, channels: 2, bitrate_kbps: 2900, duration_ms: 200_000 };
const mp3128: AudioMeta = { format: 'mp3', codec: 'mp3', lossless: false, sample_rate: 44100, bit_depth: 0, channels: 2, bitrate_kbps: 128, duration_ms: 200_000 };
const full: Renditions = {
  low: { url: '/m/x.low.m4a', codec_label: 'AAC 64' },
  normal: { url: '/m/x.normal.m4a', codec_label: 'AAC 160' },
  high: { url: '/m/x.high.m4a', codec_label: 'AAC 320' },
  lossless: { url: '/m/x.lossless.flac', codec_label: 'FLAC 24/96' },
};
const base = { premium: false, preview: false, losslessEnabled: true, renditions: full, master: { url: '/m/x.flac', meta: flac24 } };

describe('resolvePlayback — HQ & Lossless khusus Premium', () => {
  it('Premium mendapat Lossless (FLAC) dan AAC 320', () => {
    expect(resolvePlayback({ ...base, premium: true, requested: 'lossless' })).toMatchObject({ quality: 'lossless', url: '/m/x.lossless.flac', capped: null });
    expect(resolvePlayback({ ...base, premium: true, requested: 'high' })).toMatchObject({ quality: 'high', codec_label: 'AAC 320', capped: null });
  });
  it('non-Premium yang meminta high/lossless diturunkan ke AAC 160 dengan alasan premium', () => {
    for (const q of ['high', 'lossless'] as const) {
      expect(resolvePlayback({ ...base, requested: q })).toMatchObject({ quality: 'normal', url: '/m/x.normal.m4a', capped: 'premium' });
    }
  });
  it('pratinjau anonim tidak pernah mendapat kualitas premium', () => {
    expect(resolvePlayback({ ...base, premium: true, preview: true, requested: 'lossless' })).toMatchObject({ quality: 'normal', capped: 'preview' });
  });
  it('auto = AAC 160; low tetap low untuk semua', () => {
    expect(resolvePlayback({ ...base, requested: 'auto' })).toMatchObject({ quality: 'normal', capped: null });
    expect(resolvePlayback({ ...base, requested: 'low' })).toMatchObject({ quality: 'low', codec_label: 'AAC 64' });
  });
  it('Lossless dimatikan Super Admin → Premium turun ke AAC 320', () => {
    expect(resolvePlayback({ ...base, premium: true, losslessEnabled: false, requested: 'lossless' })).toMatchObject({ quality: 'high', capped: 'disabled' });
  });
  it('non-Premium tidak pernah menerima master lossless mentah walau rendisi belum ada', () => {
    expect(resolvePlayback({ ...base, renditions: {}, requested: 'normal' })).toBeNull();
    expect(resolvePlayback({ ...base, renditions: {}, requested: 'lossless' })).toBeNull();
    // Premium boleh memutar master lossless selama rendisi belum selesai.
    expect(resolvePlayback({ ...base, premium: true, renditions: {}, requested: 'lossless' })).toMatchObject({ quality: 'lossless', url: '/m/x.flac', codec_label: 'FLAC 24/96' });
  });
  it('rendisi yang hilang turun ke tingkat di bawahnya, tidak naik melewati hak', () => {
    const partial: Renditions = { low: full.low, lossless: full.lossless };
    expect(resolvePlayback({ ...base, renditions: partial, requested: 'normal' })).toMatchObject({ quality: 'low', capped: 'unavailable' });
  });
  it('master lossy tanpa rendisi diputar apa adanya; Lossless tidak bisa dipenuhi', () => {
    const lossy = { ...base, renditions: null, master: { url: '/m/y.mp3', meta: mp3128 } };
    expect(resolvePlayback({ ...lossy, requested: 'normal' })).toMatchObject({ url: '/m/y.mp3', codec_label: 'MP3 128', capped: null });
    expect(resolvePlayback({ ...lossy, premium: true, requested: 'lossless' })).toMatchObject({ quality: 'high', capped: 'unavailable' });
  });
  it('media lama tanpa metadata memakai label lama', () => {
    expect(resolvePlayback({ ...base, renditions: null, master: { url: 'https://x/a.mp3', meta: null }, requested: 'auto' })).toMatchObject({ codec_label: 'AAC 160', capped: null });
  });
});

describe('rendisi & label', () => {
  it('lossless hanya dari master lossless; 320 hanya dari sumber ≥ 256 kbps', () => {
    const all = ['low', 'normal', 'high', 'lossless'] as const;
    expect(plannedRenditions(flac24, [...all])).toEqual([...all]);
    expect(plannedRenditions(mp3128, [...all])).toEqual(['low', 'normal']);
  });
  it('label master', () => {
    expect(masterLabel(flac24)).toBe('FLAC 24/96');
    expect(masterLabel({ ...flac24, codec: 'pcm_s16le', format: 'wav', bit_depth: 16, sample_rate: 44100 })).toBe('WAV 16/44.1');
    expect(masterLabel(mp3128)).toBe('MP3 128');
  });
});
