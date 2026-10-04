import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
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
  Star,
  Ticket,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import Aurora from '@/components/reactbits/Aurora';
import BlurText from '@/components/reactbits/BlurText';
import RotatingText from '@/components/reactbits/RotatingText';
import LogoLoop from '@/components/reactbits/LogoLoop';
import CountUp from '@/components/reactbits/CountUp';
import SpotlightCard from '@/components/reactbits/SpotlightCard';
import TiltedCard from '@/components/reactbits/TiltedCard';
import StarBorder from '@/components/reactbits/StarBorder';
import ShinyText from '@/components/reactbits/ShinyText';
import FadeContent from '@/components/reactbits/FadeContent';
import { api, ApiError, fmt } from '@/lib/api';
import type { EventSummary, Paged } from '@/lib/types';
import { cx, toast } from '@/components/ui';
import { PublicFooter, PublicNav } from './PublicChrome';

type Audience = 'fan' | 'artist' | 'promotor';
const AUDIENCE: Record<Audience, { label: string; pitch: string; cta: string; href: string; secondary: string; secondaryHref: string }> = {
  fan: {
    label: 'Fan',
    pitch: 'Semua musik gratis tanpa batas — kualitas lossless, lirik sinkron, dan tahu duluan kapan idolamu manggung di kotamu.',
    cta: 'Mulai dengarkan',
    href: '/app',
    secondary: 'Unduh aplikasi',
    secondaryHref: '#unduh',
  },
  artist: {
    label: 'Artis & Manajemen',
    pitch: 'Data pendengarmu jadi portofolio jualan. EPK dinamis, kalender anti bentrok, kontrak otomatis, dibayar pasti lewat rekening bersama.',
    cta: 'Daftar sebagai Artis',
    href: '/studio',
    secondary: 'Gabung waitlist',
    secondaryHref: '#waitlist',
  },
  promotor: {
    label: 'Promotor',
    pitch: 'Temukan artis dengan basis pendengar nyata di kotamu, sesuai budget, dengan jaminan kontrak dan dana aman.',
    cta: 'Daftar sebagai Promotor',
    href: '/promotor',
    secondary: 'Gabung waitlist',
    secondaryHref: '#waitlist',
  },
};

const PARTNERS = ['Rekam Pinggir', 'Kolektif Selatan', 'Sora Records', 'BEM Nusantara', 'Pensi Kita', 'Gigs Bandung', 'Ruang Dengar', 'Lokananta Muda', 'Suara Timur'];

function Hero() {
  const [aud, setAud] = useState<Audience>('fan');
  const a = AUDIENCE[aud];
  return (
    <section className="relative isolate overflow-hidden bg-black">
      <div className="absolute inset-0 -z-10 opacity-80" aria-hidden>
        <Aurora colorStops={['#1ed760', '#7c3aed', '#e8115b']} amplitude={1.1} blend={0.55} speed={0.6} />
      </div>
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-black/40 to-black" aria-hidden />
      <div className="mx-auto max-w-6xl px-4 pt-20 pb-24 md:pt-28 md:pb-32">
        <ShinyText text="Platform ekosistem musik indie & off-air Indonesia" className="text-sm font-semibold tracking-wide" speed={3} />
        <h1 className="mt-6 max-w-4xl text-5xl leading-[1.02] font-black tracking-tighter md:text-7xl lg:text-8xl">
          <BlurText text="Dengar gratis." animateBy="words" delay={120} className="block" />
          <BlurText text="Datang ke panggungnya." animateBy="words" delay={120} className="block text-gema-green" />
          <BlurText text="Dukung langsung." animateBy="words" delay={120} className="block" />
        </h1>
        <div className="mt-8 flex flex-wrap items-center gap-2 text-lg font-semibold md:text-2xl">
          <span className="text-white/80">Musik</span>
          <RotatingText
            texts={['indie', 'lokal', 'kotamu', 'lossless', 'tanpa batas']}
            mainClassName="overflow-hidden rounded-lg bg-gema-green px-3 py-0.5 text-black"
            staggerFrom="last"
            staggerDuration={0.025}
            splitLevelClassName="overflow-hidden pb-0.5"
            rotationInterval={2200}
            transition={{ type: 'spring', damping: 30, stiffness: 400 }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '-120%' }}
          />
        </div>

        <div className="mt-12 inline-flex rounded-full bg-white/10 p-1 backdrop-blur" role="tablist" aria-label="Pilih audiens">
          {(Object.keys(AUDIENCE) as Audience[]).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={aud === k}
              onClick={() => setAud(k)}
              className={cx('rounded-full px-4 py-2 text-sm font-bold transition md:px-6', aud === k ? 'bg-white text-black' : 'text-white/80 hover:text-white')}
            >
              {AUDIENCE[k].label}
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={aud} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
            <p className="mt-6 max-w-2xl text-lg text-white/85 md:text-xl">{a.pitch}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={a.href} className="rounded-full bg-gema-green px-8 py-4 font-bold text-black transition hover:scale-105">
                {a.cta}
              </Link>
              <a href={a.secondaryHref} className="rounded-full border border-white/50 px-8 py-4 font-bold hover:border-white">
                {a.secondary}
              </a>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

function SocialProof() {
  return (
    <section className="border-y border-white/10 bg-black py-14" aria-label="Mitra dan statistik">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 text-center sm:grid-cols-3">
        {[
          { n: 500, s: '+', l: 'artis indie terkurasi' },
          { n: 5, s: ' kota', l: 'peluncuran closed beta' },
          { n: 100, s: '+', l: 'promotor & EO kampus' },
        ].map((x) => (
          <div key={x.l}>
            <p className="text-5xl font-black text-white">
              <CountUp to={x.n} duration={2} separator="." />
              {x.s}
            </p>
            <p className="mt-1 text-gema-muted">{x.l}</p>
          </div>
        ))}
      </div>
      <div className="mt-12">
        <LogoLoop
          logos={PARTNERS.map((p) => ({ node: <span className="text-xl font-extrabold tracking-tight whitespace-nowrap text-white/50">{p}</span>, title: p }))}
          speed={60}
          gap={56}
          logoHeight={28}
          fadeOut
          fadeOutColor="#000000"
          pauseOnHover
          ariaLabel="Label dan komunitas mitra"
        />
      </div>
      <blockquote className="mx-auto mt-12 max-w-3xl px-4 text-center text-xl text-white/80 italic">
        “Akhirnya data pendengar kami di Bandung bisa jadi bahan pitching ke promotor — dan DP-nya aman di rekening bersama.”
        <footer className="mt-3 text-sm text-gema-muted not-italic">— Senja Kolektif, band indie Bandung</footer>
      </blockquote>
    </section>
  );
}

function Feature({ icon: Icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <SpotlightCard className="h-full !rounded-2xl !border-white/10 !bg-[#111] !p-6" spotlightColor="rgba(30, 215, 96, 0.18)">
      <Icon className="size-7 text-gema-green" />
      <h3 className="mt-4 text-lg font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-gema-muted">{body}</p>
    </SpotlightCard>
  );
}

function Pillar({ id, kicker, title, body, cta, href, features, accent }: { id: string; kicker: string; title: string; body: string; cta: string; href: string; features: { icon: any; title: string; body: string }[]; accent: string }) {
  return (
    <section id={id} className="bg-black px-4 py-24">
      <FadeContent blur duration={800} className="mx-auto max-w-6xl">
        <p className="text-sm font-bold tracking-[0.14em] uppercase" style={{ color: accent }}>
          {kicker}
        </p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <h2 className="text-4xl font-black tracking-tight md:text-5xl">{title}</h2>
            <p className="mt-4 text-lg text-gema-muted">{body}</p>
          </div>
          <Link to={href} className="rounded-full bg-white px-7 py-3.5 font-bold text-black hover:scale-105">
            {cta}
          </Link>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <Feature key={f.title} {...f} />
          ))}
        </div>
      </FadeContent>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { icon: Headphones, t: 'Dengar', b: 'Fan streaming gratis. Setiap pemutaran ≥30 detik menjadi data permintaan pasar per kota.' },
    { icon: CalendarCheck2, t: 'Booking', b: 'Promotor menemukan artis lewat Audience Match, negosiasi terstruktur, lalu kontrak elektronik.' },
    { icon: Mic2, t: 'Panggung', b: 'Fan dapat tiket presale, artis tampil, dana cair H+1 setelah show — langsung terbagi ke tim.' },
  ];
  const escrow = [
    { t: 'Kontrak ditandatangani', s: 'Invoice DP 50% terbit' },
    { t: 'Promotor bayar DP', s: 'Dana ditahan mitra escrow berizin' },
    { t: 'Pelunasan sebelum H-7', s: 'Status Booked & Secured' },
    { t: 'Show selesai', s: 'Jendela dispute 24 jam' },
    { t: 'Pencairan H+1', s: 'Split otomatis + bukti potong PPh' },
  ];
  return (
    <section className="bg-gradient-to-b from-black to-[#0b1a10] px-4 py-24">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-center text-4xl font-black tracking-tight md:text-5xl">Cara kerja GEMA</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-gema-muted">Satu lingkaran data: dengar → datang → dukung.</p>
        <ol className="mt-14 grid gap-6 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.t} className="relative rounded-2xl bg-white/5 p-8">
              <span className="absolute top-6 right-6 text-6xl font-black text-white/10">{i + 1}</span>
              <s.icon className="size-9 text-gema-green" />
              <h3 className="mt-5 text-2xl font-extrabold">{s.t}</h3>
              <p className="mt-2 text-gema-muted">{s.b}</p>
            </li>
          ))}
        </ol>
        <div className="mt-16 rounded-2xl border border-gema-green/30 bg-black/40 p-6 md:p-10">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-7 text-gema-green" />
            <h3 className="text-xl font-extrabold">Alur dana rekening bersama (escrow)</h3>
          </div>
          <ol className="mt-8 grid gap-4 md:grid-cols-5">
            {escrow.map((e, i) => (
              <li key={e.t} className="relative">
                <div className="flex items-center gap-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gema-green text-sm font-black text-black">{i + 1}</span>
                  {i < escrow.length - 1 && <span className="hidden h-0.5 flex-1 bg-gradient-to-r from-gema-green to-gema-green/10 md:block" />}
                </div>
                <p className="mt-3 font-bold">{e.t}</p>
                <p className="text-sm text-gema-muted">{e.s}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-xs text-gema-subtle">GEMA tidak menampung dana di rekening operasionalnya; dana dikelola mitra pembayaran berizin Bank Indonesia.</p>
        </div>
      </div>
    </section>
  );
}

function UpcomingEvents() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['events', 'landing'],
    queryFn: () => api<Paged<EventSummary>>('/v1/ticketing/events', { query: { limit: 8 } }),
  });
  const events = data?.data ?? [];
  return (
    <section className="bg-black px-4 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-4xl font-black tracking-tight md:text-5xl">Event mendatang</h2>
            <p className="mt-2 text-gema-muted">Konser, tur, launching album, dan gig kampus dari artis di GEMA.</p>
          </div>
          <Link to="/app/events" className="hidden rounded-full border border-white/40 px-6 py-3 font-bold hover:border-white sm:inline-block">
            Lihat semua event
          </Link>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {isLoading && Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-80 animate-pulse rounded-2xl bg-white/5" />)}
          {isError && <p className="col-span-full text-gema-muted">Jadwal event belum dapat dimuat.</p>}
          {!isLoading && !isError && !events.length && <p className="col-span-full text-gema-muted">Belum ada event terjadwal — segera hadir.</p>}
          {events.slice(0, 4).map((e) => (
            <Link key={e.id} to={`/e/${e.slug}`} className="group block">
              <TiltedCard
                imageSrc={e.poster_url ?? `https://picsum.photos/seed/gema-ev-${e.id}/600/600`}
                altText={e.title}
                captionText={e.title}
                containerHeight="260px"
                containerWidth="100%"
                imageHeight="260px"
                imageWidth="100%"
                rotateAmplitude={10}
                scaleOnHover={1.04}
                showMobileWarning={false}
                showTooltip={false}
              />
              <p className="mt-4 text-xs font-bold tracking-wide text-gema-green uppercase">{fmt.date(e.starts_at, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
              <p className="mt-1 font-bold group-hover:underline">{e.title}</p>
              <p className="flex items-center gap-1 text-sm text-gema-muted">
                <MapPin className="size-3.5" /> {e.venue_name}, {e.city}
              </p>
              {e.min_price != null && <p className="mt-1 text-sm">Mulai {fmt.idr(e.min_price)}</p>}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const fan = [
    { name: 'Gratis', price: 'Rp 0', note: 'selamanya', items: ['Musik tanpa batas, on-demand', 'Lossless & Hi-Res (opt-in Wi-Fi)', 'Lirik sinkron & playlist', 'Info event & presale fan setia', 'Iklan sesekali'], cta: 'Mulai dengarkan', href: '/app', hl: false },
    { name: 'Premium', price: 'Rp 49.900', note: '/bulan', items: ['Semua fitur Gratis', 'Podcast premium & audio fiksi', 'Bebas iklan', 'Unduhan tanpa batas', 'Early access tiket'], cta: 'Lihat paket Premium', href: '/premium', hl: true },
  ];
  const b2b = [
    { name: 'Starter', price: 'Gratis', items: ['EPK dinamis & rate card', 'Kalender & inbox booking', 'Komisi artis 7%'] },
    { name: 'Pro', price: 'Rp 199.000/bln', items: ['Analitik lanjutan & ekspor', 'Kontrak kustom', 'Komisi artis 5% · promotor 3%'] },
    { name: 'Label', price: 'Hubungi kami', items: ['Multi-roster & batas harga', 'Ingest katalog massal', 'Laporan royalti terpusat'] },
  ];
  return (
    <section id="harga" className="bg-[#f6f6f4] px-4 py-24 text-black">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-center text-4xl font-black tracking-tight md:text-5xl">Harga transparan</h2>
        <p className="mt-3 text-center text-neutral-600">Musik gratis untuk semua. Kami dibayar ketika panggung terjadi.</p>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {fan.map((p) => {
            const card = (
              <div className={cx('flex h-full flex-col rounded-2xl p-8 text-left', p.hl ? 'bg-black text-white' : 'border border-neutral-200 bg-white')}>
                <p className="text-sm font-bold tracking-wide uppercase opacity-70">Fan</p>
                <h3 className="mt-1 text-3xl font-black">{p.name}</h3>
                <p className="mt-2 text-2xl font-extrabold">
                  {p.price}
                  <span className="text-base font-normal opacity-60"> {p.note}</span>
                </p>
                <ul className="mt-6 flex-1 space-y-2">
                  {p.items.map((i) => (
                    <li key={i} className="flex gap-2">
                      <BadgeCheck className={cx('size-5 shrink-0', p.hl ? 'text-gema-green' : 'text-emerald-600')} /> {i}
                    </li>
                  ))}
                </ul>
                <Link to={p.href} className={cx('mt-8 rounded-full py-3.5 text-center font-bold', p.hl ? 'bg-gema-green text-black' : 'bg-black text-white')}>
                  {p.cta}
                </Link>
              </div>
            );
            return p.hl ? (
              <StarBorder key={p.name} as="div" className="w-full !rounded-2xl" color="#1ed760" speed="5s" thickness={2}>
                {card}
              </StarBorder>
            ) : (
              <div key={p.name}>{card}</div>
            );
          })}
        </div>
        <h3 className="mt-16 text-center text-2xl font-black">GEMA Pro untuk artis, manajemen, label & promotor</h3>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {b2b.map((p) => (
            <div key={p.name} className="rounded-2xl border border-neutral-200 bg-white p-6">
              <h4 className="text-xl font-black">{p.name}</h4>
              <p className="mt-1 font-bold text-neutral-700">{p.price}</p>
              <ul className="mt-4 space-y-1.5 text-sm text-neutral-700">
                {p.items.map((i) => (
                  <li key={i}>• {i}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-neutral-500">
          Komisi booking off-air: promotor 3–5% (service fee) + artis 5–8% dari fee. Biaya payment & komisi tidak direfund kecuali kesalahan sistem GEMA. Angka bersifat indikatif selama beta.
        </p>
      </div>
    </section>
  );
}

const FAQS = [
  ['Bagaimana royalti streaming dihitung?', 'GEMA memakai model user-centric (hybrid): pendapatan dari seorang pendengar hanya dibagi ke artis yang ia dengarkan. Hanya pemutaran ≥30 detik yang lolos deteksi fraud yang dihitung. Statement bulanan terbit paling lambat tanggal 15 bulan berikutnya, rinci per lagu dan pemegang hak.'],
  ['Apakah dana booking aman?', 'Pembayaran promotor ditahan di rekening bersama (escrow) milik mitra pembayaran berizin — bukan rekening operasional GEMA. Dana baru dicairkan H+1 setelah show selesai tanpa sengketa, dan otomatis dibagi sesuai kontrak.'],
  ['Bagaimana GEMA melindungi hak cipta?', 'Setiap unggahan melewati audio fingerprint, verifikasi identitas pengunggah, dan persetujuan split hak. Klaim pelanggaran ditangani dengan mekanisme notice-and-takedown maksimal 2×24 jam.'],
  ['Katalog saya sudah ada di GEMA, bagaimana klaim profil?', 'Masuk ke Artist Studio, pilih "Klaim profil", lalu verifikasi melalui akun media sosial resmi atau konfirmasi dari label/distributor Anda.'],
  ['Apakah musik benar-benar gratis?', 'Ya. Streaming, playlist, lirik, kualitas audio terbaik, dan pemutaran tanpa batas gratis untuk semua pengguna terdaftar. Premium hanya untuk podcast premium, audio fiksi, dan pengalaman bebas iklan.'],
];

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="bg-black px-4 py-24">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-center text-4xl font-black tracking-tight">Pertanyaan umum</h2>
        <div className="mt-10 divide-y divide-white/10 border-y border-white/10">
          {FAQS.map(([q, a], i) => (
            <div key={q}>
              <button className="flex w-full items-center justify-between gap-4 py-5 text-left text-lg font-bold" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                {q}
                <ChevronDown className={cx('size-5 shrink-0 transition', open === i && 'rotate-180')} />
              </button>
              {open === i && <p className="pb-5 leading-relaxed text-gema-muted">{a}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const SEGMENTS = [
  ['fan', 'Fan / Pendengar'],
  ['artist', 'Artis / Band'],
  ['management', 'Manajemen Artis'],
  ['label', 'Label / Publisher'],
  ['promotor', 'Promotor / EO'],
] as const;
const CITIES = ['Jakarta', 'Bandung', 'Yogyakarta', 'Surabaya', 'Malang', 'Bali', 'Medan', 'Semarang', 'Makassar', 'Lainnya'];

function Waitlist() {
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
      toast.error(err instanceof ApiError && err.status === 409 ? 'Email ini sudah terdaftar di waitlist.' : err);
    } finally {
      setBusy(false);
    }
  }
  const field = 'w-full rounded-lg border border-white/20 bg-white/5 px-4 py-3 text-white placeholder:text-white/40 focus:border-gema-green focus:outline-none';
  return (
    <section id="waitlist" className="bg-gradient-to-br from-[#450af5] via-[#7c3aed] to-[#e8115b] px-4 py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2">
        <div>
          <h2 className="text-4xl font-black tracking-tight md:text-5xl">Gabung lebih awal.</h2>
          <p className="mt-4 text-lg text-white/85">Pra-registrasi untuk fan, artis, manajemen, label, dan promotor. Program Founding Artist: take rate lebih rendah selama 12 bulan.</p>
          <ul className="mt-6 space-y-2 text-white/85">
            <li className="flex gap-2">
              <Star className="size-5" /> Kode referral untuk prioritas akses
            </li>
            <li className="flex gap-2">
              <ShieldCheck className="size-5" /> Data diproses sesuai UU PDP
            </li>
          </ul>
        </div>
        {done ? (
          <div className="rounded-2xl bg-black/40 p-8 text-center backdrop-blur" role="status">
            <p className="text-sm font-bold tracking-wide uppercase">Terima kasih!</p>
            <p className="mt-2 text-5xl font-black">#{done.position}</p>
            <p className="mt-2 text-white/80">posisi kamu di antrean</p>
            <p className="mt-6 text-sm">Bagikan kode referral untuk naik antrean:</p>
            <p className="mt-2 inline-block rounded-lg bg-white px-4 py-2 font-mono text-lg font-bold text-black">{done.referral_code}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-2xl bg-black/40 p-6 backdrop-blur md:p-8">
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold">Email</span>
              <input required type="email" className={field} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="nama@email.com" autoComplete="email" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold">Nama (opsional)</span>
              <input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-bold">Saya adalah</span>
                <select className={field} value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })}>
                  {SEGMENTS.map(([v, l]) => (
                    <option key={v} value={v} className="text-black">
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-bold">Kota</span>
                <select className={field} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}>
                  <option value="" className="text-black">
                    Pilih kota
                  </option>
                  {CITIES.map((c) => (
                    <option key={c} className="text-black">
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-sm font-bold">Kode referral (opsional)</span>
              <input className={field} value={form.referral_code} onChange={(e) => setForm({ ...form, referral_code: e.target.value })} />
            </label>
            <label className="flex items-start gap-3 text-sm text-white/85">
              <input type="checkbox" className="mt-1 size-4 accent-gema-green" checked={form.consent_marketing} onChange={(e) => setForm({ ...form, consent_marketing: e.target.checked })} />
              Saya bersedia menerima informasi pemasaran dari GEMA. (Opsional — dapat ditarik kapan saja.)
            </label>
            <button disabled={busy} className="w-full rounded-full bg-white py-3.5 font-bold text-black transition hover:scale-[1.02] disabled:opacity-60">
              {busy ? 'Mendaftarkan…' : 'Gabung waitlist'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

function DownloadBand() {
  return (
    <section id="unduh" className="bg-black px-4 py-20 text-center">
      <Radio className="mx-auto size-10 text-gema-green" />
      <h2 className="mt-4 text-3xl font-black">Dengarkan di mana saja</h2>
      <p className="mt-2 text-gema-muted">iOS, Android, dan web. Mode hemat data, unduhan offline terenkripsi.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link to="/app" className="rounded-full bg-white px-8 py-3.5 font-bold text-black hover:scale-105">
          Buka Web Player
        </Link>
        <span className="rounded-full border border-white/30 px-8 py-3.5 font-bold text-white/60">App Store · segera</span>
        <span className="rounded-full border border-white/30 px-8 py-3.5 font-bold text-white/60">Google Play · segera</span>
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <div className="min-h-full bg-black text-white">
      <PublicNav />
      <main>
        <Hero />
        <SocialProof />
        <Pillar
          id="fan"
          kicker="Untuk Fan"
          title="Semua gratis. Kualitas terbaik."
          body="Tanpa batas skip, tanpa batas jam. Dari indie kotamu sampai podcast dan cerita fiksi berseri."
          cta="Mulai dengarkan"
          href="/app"
          accent="#1ed760"
          features={[
            { icon: Music4, title: 'Lossless & Hi-Res', body: 'AAC hingga 320 kbps, FLAC 16-bit, Hi-Res 24-bit bila master tersedia.' },
            { icon: Mic2, title: 'Lirik sinkron', body: 'Ikuti baris demi baris, mode karaoke, bagikan potongan lirik.' },
            { icon: Radio, title: 'Podcast & cerita', body: 'Podcast premium dan audio fiksi misteri, horor, romansa.' },
            { icon: Ticket, title: 'Presale fan setia', body: 'Top listener dapat akses tiket duluan — tanpa rebutan dengan calo.' },
          ]}
        />
        <Pillar
          id="artis"
          kicker="Untuk Artis & Manajemen"
          title="Kelola karier & panggung dalam satu dasbor."
          body="Data streaming otomatis menjadi EPK yang bisa dijual ke promotor. Tanpa double booking, tanpa DP hilang."
          cta="Daftar sebagai Artis"
          href="/studio"
          accent="#a78bfa"
          features={[
            { icon: TrendingUp, title: 'EPK dinamis', body: 'Pendengar bulanan, top kota, demografi — diperbarui otomatis.' },
            { icon: CalendarCheck2, title: 'Kalender anti bentrok', body: 'Hold 1st/2nd, deteksi konflik geografis, sinkron Google Calendar.' },
            { icon: FileSignature, title: 'Kontrak otomatis', body: 'Draf dari hasil negosiasi, tanda tangan elektronik tersertifikasi.' },
            { icon: Wallet, title: 'Split otomatis', body: 'Fee show terbagi ke anggota, kru, dan manajemen saat pencairan.' },
          ]}
        />
        <Pillar
          id="promotor"
          kicker="Untuk Promotor"
          title="Temukan & booking artis dengan aman."
          body="Cari berdasarkan audiens nyata di kota acaramu, harga transparan, dana aman di rekening bersama."
          cta="Daftar sebagai Promotor"
          href="/promotor"
          accent="#f59b23"
          features={[
            { icon: Search, title: 'Audience Match', body: 'Skor kecocokan artis dengan pendengar aktif di kota event.' },
            { icon: Users, title: 'Rating dua arah', body: 'Reputasi artis & promotor dari show yang benar-benar terjadi.' },
            { icon: Landmark, title: 'Escrow berizin', body: 'DP & pelunasan ditahan mitra berizin, refund sesuai matriks.' },
            { icon: Ticket, title: 'Tiket & check-in', body: 'Jual tiket, QR dinamis anti-screenshot, scanner offline.' },
          ]}
        />
        <HowItWorks />
        <UpcomingEvents />
        <Pricing />
        <Faq />
        <Waitlist />
        <DownloadBand />
      </main>
      <PublicFooter />
    </div>
  );
}
