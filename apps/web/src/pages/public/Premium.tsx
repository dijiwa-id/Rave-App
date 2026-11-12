import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react';
import { ArrowRight, AudioLines, BadgeCheck, Check, ChevronDown, Lock, Minus, Podcast, Sparkles, VolumeX } from 'lucide-react';
import { api } from '@/lib/api';
import type { Show } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { cx } from '@/components/ui';
import { RaveMark } from '@/components/ui/RaveLogo';
import { useModule } from '@/components/ModuleGate';
import { usePricing } from '@/lib/pricing';
import { useDict } from '@/lib/i18n';
import { BTN_GHOST, BTN_GHOST_SM, BTN_PRIMARY, BTN_PRIMARY_SM, CARD_TITLE, Heading, Section } from './marketing';
import { useScrollFx, WaveFrame } from './LandingScroll';
import { Vinyl } from './Vinyl';
import { PublicFooter, PublicNav } from './PublicChrome';

/**
 * Halaman RAVE Premium. Prinsip produk (BRD + D-03): musik selalu gratis (AAC hingga 160) — Premium membuka AAC 320 &
 * Lossless/Hi-Res FLAC, bebas iklan, serta podcast & audio fiksi premium. Unduhan offline belum ada (ditandai "segera
 * hadir"); tidak ada janji akses tiket lebih awal. Billing langganan dibuka pada fase
 * berikutnya (REQ-PAY-03), jadi CTA mengarah ke waitlist, bukan checkout palsu.
 *
 * Interaksi scroll mengikuti landing (LandingScroll.tsx): RAVE glass, kartu 3D yang tegak saat di-scroll, kartu
 * paket yang menyebar, rak konten horizontal, dan CTA bergelombang titik. Layar kecil / "kurangi gerakan" → statis.
 */

const NOTIFY = '/#waitlist';
const EASE = [0.22, 1, 0.36, 1] as const;

type Cell = boolean | string;
type PublicDict = ReturnType<typeof useDict<'public'>>;
type CellKey = keyof PublicDict['premium']['cells'];
/** Nilai sel per baris (urutan = `premium.compare` di kamus); string = kunci `premium.cells`. */
const COMPARE_CELLS: { free: boolean | CellKey; premium: boolean | CellKey }[] = [
  { free: true, premium: true },
  { free: true, premium: true },
  // Keputusan D-03: AAC 320 & Lossless/Hi-Res FLAC khusus Premium (ditegakkan server, packages/domain/src/audio.ts).
  { free: false, premium: true },
  { free: true, premium: true },
  { free: true, premium: true },
  { free: 'selectedEpisodes', premium: true },
  { free: false, premium: true },
];

type Pricing = ReturnType<typeof usePricing>;

// Harga, masa coba, verifikasi pelajar, dan jumlah perangkat dari Super Admin (`subscription.*`).
const plans = (t: Pricing, d: PublicDict['premium']['plans']) => [
  { name: d.individual.name, price: t.individual, who: d.individual.who, items: [d.individual.allBenefits, d.individual.quality, d.individual.downloadsSoon], popular: true },
  { name: d.student.name, price: t.student, who: d.student.who, items: [d.student.allBenefits, d.student.verification, d.student.renewed(t.studentMonths)], popular: false },
  { name: d.duo.name, price: t.duo, who: d.duo.who, items: [...d.duo.items], popular: false },
];

const PAYMENTS = ['QRIS', 'GoPay', 'OVO', 'DANA', 'Virtual Account'];

const faqs = (t: Pricing, f: PublicDict['premium']['faq']): [string, string][] => [
  [f.q1, f.a1],
  [f.q2, f.a2(t.trial)],
  [f.q3, f.a3],
  [f.q4, f.a4],
  [f.q5, f.a5(t.studentMonths)],
];

const BENEFIT_ICONS = [Podcast, VolumeX, AudioLines];

// =============================================================================================
// Hero — Aurora seperti home, konten memudar saat di-scroll, kartu keanggotaan 3D yang tegak
// =============================================================================================

/** Kartu keanggotaan RAVE glass: rebah 3D lalu tegak saat di-scroll, miring mengikuti kursor, kilau holografik. */
function MemberCard() {
  const reduce = useReducedMotion();
  const t = usePricing();
  const d = useDict('public').premium;
  const BENEFITS = BENEFIT_ICONS.map((icon, i) => ({ icon, t: d.benefits[i] }));
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start end', 'center center'] });
  const lay = useTransform(p, [0, 1], [reduce ? 0 : 38, 0]);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const tiltX = useSpring(useTransform(my, [-0.5, 0.5], [8, -8]), { stiffness: 140, damping: 18 });
  const tiltY = useSpring(useTransform(mx, [-0.5, 0.5], [-10, 10]), { stiffness: 140, damping: 18 });
  const rotateX = useTransform([lay, tiltX] as MotionValue<number>[], ([a, b]: number[]) => a + b);
  const sheen = useTransform(mx, [-0.5, 0.5], ['20%', '80%']);
  const sheenBg = useTransform(sheen, (x) => `radial-gradient(60% 80% at ${x} 0%, rgba(255,255,255,0.22), transparent 60%)`);

  return (
    <div
      ref={ref}
      className="relative mx-auto mt-16 w-full max-w-[34rem] [perspective:1400px]"
      onPointerMove={(e) => {
        if (reduce || e.pointerType !== 'mouse') return;
        const r = ref.current!.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width - 0.5);
        my.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onPointerLeave={() => (mx.set(0), my.set(0))}
    >
      <div className="absolute -inset-12 -z-10 rounded-none bg-[radial-gradient(closest-side,rgba(138,47,63,0.35),rgba(91,42,110,0.18),transparent)] blur-2xl" aria-hidden />
      <motion.div style={{ rotateX, rotateY: tiltY, transformOrigin: '50% 100%' }} className="rave-glass-strong aspect-[1.586] overflow-hidden rounded-none p-6 text-left md:p-8">
        <motion.div style={{ background: sheenBg }} className="pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative flex h-full flex-col">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2.5 font-display text-lg uppercase tracking-wide">
              <RaveMark className="size-9" /> RAVE <span className="font-semibold text-white/70">Premium</span>
            </span>
            <Sparkles className="size-5 text-white/80" />
          </div>
          <div className="mt-auto">
            <p className="text-xs font-bold tracking-[0.2em] text-white/60 uppercase">{d.plans.individual.name}</p>
            <p className="mt-1 flex items-baseline gap-1">
              <span className="text-sm font-bold text-white/70">Rp</span>
              <span className="font-display text-5xl leading-none md:text-6xl">{t.individual}</span>
              <span className="text-sm text-white/60">{d.perMonth}</span>
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {BENEFITS.map((b) => (
                <span key={b.t} className="inline-flex items-center gap-1.5 rounded-none border border-white/20 bg-black/25 px-2.5 py-1 text-[11px] font-bold backdrop-blur">
                  <b.icon className="size-3.5" /> {b.t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function Hero() {
  const premium = useAuth((s) => s.user?.premium);
  const t = usePricing();
  const d = useDict('public').premium;
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const y = useTransform(p, [0, 1], [0, reduce ? 0 : 140]);
  const opacity = useTransform(p, [0, 0.55], [1, reduce ? 1 : 0]);
  const fade = (delay: number) => ({
    initial: { opacity: 0, y: reduce ? 0 : 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay, ease: EASE },
  });
  return (
    <section ref={ref} className="relative isolate overflow-hidden px-4 pt-[9.5rem] pb-24 text-center md:pt-[11.5rem]">
      <div className="rave-grain rave-crumple !absolute inset-0 -z-10 bg-[radial-gradient(110%_80%_at_50%_0%,#4a1f5c_0,#2a1233_45%,#181818_100%)]" aria-hidden />
      {/* Vinyl realistis (komponen bersama landing): buram penuh di atas latar bertekstur, berputar pelan. */}
      <Vinyl
        className="absolute top-[46%] left-1/2 -z-10 w-[min(1000px,120vw)] -translate-x-1/2"
        discClassName="animate-[rave-spin_9s_linear_infinite] motion-reduce:animate-none"
      />
      <motion.div style={{ y, opacity }} className="mx-auto max-w-4xl">
        <motion.span {...fade(0)} className="rave-label rave-eyebrow !text-[12px]">
          <Sparkles className="size-4" /> RAVE Premium
        </motion.span>
        <motion.h1 {...fade(0.08)} className="mt-7 text-6xl leading-[0.9] text-balance md:text-8xl lg:text-[7.5rem]">
          {d.heroTitle1}
          <br />
          <span className="text-rave-primary-text">{d.heroTitle2}</span>
        </motion.h1>
        <motion.p {...fade(0.16)} className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/70">
          {d.heroLead(t.student)}
        </motion.p>
        <motion.div {...fade(0.24)}>
          {premium ? (
            <div className="rave-glass mt-9 inline-flex items-center gap-2 rounded-none px-6 py-3.5 font-bold">
              <BadgeCheck className="size-5 text-rave-primary-text" /> {d.alreadyPremium}
            </div>
          ) : (
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <a href={NOTIFY} className={BTN_PRIMARY}>
                {d.remindWhenOpen}
                <ArrowRight className="size-4 transition group-hover:translate-x-1" />
              </a>
              <a href="#paket" className={BTN_GHOST}>
                {d.seePlans}
              </a>
            </div>
          )}
          <p className="mt-5 text-sm text-white/45">{d.heroNote(t.trial)}</p>
        </motion.div>
      </motion.div>
      <MemberCard />
    </section>
  );
}

// =============================================================================================
// Gratis vs Premium — baris muncul berurutan, kolom Premium menyala
// =============================================================================================

function Mark({ v, highlight }: { v: Cell; highlight?: boolean }) {
  const d = useDict('public').premium;
  if (v === true) return <Check className={cx('mx-auto size-5', highlight ? 'text-rave-primary-text' : 'text-white/80')} aria-label={d.included} />;
  if (v === false) return <Minus className="mx-auto size-5 text-white/25" aria-label={d.notIncluded} />;
  return <span className={cx('text-sm font-semibold', highlight ? 'text-white' : 'text-white/60')}>{v}</span>;
}

function Compare() {
  const reduce = useReducedMotion();
  const d = useDict('public').premium;
  const cell = (v: boolean | CellKey): Cell => (typeof v === 'boolean' ? v : d.cells[v]);
  const COMPARE = COMPARE_CELLS.map((c, i) => ({ feature: d.compare[i], free: cell(c.free), premium: cell(c.premium) }));
  return (
    <Section className="!pt-8">
      <Heading center kicker={d.compareKicker} title={d.compareTitle} body={d.compareBody} />
      <div className="rave-glass mx-auto mt-12 max-w-4xl overflow-hidden rounded-none">
        <table className="relative w-full text-left">
          <thead>
            <tr className="border-b border-white/10">
              <th scope="col" className="p-4 text-sm font-bold text-white/60 md:px-6">
                {d.feature}
              </th>
              <th scope="col" className="w-28 p-4 text-center text-sm font-bold md:w-40">
                {d.free}
              </th>
              <th scope="col" className="w-28 bg-gradient-to-b from-[#8A2F3F]/25 to-[#8A2F3F]/10 p-4 text-center text-sm font-bold md:w-40">
                <span className="text-rave-primary-text">Premium</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARE.map((r, i) => (
              <motion.tr
                key={r.feature}
                className="border-b border-white/[0.06] last:border-0"
                initial={reduce ? false : { opacity: 0, x: -16 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ duration: 0.5, delay: i * 0.06, ease: EASE }}
              >
                <th scope="row" className="p-4 text-sm font-semibold text-white/85 md:px-6 md:text-base">
                  {r.feature}
                </th>
                <td className="p-4 text-center">
                  <Mark v={r.free} />
                </td>
                <td className="bg-[#8A2F3F]/10 p-4 text-center">
                  <motion.span
                    className="inline-block"
                    initial={reduce ? false : { scale: 0.4, opacity: 0 }}
                    whileInView={{ scale: 1, opacity: 1 }}
                    viewport={{ once: true, amount: 0.6 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 18, delay: 0.15 + i * 0.06 }}
                  >
                    <Mark v={r.premium} highlight />
                  </motion.span>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mx-auto mt-4 max-w-4xl text-center text-sm text-white/55">{d.comingSoon}</p>
    </Section>
  );
}

// =============================================================================================
// Paket — tiga kartu bertumpuk di tengah lalu menyebar saat section masuk layar
// =============================================================================================

function PlanCard({ p, trial }: { p: ReturnType<typeof plans>[number]; trial: string | null | undefined }) {
  const d = useDict('public').premium;
  return (
    <div className={cx('rave-card-hover rave-taped relative flex h-full flex-col rounded-none p-7', p.popular ? 'rave-glass-strong' : 'rave-glass')}>
      <div className="flex items-center justify-between">
        <h3 className={cx('text-4xl', CARD_TITLE)}>{p.name}</h3>
        {p.popular && <span className="rave-sticker rave-label bg-rave-primary px-2.5 py-1 !text-[10px] text-rave-on-primary [--sticker-r:6deg]">{d.mostPopular}</span>}
      </div>
      <p className="mt-1 text-sm text-white/60">{p.who}</p>
      <p className="mt-6 flex items-baseline gap-1">
        <span className="text-sm font-bold text-white/60">Rp</span>
        <span className="font-display text-5xl leading-none">{p.price}</span>
        <span className="text-sm text-white/50">{d.perMonth}</span>
      </p>
      {trial && <p className={cx('mt-1 text-xs font-semibold', p.popular ? 'text-white/85' : 'text-rave-primary-text')}>{d.trialAtLaunch(trial)}</p>}
      <ul className="mt-6 flex-1 space-y-3 border-t border-white/15 pt-6">
        {p.items.map((i) => (
          <li key={i} className="flex gap-2.5 text-sm text-white/85">
            <Check className="size-4 shrink-0 text-rave-primary-text" /> {i}
          </li>
        ))}
      </ul>
      <a
        href={NOTIFY}
        className={cx('mt-8 w-full', p.popular ? BTN_PRIMARY_SM : BTN_GHOST_SM)}
      >
        {d.remindMe}
      </a>
    </div>
  );
}

function SpreadCard({ p, i, prog, children }: { p: MotionValue<number>; i: number; prog: [number, number]; children: React.ReactNode }) {
  // Posisi awal: semua kartu bertumpuk di kolom tengah (offset ±1 kolom), sedikit miring & mengecil.
  const off = i === 0 ? 1 : i === 2 ? -1 : 0;
  const x = useTransform(p, prog, [`${off * 105}%`, '0%']);
  const rotate = useTransform(p, prog, [off * -7, 0]);
  const scale = useTransform(p, prog, [off ? 0.9 : 1, 1]);
  const y = useTransform(p, prog, [off ? 30 : 0, 0]);
  return (
    <motion.div style={{ x, rotate, scale, y, zIndex: off ? 1 : 2 }} className="relative">
      {children}
    </motion.div>
  );
}

function Plans() {
  const t = usePricing();
  const d = useDict('public').premium;
  const fx = useScrollFx();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start end', 'center center'] });
  // Urutan tampil: Pelajar · Individu (tengah, populer) · Duo
  const ordered = (() => {
    const all = plans(t, d.plans);
    const pop = all.find((x) => x.popular)!;
    const rest = all.filter((x) => !x.popular);
    return [rest[0], pop, rest[1]];
  })();
  return (
    <Section id="paket">
      <Heading center kicker={d.plansKicker} title={d.plansTitle} body={d.plansBody} />
      <div ref={ref} className="mt-12 grid items-stretch gap-5 md:grid-cols-3">
        {ordered.map((plan, i) =>
          fx ? (
            <SpreadCard key={plan.name} p={p} i={i} prog={[0.35, 0.95]}>
              <PlanCard p={plan} trial={t.trial} />
            </SpreadCard>
          ) : (
            <div key={plan.name} className={cx(plan.popular && 'order-first md:order-none')}>
              <PlanCard p={plan} trial={t.trial} />
            </div>
          ),
        )}
      </div>
      <p className="mt-8 text-center text-sm text-white/45">{d.payments([...PAYMENTS, d.creditCard].join(' · '))}</p>
    </Section>
  );
}

// =============================================================================================
// Eksklusif — rak horizontal yang bergeser mengikuti scroll vertikal (sticky)
// =============================================================================================

function ShowCard({ s }: { s: Show }) {
  const d = useDict('public').premium;
  return (
    <Link to={`/app/show/${s.id}`} className="group block w-60 shrink-0 md:w-72">
      <div className="rave-glass relative aspect-square overflow-hidden rounded-none p-0">
        <img src={s.cover_url} alt={s.title} loading="lazy" className="size-full object-cover transition duration-700 group-hover:scale-105" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" aria-hidden />
        <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-none bg-black/60 px-2.5 py-1 text-[11px] font-bold backdrop-blur">
          <Lock className="size-3" /> Premium
        </span>
        <span className="absolute right-3 bottom-3 grid size-10 place-items-center rounded-full bg-rave-primary text-rave-on-primary opacity-0 transition group-hover:opacity-100">
          <ArrowRight className="size-4" />
        </span>
      </div>
      <p className="mt-3 truncate text-lg font-bold">{s.title}</p>
      <p className="truncate text-sm text-white/50">
        {s.kind === 'FICTION' ? d.fiction : d.podcast} · {s.publisher}
      </p>
    </Link>
  );
}

function ExclusiveHeading() {
  const d = useDict('public').premium;
  return (
    <Heading
      kicker={d.exclusiveKicker}
      title={d.exclusiveTitle}
      body={d.exclusiveBody}
      action={
        <Link to="/app/podcasts" className="inline-flex items-center gap-2 rounded-none border border-white/25 px-6 py-3 font-bold transition hover:border-white/60 hover:bg-white/5">
          {d.explore} <ArrowRight className="size-4" />
        </Link>
      }
    />
  );
}

function Exclusive() {
  const podcasts = useModule('podcasts');
  const fx = useScrollFx();
  // `limit` tidak didukung server (catalog/routes.ts) → dipotong di klien.
  const q = useQuery({ queryKey: ['shows', 'premium-page'], queryFn: () => api<{ data: Show[] }>('/v1/catalog/shows'), enabled: podcasts });
  const shows = (q.data?.data ?? []).slice(0, 8);
  const ref = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [dist, setDist] = useState(0); // jarak geser horizontal (px) = lebar rak − lebar layar
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const x = useTransform(p, [0.05, 0.95], [0, -dist]);
  const horizontal = fx && dist > 0;

  useLayoutEffect(() => {
    if (!fx || !track.current) return;
    const measure = () => setDist(Math.max(0, track.current!.scrollWidth - window.innerWidth + 64));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track.current);
    window.addEventListener('resize', measure);
    return () => (ro.disconnect(), window.removeEventListener('resize', measure));
  }, [fx, shows.length]);

  if (!podcasts) return null;
  if (!q.isLoading && !shows.length) return null;

  if (!fx)
    return (
      <Section>
        <ExclusiveHeading />
        <div className="-mx-4 mt-10 flex snap-x gap-4 overflow-x-auto px-4 pb-4 [scrollbar-width:none]">
          {q.isLoading && Array.from({ length: 4 }).map((_, i) => <div key={i} className="aspect-square w-60 shrink-0 animate-pulse rounded-none bg-white/5" />)}
          {shows.map((s) => (
            <div key={s.id} className="snap-start">
              <ShowCard s={s} />
            </div>
          ))}
        </div>
      </Section>
    );

  return (
    <section ref={ref} className="relative" style={{ height: horizontal ? `calc(100vh + ${dist}px)` : undefined }}>
      <div className={cx('flex flex-col justify-center overflow-hidden', horizontal ? 'sticky top-0 h-screen' : 'py-24')}>
        <div className="mx-auto w-full max-w-[82.5rem] px-4"><ExclusiveHeading /></div>
        <motion.div ref={track} style={{ x }} className="mt-12 flex w-max gap-5 pr-8 pl-[max(1rem,calc((100vw-72rem)/2+1rem))]">
          {q.isLoading && Array.from({ length: 5 }).map((_, i) => <div key={i} className="aspect-square w-72 shrink-0 animate-pulse rounded-none bg-white/5" />)}
          {shows.map((s) => (
            <ShowCard key={s.id} s={s} />
          ))}
        </motion.div>
        {horizontal && (
          <div className="mx-auto mt-10 h-1 w-48 overflow-hidden rounded-full bg-white/10" aria-hidden>
            <motion.div style={{ scaleX: p, transformOrigin: '0% 50%' }} className="h-full bg-rave-primary" />
          </div>
        )}
      </div>
    </section>
  );
}

// =============================================================================================
// FAQ & penutup
// =============================================================================================

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const d = useDict('public').premium;
  const FAQS = faqs(usePricing(), d.faq);
  return (
    <Section>
      <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
        <div>
          <Heading kicker="FAQ" title={d.faqTitle} />
        </div>
        <div className="divide-y divide-white/10 border-y border-white/10">
          {FAQS.map(([q, a], i) => (
            <div key={q}>
              <button className="flex w-full items-center justify-between gap-4 py-5 text-left text-lg font-bold" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                {q}
                <ChevronDown className={cx('size-5 shrink-0 text-white/50 transition', open === i && 'rotate-180')} />
              </button>
              <motion.div initial={false} animate={{ height: open === i ? 'auto' : 0, opacity: open === i ? 1 : 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                <p className="pb-5 leading-relaxed text-white/60">{a}</p>
              </motion.div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function ClosingCta() {
  const d = useDict('public').premium;
  return (
    <section className="px-4 pb-24">
      <WaveFrame>
        <div className="px-6 py-16 text-center md:py-20">
          <h2 className="text-5xl leading-[0.95] md:text-7xl">{d.closingTitle}</h2>
          <p className="mx-auto mt-4 max-w-xl text-white/75">{d.closingBody}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/app" className={BTN_PRIMARY}>
              {d.startListening}
            </Link>
            <a href={NOTIFY} className={cx(BTN_GHOST, 'bg-rave-ink/60 backdrop-blur')}>
              {d.remindMe}
            </a>
          </div>
        </div>
      </WaveFrame>
    </section>
  );
}

export default function Premium() {
  return (
    <div className="min-h-full overflow-x-clip bg-rave-ink text-rave-paper">
      <PublicNav />
      <main>
        <Hero />
        <Compare />
        <Plans />
        <Exclusive />
        <Faq />
        <ClosingCta />
      </main>
      <PublicFooter />
    </div>
  );
}
