import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { LocateFixed, Mic2, Pause, Play, Share2, SkipBack, SkipForward, X } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import { usePlayer } from '@/stores/player';
import { colorFor } from '@/components/fan';
import { cx, EmptyState, toast } from '@/components/ui';
import { Vinyl } from '@/pages/public/Vinyl';
import type { Lyrics as LyricsT } from './Track';
import { useDict } from '@/lib/i18n';
import { useBranding } from '@/lib/platform';

/**
 * Lirik tersinkron layar penuh (REQ-STR-03).
 * - Mode baca: latar warna lagu + raster titik tipis + cincin putus-putus abstrak + piringan RAVE berputar pelan;
 *   baris aktif ditandai bilah mustard, klik baris untuk lompat, auto-scroll berhenti sementara saat pengguna menggulir.
 * - Mode karaoke: panggung gelap, baris aktif besar dengan sapuan warna mustard mengikuti waktu, cincin titik
 *   "berdenyut" tiap ganti baris, equalizer deck RAVE, dan hitung mundur titik saat jeda instrumental.
 */

type Line = { time_ms: number; text: string };

/** Indeks baris aktif (-1 = belum ada / lirik tidak tersinkron). */
function activeLine(lines: Line[], synced: boolean, pos: number): number {
  if (!synced) return -1;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i]!.time_ms <= pos + 150) idx = i;
  return idx;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const FOLLOW_PAUSE_MS = 4000;

// ---------------------------------------------------------------- Grafis

/** Raster titik tipis yang memudar (mask radial) — dipakai di kedua mode. */
function DotField({ className, size = 14, opacity = 0.16, mask = 'radial-gradient(ellipse 70% 60% at 80% 20%, #000 0%, transparent 75%)' }: { className?: string; size?: number; opacity?: number; mask?: string }) {
  return (
    <div
      aria-hidden
      className={cx('pointer-events-none absolute inset-0', className)}
      style={{
        backgroundImage: `radial-gradient(rgb(255 255 255 / ${opacity}) 1px, transparent 1.6px)`,
        backgroundSize: `${size}px ${size}px`,
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    />
  );
}

/** Cincin konsentris putus-putus + busur titik (abstrak, sangat tipis). */
function DottedRings({ className, spin }: { className?: string; spin?: boolean }) {
  return (
    <svg viewBox="0 0 400 400" aria-hidden className={cx('pointer-events-none', className)} fill="none">
      <g className={cx('origin-center', spin && 'animate-[rave-spin_60s_linear_infinite] motion-reduce:animate-none')} style={{ transformBox: 'fill-box' }}>
        <circle cx="200" cy="200" r="190" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1" strokeDasharray="1 7" strokeLinecap="round" />
        <circle cx="200" cy="200" r="150" stroke="currentColor" strokeOpacity="0.16" strokeWidth="1" strokeDasharray="2 10" strokeLinecap="round" />
        <circle cx="200" cy="200" r="110" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" strokeDasharray="1 5" strokeLinecap="round" />
        <path d="M60 200 A140 140 0 0 1 200 60" stroke="#f4c21f" strokeOpacity="0.55" strokeWidth="2" strokeDasharray="0.1 9" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Garis gelombang titik — aksen "suara" khas RAVE di sudut halaman. */
function DotWave({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 600 80" preserveAspectRatio="none" aria-hidden className={cx('pointer-events-none', className)} fill="none">
      <defs>
        <linearGradient id={`w${id}`} x1="0" x2="1">
          <stop offset="0" stopColor="#f4c21f" stopOpacity="0" />
          <stop offset="0.5" stopColor="#f4c21f" stopOpacity="0.7" />
          <stop offset="1" stopColor="#c9a0dc" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 40 C 60 10, 120 70, 180 40 S 300 10, 360 40 S 480 70, 540 40 S 600 25, 600 40" stroke={`url(#w${id})`} strokeWidth="2.5" strokeDasharray="0.1 8" strokeLinecap="round" />
    </svg>
  );
}

/** Equalizer bergaya deck RAVE (mustard → ungu); diam bila tidak memutar / reduced motion. */
function Equalizer({ on, bars = 32, className }: { on: boolean; bars?: number; className?: string }) {
  return (
    <div aria-hidden className={cx('flex items-end justify-center gap-[3px]', className)}>
      {Array.from({ length: bars }, (_, i) => {
        const h = 30 + ((i * 37) % 70);
        return (
          <span
            key={i}
            className="w-1.5 origin-bottom rounded-none motion-reduce:!animate-none sm:w-2"
            style={{
              height: `${h}%`,
              background: i % 5 === 0 ? '#c9a0dc' : '#f4c21f',
              opacity: 0.25 + (h / 100) * 0.55,
              transform: on ? undefined : 'scaleY(0.12)',
              animation: on ? `deck-eq ${0.7 + ((i * 13) % 7) / 10}s ease-in-out ${-(i % 9) / 10}s infinite alternate` : 'none',
              transition: 'transform 300ms',
            }}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Karaoke

/**
 * Medan orbit karaoke: lintasan elips bertumpuk seperti garis edar planet — garis putus-putus dipadu garis utuh,
 * tiap orbit sedikit miring & pusatnya tidak tepat satu poros (sengaja "tidak presisi"), dengan planet (bulatan)
 * yang beredar di lintasannya. Seluruh sistem berpresesi pelan. Berhenti saat lagu dijeda / reduced motion.
 */
type Orbit = { cx: number; cy: number; rx: number; ry: number; tilt: number; dash?: string; width: number; color: string; opacity: number; planet: number; planetColor: string; dur: number; reverse?: boolean; start: number; halo?: boolean };
const ORBITS: Orbit[] = [
  { cx: 506, cy: 494, rx: 478, ry: 168, tilt: -17, dash: '2 11', width: 1.2, color: '#ffffff', opacity: 0.26, planet: 7, planetColor: '#f4c21f', dur: 96, start: 0.12, halo: true },
  { cx: 493, cy: 507, rx: 418, ry: 196, tilt: 9, width: 1, color: '#ffffff', opacity: 0.13, planet: 4.5, planetColor: '#ffffff', dur: 74, reverse: true, start: 0.58 },
  { cx: 512, cy: 499, rx: 344, ry: 118, tilt: -31, dash: '0.1 9', width: 2.4, color: '#f4c21f', opacity: 0.5, planet: 9, planetColor: '#c9a0dc', dur: 58, start: 0.33, halo: true },
  { cx: 497, cy: 489, rx: 268, ry: 236, tilt: 4, width: 1, color: '#c9a0dc', opacity: 0.2, planet: 3.5, planetColor: '#f4c21f', dur: 44, reverse: true, start: 0.8 },
  { cx: 489, cy: 503, rx: 210, ry: 84, tilt: 23, dash: '7 7', width: 1, color: '#ffffff', opacity: 0.22, planet: 5, planetColor: '#ffffff', dur: 33, start: 0.05 },
  { cx: 504, cy: 509, rx: 128, ry: 112, tilt: -8, dash: '1 5', width: 1, color: '#ffffff', opacity: 0.18, planet: 2.8, planetColor: '#f4c21f', dur: 24, reverse: true, start: 0.45 },
];
/** Elips sebagai path (dimulai di sisi kanan) — untuk lintasan animateMotion planet. */
const ellipsePath = (o: Orbit) => `M${o.cx + o.rx} ${o.cy} A${o.rx} ${o.ry} 0 1 1 ${o.cx - o.rx} ${o.cy} A${o.rx} ${o.ry} 0 1 1 ${o.cx + o.rx} ${o.cy}`;

function OrbitField({ playing, still, className }: { playing: boolean; still: boolean; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    if (playing && !still) svg.unpauseAnimations();
    else svg.pauseAnimations();
  }, [playing, still]);
  return (
    <svg ref={ref} viewBox="0 0 1000 1000" aria-hidden className={cx('pointer-events-none overflow-visible', className)} fill="none">
      {/* Presesi pelan seluruh sistem di poros yang sedikit bergeser dari tengah. */}
      <g
        className="animate-[rave-spin_240s_linear_infinite] motion-reduce:animate-none"
        style={{ transformOrigin: '508px 496px', transformBox: 'view-box', animationPlayState: playing && !still ? 'running' : 'paused' }}
      >
        {ORBITS.map((o, i) => {
          const path = ellipsePath(o);
          // Posisi awal planet (statis bila animasi tidak jalan): titik pada elips di fraksi `start`.
          const a = o.start * Math.PI * 2;
          const px = o.cx + o.rx * Math.cos(a);
          const py = o.cy - o.ry * Math.sin(a);
          return (
            <g key={i} transform={`rotate(${o.tilt} ${o.cx} ${o.cy})`}>
              <path d={path} stroke={o.color} strokeOpacity={o.opacity} strokeWidth={o.width} strokeDasharray={o.dash} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              {/* Planet: bulatan (+ halo tipis) yang beredar di lintasan. */}
              <g transform={still ? `translate(${px} ${py})` : undefined}>
                {o.halo && <circle r={o.planet * 2.4} stroke={o.planetColor} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="1 3" />}
                <circle r={o.planet} fill={o.planetColor} fillOpacity="0.9" />
                {!still && (
                  <animateMotion
                    dur={`${o.dur}s`}
                    repeatCount="indefinite"
                    path={path}
                    keyPoints={o.reverse ? `${o.start};0;1;${o.start}` : `${o.start};1;0;${o.start}`}
                    keyTimes={`0;${o.reverse ? o.start : 1 - o.start};${o.reverse ? o.start : 1 - o.start};1`}
                    calcMode="linear"
                  />
                )}
              </g>
            </g>
          );
        })}
        {/* Bintang kecil di antara orbit. */}
        {[
          [182, 268, 1.6], [820, 214, 2.2], [742, 802, 1.4], [236, 760, 2], [905, 560, 1.2], [96, 470, 1.4], [612, 120, 1.2], [420, 905, 1.6],
        ].map(([x, y, rr], i) => (
          <circle key={`s${i}`} cx={x} cy={y} r={rr} fill="#ffffff" fillOpacity={0.35} />
        ))}
      </g>
    </svg>
  );
}

/** Lockup karaoke: logo RAVE (unggahan Super Admin atau bawaan) + "KARAOKE" berjarak lebar di bawahnya. */
function KaraokeBrand({ label }: { label: string }) {
  const b = useBranding();
  return (
    <div className="flex flex-col items-center select-none">
      <img src={b.logoDark} alt={b.name} className="h-8 w-auto object-contain sm:h-11" draggable={false} />
      <div className="mt-1.5 flex items-center gap-2.5" aria-hidden>
        <span className="h-px w-5 bg-gradient-to-r from-transparent to-rave-mustard sm:w-8" />
        <span className="font-label text-[10px] font-bold tracking-[0.55em] text-rave-mustard uppercase sm:text-xs">{label}</span>
        <span className="h-px w-5 bg-gradient-to-l from-transparent to-rave-mustard sm:w-8" />
      </div>
    </div>
  );
}

/** Baris aktif karaoke: sapuan mustard dari kiri ke kanan mengikuti posisi lagu (diperhalus transisi CSS). */
function SweepLine({ text, start, end }: { text: string; start: number; end: number }) {
  const pct = usePlayer((s) => Math.round(clamp01((s.positionMs - start) / Math.max(1, end - start)) * 1000) / 10);
  return (
    <span
      className="bg-clip-text text-transparent [-webkit-box-decoration-break:clone] [box-decoration-break:clone]"
      style={{
        backgroundImage: 'linear-gradient(90deg, #f4c21f 0 50%, rgb(255 255 255 / 0.92) 50% 100%)',
        backgroundSize: '200% 100%',
        backgroundPosition: `${100 - pct}% 0`,
        transition: 'background-position 260ms linear',
      }}
    >
      {text}
    </span>
  );
}

/** Hitung mundur 3 titik saat jeda instrumental / sebelum baris pertama. */
function GapCountdown({ from, to }: { from: number; to: number }) {
  const p = usePlayer((s) => clamp01((s.positionMs - from) / Math.max(1, to - from)));
  return (
    <span className="inline-flex items-center gap-4" aria-hidden>
      {[0, 1, 2].map((i) => {
        const lit = p >= (i + 1) / 4;
        return (
          <span
            key={i}
            className={cx('size-4 rounded-full border-2 transition-all duration-300 sm:size-5', lit ? 'scale-110 border-rave-mustard bg-rave-mustard shadow-[0_0_18px_rgb(244_194_31/0.6)]' : 'border-white/40 bg-transparent')}
          />
        );
      })}
    </span>
  );
}

function KaraokeStage({ lines, active, onExit, title, subtitle, image }: { lines: Line[]; active: number; onExit: () => void; title: string; subtitle: string; image: string | null }) {
  const d = useDict('fan');
  const playing = usePlayer((s) => s.playing);
  const duration = usePlayer((s) => s.durationMs);
  const seek = usePlayer((s) => s.seek);
  const reduce = useReducedMotion();

  const cur = active >= 0 ? lines[active] : undefined;
  const nextIdx = active + 1;
  const next = lines[nextIdx];
  const start = cur?.time_ms ?? 0;
  const end = next?.time_ms ?? (duration > start ? duration : start + 4000);
  // Jeda: sebelum baris pertama, atau baris aktif kosong (♪) dengan baris berikut > 3 dtk lagi.
  const gap = !cur || !cur.text.trim();
  const gapLong = gap && next && next.time_ms - start > 3000;

  // Layar penuh: overlay menutupi seluruh aplikasi + Fullscreen API browser (bila didukung; iOS cukup overlay).
  // Keluar dari fullscreen native (Esc/gestur) juga menutup karaoke; keluar karaoke juga keluar dari fullscreen native.
  useEffect(() => {
    // requestFullscreen dipanggil di handler klik tombol Karaoke (butuh gestur pengguna); di sini cukup memantau keluarnya.
    let entered = !!document.fullscreenElement;
    const onChange = () => {
      if (document.fullscreenElement) entered = true;
      else if (entered) onExit();
    };
    document.addEventListener('fullscreenchange', onChange);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.body.style.overflow = prevOverflow;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [onExit]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={d.lyrics.karaoke} className="fixed inset-0 z-[200] isolate flex h-dvh flex-col overflow-hidden bg-[#120b16] text-white">
      {/* Latar panggung */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_40rem_at_50%_40%,rgb(91_42_110/0.55),transparent_70%),linear-gradient(180deg,#1d0f24,#0e0c0f)]" />
      <DotField size={12} opacity={0.14} mask="radial-gradient(ellipse 80% 70% at 50% 45%, #000 0%, transparent 80%)" className="-z-10" />
      <Vinyl
        shadow={false}
        className="absolute top-1/2 left-1/2 -z-10 w-[min(62vw,460px)] -translate-x-1/2 -translate-y-1/2 opacity-[0.18]"
        discClassName={cx('animate-[rave-spin_6s_linear_infinite] motion-reduce:animate-none', !playing && '[animation-play-state:paused]')}
      />
      <OrbitField playing={playing} still={!!reduce} className="absolute top-1/2 left-1/2 -z-10 w-[max(150vw,1100px)] -translate-x-1/2 -translate-y-1/2 sm:w-[min(140vw,1400px)]" />
      {/* Vinyet: tepi panggung menggelap agar lirik tetap paling menonjol. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_75%_65%_at_50%_50%,transparent_40%,rgb(14_12_15/0.85)_100%)]" />
      {/* Denyut cincin titik setiap ganti baris */}
      {!reduce && (
        <div aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 -z-10 w-[min(90vw,620px)] -translate-x-1/2 -translate-y-1/2">
          <AnimatePresence>
            <motion.svg
              key={active}
              viewBox="0 0 200 200"
              className="absolute inset-0 w-full"
              initial={{ scale: 0.55, opacity: 0.9 }}
              animate={{ scale: 1.35, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
            >
              <circle cx="100" cy="100" r="96" fill="none" stroke="#f4c21f" strokeWidth="1.6" strokeDasharray="0.1 6" strokeLinecap="round" />
            </motion.svg>
          </AnimatePresence>
          <div className="aspect-square w-full" />
        </div>
      )}

      {/* Kepala panggung */}
      <header className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] md:px-10 md:pt-8">
        {/* Lagu yang sedang dinyanyikan */}
        <div className="flex min-w-0 items-center gap-3">
          {image ? (
            <img src={image} alt="" className="size-10 shrink-0 object-cover ring-1 ring-white/15 sm:size-11" />
          ) : (
            <span className="grid size-10 shrink-0 place-items-center bg-rave-purple ring-1 ring-white/15 sm:size-11">
              <Mic2 className="size-5" />
            </span>
          )}
          <div className="hidden min-w-0 sm:block">
            <p className="truncate text-sm font-bold">{title}</p>
            <p className="truncate text-xs text-white/60">{subtitle}</p>
          </div>
        </div>
        <KaraokeBrand label={d.lyrics.karaokeTitle} />
        <div className="flex justify-end">
          <button
            onClick={onExit}
            title={d.lyrics.exitKaraoke}
            className="inline-flex h-10 shrink-0 items-center gap-2 border border-white/20 bg-black/30 px-3 text-sm font-bold backdrop-blur transition hover:bg-white hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rave-mustard"
          >
            <X className="size-4" /> <span className="hidden sm:inline">{d.lyrics.exitKaraoke}</span>
          </button>
        </div>
      </header>

      {/* Baris */}
      <div className="relative flex flex-1 flex-col items-center justify-center px-5 py-10 text-center md:px-16" aria-live="polite">
        <AnimatePresence mode="popLayout" initial={false}>
          {active > 0 && lines[active - 1]?.text && (
            <motion.p
              key={`p${active - 1}`}
              initial={reduce ? false : { opacity: 0, y: 20 }}
              animate={{ opacity: 0.35, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -24 }}
              transition={{ duration: 0.35 }}
              className="mb-6 max-w-4xl text-lg font-bold text-white/70 sm:text-2xl"
            >
              {lines[active - 1]!.text}
            </motion.p>
          )}
          <motion.div
            key={`c${active}`}
            initial={reduce ? false : { opacity: 0, y: 36, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: -30, scale: 0.98 }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-5xl"
          >
            {gap ? (
              <div className="flex flex-col items-center gap-5 py-4">
                {gapLong ? <GapCountdown from={start} to={next!.time_ms} /> : <span className="font-display text-6xl text-rave-mustard">♪</span>}
                <span className="font-label text-[11px] font-bold tracking-[0.2em] text-white/50 uppercase">{active < 0 ? d.lyrics.getReady : d.lyrics.instrumental}</span>
              </div>
            ) : (
              <p className="text-[clamp(2rem,6.5vw,4.75rem)] leading-[1.08] font-black tracking-tight text-balance drop-shadow-[0_4px_30px_rgb(0_0_0/0.5)]">
                <SweepLine text={cur!.text} start={start} end={end} />
              </p>
            )}
          </motion.div>
          {next?.text && (
            <motion.button
              key={`n${nextIdx}`}
              type="button"
              onClick={() => seek(next.time_ms)}
              initial={reduce ? false : { opacity: 0, y: 24 }}
              animate={{ opacity: 0.5, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -20 }}
              transition={{ duration: 0.35, delay: 0.05 }}
              className="mt-8 max-w-4xl text-xl font-extrabold text-white/80 transition hover:!opacity-90 sm:text-3xl"
            >
              {next.text}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Equalizer + garis gelombang titik + kontrol (player bar tertutup overlay) */}
      <div className="relative px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:px-10">
        <DotWave className="absolute inset-x-0 top-0 h-16 w-full opacity-60" />
        <Equalizer on={playing && !reduce} className="mx-auto h-12 max-w-3xl sm:h-16" />
        <KaraokeControls />
      </div>
    </div>,
    document.body,
  );
}

/** Kontrol ringkas di panggung karaoke: mundur/putar/maju + bilah waktu yang bisa diklik. */
function KaraokeControls() {
  const d = useDict('fan');
  const playing = usePlayer((s) => s.playing);
  const toggle = usePlayer((s) => s.toggle);
  const prev = usePlayer((s) => s.prev);
  const next = usePlayer((s) => s.next);
  const seek = usePlayer((s) => s.seek);
  const pos = usePlayer((s) => Math.floor(s.positionMs / 1000) * 1000);
  const dur = usePlayer((s) => s.durationMs);
  const pct = dur > 0 ? clamp01(pos / dur) * 100 : 0;
  const btn = 'grid size-10 place-items-center text-white/80 transition hover:text-rave-mustard';
  return (
    <div className="mx-auto mt-4 flex max-w-3xl items-center gap-3 sm:gap-4">
      <button onClick={prev} className={btn} aria-label={d.lyrics.prev}>
        <SkipBack className="size-5" />
      </button>
      <button
        onClick={toggle}
        aria-label={playing ? d.lyrics.pause : d.lyrics.play}
        className="grid size-12 shrink-0 place-items-center border-2 border-rave-ink bg-rave-mustard text-rave-ink shadow-[3px_3px_0_#0b0a0c] transition active:translate-y-0.5 active:shadow-[1px_1px_0_#0b0a0c]"
      >
        {playing ? <Pause className="size-5" /> : <Play className="size-5 translate-x-px" />}
      </button>
      <button onClick={next} className={btn} aria-label={d.lyrics.next}>
        <SkipForward className="size-5" />
      </button>
      <span className="w-10 text-right font-label text-[11px] text-white/60 tabular-nums">{fmt.duration(pos)}</span>
      <button
        type="button"
        aria-label={d.lyrics.seek}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (dur > 0) seek(clamp01((e.clientX - r.left) / r.width) * dur);
        }}
        className="group relative h-6 flex-1"
      >
        <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 bg-white/15" />
        <span className="absolute top-1/2 left-0 h-1 -translate-y-1/2 bg-rave-mustard transition-[width] duration-500 ease-linear" style={{ width: `${pct}%` }} />
        <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 bg-white opacity-0 transition group-hover:opacity-100" style={{ left: `${pct}%` }} />
      </button>
      <span className="w-10 font-label text-[11px] text-white/60 tabular-nums">{fmt.duration(dur)}</span>
    </div>
  );
}

// ---------------------------------------------------------------- Halaman

export default function Lyrics() {
  const current = usePlayer((s) => s.current);
  const seek = usePlayer((s) => s.seek);
  const playing = usePlayer((s) => s.playing);
  const [karaoke, setKaraoke] = useState(false);
  const [follow, setFollow] = useState(true);
  const d = useDict('fan');
  const isTrack = current?.kind === 'track';
  const q = useQuery({
    queryKey: ['lyrics', current?.id],
    queryFn: () => api<LyricsT>(`/v1/catalog/tracks/${current!.id}/lyrics`),
    enabled: isTrack,
    retry: false,
  });
  const lines = q.data?.lines ?? [];
  const synced = !!q.data?.synced;
  // Berlangganan indeks turunan (primitif), bukan positionMs → render ulang hanya saat baris berganti.
  const active = usePlayer((s) => activeLine(lines, synced, s.positionMs));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-scroll ke baris aktif, kecuali pengguna sedang menggulir sendiri (dilanjutkan otomatis setelah jeda).
  useEffect(() => {
    if (karaoke || !follow) return;
    refs.current[active]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active, follow, karaoke]);
  useEffect(() => {
    if (karaoke || !synced) return;
    const pause = () => {
      setFollow(false);
      if (pauseTimer.current) clearTimeout(pauseTimer.current);
      pauseTimer.current = setTimeout(() => setFollow(true), FOLLOW_PAUSE_MS);
    };
    window.addEventListener('wheel', pause, { passive: true });
    window.addEventListener('touchmove', pause, { passive: true });
    return () => {
      window.removeEventListener('wheel', pause);
      window.removeEventListener('touchmove', pause);
      if (pauseTimer.current) clearTimeout(pauseTimer.current);
    };
  }, [karaoke, synced]);
  // Esc keluar dari karaoke.
  useEffect(() => {
    if (!karaoke) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setKaraoke(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [karaoke]);
  // Lagu berganti tanpa lirik tersinkron → keluar karaoke.
  useEffect(() => {
    if (karaoke && q.data && !q.data.synced) setKaraoke(false);
  }, [karaoke, q.data]);

  const exitKaraoke = useCallback(() => setKaraoke(false), []);
  const color = colorFor(current?.id);
  if (!current)
    return (
      <div className="relative overflow-hidden pt-24">
        <DotField mask="radial-gradient(ellipse 60% 60% at 50% 30%, #000, transparent 75%)" />
        <EmptyState icon={<Mic2 className="size-12" />} title={d.lyrics.playToSee} action={<Link to="/app" className="rounded-none bg-white px-6 py-2.5 text-sm font-bold text-black">{d.lyrics.goHome}</Link>} />
      </div>
    );

  async function shareLine(text: string) {
    const card = d.lyrics.shareCard(text, current!.title, current!.subtitle);
    try {
      await navigator.clipboard.writeText(card);
      toast.success(d.lyrics.copied);
    } catch {
      toast.info(card);
    }
  }

  if (karaoke && synced && lines.length)
    return <KaraokeStage lines={lines} active={active} onExit={exitKaraoke} title={current.title} subtitle={current.subtitle} image={current.image_url} />;

  return (
    <div className="relative isolate min-h-full overflow-hidden px-4 pt-24 pb-28 md:px-12">
      {/* Latar: warna lagu → gelap, raster titik tipis, cincin putus-putus, piringan RAVE */}
      <div aria-hidden className="absolute inset-0 -z-10" style={{ background: `linear-gradient(165deg, ${color} 0%, color-mix(in srgb, ${color} 55%, #120b16) 45%, #120b16 100%)` }} />
      <DotField />
      <DotField size={10} opacity={0.1} mask="radial-gradient(ellipse 50% 40% at 0% 100%, #000, transparent 70%)" />
      <div aria-hidden className="pointer-events-none fixed top-28 -right-40 -z-10 hidden w-[560px] md:block">
        <Vinyl shadow={false} className="w-full opacity-30" discClassName={cx('animate-[rave-spin_10s_linear_infinite] motion-reduce:animate-none', !playing && '[animation-play-state:paused]')} />
        <DottedRings spin={playing} className="absolute -inset-16 text-white" />
      </div>

      {/* Kepala */}
      <header className="mb-10 flex flex-wrap items-end justify-between gap-5">
        <div className="flex min-w-0 flex-1 basis-72 items-center gap-4">
          {current.image_url ? (
            <img src={current.image_url} alt="" className="size-16 shrink-0 object-cover shadow-[4px_4px_0_#f4c21f] md:size-20" />
          ) : (
            <span className="grid size-16 shrink-0 place-items-center bg-rave-purple shadow-[4px_4px_0_#f4c21f] md:size-20"><Mic2 className="size-7" /></span>
          )}
          <div className="min-w-0 flex-1">
            <span className="inline-block rotate-[-3deg] border-2 border-rave-ink bg-rave-mustard px-2 pt-0.5 font-display text-sm leading-tight text-rave-ink uppercase shadow-[2px_2px_0_#0b0a0c]">
              {d.shared.lyrics}
            </span>
            <p className="mt-2 truncate text-2xl font-black tracking-tight md:text-3xl">{current.title}</p>
            <p className="truncate text-sm font-semibold text-white/70">{current.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {q.data && (
            <span className="hidden items-center gap-1.5 border border-white/20 bg-black/20 px-2.5 py-1.5 font-label text-[10.5px] font-bold tracking-[0.14em] text-white/75 uppercase sm:inline-flex">
              <span className={cx('size-1.5 rounded-full', synced ? 'bg-rave-mustard' : 'bg-white/50')} />
              {synced ? d.lyrics.synced : d.lyrics.unsynced}
            </span>
          )}
          {synced && (
            <button
              onClick={() => {
                setKaraoke(true);
                const root = document.documentElement;
                if (root.requestFullscreen && !document.fullscreenElement) void root.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
              }}
              className="group inline-flex h-11 items-center gap-2 border-2 border-rave-ink bg-rave-mustard px-4 text-sm font-black text-rave-ink shadow-[3px_3px_0_#0b0a0c] transition hover:-translate-y-0.5 hover:shadow-[4px_5px_0_#0b0a0c] active:translate-y-0 active:shadow-[1px_1px_0_#0b0a0c]"
            >
              <Mic2 className="size-4 transition group-hover:rotate-[-12deg]" /> {d.lyrics.karaoke}
            </button>
          )}
        </div>
      </header>

      {!isTrack ? (
        <p className="text-2xl font-bold text-white/60">{d.lyrics.notForEpisodes}</p>
      ) : q.isLoading ? (
        <div className="max-w-3xl space-y-5" aria-busy>
          {[80, 60, 72, 50, 66].map((w, i) => (
            <div key={i} className="h-8 animate-pulse bg-white/10 md:h-10" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : q.isError || !lines.length ? (
        <div className="max-w-xl border border-dashed border-white/25 bg-black/20 p-8">
          <Mic2 className="size-8 text-rave-mustard" />
          <p className="mt-4 text-2xl font-bold">{d.shared.lyricsUnavailable}</p>
          <DotWave className="mt-6 h-10 w-full" />
        </div>
      ) : (
        <ol className="relative max-w-4xl space-y-2 md:space-y-3">
          {lines.map((l, i) => {
            const done = synced && i < active;
            const on = i === active;
            return (
              <li key={i} className="group relative flex items-start gap-3">
                {/* Penanda baris aktif: bilah mustard + titik */}
                <span aria-hidden className={cx('absolute top-1/2 -left-4 h-[70%] w-1 -translate-y-1/2 bg-rave-mustard transition-all duration-300 md:-left-6', on ? 'scale-y-100 opacity-100' : 'scale-y-0 opacity-0')} />
                <button
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  onClick={() => synced && seek(l.time_ms)}
                  aria-current={on ? 'true' : undefined}
                  className={cx(
                    'origin-left py-1 text-left text-2xl leading-snug font-extrabold tracking-tight transition-all duration-300 md:text-4xl',
                    !synced ? 'cursor-text text-white' : on ? 'scale-[1.02] text-white drop-shadow-[0_2px_20px_rgb(244_194_31/0.25)]' : done ? 'text-white/45 hover:text-white/80' : 'text-white/30 hover:text-white/80',
                  )}
                >
                  {l.text || <span className={cx(on ? 'text-rave-mustard' : 'text-white/30')}>♪ ♪ ♪</span>}
                </button>
                {l.text && (
                  <button onClick={() => shareLine(l.text)} aria-label={d.lyrics.shareLine} className="mt-2.5 shrink-0 p-1 text-white/70 opacity-0 transition group-hover:opacity-100 hover:text-rave-mustard focus-visible:opacity-100 md:mt-3.5">
                    <Share2 className="size-5" />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <p className="mt-16 text-xs text-white/45">{d.lyrics.license}</p>

      {/* Kembali mengikuti baris aktif setelah menggulir manual */}
      <AnimatePresence>
        {synced && !follow && active >= 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="pointer-events-none sticky bottom-6 z-30 mt-6 flex justify-center"
          >
            <button
              onClick={() => {
                setFollow(true);
                refs.current[active]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              }}
              className="pointer-events-auto inline-flex h-10 items-center gap-2 border-2 border-rave-ink bg-white px-4 text-sm font-bold text-black shadow-[3px_3px_0_#f4c21f] transition hover:-translate-y-0.5"
            >
              <LocateFixed className="size-4" /> {d.lyrics.followLyrics}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
