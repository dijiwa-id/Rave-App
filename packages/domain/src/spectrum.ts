// Amplop spektrum per lagu untuk LCD pemutar (web, desktop, mobile) — kontrak bersama:
// GET /v1/catalog/tracks/:id/spectrum → { fps, bands, frames, duration_ms, data: base64(frames*bands uint8, frame-major) }.
// DSP murni TypeScript (tanpa dependensi native): Hann + FFT radix-2, 32 pita log 40 Hz–16 kHz, dB relatif terhadap
// band-frame terkeras, dipetakan (dB + 60) / 60 → 0..255, dihaluskan (attack instan, release ~120 ms).

/** Naikkan bila algoritme berubah → amplop lama dibuat ulang (ETag ikut berubah). */
export const SPECTRUM_VERSION = 1;
export const SPECTRUM_FPS = 20;
export const SPECTRUM_BANDS = 32;
export const SPECTRUM_F_MIN = 40;
export const SPECTRUM_F_MAX = 16_000;
/** Sample rate dekode (≥ 2 × 16 kHz agar pita teratas terisi). */
export const SPECTRUM_SAMPLE_RATE = 32_000;
/** Rentang dinamika tampilan (dB di bawah band-frame terkeras → 0). */
export const SPECTRUM_RANGE_DB = 60;

export interface SpectrumOptions {
  sampleRate?: number;
  fps?: number;
  bands?: number;
  fftSize?: number;
  fMin?: number;
  fMax?: number;
  /** Konstanta waktu release penghalusan (ms). Attack instan. */
  releaseMs?: number;
  /** Ambang hening absolut (dBFS per pita): seluruh lagu di bawah ini → semua 0. */
  silenceDb?: number;
}

export interface SpectrumEnvelope {
  fps: number;
  bands: number;
  frames: number;
  duration_ms: number;
  /** frames*bands byte, frame-major: data[f*bands + b]. */
  data: Uint8Array;
}

/** Tepi pita log-spaced: bands+1 frekuensi dari fMin ke fMax. */
export function bandEdges(bands = SPECTRUM_BANDS, fMin = SPECTRUM_F_MIN, fMax = SPECTRUM_F_MAX): number[] {
  const r = Math.log(fMax / fMin);
  return Array.from({ length: bands + 1 }, (_, k) => fMin * Math.exp((r * k) / bands));
}

/** Indeks pita untuk frekuensi f (−1 di luar rentang). */
export function bandOf(f: number, bands = SPECTRUM_BANDS, fMin = SPECTRUM_F_MIN, fMax = SPECTRUM_F_MAX): number {
  if (f < fMin || f >= fMax) return -1;
  return Math.min(bands - 1, Math.floor((bands * Math.log(f / fMin)) / Math.log(fMax / fMin)));
}

/** FFT kompleks in-place radix-2 (re/im panjang 2^k). */
function fft(re: Float64Array, im: Float64Array, cos: Float64Array, sin: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
      t = im[i]!;
      im[i] = im[j]!;
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step]!;
        const wi = -sin[k * step]!;
        const a = i + k;
        const b = a + half;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
    }
  }
}

/**
 * Penganalisis streaming: `push()` potongan PCM mono float (−1..1) sesuai urutan, lalu `finish()`.
 * Memori ~ O(fftSize + frames*bands) — lagu panjang tidak ditampung utuh.
 * Frame f berpusat di t = f / fps (jendela fftSize sampel, nol di luar sinyal).
 */
export class SpectrumAnalyzer {
  readonly sampleRate: number;
  readonly fps: number;
  readonly bands: number;
  readonly fftSize: number;
  private readonly hop: number;
  private readonly releaseMs: number;
  private readonly silenceDb: number;
  private readonly win: Float64Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  /** Bobot tumpang-tindih bin → pita: [band][binIndex, weight][]. */
  private readonly map: Array<Array<[number, number]>>;
  private readonly norm: number;
  private buf = new Float32Array(0);
  /** Indeks sampel absolut dari buf[0]. */
  private base = 0;
  private total = 0;
  private nextFrame = 0;
  private db: number[] = [];

  constructor(opts: SpectrumOptions = {}) {
    this.sampleRate = opts.sampleRate ?? SPECTRUM_SAMPLE_RATE;
    this.fps = opts.fps ?? SPECTRUM_FPS;
    this.bands = opts.bands ?? SPECTRUM_BANDS;
    this.fftSize = opts.fftSize ?? 2048;
    this.releaseMs = opts.releaseMs ?? 120;
    this.silenceDb = opts.silenceDb ?? -90;
    if (this.fftSize & (this.fftSize - 1)) throw new Error('fftSize harus pangkat 2');
    this.hop = this.sampleRate / this.fps;
    const n = this.fftSize;
    this.win = new Float64Array(n);
    let wsum = 0;
    for (let i = 0; i < n; i++) wsum += this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    // Amplitudo sinus skala penuh → |X| = wsum/2 → daya 0 dBFS ≈ (wsum/2)^2.
    this.norm = 1 / ((wsum / 2) * (wsum / 2));
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / n);
      this.sin[k] = Math.sin((2 * Math.PI * k) / n);
    }
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    const edges = bandEdges(this.bands, opts.fMin ?? SPECTRUM_F_MIN, Math.min(opts.fMax ?? SPECTRUM_F_MAX, this.sampleRate / 2));
    const df = this.sampleRate / n;
    this.map = [];
    for (let b = 0; b < this.bands; b++) {
      const lo = edges[b]!;
      const hi = edges[b + 1]!;
      const row: Array<[number, number]> = [];
      for (let i = Math.max(1, Math.floor(lo / df) - 1); i <= Math.min(n / 2 - 1, Math.ceil(hi / df) + 1); i++) {
        const ov = Math.min(hi, (i + 0.5) * df) - Math.max(lo, (i - 0.5) * df);
        if (ov > 0) row.push([i, ov / df]);
      }
      this.map.push(row);
    }
  }

  push(chunk: Float32Array) {
    if (!chunk.length) return;
    const merged = new Float32Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    this.total += chunk.length;
    this.drain(false);
  }

  private sampleAt(abs: number): number {
    const i = abs - this.base;
    return i >= 0 && i < this.buf.length ? this.buf[i]! : 0;
  }

  private drain(final: boolean) {
    const n = this.fftSize;
    const frames = final ? Math.ceil(this.total / this.hop) : Infinity;
    while (this.nextFrame < frames) {
      const center = Math.round(this.nextFrame * this.hop);
      const start = center - n / 2;
      if (!final && start + n > this.total) break;
      for (let i = 0; i < n; i++) {
        this.re[i] = this.sampleAt(start + i) * this.win[i]!;
        this.im[i] = 0;
      }
      fft(this.re, this.im, this.cos, this.sin);
      for (const row of this.map) {
        let p = 0;
        for (const [i, w] of row) p += (this.re[i]! * this.re[i]! + this.im[i]! * this.im[i]!) * w;
        this.db.push(10 * Math.log10(p * this.norm + 1e-20));
      }
      this.nextFrame++;
      // Buang sampel yang tidak lagi dibutuhkan frame berikutnya.
      const keepFrom = Math.round(this.nextFrame * this.hop) - n / 2;
      const drop = keepFrom - this.base;
      if (drop > 65_536 && drop <= this.buf.length) {
        this.buf = this.buf.slice(drop);
        this.base = keepFrom;
      }
    }
  }

  finish(): SpectrumEnvelope {
    this.drain(true);
    const bands = this.bands;
    const frames = this.nextFrame;
    let max = -Infinity;
    for (const v of this.db) if (v > max) max = v;
    const data = new Uint8Array(frames * bands);
    const durationMs = Math.round((this.total / this.sampleRate) * 1000);
    if (!(max > this.silenceDb)) return { fps: this.fps, bands, frames, duration_ms: durationMs, data };
    const rel = 1 - Math.exp(-1000 / this.fps / this.releaseMs);
    const prev = new Float64Array(bands);
    for (let f = 0; f < frames; f++) {
      for (let b = 0; b < bands; b++) {
        const d = this.db[f * bands + b]!;
        let v = d < this.silenceDb ? 0 : Math.min(1, Math.max(0, (d - max + SPECTRUM_RANGE_DB) / SPECTRUM_RANGE_DB));
        // Attack instan, release eksponensial.
        if (v < prev[b]!) v = prev[b]! + (v - prev[b]!) * rel;
        prev[b] = v;
        data[f * bands + b] = Math.round(v * 255);
      }
    }
    return { fps: this.fps, bands, frames, duration_ms: durationMs, data };
  }
}

/** Analisis satu buffer PCM utuh (dipakai uji & sumber kecil). */
export function computeSpectrum(pcm: Float32Array, opts: SpectrumOptions = {}): SpectrumEnvelope {
  const a = new SpectrumAnalyzer(opts);
  a.push(pcm);
  return a.finish();
}

/** Byte amplop → base64 (Node & browser). */
export function spectrumToBase64(data: Uint8Array): string {
  const g = globalThis as { Buffer?: { from(d: Uint8Array): { toString(enc: string): string } } };
  if (g.Buffer) return g.Buffer.from(data).toString('base64');
  let s = '';
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}
