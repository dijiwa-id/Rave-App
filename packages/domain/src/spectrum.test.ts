import { describe, expect, it } from 'vitest';
import { bandEdges, bandOf, computeSpectrum, SpectrumAnalyzer, SPECTRUM_BANDS, SPECTRUM_SAMPLE_RATE, spectrumToBase64 } from './spectrum.js';

const SR = SPECTRUM_SAMPLE_RATE;
const sine = (hz: number, seconds: number, amp = 0.5, sr = SR) => {
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr);
  return out;
};
const frame = (data: Uint8Array, f: number, bands = SPECTRUM_BANDS) => Array.from(data.subarray(f * bands, (f + 1) * bands));
const argmax = (xs: number[]) => xs.indexOf(Math.max(...xs));

describe('spectrum — pita log 40 Hz–16 kHz', () => {
  it('32 pita dengan tepi 40 Hz dan 16 kHz', () => {
    const e = bandEdges();
    expect(e).toHaveLength(SPECTRUM_BANDS + 1);
    expect(e[0]).toBeCloseTo(40);
    expect(e[SPECTRUM_BANDS]).toBeCloseTo(16000);
    expect(bandOf(39)).toBe(-1);
    expect(bandOf(40)).toBe(0);
    expect(bandOf(15999)).toBe(31);
  });

  it('sinus pada frekuensi tertentu menyalakan pita yang tepat (255 = band-frame terkeras)', () => {
    for (const hz of [100, 1000, 5000, 12000]) {
      const env = computeSpectrum(sine(hz, 2));
      const mid = frame(env.data, 20);
      expect(argmax(mid)).toBe(bandOf(hz));
      expect(Math.max(...mid)).toBeGreaterThanOrEqual(250);
      // Pita jauh dari nada redup (> 40 dB di bawah puncak).
      expect(mid[0]).toBeLessThan(80);
      expect(mid[31]).toBeLessThan(80);
    }
  });

  it('hening → semua nol', () => {
    const env = computeSpectrum(new Float32Array(SR * 3));
    expect(env.frames).toBe(60);
    expect(env.data.length).toBe(60 * SPECTRUM_BANDS);
    expect(env.data.every((v) => v === 0)).toBe(true);
  });

  it('jumlah frame = ceil(durasi × fps), durasi dari sampel', () => {
    for (const s of [1, 2.37, 10]) {
      const env = computeSpectrum(new Float32Array(Math.round(s * SR)).fill(0.1));
      expect(env.frames).toBe(Math.ceil(s * 20));
      expect(env.duration_ms).toBe(Math.round(s * 1000));
      expect(env.data.length).toBe(env.frames * env.bands);
    }
  });

  it('tata letak byte frame-major: data[f*bands + b]', () => {
    // 1 dtk 200 Hz lalu 1 dtk 8 kHz → frame awal menyala di pita rendah, frame akhir di pita tinggi.
    const a = sine(200, 1);
    const b = sine(8000, 1);
    const pcm = new Float32Array(a.length + b.length);
    pcm.set(a);
    pcm.set(b, a.length);
    const env = computeSpectrum(pcm);
    expect(argmax(frame(env.data, 5))).toBe(bandOf(200));
    expect(argmax(frame(env.data, 35))).toBe(bandOf(8000));
    expect(env.data[5 * env.bands + bandOf(200)]).toBeGreaterThan(240);
    expect(env.data[35 * env.bands + bandOf(200)]).toBeLessThan(60);
  });

  it('bagian pelan lebih rendah dari bagian keras; release halus setelah nada berhenti', () => {
    const loud = sine(1000, 1, 0.8);
    const quiet = sine(1000, 1, 0.008); // −40 dB
    const pcm = new Float32Array(loud.length * 3);
    pcm.set(loud);
    pcm.set(quiet, loud.length);
    const env = computeSpectrum(pcm);
    const k = bandOf(1000);
    const at = (f: number) => env.data[f * env.bands + k]!;
    expect(at(10)).toBeGreaterThan(250);
    expect(at(30)).toBeGreaterThan(70);
    expect(at(30)).toBeLessThan(110); // (−40 + 60) / 60 × 255 ≈ 85
    // Setelah hening: turun bertahap (bukan langsung 0), lalu habis.
    expect(at(42)).toBeGreaterThan(0);
    expect(at(42)).toBeLessThan(at(39));
    expect(at(58)).toBe(0);
  });

  it('streaming dalam potongan = hasil sekali jalan', () => {
    const pcm = sine(440, 7.3);
    const whole = computeSpectrum(pcm);
    const a = new SpectrumAnalyzer();
    for (let i = 0; i < pcm.length; i += 3001) a.push(pcm.subarray(i, i + 3001));
    const parts = a.finish();
    expect(parts.frames).toBe(whole.frames);
    expect(Buffer.from(parts.data).equals(Buffer.from(whole.data))).toBe(true);
  });

  it('base64 bolak-balik', () => {
    const d = new Uint8Array([0, 1, 254, 255, 128]);
    expect(Buffer.from(spectrumToBase64(d), 'base64')).toEqual(Buffer.from(d));
  });
});
