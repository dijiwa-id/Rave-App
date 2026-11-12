import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  CalendarCheck2,
  ChevronDown,
  FileSignature,
  Headphones,
  Landmark,
  MapPin,
  Mic2,
  Music4,
  Radio,
  Search,
  ShieldCheck,
  Smartphone,
  Star,
  Ticket,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import CountUp from '@/components/reactbits/CountUp';
import { api, ApiError, fmt } from '@/lib/api';
import type { EventSummary, Paged } from '@/lib/types';
import { cx, toast } from '@/components/ui';
import { useModule } from '@/components/ModuleGate';
import { setting, usePlatformConfig } from '@/lib/platform';
import { usePricing } from '@/lib/pricing';
import { Hero, RaveBand } from './LandingHero';
import { Movement, RoleStack, Spotlight, WaveFrame, WhyRave, type RoleCard } from './LandingScroll';
import { BTN_PRIMARY, BTN_PRIMARY_SM, CARD_TITLE, Heading, Section } from './marketing';
import { PublicFooter, PublicNav } from './PublicChrome';
import { SponsorBanner, useSponsorAvailable } from '@/components/ads/SponsorBanner';
import { CmsBlock, useLanding, usePick } from '@/lib/landing';
import type { LandingSectionId } from '@rave/domain/landing';
import { localeTag, useDict } from '@/lib/i18n';
// Foto peran: Unsplash (lisensi bebas pakai), disimpan lokal.
import roleFan from '@/assets/landing/role-fan.webp';
import roleArtist from '@/assets/landing/role-artist.webp';
import rolePromotor from '@/assets/landing/role-promotor.webp';

// ---------------------------------------------------------------------------------------------
// Bukti sosial: angka (satu-satunya tempat statistik ditampilkan). Partner tampil di pita kuning (CMS).
// ---------------------------------------------------------------------------------------------

function TrustBar() {
  const { stats } = useLanding();
  const t = usePick();
  const d = useDict('public');
  return (
    <section className="border-b border-white/10 bg-rave-ink pt-20 pb-16" aria-label={d.statsAria}>
      <div className={cx('mx-auto grid max-w-[82.5rem] gap-4 px-4', ['grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-2 md:grid-cols-4'][stats.length - 1])}>
        {stats.map((x, i) => (
          <div key={i} className="text-center">
            <p className="font-display text-4xl leading-none text-rave-primary-text md:text-6xl">
              <CountUp to={x.value} duration={2} separator="." />
              {t(x.suffix)}
            </p>
            <p className="rave-label mt-2 !text-[10px] text-white/55 md:!text-[11px]">{t(x.label)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Ekosistem: tiga peran dalam satu grid (menggantikan tiga section terpisah yang berulang)
// ---------------------------------------------------------------------------------------------
/** Bagian non-teks kartu peran; teks dari kamus `roles.<id>` (fitur dipasangkan dengan ikon berdasarkan indeks). */
const ROLE_ART = [
  { id: 'fan', key: 'fan', image: roleFan, icons: [Music4, Mic2, Radio, Ticket], href: '/app' },
  { id: 'artis', key: 'artist', image: roleArtist, icons: [TrendingUp, CalendarCheck2, FileSignature, Wallet], href: '/studio' },
  { id: 'promotor', key: 'promotor', image: rolePromotor, icons: [Search, Users, Landmark, Ticket], href: '/promotor' },
] as const;

function useRoles(): RoleCard[] {
  const r = useDict('public').roles;
  return ROLE_ART.map((a) => {
    const c = r[a.key];
    return {
      id: a.id,
      image: a.image,
      alt: c.alt,
      label: c.label,
      title: c.title,
      body: c.body,
      features: a.icons.map((icon, i) => ({ icon, t: c.features[i] })),
      cta: c.cta,
      href: a.href,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Cara kerja + alur dana escrow
// ---------------------------------------------------------------------------------------------
function HowItWorks() {
  const d = useDict('public').how;
  const steps = [Headphones, CalendarCheck2, Mic2].map((icon, i) => ({ icon, ...d.steps[i] }));
  const escrow = d.escrow;
  return (
    <Section className="relative bg-[radial-gradient(60%_50%_at_50%_0%,rgba(91,42,110,0.14),transparent)]">
      <Heading center kicker={d.kicker} title={d.title} body={d.body} />
      <ol className="rave-tilt relative mt-16 grid gap-8 md:grid-cols-3">
        <span className="absolute top-12 right-[16%] left-[16%] hidden h-px bg-gradient-to-r from-transparent via-white/20 to-transparent md:block" aria-hidden />
        {steps.map((s, i) => (
          <li key={s.t} className="rave-card rave-taped group relative rounded-none p-8 pt-10 text-center">
            <span className="rave-catno absolute top-4 left-5">RV-00{i + 1}</span>
            <span className="rave-catno absolute top-4 right-5">Side {String.fromCharCode(65 + i)}</span>
            <span className="mx-auto grid size-16 -rotate-3 place-items-center rounded-none bg-rave-purple text-rave-primary-text shadow-[4px_4px_0_#181818] transition group-hover:rotate-0">
              <s.icon className="size-7" />
            </span>
            <p className="rave-stamp mt-7 text-rave-primary-text">{d.step(i + 1)}</p>
            <h3 className={cx('mt-2 text-4xl', CARD_TITLE)}>{s.t}</h3>
            <p className="mt-3 text-white/60">{s.b}</p>
          </li>
        ))}
      </ol>

      <div className="rave-card mt-12 rounded-none p-6 [--tilt:-0.4deg] md:p-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-6 text-rave-primary-text" />
            <h3 className={cx('text-3xl', CARD_TITLE)}>{d.escrowTitle}</h3>
          </div>
          <p className="text-xs text-white/40">{d.escrowNote}</p>
        </div>
        <ol className="mt-8 grid gap-6 sm:grid-cols-2 md:grid-cols-5 md:gap-4">
          {escrow.map((e, i) => (
            <li key={e.t}>
              <div className="flex items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-rave-primary/50 bg-rave-primary/10 text-sm font-black text-rave-primary-text">{i + 1}</span>
                {i < escrow.length - 1 && <span className="hidden h-px flex-1 bg-gradient-to-r from-rave-primary/50 to-transparent md:block" />}
              </div>
              <p className="mt-3 font-bold">{e.t}</p>
              <p className="text-sm text-white/50">{e.s}</p>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Event mendatang: kartu bergaya tiket (tanggal, lokasi, harga) — tanpa poster placeholder
// ---------------------------------------------------------------------------------------------
function UpcomingEvents() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['events', 'landing'],
    queryFn: () => api<Paged<EventSummary>>('/v1/ticketing/events', { query: { limit: 8 } }),
  });
  const events = data?.data ?? [];
  const t = useDict('public').events;
  return (
    <Section>
      <Heading
        kicker={t.kicker}
        title={t.title}
        body={t.body}
        action={
          <Link to="/app/events" className="inline-flex items-center gap-2 rounded-none border border-white/25 px-6 py-3 font-bold transition hover:border-white/60 hover:bg-white/5">
            {t.all} <ArrowRight className="size-4" />
          </Link>
        }
      />
      <div className="rave-tilt mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading && Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-56 animate-pulse rounded-none bg-white/5" />)}
        {isError && <p className="col-span-full text-white/50">{t.loadError}</p>}
        {!isLoading && !isError && !events.length && <p className="col-span-full text-white/50">{t.empty}</p>}
        {events.slice(0, 4).map((e) => {
          const d = new Date(e.starts_at);
          return (
            <Link
              key={e.id}
              to={`/e/${e.slug}`}
              className="rave-card group relative flex flex-col overflow-hidden rounded-none p-6"
            >
              <span className="absolute inset-x-0 top-0 h-2 bg-[repeating-linear-gradient(-45deg,#F4C21F_0_10px,#181818_10px_20px)] opacity-80 transition group-hover:opacity-100" aria-hidden />
              <span className="rave-sticker absolute top-5 right-4 bg-rave-berry px-2.5 py-0.5 font-label text-[10px] font-bold tracking-[0.18em] text-rave-paper uppercase [--sticker-r:6deg]">Gig</span>
              <div className="flex items-baseline gap-2">
                <span className="mt-2 font-display text-7xl leading-none text-rave-primary-text">{d.getDate()}</span>
                <span className="rave-label text-white/60">
                  {d.toLocaleDateString(localeTag(), { month: 'short' })} · {d.toLocaleDateString(localeTag(), { weekday: 'short' })}
                </span>
              </div>
              <h3 className="mt-5 line-clamp-2 text-lg leading-snug font-bold">{e.title}</h3>
              <p className="mt-2 flex items-start gap-1.5 text-sm text-white/55">
                <MapPin className="mt-0.5 size-3.5 shrink-0" /> {e.venue_name}, {e.city}
              </p>
              {/* Garis sobekan tiket */}
              <div className="relative my-5 border-t border-dashed border-white/15">
                <span className="absolute -top-3 -left-9 size-6 rounded-full border-2 border-white/15 bg-rave-ink" />
                <span className="absolute -top-3 -right-9 size-6 rounded-full border-2 border-white/15 bg-rave-ink" />
              </div>
              <div className="mt-auto flex items-center justify-between">
                <span className="text-sm">
                  <span className="text-white/50">{t.from}</span>
                  <span className="font-bold">{e.min_price != null ? fmt.idrShort(e.min_price) : '—'}</span>
                </span>
                <span className="grid size-9 place-items-center rounded-full bg-white/10 transition group-hover:bg-rave-primary group-hover:text-rave-on-primary">
                  <ArrowUpRight className="size-4" />
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </Section>
  );
}

function Testimonial() {
  const { testimonial: tm } = useLanding();
  const t = usePick();
  const initials = tm.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <Section>
      <figure className="rave-card-label rave-card rave-stapled rave-crumple relative mx-auto max-w-5xl rounded-none px-6 py-16 text-center [--tilt:-0.8deg] md:px-16">
        <span className="pointer-events-none absolute -top-6 left-6 font-display text-[9rem] leading-none text-rave-primary-text select-none md:left-10" aria-hidden>“</span>
        <span className="rave-stamp absolute right-6 bottom-5 text-rave-paper/70 [--stamp-r:4deg]">{t(tm.stamp)}</span>
        <blockquote className="relative mx-auto max-w-3xl font-display text-4xl leading-[1.02] text-balance uppercase md:text-5xl">
          {t(tm.quote)}
        </blockquote>
        <figcaption className="relative mt-8 flex items-center justify-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-rave-primary font-display text-base text-rave-on-primary">{initials}</span>
          <span className="text-left">
            <span className="block font-bold">{tm.name}</span>
            <span className="block text-sm text-white/50">{t(tm.role)}</span>
          </span>
        </figcaption>
      </figure>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Harga
// ---------------------------------------------------------------------------------------------
/** Stiker label harga: persegi dua baris (judul display + keterangan mono), garis tinta, bayangan sablon, miring. */
function PriceSticker({ top, bottom, tone }: { top: string; bottom: string; tone: 'mustard' | 'paper' }) {
  return (
    <span
      className={cx(
        'absolute -top-6 right-6 z-10 rotate-[5deg] border-2 border-rave-ink px-3.5 pt-1.5 pb-1 text-center text-rave-ink shadow-[3px_3px_0_#0b0a0c]',
        tone === 'mustard' ? 'bg-rave-primary' : 'bg-rave-paper',
      )}
    >
      <span className="block font-display text-2xl leading-none uppercase">{top}</span>
      <span className="mt-0.5 block font-label text-[9px] font-bold tracking-[0.16em] uppercase">{bottom}</span>
    </span>
  );
}

function Pricing() {
  const t = usePricing();
  const d = useDict('public').pricing;
  const fan = [
    { name: d.free, price: 'Rp 0', note: d.forever, items: d.freeItems, cta: d.startListening, href: '/app', hl: false },
    { name: 'Premium', price: `Rp ${t.individual}`, note: d.perMonth, items: d.premiumItems, cta: d.seePremium, href: '/premium', hl: true },
  ];
  const b2b = [
    { name: 'Starter', price: d.free, items: [...d.starterItems, d.artistCommission(t.artistCommission)] },
    { name: 'Pro', price: d.proPrice, items: [...d.proItems, d.proCommission(t.proArtistCommission, t.proPromotorFee)] },
    { name: 'Label', price: d.contactUs, items: d.labelItems },
  ];
  return (
    <section id="harga" className="rave-grain scroll-mt-20 bg-rave-paper px-4 py-20 text-rave-ink md:py-28">
      <div className="mx-auto max-w-[82.5rem]">
        <div className="text-center">
          <p className="rave-label inline-flex items-center gap-3 text-rave-purple before:h-[1.5px] before:w-8 before:bg-current">{d.kicker}</p>
          <h2 className="mt-4 text-[2.75rem] leading-[0.95] md:text-[4.25rem]">{d.title}</h2>
          <p className="mt-4 text-lg text-neutral-600">{d.body}</p>
        </div>
        <div className="rave-tilt mx-auto mt-14 grid max-w-4xl gap-10 md:grid-cols-2">
          {fan.map((p) => {
            const card = (
              <div className={cx('rave-card rave-taped relative flex h-full flex-col rounded-none p-8 text-left', p.hl ? 'rave-card-label text-rave-paper' : 'rave-card-paper')}>
                <PriceSticker tone={p.hl ? 'paper' : 'mustard'} top={p.hl ? d.stickerPick : d.free} bottom={p.hl ? d.stickerScene : d.forever} />
                <p className="rave-stamp self-start">{d.listener}</p>
                <h3 className="mt-4 font-display text-6xl leading-none uppercase">{p.name}</h3>
                <p className="mt-3 flex items-baseline gap-2">
                  <span className="font-display text-4xl leading-none">{p.price}</span>
                  <span className="font-label text-[11px] font-bold tracking-[0.1em] uppercase opacity-60">{p.note}</span>
                </p>
                <ul className="mt-6 flex-1 space-y-2.5">
                  {p.items.map((i) => (
                    <li key={i} className="flex gap-2">
                      <BadgeCheck className={cx('size-5 shrink-0', p.hl ? 'text-rave-primary-text' : 'text-emerald-600')} /> {i}
                    </li>
                  ))}
                </ul>
                <Link to={p.href} className={cx('mt-8 w-full', p.hl ? BTN_PRIMARY : cx(BTN_PRIMARY, '!border-rave-ink !bg-rave-ink !text-rave-paper hover:!bg-rave-purple'))}>
                  {p.cta}
                </Link>
              </div>
            );
            return <div key={p.name}>{card}</div>;
          })}
        </div>
        <h3 className={cx('mt-20 text-center text-3xl md:text-4xl', CARD_TITLE)}>{d.b2bTitle}</h3>
        <div className="rave-tilt mt-10 grid gap-8 md:grid-cols-3">
          {b2b.map((p, i) => (
            <div key={p.name} className="rave-card rave-card-paper relative rounded-none p-6">
              <span className="rave-catno absolute top-4 right-5">RV-PRO-{i + 1}</span>
              <h4 className={cx('text-3xl', CARD_TITLE)}>{p.name}</h4>
              <p className="mt-1 font-bold text-neutral-700">{p.price}</p>
              <ul className="mt-4 space-y-2 text-sm text-neutral-700">
                {p.items.map((i) => (
                  <li key={i} className="flex gap-2">
                    <BadgeCheck className="size-4 shrink-0 text-neutral-400" /> {i}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-center text-xs text-neutral-500">
          {d.footnote}
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// FAQ (dua kolom)
// ---------------------------------------------------------------------------------------------

function Faq() {
  const { faq } = useLanding();
  const t = usePick();
  const [open, setOpen] = useState<number | null>(0);
  const supportEmail = setting(usePlatformConfig(), 'general.support_email', 'bantuan@rave.id');
  const d = useDict('public').faq;
  return (
    <Section id="faq">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
        <div>
          <Heading kicker={d.kicker} title={d.title} />
          <p className="mt-4 text-white/60">
            {d.unanswered}{' '}
            <a href={`mailto:${supportEmail}`} className="font-bold text-white underline-offset-4 hover:underline">
              {d.contact}
            </a>
            .
          </p>
        </div>
        <div className="divide-y divide-white/10 border-y border-white/10">
          {faq.map(({ q: qq, a: aa }, i) => {
            const q = t(qq);
            const a = t(aa);
            return (
            <div key={i}>
              <button className="flex w-full items-center justify-between gap-4 py-5 text-left text-lg font-bold" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                {q}
                <ChevronDown className={cx('size-5 shrink-0 text-white/50 transition', open === i && 'rotate-180')} />
              </button>
              {open === i && <p className="pb-5 leading-relaxed text-white/60">{a}</p>}
            </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Penutup: waitlist + ketersediaan aplikasi (menggabungkan section "Unduh")
// ---------------------------------------------------------------------------------------------
const SEGMENTS = ['fan', 'artist', 'management', 'label', 'promotor'] as const;
/** Nilai kota disimpan apa adanya (termasuk 'Lainnya'); hanya label yang diterjemahkan. */
const CITIES = ['Jakarta', 'Bandung', 'Yogyakarta', 'Surabaya', 'Malang', 'Bali', 'Medan', 'Semarang', 'Makassar', 'Lainnya'];

function Waitlist() {
  const waitlistOpen = useModule('waitlist');
  const d = useDict('public').waitlist;
  const [form, setForm] = useState({ email: '', name: '', segment: 'fan', city: '', consent_marketing: false, referral_code: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ position: number; referral_code: string } | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ position: number; referral_code: string }>('/v1/waitlist', {
        body: { ...form, city: form.city || undefined, name: form.name || undefined, referral_code: form.referral_code || undefined },
        auth: false,
      });
      setDone(r);
    } catch (err) {
      toast.error(err instanceof ApiError && err.status === 409 ? d.alreadyRegistered : err);
    } finally {
      setBusy(false);
    }
  }
  const field = 'w-full rounded-none border-2 border-rave-ink bg-white px-4 py-3 text-rave-ink transition placeholder:text-rave-ink/40 focus:border-rave-purple focus:shadow-[3px_3px_0_#5B2A6E] focus:outline-none';
  const lbl = 'mb-1.5 block font-label text-[11px] font-bold tracking-[0.1em] uppercase';
  const slip = 'relative rotate-[0.8deg] border-2 border-rave-ink bg-rave-paper bg-[radial-gradient(rgba(24,24,24,0.06)_1px,transparent_1.2px)] bg-[length:6px_6px] text-rave-ink shadow-[6px_6px_0_#0b0a0c] rave-taped';
  return (
    <section id="waitlist" className="scroll-mt-20 px-4 pb-20 md:pb-24">
      <WaveFrame>
        <div className="relative grid items-center gap-12 p-8 md:grid-cols-2 md:p-14">
          <span className="absolute -top-5 left-8 z-10 -rotate-[4deg] border-2 border-rave-ink bg-rave-primary px-3.5 pt-1.5 pb-1 text-center text-rave-ink shadow-[3px_3px_0_#0b0a0c]">
            <span className="block font-display text-2xl leading-none uppercase">Early</span>
            <span className="mt-0.5 block font-label text-[9px] font-bold tracking-[0.16em] uppercase">access</span>
          </span>
          <div id="unduh" className="scroll-mt-24">
            <h2 className="text-[2.75rem] leading-[0.95] md:text-[4.25rem]">{d.title}</h2>
            <p className="mt-4 text-lg text-white/80">{d.body}</p>
            <ul className="mt-6 space-y-2.5 text-white/80">
              <li className="flex gap-2.5">
                <Star className="size-5 shrink-0" /> {d.perkReferral}
              </li>
              <li className="flex gap-2.5">
                <ShieldCheck className="size-5 shrink-0" /> {d.perkPdp}
              </li>
            </ul>
            <div className="mt-10 border-t border-white/15 pt-6">
              <p className="flex items-center gap-2 text-sm font-bold text-white/80">
                <Smartphone className="size-4" /> {d.listenAnywhere}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to="/app" className={BTN_PRIMARY_SM}>
                  {d.openWebPlayer}
                </Link>
                <span className="rave-label rounded-none border border-white/20 px-5 py-3 !text-[11px] text-white/50">{d.soon('App Store')}</span>
                <span className="rave-label rounded-none border border-white/20 px-5 py-3 !text-[11px] text-white/50">{d.soon('Google Play')}</span>
              </div>
            </div>
          </div>
          {!waitlistOpen ? (
            <div className={cx(slip, 'p-8 text-center')} role="status">
              <p className="rave-label">{d.closedTitle}</p>
              <p className="mt-3 text-rave-ink/80">{d.closedBody}</p>
              <Link to="/app" className={cx('mt-6', BTN_PRIMARY_SM)}>
                {d.openWebPlayer}
              </Link>
            </div>
          ) : done ? (
            <div className={cx(slip, 'p-8 text-center')} role="status">
              <p className="rave-label">{d.thanks}</p>
              <p className="mt-2 font-display text-7xl leading-none text-rave-purple">#{done.position}</p>
              <p className="mt-2 text-rave-ink/70">{d.yourPosition}</p>
              <p className="mt-6 text-sm">{d.shareReferral}</p>
              <p className="mt-2 inline-block border-2 border-rave-ink bg-white px-4 py-2 font-label text-lg font-bold text-rave-ink">{done.referral_code}</p>
            </div>
          ) : (
            <form onSubmit={submit} className={cx(slip, 'space-y-4 p-6 pt-8 md:p-8 md:pt-10')}>
              <div className="-mt-1 mb-2 flex items-center justify-between border-b-2 border-dashed border-rave-ink/30 pb-3">
                <span className="rave-label">{d.formTitle}</span>
                <span className="rave-catno">No. 001</span>
              </div>
              <label className="block">
                <span className={lbl}>{d.email}</span>
                <input required type="email" className={field} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={d.emailPlaceholder} autoComplete="email" />
              </label>
              <label className="block">
                <span className={lbl}>{d.nameOptional}</span>
                <input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={lbl}>{d.iAm}</span>
                  <select className={field} value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })}>
                    {SEGMENTS.map((v) => (
                      <option key={v} value={v} className="text-black">
                        {d.segments[v]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={lbl}>{d.city}</span>
                  <select className={field} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}>
                    <option value="" className="text-black">
                      {d.pickCity}
                    </option>
                    {CITIES.map((c) => (
                      <option key={c} value={c} className="text-black">
                        {c === 'Lainnya' ? d.otherCity : c}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className={lbl}>{d.referralOptional}</span>
                <input className={field} value={form.referral_code} onChange={(e) => setForm({ ...form, referral_code: e.target.value })} />
              </label>
              <label className="flex items-start gap-3 text-sm text-rave-ink/80">
                <input type="checkbox" className="mt-1 size-4 accent-[#5B2A6E]" checked={form.consent_marketing} onChange={(e) => setForm({ ...form, consent_marketing: e.target.checked })} />
                {d.consent}
              </label>
              <button disabled={busy} className={cx('w-full', BTN_PRIMARY)}>
                {busy ? d.submitting : d.submit}
              </button>
            </form>
          )}
        </div>
      </WaveFrame>
    </section>
  );
}

export default function Landing() {
  const ticketing = useModule('ticketing');
  const { sections: on, order } = useLanding();
  const d = useDict('public');
  const names = useDict('cms').sectionNames;
  const sponsorOn = useSponsorAvailable();
  const roles = useRoles();
  // Section di bawah hero & pita: urutan & visibilitas dari CMS (Editor Landing).
  const render: Record<LandingSectionId, () => ReactNode> = {
    stats: () => <TrustBar />,
    why: () => <WhyRave />,
    spotlight: () => <Spotlight />,
    roles: () => <RoleStack roles={roles} heading={<Heading kicker={d.roles.kicker} title={d.roles.title} body={d.roles.body} />} />,
    how: () => <HowItWorks />,
    events: () => (ticketing ? <UpcomingEvents /> : null),
    testimonial: () => <Testimonial />,
    sponsor: () =>
      sponsorOn && (
      <section aria-label={d.sponsorAria} className="px-4">
        <div className="mx-auto max-w-[82.5rem]">
          <SponsorBanner />
        </div>
      </section>
      ),
    movement: () => <Movement />,
    pricing: () => <Pricing />,
    faq: () => <Faq />,
    waitlist: () => <Waitlist />,
  };
  return (
    <div className="min-h-full overflow-x-clip bg-rave-ink text-rave-paper">
      <PublicNav />
      <main>
        <CmsBlock id="hero" label={names.hero}>
          <Hero />
        </CmsBlock>
        <CmsBlock id="band" label={names.band}>
          <RaveBand />
        </CmsBlock>
        {order.map((id) =>
          on[id] ? (
            <CmsBlock key={id} id={id} label={names[id]}>
              {render[id]()}
            </CmsBlock>
          ) : null,
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
