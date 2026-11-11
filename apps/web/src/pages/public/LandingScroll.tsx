import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion, useMotionTemplate, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTime, useTransform, type MotionValue } from 'motion/react';
import { ArrowRight, FileSignature, Headphones, Landmark, MapPin } from 'lucide-react';
import CountUp from '@/components/reactbits/CountUp';
import { LOCKUP_RATIO, RaveLockup } from '@/components/ui/RaveLogo';
import { useBranding } from '@/lib/platform';
import { useDict } from '@/lib/i18n';
import { Vinyl } from './Vinyl';
import { cx } from '@/components/ui';
import { BTN_GHOST, BTN_PRIMARY, BTN_PRIMARY_SM, CARD_TITLE, RansomText } from './marketing';
import paper from '@/assets/brand/paper-crumpled.webp';
import halftone from '@/assets/brand/paper-halftone.webp';
import folded from '@/assets/brand/hero-poster-folded.webp';
import gigDiy from '@/assets/landing/gig-diy.webp'; // Unsplash License — Evgeniy Smersh (@igrindphoto)
import stage from '@/assets/landing/hero-stage.webp';
import roleFan from '@/assets/landing/role-fan.webp';
import roleArtist from '@/assets/landing/role-artist.webp';
import rolePromotor from '@/assets/landing/role-promotor.webp';

// Section landing yang digerakkan scroll (bento reveal, spotlight 3D, tumpukan kartu, kolase, gelombang titik).
// Semua animasi hanya memakai transform/opacity/clip-path; "kurangi gerakan" & layar kecil → tata letak statis.

const EASE = [0.22, 1, 0.36, 1] as const;

function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Animasi scroll hanya di desktop & bila pengguna tidak meminta gerak dikurangi. */
export function useScrollFx() {
  const reduce = useReducedMotion();
  const desktop = useMedia('(min-width: 1024px)');
  return desktop && !reduce;
}


// =============================================================================================
// 1. Kenapa RAVE — wordmark ditempel ke sampul piringan, piringan keluar & berputar, kartu fitur menyebar
// =============================================================================================

// Grafis mini kartu fitur — satu kosakata raw punk: blok tajam bergaris tinta, bayangan sablon, stiker, cap, tiket.
const INK_BOX = 'border-2 border-rave-ink shadow-[2px_2px_0_#0b0a0c]';

/** Equalizer sablon: kolom blok tajam mustard/paper/ungu yang memantul. */
function MiniEqualizer() {
  const reduce = useReducedMotion();
  const cols = [0.45, 0.85, 0.6, 1, 0.7, 0.92, 0.5, 0.8, 0.55];
  const tone = ['bg-rave-mustard', 'bg-rave-paper', 'bg-rave-purple'];
  return (
    <div className="flex h-16 items-end justify-center gap-1.5" aria-hidden>
      {cols.map((h, k) => (
        <motion.span
          key={k}
          className={cx('w-3 origin-bottom', INK_BOX, tone[k % 3])}
          style={{ height: `${h * 100}%` }}
          animate={reduce ? undefined : { scaleY: [0.35, 1, 0.55, 0.9, 0.35] }}
          transition={{ duration: 1.1 + (k % 4) * 0.2, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

/** Peta kota: stiker nama kota mengitari paku pines di tengah. */
function MiniOrbit() {
  const reduce = useReducedMotion();
  const cities = [
    { c: 'Bandung', t: 'bg-rave-mustard text-rave-ink' },
    { c: 'Jakarta', t: 'bg-rave-paper text-rave-ink' },
    { c: 'Yogya', t: 'bg-rave-berry text-rave-paper' },
    { c: 'Malang', t: 'bg-rave-purple text-rave-paper' },
  ];
  return (
    <div className="relative mx-auto size-32" aria-hidden>
      <span className="absolute inset-4 border-2 border-dashed border-white/15" />
      <span className="absolute inset-10 rotate-45 border-2 border-dashed border-white/10" />
      <span className={cx('absolute inset-[43%] rotate-45 bg-rave-mustard', INK_BOX)} />
      <motion.div className="absolute inset-0" animate={reduce ? undefined : { rotate: 360 }} transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}>
        {cities.map(({ c, t }, i) => {
          const a = (i / cities.length) * Math.PI * 2;
          return (
            <span
              key={c}
              className={cx('absolute -translate-x-1/2 -translate-y-1/2 px-1.5 py-0.5 font-label text-[9px] font-bold whitespace-nowrap uppercase', INK_BOX, t)}
              style={{ left: `${50 + Math.cos(a) * 44}%`, top: `${50 + Math.sin(a) * 44}%`, rotate: `${(i % 2 ? 6 : -6)}deg` }}
            >
              {c}
            </span>
          );
        })}
      </motion.div>
    </div>
  );
}

/** Alur escrow: sobekan tiket berurutan, langkah akhir dicap mustard. */
function MiniEscrow() {
  const d = useDict('public').why;
  const steps = d.escrowSteps;
  return (
    <div className="flex items-center justify-center gap-1.5" aria-hidden>
      {steps.map((s, i) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className={cx('bg-rave-paper px-2 py-1 font-label text-[9px] font-bold text-rave-ink uppercase [clip-path:polygon(0_0,100%_0,100%_35%,92%_50%,100%_65%,100%_100%,0_100%,0_65%,8%_50%,0_35%)]', i % 2 ? 'rotate-[2deg]' : '-rotate-[2deg]')}>{s}</span>
          <span className="font-label text-[10px] text-rave-primary-text">→</span>
        </span>
      ))}
      <span className="rave-stamp -rotate-6 !border-2 !border-solid border-rave-primary bg-rave-primary/10 !px-2 !py-1 text-rave-primary-text !opacity-100">{d.escrowPaid}</span>
    </div>
  );
}

/** OTP: tuts mesin ketik; dua digit terakhir menunggu (kursor berkedip). */
function MiniOtp() {
  const reduce = useReducedMotion();
  return (
    <div className="flex justify-center gap-1.5" aria-hidden>
      {'482913'.split('').map((d, i) => (
        <span key={i} className={cx('grid h-10 w-8 place-items-center font-label text-base font-bold', INK_BOX, i < 4 ? 'bg-rave-paper text-rave-ink' : 'bg-[#1e1c1f] text-white/30')}>
          {i < 4 ? d : i === 4 ? <motion.span className="block h-4 w-0.5 bg-rave-primary" animate={reduce ? undefined : { opacity: [1, 0, 1] }} transition={{ duration: 1, repeat: Infinity }} /> : '•'}
        </span>
      ))}
    </div>
  );
}

type WhyItem = { icon: ComponentType<{ className?: string }>; t: string; b: string; visual: ReactNode };
/** Ikon & grafis per kartu (urutan = `why.items` di kamus). */
const WHY_ART: { icon: ComponentType<{ className?: string }>; visual: ReactNode }[] = [
  { icon: Headphones, visual: <MiniEqualizer /> },
  { icon: MapPin, visual: <MiniOrbit /> },
  { icon: Landmark, visual: <MiniEscrow /> },
  { icon: FileSignature, visual: <MiniOtp /> },
];

function useWhy(): WhyItem[] {
  const items = useDict('public').why.items;
  return WHY_ART.map((a, i) => ({ ...a, t: items[i].t, b: items[i].b }));
}

function WhyCard({ item, className }: { item: WhyItem; className?: string }) {
  return (
    <div className={cx('rave-glass flex flex-col gap-4 rounded-none p-5', className)}>
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 -rotate-3 place-items-center border-2 border-rave-ink bg-rave-purple shadow-[2px_2px_0_#0b0a0c]">
          <item.icon className="size-4 text-rave-primary-text" />
        </span>
        <h3 className={cx('text-xl', CARD_TITLE)}>{item.t}</h3>
      </div>
      <div className="grid min-h-20 place-items-center">{item.visual}</div>
      <p className="text-sm text-white/65">{item.b}</p>
    </div>
  );
}

function WhyCopy() {
  const d = useDict('public').why;
  return (
    <>
      <p>{d.copy1}</p>
      <p className="mt-4">{d.copy2}</p>
    </>
  );
}

/** Wordmark RAVE asli (branding platform; bawaan = logo resmi RAVE dengan piringan hitam di "V"). */
function Wordmark({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const b = useBranding();
  return (
    <span aria-hidden className={cx('block w-full select-none', className)} style={style}>
      <RaveLockup src={b.logoDark} label={b.name} className="!h-auto w-full" />
    </span>
  );
}
const WORDMARK_RATIO = LOCKUP_RATIO;

/** Judul: eyebrow + wordmark RAVE asli. `slot` = tempat wordmark (diisi wordmark terbang saat animasi aktif). */
function WhyHeading({ slot }: { slot?: React.Ref<HTMLSpanElement> }) {
  const d = useDict('public').why;
  return (
    <h2 className="text-center">
      <span className="rave-label rave-eyebrow !flex justify-center !font-label !text-[12px]">{d.eyebrow}</span>
      <span className="sr-only">RAVE</span>
      <span className="mx-auto mt-4 block w-[min(26rem,82vw)]" style={{ aspectRatio: String(WORDMARK_RATIO) }}>
        {slot ? <span ref={slot} className="block size-full" aria-hidden /> : <Wordmark />}
      </span>
    </h2>
  );
}

function SideCard({ p, from, range, item }: { p: MotionValue<number>; from: number; range: [number, number]; item: WhyItem }) {
  const ease = (t: number) => 1 - (1 - t) ** 3; // easeOutCubic — mendarat lembut
  const x = useTransform(p, range, [from, 0], { ease });
  const opacity = useTransform(p, [range[0], range[0] + (range[1] - range[0]) * 0.6], [0, 1]);
  const scale = useTransform(p, range, [0.86, 1], { ease });
  const rotate = useTransform(p, range, [from > 0 ? -7 : 7, 0], { ease });
  return (
    <motion.div style={{ x, opacity, scale, rotate }}>
      <WhyCard item={item} className="h-full" />
    </motion.div>
  );
}

const DOCK_W = 270; // px — lebar wordmark saat ditempel di sampul
const FLY: [number, number] = [0.08, 0.34]; // rentang progres scroll: judul → sampul

export function WhyRave() {
  const fx = useScrollFx();
  const WHY = useWhy();
  const ref = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLSpanElement>(null);
  const dock = useRef<HTMLSpanElement>(null);
  const { scrollYProgress: raw } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  // Progres dihaluskan pegas → semua transisi mengalir lembut walau scroll roda/trackpad patah-patah.
  const p = useSpring(raw, { stiffness: 140, damping: 32, mass: 0.35, restDelta: 0.0005 });
  const smooth = (t: number) => t * t * (3 - 2 * t); // smoothstep
  // Sampul "disobek" terbuka dari strip tengah — tepi lurus, tanpa sudut membulat.
  const clip = useTransform(p, [0.1, 0.4], ['inset(46% 40% 46% 40%)', 'inset(0% 0% 0% 0%)'], { ease: smooth });
  const sleeveRotate = useTransform(p, [0.1, 0.4], [-6, 0], { ease: smooth });
  const copyOpacity = useTransform(p, [0.36, 0.5], [0, 1], { ease: smooth });
  const copyY = useTransform(p, [0.36, 0.5], [24, 0], { ease: smooth });
  // Piringan keluar dari balik sampul; putaran = idle konstan (±33 rpm visual diperlambat) + dorongan dari scroll.
  const vinylY = useTransform(p, [0.28, 0.54], ['10%', '-52%'], { ease: smooth });
  const vinylOpacity = useTransform(p, [0.26, 0.34], [0, 1]);
  const time = useTime();
  const vinylSpin = useTransform([time, p] as MotionValue<number>[], ([t, v]: number[]) => (t / 1000) * 40 + v * 540);

  // Wordmark terbang dari judul ke sampul: posisi diukur relatif panggung sticky, diinterpolasi dari progres scroll,
  // dengan sedikit putaran & "tamparan" (overshoot) saat menempel seperti stiker.
  const tx = useMotionValue(0);
  const ty = useMotionValue(0);
  const ts = useMotionValue(1);
  const tr = useMotionValue(0);
  const geo = useRef<{ sx: number; sy: number; ss: number; dx: number; dy: number } | null>(null);
  const place = () => {
    const g = geo.current;
    if (!g) return;
    const t = Math.min(1, Math.max(0, (p.get() - FLY[0]) / (FLY[1] - FLY[0])));
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // easeInOutQuad
    const slap = t > 0.85 ? Math.sin(((t - 0.85) / 0.15) * Math.PI) * 0.06 : 0;
    tx.set(g.sx + (g.dx - g.sx) * e);
    ty.set(g.sy + (g.dy - g.sy) * e);
    ts.set(g.ss + (1 - g.ss) * e + slap);
    tr.set(-5 * e);
  };
  useMotionValueEvent(p, 'change', place);
  useLayoutEffect(() => {
    if (!fx) return;
    const measure = () => {
      if (!stage.current || !slot.current || !dock.current) return;
      const o = stage.current.getBoundingClientRect();
      const s = slot.current.getBoundingClientRect();
      const d = dock.current.getBoundingClientRect();
      geo.current = { sx: s.left - o.left, sy: s.top - o.top, ss: s.width / DOCK_W, dx: d.left - o.left, dy: d.top - o.top };
      place();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage.current!);
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx]);

  if (!fx)
    return (
      <section id="kenapa" ref={ref} className="scroll-mt-20 px-4 py-20 md:py-24">
        <div className="mx-auto max-w-[82.5rem]">
          <WhyHeading />
          <div className="rave-tilt mt-24 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            <div className="relative sm:col-span-2 lg:col-span-1 lg:row-span-2">
              <Vinyl shadow={false} className="absolute top-0 left-1/2 w-[62%] -translate-x-1/2 -translate-y-[48%]" discClassName="animate-[rave-spin_9s_linear_infinite] motion-reduce:animate-none" />
              <div className="rave-glass-strong relative px-8 pt-10 pb-8 text-center text-lg font-semibold">
                <Wordmark className="mx-auto mt-10 mb-8 w-64 -rotate-[5deg] drop-shadow-[4px_4px_0_#0b0a0c]" />
                <WhyCopy />
              </div>
            </div>
            {WHY.map((w) => (
              <WhyCard key={w.t} item={w} />
            ))}
          </div>
        </div>
      </section>
    );

  return (
    <section id="kenapa" ref={ref} className="relative h-[280vh] scroll-mt-20">
      <div ref={stage} className="sticky top-0 flex h-screen flex-col items-center justify-center overflow-hidden px-4">
        <div className="pointer-events-none absolute top-1/2 left-1/2 -z-10 h-[60vh] w-[60vw] -translate-x-1/2 -translate-y-1/3 rounded-none bg-[radial-gradient(closest-side,rgba(244,194,31,0.14),transparent)] blur-2xl" aria-hidden />
        <WhyHeading slot={slot} />
        <div className="mt-16 grid w-full max-w-[82.5rem] grid-cols-[1fr_1.05fr_1fr] gap-8">
          <div className="grid gap-8">
            <SideCard p={p} from={260} range={[0.46, 0.66]} item={WHY[0]} />
            <SideCard p={p} from={260} range={[0.54, 0.74]} item={WHY[2]} />
          </div>
          <div className="relative">
            {/* Piringan di belakang sampul — muncul dari tepi atas. */}
            <motion.div className="absolute top-0 left-1/2 -z-0 w-[62%] -translate-x-1/2" style={{ y: vinylY, opacity: vinylOpacity }}>
              <Vinyl shadow={false} discStyle={{ rotate: vinylSpin }} />
            </motion.div>
            <motion.div
              style={{ clipPath: clip, rotate: sleeveRotate }}
              className="rave-glass-strong relative z-10 flex h-full flex-col justify-end px-8 pt-60 pb-8 text-center text-base leading-relaxed font-semibold xl:text-lg"
            >
              <span className="rave-catno absolute top-4 left-5 text-rave-paper">RV-LP-001</span>
              <span className="rave-catno absolute top-4 right-5 text-rave-paper">33⅓ RPM</span>
              <motion.div style={{ opacity: copyOpacity, y: copyY }}><WhyCopy /></motion.div>
            </motion.div>
            {/* Titik tambat wordmark: bagian atas sampul. */}
            <span ref={dock} className="pointer-events-none invisible absolute top-[24%] left-1/2 -translate-x-1/2" style={{ width: DOCK_W, aspectRatio: String(WORDMARK_RATIO) }} aria-hidden />
          </div>
          <div className="grid gap-8">
            <SideCard p={p} from={-260} range={[0.5, 0.7]} item={WHY[1]} />
            <SideCard p={p} from={-260} range={[0.58, 0.78]} item={WHY[3]} />
          </div>
        </div>
        <motion.div style={{ x: tx, y: ty, scale: ts, rotate: tr, width: DOCK_W }} className="absolute top-0 left-0 z-20 origin-top-left">
          <Wordmark className="drop-shadow-[5px_5px_0_#0b0a0c]" />
        </motion.div>
      </div>
    </section>
  );
}

// =============================================================================================
// 2. Spotlight — foto gig DIY (gaya fotokopi + kertas kusut) rebah 3D lalu tegak saat masuk layar, dengan angka
// =============================================================================================

export function Spotlight() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start end', 'center center'] });
  const rotateX = useTransform(p, [0, 1], [reduce ? 0 : 32, 0]);
  const scale = useTransform(p, [0, 1], [reduce ? 1 : 0.86, 1]);
  const glow = useTransform(p, [0.4, 1], [0.2, 1]);
  const d = useDict('public').spotlight;

  return (
    <section className="px-4 py-20 md:py-28">
      <div className="mx-auto max-w-[82.5rem] text-center">
        <p className="rave-label rave-eyebrow justify-center !text-[12px]">{d.eyebrow}</p>
        <h2 className="mt-4 text-7xl leading-[0.9] text-rave-primary-text md:text-[9rem]">{d.title}</h2>
      </div>
      <div ref={ref} className="mx-auto mt-12 max-w-[82.5rem] [perspective:1400px]">
        <motion.div
          style={{ rotateX, scale, transformOrigin: '50% 100%' }}
          className="relative isolate overflow-hidden rounded-none border-2 border-rave-ink bg-black shadow-[10px_10px_0_#5B2A6E] md:aspect-[16/8]"
        >
          {/* Gig DIY (crowd surfing di venue kecil) dicetak ala flyer fotokopi: hitam-putih kontras + kertas kusut + halftone. */}
          <img src={gigDiy} alt={d.photoAlt} loading="lazy" className="absolute inset-0 -z-20 size-full object-cover object-[60%_40%] grayscale contrast-[1.3] brightness-[0.95]" />
          <div className="absolute inset-0 -z-10 bg-cover bg-center opacity-75 mix-blend-overlay" style={{ backgroundImage: `url(${paper})` }} aria-hidden />
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(rgba(0,0,0,0.5)_1px,transparent_1.6px)] bg-[length:5px_5px] opacity-50 mix-blend-multiply" aria-hidden />
          {/* Kerucut sorot lampu */}
          <motion.div
            style={{ opacity: glow }}
            className="absolute inset-0 -z-10 bg-[conic-gradient(from_180deg_at_55%_-10%,transparent_42%,rgba(244,194,31,0.35)_48%,rgba(138,47,63,0.25)_52%,transparent_58%)] mix-blend-screen"
            aria-hidden
          />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black via-black/40 to-black/70" aria-hidden />
          <div className="grid h-full gap-8 p-8 text-left md:grid-cols-2 md:p-14">
            <div className="flex flex-col justify-center">
              <p className="font-display text-7xl leading-none md:text-9xl">
                <span className="mr-1 align-top text-2xl text-[#F4C21F]">*</span>
                <CountUp to={500} duration={2} separator="." />+
              </p>
              <p className="mt-3 max-w-xs text-white/70">{d.artists}</p>
            </div>
            <div className="flex flex-col justify-end gap-4 text-sm text-white/70 md:items-end md:text-right">
              <p className="max-w-xs">{d.body1}</p>
              <p className="max-w-xs">{d.body2}</p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// =============================================================================================
// 3. Ekosistem — tiga kartu peran bertumpuk saat di-scroll (kartu di belakang mengecil)
// =============================================================================================

export interface RoleCard {
  id: string;
  image: string;
  alt: string;
  label: string;
  title: string;
  body: string;
  features: { icon: ComponentType<{ className?: string }>; t: string }[];
  cta: string;
  href: string;
}

/**
 * Perlakuan foto punk yang seragam untuk semua kartu peran: fotokopi hitam-putih kontras tinggi → duotone ungu RAVE,
 * halftone + grain, bayangan dari kiri untuk keterbacaan teks, dan selotip sobek di sudut.
 */
function PunkPhoto({ src, alt }: { src: string; alt: string }) {
  return (
    <>
      <img src={src} alt={alt} loading="lazy" className="absolute inset-0 -z-20 size-full object-cover grayscale contrast-[1.35] brightness-[1.05]" />
      <div className="absolute inset-0 -z-10 bg-rave-purple opacity-85 mix-blend-multiply" aria-hidden />
      <div className="absolute inset-0 -z-10 bg-[#F4C21F] opacity-[0.07] mix-blend-screen" aria-hidden />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(rgba(0,0,0,0.55)_1px,transparent_1.7px)] bg-[length:6px_6px] opacity-70 mix-blend-multiply" aria-hidden />
      <div className="absolute inset-0 -z-10 bg-[image:var(--rave-grain)] opacity-50 mix-blend-overlay" aria-hidden />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(14,12,15,0.92)_0%,rgba(14,12,15,0.55)_45%,rgba(14,12,15,0.1)_75%),linear-gradient(0deg,rgba(14,12,15,0.85),transparent_45%)]" aria-hidden />
      <span className="pointer-events-none absolute -right-10 bottom-16 h-7 w-48 -rotate-[32deg] bg-rave-paper/70 shadow-[0_1px_2px_rgba(0,0,0,0.4)] [clip-path:polygon(0_10%,8%_0,18%_12%,30%_2%,44%_10%,58%_0,72%_9%,86%_1%,100%_10%,97%_55%,100%_92%,86%_100%,70%_91%,54%_100%,38%_92%,22%_100%,8%_92%,0_100%,3%_50%)]" aria-hidden />
    </>
  );
}

function RoleSlide({ r, i, n, p, fx }: { r: RoleCard; i: number; n: number; p: MotionValue<number>; fx: boolean }) {
  const scale = useTransform(p, [i / n, 1], [1, 1 - (n - 1 - i) * 0.05]);
  const dim = useTransform(p, [i / n, Math.min(1, (i + 1) / n)], [0, i === n - 1 ? 0 : 0.45]);
  return (
    <div id={r.id} className={cx('scroll-mt-24', fx && 'sticky')} style={fx ? { top: `calc(6rem + ${i * 1.75}rem)` } : undefined}>
      <motion.article style={fx ? { scale, transformOrigin: '50% 0%' } : undefined} className="relative isolate overflow-hidden rounded-none border-2 border-rave-ink bg-black shadow-[8px_8px_0_#0b0a0c] lg:min-h-[560px]">
        <PunkPhoto src={r.image} alt={r.alt} />
        <div className="flex h-full flex-col p-6 md:p-10 lg:min-h-[560px]">
          <div className="flex items-center justify-between gap-4">
            <span className="rave-sticker rave-label bg-rave-primary px-3.5 py-1.5 !text-[10px] text-rave-on-primary">{r.label}</span>
            <span className="rave-catno text-rave-paper">RAVE · RV-1{i}0 · {String.fromCharCode(65 + i)}-side</span>
          </div>
          <h3 className={cx('mt-6 max-w-2xl text-5xl md:text-7xl', CARD_TITLE)}>{r.title}</h3>
          <p className="mt-3 max-w-lg text-white/80 md:text-lg">{r.body}</p>
          <div className="mt-auto pt-10">
            <ul className="grid gap-px overflow-hidden rounded-none border-2 border-rave-ink bg-rave-ink sm:grid-cols-2 lg:grid-cols-4">
              {r.features.map((f) => (
                <li key={f.t} className="flex items-center gap-3 bg-[#181818]/80 p-4 text-sm font-semibold backdrop-blur-md">
                  <f.icon className="size-4 shrink-0 text-rave-primary-text" /> {f.t}
                </li>
              ))}
            </ul>
            <Link to={r.href} className={cx('mt-6', BTN_PRIMARY_SM)}>
              {r.cta} <ArrowRight className="size-4 transition group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
        {fx && <motion.div style={{ opacity: dim }} className="pointer-events-none absolute inset-0 bg-black" aria-hidden />}
      </motion.article>
    </div>
  );
}

export function RoleStack({ roles, heading }: { roles: RoleCard[]; heading: ReactNode }) {
  const fx = useScrollFx();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  return (
    <section id="ekosistem" className="scroll-mt-20 px-4 py-20 md:py-24">
      <div className="mx-auto max-w-[82.5rem]">
        {heading}
        <div ref={ref} className={cx('mt-14', fx ? 'space-y-[22vh] pb-[6vh]' : 'space-y-5')}>
          {roles.map((r, i) => (
            <RoleSlide key={r.id} r={r} i={i} n={roles.length} p={p} fx={fx} />
          ))}
        </div>
      </div>
    </section>
  );
}

// =============================================================================================
// 4. Kolase — kartu, piringan, & stiker berhamburan keluar dari judul
// =============================================================================================

type Piece = { kind: 'img' | 'disc' | 'tag'; src?: string; tag?: 'newRelease' | 'presale' | 'live'; x: number; y: number; r: number; w: number; tone?: string };
// x/y = posisi akhir relatif pusat (% lebar/tinggi panggung); w = lebar (rem).
const PIECES: Piece[] = [
  { kind: 'img', src: stage, x: -34, y: -30, r: -12, w: 9 },
  { kind: 'disc', x: -16, y: -36, r: 0, w: 7 },
  { kind: 'img', src: roleFan, x: 6, y: -38, r: 8, w: 8 },
  { kind: 'tag', tag: 'newRelease', x: 30, y: -30, r: 14, w: 9, tone: 'bg-[#8A2F3F]' },
  { kind: 'disc', x: 40, y: -8, r: 0, w: 8 },
  { kind: 'img', src: rolePromotor, x: 34, y: 26, r: -9, w: 10 },
  { kind: 'tag', tag: 'presale', x: 12, y: 36, r: -6, w: 8, tone: 'bg-[#F4C21F] !text-[#181818]' },
  { kind: 'img', src: roleArtist, x: -10, y: 34, r: 10, w: 8 },
  { kind: 'disc', x: -30, y: 24, r: 0, w: 6.5 },
  { kind: 'tag', tag: 'live', x: -42, y: 2, r: -16, w: 6, tone: 'bg-[#5B2A6E]' },
];

function Disc() {
  return (
    <span className="rave-groove relative block aspect-square !bg-[repeating-radial-gradient(circle,#1a1a1a_0_3px,#0f0f0f_3px_4px)] shadow-2xl shadow-black/60">
      <span className="absolute inset-[34%] rounded-full bg-rave-purple" />
      <span className="absolute inset-[47%] rounded-full bg-rave-paper" />
    </span>
  );
}

function PieceView({ piece, p, i, fx }: { piece: Piece; p: MotionValue<number>; i: number; fx: boolean }) {
  const start = 0.05 + (i % 5) * 0.03;
  const range = [start, start + 0.4];
  const x = useTransform(p, range, ['0%', `${piece.x}vw`]);
  const y = useTransform(p, range, ['0vh', `${piece.y}vh`]);
  const rotate = useTransform(p, range, [0, piece.r + (piece.kind === 'disc' ? 180 : 0)]);
  const scale = useTransform(p, range, [0.2, 1]);
  const opacity = useTransform(p, [start + 0.06, start + 0.16], [0, 1]);
  const tags = useDict('public').movement.tags;
  const body =
    piece.kind === 'img' ? (
      <img src={piece.src} alt="" loading="lazy" className="aspect-[4/5] w-full rounded-none object-cover shadow-2xl shadow-black/60 ring-4 ring-rave-paper" />
    ) : piece.kind === 'disc' ? (
      <Disc />
    ) : (
      <span className={cx('rave-label block rounded-none px-3 py-2 text-center !text-[12px] text-white shadow-[3px_3px_0_#0e0c0f]', piece.tone)}>{piece.tag && tags[piece.tag]}</span>
    );
  return (
    <motion.div
      aria-hidden
      className="absolute top-1/2 left-1/2 -mt-[3rem] -ml-[4rem]"
      style={fx ? { x, y, rotate, scale, opacity, width: `${piece.w}rem` } : { x: `${piece.x}vw`, y: `${piece.y * 0.8}vh`, rotate: piece.r, width: `${piece.w * 0.7}rem` }}
    >
      {body}
    </motion.div>
  );
}

/** Tepi sobek atas & bawah untuk lembar kertas latar Movement. */
const SHEET_TORN =
  'polygon(0 4%,5% 1%,11% 5%,17% 0,24% 4%,31% 1%,38% 5%,45% 0,52% 4%,59% 1%,66% 5%,73% 0,80% 4%,87% 1%,94% 5%,100% 2%,100% 96%,94% 99%,87% 95%,80% 100%,73% 96%,66% 99%,59% 95%,52% 100%,45% 96%,38% 99%,31% 95%,24% 100%,17% 96%,11% 99%,5% 95%,0 98%)';

/**
 * Latar Movement: medan titik halftone mustard yang menyebar & membesar dari tengah (tinta meresap),
 * lalu lembar kertas ungu bertepi sobek (lipatan poster + halftone) naik, berputar, dan terbentang di belakang judul.
 */
function MovementBackdrop({ p, fx }: { p: MotionValue<number>; fx: boolean }) {
  const ease = (t: number) => 1 - (1 - t) ** 3;
  const dotSize = useTransform(p, [0, 1], [7, 30]);
  const dotMask = useTransform(p, [0.02, 0.6], [0, 170], { ease });
  const dotOpacity = useTransform(p, [0, 0.12], [0, 0.5]);
  const bgSize = useMotionTemplate`${dotSize}px ${dotSize}px`;
  const maskSize = useMotionTemplate`${dotMask}% ${dotMask}%`;
  const sheetY = useTransform(p, [0.05, 0.55], ['75%', '0%'], { ease });
  const sheetRotate = useTransform(p, [0.05, 0.55], [-14, -3], { ease });
  const sheetScale = useTransform(p, [0.05, 0.55], [0.62, 1], { ease });
  const sheetOpacity = useTransform(p, [0.05, 0.18], [0, 1]);
  const mask = 'radial-gradient(circle, #000 55%, transparent 70%)';
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <motion.div
        className="absolute inset-0"
        style={
          fx
            ? { backgroundImage: 'radial-gradient(circle, rgba(244,194,31,0.55) 32%, transparent 36%)', backgroundSize: bgSize, backgroundPosition: 'center', opacity: dotOpacity, maskImage: mask, WebkitMaskImage: mask, maskSize, WebkitMaskSize: maskSize, maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center' }
            : { backgroundImage: 'radial-gradient(circle, rgba(244,194,31,0.4) 32%, transparent 36%)', backgroundSize: '14px 14px', opacity: 0.35, maskImage: mask, WebkitMaskImage: mask }
        }
      />
      <div className="absolute inset-0 grid place-items-center">
        <motion.div
          className="relative isolate h-[min(74vh,640px)] w-[min(1120px,90vw)] bg-rave-purple shadow-[12px_12px_0_#0b0a0c]"
          style={fx ? { y: sheetY, rotate: sheetRotate, scale: sheetScale, opacity: sheetOpacity, clipPath: SHEET_TORN } : { rotate: -3, clipPath: SHEET_TORN }}
        >
          <span className="absolute inset-0 bg-cover bg-center opacity-90 mix-blend-overlay" style={{ backgroundImage: `url(${folded})` }} />
          <span className="absolute inset-0 bg-cover bg-center opacity-35 mix-blend-multiply" style={{ backgroundImage: `url(${halftone})` }} />
          <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(14,12,15,0.15),rgba(14,12,15,0.35))]" />
        </motion.div>
      </div>
    </div>
  );
}

export function Movement() {
  const fx = useScrollFx();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const titleScale = useTransform(p, [0, 0.45], [0.92, 1]);
  const d = useDict('public').movement;
  const content = (
    <motion.div style={fx ? { scale: titleScale } : undefined} className="relative z-10 mx-auto max-w-2xl text-center">
      <h2 className="text-6xl leading-[0.92] text-balance md:text-8xl">
        {d.titleBefore} <RansomText text={d.titleWord} className="mx-1" /> {d.titleAfter}
      </h2>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link to="/app" className={BTN_PRIMARY}>
          {d.startListening} <ArrowRight className="size-4 transition group-hover:translate-x-1" />
        </Link>
        <a href="#waitlist" className={cx(BTN_GHOST, 'bg-rave-ink/60 backdrop-blur')}>
          {d.joinWaitlist}
        </a>
      </div>
    </motion.div>
  );
  if (!fx)
    return (
      <section ref={ref} className="relative overflow-hidden px-4 py-28">
        <MovementBackdrop p={p} fx={false} />
        <div className="pointer-events-none absolute inset-0 opacity-40">
          {PIECES.slice(0, 6).map((piece, i) => (
            <PieceView key={i} piece={piece} p={p} i={i} fx={false} />
          ))}
        </div>
        <div className="relative py-6">{content}</div>
      </section>
    );
  return (
    <section ref={ref} className="relative h-[220vh]">
      <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden px-4">
        <MovementBackdrop p={p} fx />
        {PIECES.map((piece, i) => (
          <PieceView key={i} piece={piece} p={p} i={i} fx />
        ))}
        {content}
      </div>
    </section>
  );
}


/** Bingkai CTA penutup bersih: kartu tinta bergaris tebal + bayangan sablon mustard + tekstur halftone samar. */
export function WaveFrame({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.8, ease: EASE }}
      className="rave-crumple relative mx-auto max-w-[82.5rem] border-2 border-rave-ink bg-[#1e1c1f] bg-[radial-gradient(rgba(237,237,237,0.04)_1px,transparent_1.2px)] bg-[length:6px_6px] shadow-[10px_10px_0_#F4C21F] before:!opacity-35"
    >
      <div className="relative">{children}</div>
    </motion.div>
  );
}

