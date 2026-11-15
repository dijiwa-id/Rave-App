import { useEffect, useRef } from 'react';
import { useTrackSpectrum, type TrackSpectrum } from '@/lib/spectrum';
import { playbackClockMs } from '@/stores/player';

/*
 * Spektrum LCD pemutar (kontrak bersama web/desktop/mobile):
 * - mengisi seluruh sisa lebar LCD; jumlah bar = clamp(floor(lebar / 6), 16, 64) (bar 3–4 px + celah 2 px);
 * - amplop server (32 pita log 40 Hz–16 kHz, 20 fps) diinterpolasi antar-frame sesuai posisi pemutaran & antar-pita
 *   (linear pada sumbu log-frekuensi) ke jumlah bar;
 * - attack ~40 ms / release ~180 ms, peak cap yang jatuh perlahan; jeda → turun ke lantai; seek → lompat seketika;
 * - tanpa amplop (episode, iklan, 202/404/galat) → animasi prosedural dengan lebar & jumlah bar yang sama;
 * - reduced motion: bar statis mengikuti frame saat ini (≤ 4×/dtk) tanpa peak cap, atau bar dekoratif statis;
 * - satu <canvas>, rAF hanya saat memutar/menetap & terlihat (tab aktif, elemen di layar, lebar > 0).
 */

const GAP = 2;
const MIN_BARS = 16;
const MAX_BARS = 64;
const ATTACK_MS = 40;
const RELEASE_MS = 180;
const PEAK_HOLD_MS = 320;
const PEAK_FALL_PER_MS = 0.00055; // ±0,55 tinggi penuh per detik
const FLOOR_PAUSED = 0.06;
const FLOOR_IDLE = 0.05;
const SEEK_JUMP_MS = 350;
/** Pola dekoratif statis (reduced motion tanpa amplop) — sama dengan bar lama. */
const STATIC_BARS = [0.62, 0.9, 0.48, 0.78, 0.35, 0.95, 0.55, 0.7, 0.42, 0.85, 0.5, 0.66];

export const barsForWidth = (w: number) => (w > 0 ? Math.max(MIN_BARS, Math.min(MAX_BARS, Math.floor(w / 6))) : 0);

interface Live {
  env: TrackSpectrum | null;
  playing: boolean;
  idle: boolean;
}

/** Nilai amplop (0..1) untuk bar `i` dari `bars` pada posisi `ms` — interpolasi frame & pita. */
function envelopeAt(env: TrackSpectrum, ms: number, out: Float32Array) {
  const { fps, bands, frames, data } = env;
  const fpos = Math.max(0, (ms / 1000) * fps);
  const f0 = Math.min(frames - 1, Math.floor(fpos));
  const f1 = Math.min(frames - 1, f0 + 1);
  const t = Math.min(1, fpos - f0);
  const o0 = f0 * bands;
  const o1 = f1 * bands;
  const n = out.length;
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : (i * (bands - 1)) / (n - 1);
    const b0 = Math.floor(x);
    const b1 = Math.min(bands - 1, b0 + 1);
    const u = x - b0;
    const a = data[o0 + b0]! + (data[o0 + b1]! - data[o0 + b0]!) * u;
    const b = data[o1 + b0]! + (data[o1 + b1]! - data[o1 + b0]!) * u;
    out[i] = (a + (b - a) * t) / 255;
  }
}

/** Animasi cadangan prosedural (tanpa amplop): gelombang berlapis + denyut bass, kemiringan ke pita tinggi. */
function proceduralAt(now: number, out: Float32Array) {
  const t = now / 1000;
  const n = out.length;
  const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 1.9)), 6);
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : i / (n - 1);
    const w1 = Math.sin(t * (2.3 + (i % 7) * 0.41) + i * 1.7);
    const w2 = Math.sin(t * (3.7 + (i % 5) * 0.53) + i * 0.9);
    const v = 0.5 - 0.22 * x + 0.22 * w1 + 0.12 * w2 + beat * 0.35 * Math.max(0, 1 - x * 3);
    out[i] = Math.max(0.08, Math.min(0.96, v));
  }
}

export function Spectrum({ trackId, playing, idle }: { trackId: string | null; playing: boolean; idle: boolean }) {
  const env = useTrackSpectrum(trackId);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef<Live>({ env, playing, idle });
  const kick = useRef<(jump: boolean) => void>(() => {});
  const prevEnv = useRef(env);

  useEffect(() => {
    const envChanged = prevEnv.current !== env;
    prevEnv.current = env;
    live.current = { env, playing, idle };
    kick.current(envChanged);
  }, [env, playing, idle]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!wrap || !canvas || !ctx) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduce = mq.matches;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let bars = 0;
    let lvl = new Float32Array(0);
    let peak = new Float32Array(0);
    let hold = new Float32Array(0);
    let target = new Float32Array(0);
    let grad: CanvasGradient | null = null;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = 0;
    let lastPos = -1;
    let jumpNext = true;
    let onScreen = true;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      w = Math.floor(r.width);
      h = Math.floor(r.height);
      dpr = Math.min(3, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      const n = barsForWidth(w);
      if (n !== bars) {
        bars = n;
        lvl = new Float32Array(n).fill(FLOOR_IDLE);
        peak = new Float32Array(n).fill(FLOOR_IDLE);
        hold = new Float32Array(n);
        target = new Float32Array(n);
        jumpNext = true;
      }
      grad = ctx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, '#f4c21f');
      grad.addColorStop(0.55, '#f4c21f');
      grad.addColorStop(0.55, '#ffd650');
      grad.addColorStop(0.8, '#ffd650');
      grad.addColorStop(0.8, '#ff6a3d');
      grad.addColorStop(1, '#ff6a3d');
    };

    const computeTargets = (now: number) => {
      const { env: e, playing: on, idle: off } = live.current;
      if (off || !on) return target.fill(off ? FLOOR_IDLE : FLOOR_PAUSED);
      if (e) return envelopeAt(e, playbackClockMs(), target);
      if (reduce) {
        for (let i = 0; i < bars; i++) target[i] = STATIC_BARS[i % STATIC_BARS.length]!;
        return target;
      }
      return proceduralAt(now, target);
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!bars || !grad) return;
      const bw = (w - GAP * (bars - 1)) / bars;
      ctx.globalAlpha = live.current.idle ? 0.35 : 1;
      ctx.shadowColor = 'rgba(244, 194, 31, 0.35)';
      ctx.shadowBlur = 3;
      ctx.fillStyle = grad;
      ctx.beginPath();
      for (let i = 0; i < bars; i++) {
        const bh = Math.max(1, Math.round(lvl[i]! * (h - 3)));
        ctx.rect(i * (bw + GAP), h - bh, bw, bh);
      }
      ctx.fill();
      if (!reduce && !live.current.idle) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffd650';
        ctx.beginPath();
        for (let i = 0; i < bars; i++) {
          if (peak[i]! <= lvl[i]! + 0.02) continue;
          const y = h - Math.max(1, Math.round(peak[i]! * (h - 3))) - 2;
          ctx.rect(i * (bw + GAP), y, bw, 1.5);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    /** Satu langkah animasi; kembalikan true bila perlu frame berikutnya. */
    const step = (now: number) => {
      const dt = last ? Math.min(100, now - last) : 16;
      last = now;
      const { env: e, playing: on } = live.current;
      let jump = jumpNext;
      jumpNext = false;
      if (e && on) {
        const pos = playbackClockMs();
        // Seek: posisi melompat dari perkiraan → tanpa penghalusan.
        if (lastPos >= 0 && Math.abs(pos - (lastPos + dt)) > SEEK_JUMP_MS) jump = true;
        lastPos = pos;
      } else lastPos = -1;
      computeTargets(now);
      let settled = true;
      if (reduce) {
        lvl.set(target);
        peak.set(target);
      } else {
        const ka = 1 - Math.exp(-dt / ATTACK_MS);
        const kr = 1 - Math.exp(-dt / RELEASE_MS);
        for (let i = 0; i < bars; i++) {
          const tg = target[i]!;
          let v = lvl[i]!;
          v = jump ? tg : v + (tg - v) * (tg > v ? ka : kr);
          lvl[i] = v;
          if (jump || v >= peak[i]!) {
            peak[i] = v;
            hold[i] = PEAK_HOLD_MS;
          } else if (hold[i]! > 0) hold[i] = hold[i]! - dt;
          else peak[i] = Math.max(v, peak[i]! - PEAK_FALL_PER_MS * dt);
          if (Math.abs(v - tg) > 0.004 || peak[i]! > v + 0.004) settled = false;
        }
      }
      draw();
      return on || !settled;
    };

    const visible = () => onScreen && !document.hidden && bars > 0;
    const stop = () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      raf = 0;
      timer = undefined;
    };
    const loop = (now: number) => {
      raf = 0;
      if (step(now) && visible()) raf = requestAnimationFrame(loop);
      else last = 0;
    };
    const tickReduced = () => {
      timer = undefined;
      step(performance.now());
      // Reduced motion: hanya saat memutar dengan amplop, maks. 4×/dtk; selain itu cukup sekali gambar.
      if (live.current.playing && live.current.env && visible()) timer = setTimeout(tickReduced, 250);
    };
    const start = () => {
      if (!visible()) return stop();
      if (reduce) {
        if (timer === undefined) tickReduced();
        return;
      }
      if (!raf) {
        last = 0;
        raf = requestAnimationFrame(loop);
      }
    };
    kick.current = (jump) => {
      if (jump) jumpNext = true;
      start();
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      draw();
      start();
    });
    ro.observe(wrap);
    const io = new IntersectionObserver((entries) => {
      onScreen = entries.some((x) => x.isIntersecting);
      if (onScreen) start();
      else stop();
    });
    io.observe(wrap);
    const onVis = () => (document.hidden ? stop() : ((jumpNext = true), start()));
    document.addEventListener('visibilitychange', onVis);
    const onMq = () => {
      reduce = mq.matches;
      stop();
      start();
    };
    mq.addEventListener('change', onMq);
    start();
    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      mq.removeEventListener('change', onMq);
      kick.current = () => {};
    };
  }, []);

  return (
    <span ref={wrapRef} className="deck-spectrum" data-on={playing} data-source={env ? 'track' : 'fallback'} aria-hidden>
      <canvas ref={canvasRef} />
    </span>
  );
}
