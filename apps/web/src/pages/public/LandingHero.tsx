import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { ArrowRight, Headphones, Radio } from 'lucide-react';
import Aurora from '@/components/reactbits/Aurora';
import { api, fmt } from '@/lib/api';
import type { LiveStream } from '@/lib/types';
import { cx } from '@/components/ui';
import { BRAND_GRADIENT } from './marketing';
// Foto: Unsplash (lisensi bebas pakai) — disimpan lokal agar landing tidak bergantung pada CDN luar.
import performer from '@/assets/landing/hero-performer.webp';
import stage from '@/assets/landing/hero-stage.webp';


const DESTINATIONS = ['panggung.', 'kotamu.', 'kampusmu.', 'festival.'];

/** Kata dinamis judul: keluar lalu masuk dengan blur-geser; diam bila pengguna memilih gerak dikurangi. */
function RotatingWord() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setI((n) => (n + 1) % DESTINATIONS.length), 2400);
    return () => clearInterval(t);
  }, [reduce]);
  return (
    <span className="relative inline-grid align-baseline">
      {/* Penahan lebar: kata terpanjang agar baris tidak melompat. */}
      <span className="invisible col-start-1 row-start-1" aria-hidden>
        kampusmu.
      </span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={DESTINATIONS[i]}
          className={cx('col-start-1 row-start-1 bg-clip-text pb-2 text-transparent', BRAND_GRADIENT)}
          initial={{ y: '40%', opacity: 0, filter: 'blur(6px)' }}
          animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          exit={{ y: '-40%', opacity: 0, filter: 'blur(6px)' }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          {DESTINATIONS[i]}
        </motion.span>
      </AnimatePresence>
      <span className="sr-only">panggung, kotamu, kampusmu, dan festival</span>
    </span>
  );
}

function Equalizer() {
  const reduce = useReducedMotion();
  return (
    <span className="flex h-4 items-end gap-[3px]" aria-hidden>
      {[0.5, 1, 0.7, 0.9].map((h, k) => (
        <motion.span
          key={k}
          className="w-[3px] rounded-full bg-gema-primary"
          style={{ height: `${h * 100}%` }}
          animate={reduce ? undefined : { scaleY: [0.35, 1, 0.55, 0.9, 0.35] }}
          transition={{ duration: 1.1 + k * 0.15, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </span>
  );
}

function FloatCard({ className, delay = 0, drift = 8, children }: { className?: string; delay?: number; drift?: number; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={cx('absolute z-20 rounded-2xl border border-white/15 bg-black/55 p-3 shadow-2xl shadow-black/50 backdrop-blur-xl', className)}
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={reduce ? { opacity: 1, y: 0, scale: 1 } : { opacity: 1, y: [0, -drift, 0], scale: 1 }}
      transition={{
        opacity: { duration: 0.6, delay },
        scale: { duration: 0.6, delay },
        y: reduce ? { duration: 0.6, delay } : { duration: 6, delay, repeat: Infinity, ease: 'easeInOut' },
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Visual hero: foto utama + satu foto pendamping, dua kartu — siaran yang sedang live (data nyata) dan pemutar
 * lossless. Sedikit miring mengikuti kursor di desktop.
 */
function HeroVisual() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [5, -5]), { stiffness: 120, damping: 20 });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-6, 6]), { stiffness: 120, damping: 20 });

  const live = useQuery({
    queryKey: ['live-streams', 'live', 'hero'],
    queryFn: () => api<{ data: LiveStream[] }>('/v1/live/streams', { query: { status: 'live', limit: 1 } }),
    refetchInterval: 30_000,
    retry: false,
  });
  const onAir = live.data?.data?.[0] ?? null;

  return (
    <div
      ref={ref}
      className="relative mx-auto aspect-[4/5] w-full max-w-[480px] [perspective:1200px]"
      onPointerMove={(e) => {
        if (reduce || e.pointerType !== 'mouse') return;
        const r = ref.current!.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width - 0.5);
        my.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onPointerLeave={() => (mx.set(0), my.set(0))}
    >
      <div className="absolute -inset-10 -z-10 rounded-full bg-[radial-gradient(closest-side,rgba(236,72,153,0.32),rgba(124,58,237,0.16),transparent)] blur-2xl" aria-hidden />

      <motion.div style={{ rotateX: rx, rotateY: ry }} className="relative size-full [transform-style:preserve-3d]">
        <motion.div
          className="absolute inset-y-0 right-0 left-[10%] overflow-hidden rounded-[32px] ring-1 ring-white/15"
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        >
          <img src={performer} alt="Penampil di atas panggung bermandikan cahaya dan asap" className="size-full object-cover" fetchPriority="high" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/10" />
        </motion.div>

        <motion.img
          src={stage}
          alt="Vokalis tampil di panggung bercahaya neon"
          className="absolute bottom-[8%] -left-[2%] z-10 aspect-square w-[36%] rounded-3xl object-cover shadow-2xl shadow-black/60 ring-4 ring-black"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.25 }}
          loading="lazy"
        />

        <FloatCard className="top-[5%] right-[5%]" delay={0.5} drift={6}>
          {onAir ? (
            <Link to={`/app/live/${onAir.id}`} className="flex items-center gap-3 pr-1">
              <span className="relative grid size-9 place-items-center rounded-full bg-red-600">
                <Radio className="size-4 text-white" />
                <span className="absolute inset-0 animate-ping rounded-full bg-red-600/50" />
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] font-bold tracking-wider text-red-400 uppercase">Live · {fmt.compact(Math.max(onAir.viewers, 1))} menonton</span>
                <span className="block max-w-[11rem] truncate text-sm font-bold text-white">{onAir.artist?.name ?? onAir.org.name}</span>
              </span>
            </Link>
          ) : (
            <span className="flex items-center gap-3 pr-1">
              <span className="grid size-9 place-items-center rounded-full bg-white/10">
                <Radio className="size-4 text-white" />
              </span>
              <span>
                <span className="block text-[11px] font-bold tracking-wider text-white/60 uppercase">Live streaming</span>
                <span className="block text-sm font-bold text-white">Sesi studio & konser</span>
              </span>
            </span>
          )}
        </FloatCard>

        <FloatCard className="right-[4%] bottom-[30%] w-[58%] sm:right-[-4%] sm:w-[54%]" delay={0.75} drift={10}>
          <div className="flex items-center gap-3">
            <img src={stage} alt="" className="size-11 rounded-lg object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-white">Hujan di Dago</p>
              <p className="truncate text-xs text-white/60">Senja Kolektif</p>
            </div>
            <Equalizer />
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/15">
            <motion.div
              className={cx('h-full rounded-full', BRAND_GRADIENT)}
              initial={{ width: '18%' }}
              animate={reduce ? undefined : { width: ['18%', '72%'] }}
              transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
            />
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-white/60">
            <Headphones className="size-3.5" /> Lossless FLAC · gratis
          </p>
        </FloatCard>
      </motion.div>
    </div>
  );
}

export function Hero() {
  const reduce = useReducedMotion();
  const fade = (delay: number) => ({
    initial: { opacity: 0, y: reduce ? 0 : 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <section className="relative isolate overflow-hidden bg-black">
      <div className="absolute inset-0 -z-10 opacity-55" aria-hidden>
        <Aurora colorStops={['#662d91', '#da1c5c', '#f6851f']} amplitude={1} blend={0.6} speed={0.5} />
      </div>
      <div
        className="absolute inset-0 -z-10 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
        aria-hidden
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-black/30 via-black/50 to-black" aria-hidden />

      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-12 pb-20 md:pt-16 xl:grid-cols-[1.1fr_1fr] xl:gap-12 xl:pt-20 xl:pb-28">
        <div>
          <motion.div {...fade(0)}>
            <Link
              to="/app/live"
              className="group inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 py-1.5 pr-3 pl-1.5 text-sm text-white/80 backdrop-blur transition hover:border-white/30 hover:bg-white/10"
            >
              <span className={cx('rounded-full px-2 py-0.5 text-xs font-bold text-white', BRAND_GRADIENT)}>Baru</span>
              Live streaming konser
              <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </Link>
          </motion.div>

          <motion.h1 {...fade(0.08)} className="mt-6 text-[2.75rem] leading-[1.04] font-black tracking-tight text-white sm:text-6xl xl:text-[4.25rem]">
            Musik indie,
            <br />
            dari playlist ke
            <br />
            <RotatingWord />
          </motion.h1>

          <motion.p {...fade(0.16)} className="mt-6 max-w-lg text-lg leading-relaxed text-white/70">
            Dengarkan gratis dalam kualitas lossless, temukan musisi independen Indonesia, lalu saksikan mereka di panggung kotamu.
          </motion.p>

          <motion.div {...fade(0.24)} className="mt-9 flex flex-wrap gap-3">
            <Link
              to="/app"
              className="group inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 font-bold text-black shadow-[0_0_40px_-8px_rgba(236,72,153,0.7)] transition hover:scale-[1.03]"
            >
              Mulai mendengarkan
              <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </Link>
            <a href="#ekosistem" className="inline-flex items-center rounded-full border border-white/25 px-7 py-3.5 font-bold text-white transition hover:border-white/60 hover:bg-white/5">
              Untuk artis & promotor
            </a>
          </motion.div>
        </div>

        <HeroVisual />
      </div>
    </section>
  );
}
