import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { ArrowRight, Headphones, Radio } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { LiveStream } from '@/lib/types';
import { cx } from '@/components/ui';
import { Vinyl } from './Vinyl';
import { useLanding, usePartners, usePick } from '@/lib/landing';
import { useDict } from '@/lib/i18n';
// Foto: Unsplash (lisensi bebas pakai) — disimpan lokal agar landing tidak bergantung pada CDN luar.
// Unsplash License — konser Jakarta oleh Kusuma (@iindahe); panggung pub Jakarta oleh Michael Effendy.
import gigJakarta from '@/assets/landing/gig-jakarta.webp';
import gigPub from '@/assets/landing/gig-jakarta-pub.webp';
import halftone from '@/assets/brand/paper-halftone.webp';
import folded from '@/assets/brand/hero-poster-folded.webp';



/** Kata dinamis judul: keluar lalu masuk dengan blur-geser; diam bila pengguna memilih gerak dikurangi. */
function RotatingWord({ words }: { words: string[] }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const n = words.length;
  useEffect(() => {
    if (reduce || n < 2) return;
    const t = setInterval(() => setI((k) => (k + 1) % n), 2400);
    return () => clearInterval(t);
  }, [reduce, n]);
  const word = words[i % n] ?? '';
  // Penahan lebar: kata terpanjang (dari CMS) agar baris tidak melompat.
  const longest = words.reduce((a, b) => (b.length > a.length ? b : a), '');
  return (
    <span className="relative inline-grid align-baseline">
      <span className="invisible col-start-1 row-start-1" aria-hidden>
        {longest}
      </span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={word}
          className="col-start-1 row-start-1 text-rave-primary-text"
          initial={{ y: '40%', opacity: 0, filter: 'blur(6px)' }}
          animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          exit={{ y: '-40%', opacity: 0, filter: 'blur(6px)' }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden
        >
          {word}
        </motion.span>
      </AnimatePresence>
      <span className="sr-only">{words.join(', ')}</span>
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
          className="w-[3px] rounded-full bg-rave-primary"
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
      className={cx('absolute z-20 rounded-none border-2 border-rave-ink bg-[#1e1c1f] p-3 shadow-[5px_5px_0_#0b0a0c]', className)}
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
  const d = useDict('public').heroVisual;
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
      {/*
       * Vinyl di samping visual (seperti rave-website .groove): ditambatkan ke kolom visual, bukan tepi layar,
       * jadi selalu menyembul di kanan foto dan tidak pernah menimpa judul di layar laptop.
       */}
      <Vinyl
        className="absolute top-1/2 left-[34%] -z-10 w-[165%] -translate-y-1/2"
        discClassName="animate-[rave-spin_9s_linear_infinite] motion-reduce:animate-none"
      />
      <div className="absolute -inset-10 -z-10 rounded-none bg-[radial-gradient(closest-side,rgba(138,47,63,0.32),rgba(91,42,110,0.16),transparent)] blur-2xl" aria-hidden />

      <motion.div style={{ rotateX: rx, rotateY: ry }} className="relative size-full [transform-style:preserve-3d]">
        <motion.div
          className="absolute inset-y-0 right-0 left-[10%] overflow-hidden rounded-none border-[5px] border-rave-paper shadow-[10px_10px_0_#F4C21F] [rotate:1.5deg]"
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Konser di Jakarta, dicetak ala flyer fotokopi: hitam-putih kontras + lipatan poster + halftone. */}
          <img src={gigJakarta} alt={d.mainAlt} className="size-full object-cover grayscale contrast-[1.25] brightness-[1.05]" fetchPriority="high" />
          <span className="absolute inset-0 bg-cover bg-center opacity-80 mix-blend-overlay" style={{ backgroundImage: `url(${folded})` }} aria-hidden />
          <span className="absolute inset-0 bg-cover bg-center opacity-30 mix-blend-multiply" style={{ backgroundImage: `url(${halftone})` }} aria-hidden />
          <span className="absolute inset-0 bg-rave-purple opacity-25 mix-blend-color" aria-hidden />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />
          <span className="rave-stamp absolute right-4 bottom-4 bg-rave-ink/60 text-rave-paper [--stamp-r:-3deg]">Live · Jakarta</span>
        </motion.div>
        {/* Selotip penahan foto */}
        <span className="pointer-events-none absolute -top-3 left-[22%] z-20 h-7 w-28 -rotate-[8deg] bg-rave-paper/75 shadow-[0_1px_2px_rgba(0,0,0,0.4)] [clip-path:polygon(0_10%,8%_0,18%_12%,30%_2%,44%_10%,58%_0,72%_9%,86%_1%,100%_10%,97%_55%,100%_92%,86%_100%,70%_91%,54%_100%,38%_92%,22%_100%,8%_92%,0_100%,3%_50%)]" aria-hidden />
        <span className="pointer-events-none absolute -top-2 right-[6%] z-20 h-7 w-24 rotate-[10deg] bg-rave-paper/75 shadow-[0_1px_2px_rgba(0,0,0,0.4)] [clip-path:polygon(0_10%,8%_0,18%_12%,30%_2%,44%_10%,58%_0,72%_9%,86%_1%,100%_10%,97%_55%,100%_92%,86%_100%,70%_91%,54%_100%,38%_92%,22%_100%,8%_92%,0_100%,3%_50%)]" aria-hidden />

        <motion.img
          src={gigPub}
          alt={d.pubAlt}
          className="absolute bottom-[8%] -left-[2%] z-10 aspect-square w-[36%] rounded-none border-[5px] border-b-[22px] border-rave-paper object-cover grayscale contrast-[1.2] shadow-[6px_6px_0_#0b0a0c] [rotate:-6deg]"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.25 }}
          loading="lazy"
        />

        <FloatCard className="top-[5%] right-[5%] !bg-rave-paper !text-rave-ink" delay={0.5} drift={6}>
          {onAir ? (
            <Link to={`/app/live/${onAir.id}`} className="flex items-center gap-3 pr-1">
              <span className="relative grid size-9 place-items-center border-2 border-rave-ink bg-red-600">
                <Radio className="size-4 text-white" />
                <span className="absolute -top-1 -right-1 size-2.5 animate-ping rounded-full bg-red-600" />
              </span>
              <span className="min-w-0">
                <span className="block font-label text-[10px] font-bold tracking-[0.1em] text-red-700 uppercase">{d.liveWatching(fmt.compact(Math.max(onAir.viewers, 1)))}</span>
                <span className="block max-w-[11rem] truncate text-sm font-bold text-rave-ink">{onAir.artist?.name ?? onAir.org.name}</span>
              </span>
            </Link>
          ) : (
            <span className="flex items-center gap-3 pr-1">
              <span className="grid size-9 place-items-center border-2 border-rave-ink bg-rave-purple">
                <Radio className="size-4 text-white" />
              </span>
              <span>
                <span className="block font-label text-[10px] font-bold tracking-[0.1em] text-rave-purple uppercase">{d.liveStreaming}</span>
                <span className="block text-sm font-bold text-rave-ink">{d.studioSessions}</span>
              </span>
            </span>
          )}
        </FloatCard>

        <FloatCard className="right-[4%] bottom-[30%] w-[58%] sm:right-[-4%] sm:w-[54%]" delay={0.75} drift={10}>
          <div className="flex items-center gap-3">
            <img src={gigPub} alt="" className="size-11 rounded-none border-2 border-rave-ink object-cover grayscale" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-white">Hujan di Dago</p>
              <p className="truncate text-xs text-white/60">Senja Kolektif</p>
            </div>
            <Equalizer />
          </div>
          <div className="mt-3 h-1.5 overflow-hidden border border-rave-ink bg-white/10">
            <motion.div
              className="h-full rounded-none bg-rave-primary"
              initial={{ width: '18%' }}
              animate={reduce ? undefined : { width: ['18%', '72%'] }}
              transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
            />
          </div>
          <p className="mt-2 flex items-center gap-1.5 font-label text-[10px] font-bold tracking-[0.08em] text-white/60 uppercase">
            <Headphones className="size-3.5" /> {d.losslessFree}
          </p>
        </FloatCard>
      </motion.div>
    </div>
  );
}

/** Tautan CMS: path internal → <Link>, selain itu (#anchor, https://) → <a> (eksternal dibuka di tab baru). */
function SmartLink({ to, className, children }: { to: string; className?: string; children: React.ReactNode }) {
  if (to.startsWith('/')) return <Link to={to} className={className}>{children}</Link>;
  const ext = /^https:/i.test(to);
  return <a href={to} className={className} {...(ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>;
}

export function Hero() {
  const reduce = useReducedMotion();
  const { hero } = useLanding();
  const t = usePick();
  const fade = (delay: number) => ({
    initial: { opacity: 0, y: reduce ? 0 : 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
  });
  const rise = (delay: number) => ({
    initial: { y: reduce ? 0 : '105%' },
    animate: { y: 0 },
    transition: { duration: 1.05, delay, ease: [0.2, 0.7, 0.1, 1] as const },
  });

  return (
    <section className="rave-grain rave-crumple rave-poster relative isolate overflow-hidden bg-[radial-gradient(120%_90%_at_70%_40%,#4a1f5c_0,#2a1233_45%,#181818_100%)]">
      <div className="mx-auto grid max-w-[82.5rem] items-center gap-14 px-4 pt-[7.5rem] pb-28 md:pt-[8.5rem] xl:grid-cols-[1.15fr_1fr] xl:gap-10 xl:pt-[9.5rem] xl:pb-32">
        <div>
          <motion.div {...fade(0)} className="flex flex-wrap items-center gap-4">
            <p className="rave-label rave-eyebrow">{t(hero.kicker)}</p>
            <SmartLink
              to={hero.badge_href}
              className="group inline-flex items-center gap-2 rounded-none border border-white/15 bg-black/30 py-1 pr-3 pl-1 text-sm text-white/80 transition hover:border-rave-primary/60"
            >
              <span className="rounded-none bg-rave-primary px-2 py-0.5 text-[11px] font-bold text-rave-on-primary uppercase">{t(hero.badge)}</span>
              {t(hero.badge_link)}
              <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </SmartLink>
          </motion.div>

          <h1 className="mt-7 text-[3.4rem] leading-[0.9] whitespace-nowrap text-rave-paper sm:text-7xl xl:text-[6.25rem]">
            <span className="block overflow-hidden pb-1">
              <motion.span className="block" {...rise(0.05)}>
                {t(hero.line1)}
              </motion.span>
            </span>
            <span className="block overflow-hidden pb-1">
              <motion.span className="block" {...rise(0.15)}>
                {t(hero.line2)}
              </motion.span>
            </span>
            <span className="block overflow-hidden pb-1">
              <motion.span className="block" {...rise(0.25)}>
                {t(hero.prefix)} <RotatingWord words={hero.words.map(t)} />
              </motion.span>
            </span>
          </h1>

          <motion.p {...fade(0.4)} className="mt-7 max-w-lg text-lg leading-relaxed text-[#cfc4d8]">
            {t(hero.lead)}
          </motion.p>

          <motion.div {...fade(0.5)} className="mt-9 flex flex-wrap gap-3">
            <SmartLink
              to={hero.cta_primary_href}
              className="rave-label group inline-flex items-center gap-3 rounded-none border-[1.5px] border-rave-primary bg-rave-primary px-7 py-4 !text-[12.5px] text-rave-on-primary transition hover:-translate-y-0.5 hover:border-rave-paper hover:bg-rave-paper"
            >
              {t(hero.cta_primary)}
              <ArrowRight className="size-4 transition group-hover:translate-x-1" />
            </SmartLink>
            <SmartLink
              to={hero.cta_secondary_href}
              className="rave-label inline-flex items-center rounded-none border-[1.5px] border-rave-paper/80 px-7 py-4 !text-[12.5px] text-rave-paper transition hover:-translate-y-0.5 hover:bg-rave-paper hover:text-rave-ink"
            >
              {t(hero.cta_secondary)}
            </SmartLink>
          </motion.div>
        </div>

        <HeroVisual />
      </div>

    </section>
  );
}

/**
 * Pita marquee mustard miring (rave-website: .band) — satu-satunya teks berjalan di landing.
 * Isi dari Editor Landing (`content.partners`: logo partner musik, tampil sebagai siluet ink);
 * bila belum ada partner, menampilkan slogan `fallback`. Berhenti saat di-hover; berhenti total bila "kurangi gerakan".
 */
export function RaveBand({ fallback: fallbackProp }: { fallback?: string[] }) {
  const { band } = useLanding();
  const t = usePick();
  const d = useDict('public').band;
  const fallback = fallbackProp ?? band.map(t);
  const partners = usePartners();
  const hasPartners = partners.length > 0;
  type Item = { key: string; name: string; logo?: string; url?: string };
  const base: Item[] = hasPartners ? partners.map((p, i) => ({ key: `p${i}`, name: p.name, logo: p.logo || undefined, url: p.url || undefined })) : fallback.map((w, i) => ({ key: `w${i}`, name: w }));
  // Ulangi sampai cukup panjang untuk mengisi layar lebar, lalu gandakan untuk loop -50% yang mulus.
  const reps = Math.max(1, Math.ceil(10 / base.length));
  const run = Array.from({ length: reps }, () => base).flat();
  const all = [...run, ...run];
  const external = (u?: string) => !!u && /^https?:/i.test(u);

  return (
    <section className="relative z-30 -mx-5 -mt-12 -rotate-[1.2deg]" aria-label={hasPartners ? d.partnersAria : d.spiritAria}>
      {hasPartners && (
        <ul className="sr-only">
          {partners.map((p) => (
            <li key={p.name}>{p.url ? <a href={p.url}>{p.name}</a> : p.name}</li>
          ))}
        </ul>
      )}
      <div className="rave-band relative py-4 md:py-5">
        <div className="items-center font-display text-[clamp(26px,3.6vw,50px)] leading-none uppercase" style={{ animationDuration: `${Math.max(24, run.length * 3.2)}s` }} aria-hidden>
          {all.map((it, i) => {
            const body = it.logo ? (
              <img src={it.logo} alt="" loading="lazy" className="h-[clamp(28px,3.4vw,46px)] w-auto max-w-[12rem] object-contain [filter:brightness(0)] opacity-90" />
            ) : (
              it.name
            );
            return (
              <span key={`${it.key}-${i}`} className="flex shrink-0 items-center gap-12">
                {it.url ? (
                  <a href={it.url} tabIndex={-1} {...(external(it.url) ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="transition hover:opacity-60">
                    {body}
                  </a>
                ) : (
                  body
                )}
                <span className="text-[0.55em] text-rave-ink/70">✺</span>
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}
