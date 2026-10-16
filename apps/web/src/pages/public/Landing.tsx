import { useState, type FormEvent } from 'react';
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
import LogoLoop from '@/components/reactbits/LogoLoop';
import CountUp from '@/components/reactbits/CountUp';
import StarBorder from '@/components/reactbits/StarBorder';
import { api, ApiError, fmt } from '@/lib/api';
import type { EventSummary, Paged } from '@/lib/types';
import { cx, toast } from '@/components/ui';
import { useModule } from '@/components/ModuleGate';
import { setting, usePlatformConfig } from '@/lib/platform';
import { usePricing } from '@/lib/pricing';
import { Hero } from './LandingHero';
import { BRAND_GRADIENT, Heading, Section } from './marketing';
import { PublicFooter, PublicNav } from './PublicChrome';
// Foto peran: Unsplash (lisensi bebas pakai), disimpan lokal.
import roleFan from '@/assets/landing/role-fan.webp';
import roleArtist from '@/assets/landing/role-artist.webp';
import rolePromotor from '@/assets/landing/role-promotor.webp';

// ---------------------------------------------------------------------------------------------
// Bukti sosial: angka + komunitas mitra (satu-satunya tempat statistik ditampilkan)
// ---------------------------------------------------------------------------------------------
const PARTNERS = ['Rekam Pinggir', 'Kolektif Selatan', 'Sora Records', 'BEM Nusantara', 'Pensi Kita', 'Gigs Bandung', 'Ruang Dengar', 'Lokananta Muda', 'Suara Timur'];
const STATS = [
  { n: 500, s: '+', l: 'artis indie terkurasi' },
  { n: 5, s: ' kota', l: 'peluncuran closed beta' },
  { n: 100, s: '+', l: 'promotor & EO kampus' },
];

function TrustBar() {
  return (
    <section className="border-y border-white/10 bg-black py-12" aria-label="Statistik dan komunitas mitra">
      <div className="mx-auto grid max-w-6xl grid-cols-3 gap-4 px-4">
        {STATS.map((x) => (
          <div key={x.l} className="text-center">
            <p className="text-3xl font-black text-white md:text-5xl">
              <CountUp to={x.n} duration={2} separator="." />
              {x.s}
            </p>
            <p className="mt-1 text-xs text-white/50 md:text-sm">{x.l}</p>
          </div>
        ))}
      </div>
      <p className="mt-10 text-center text-xs font-bold tracking-[0.16em] text-white/40 uppercase">Tumbuh bersama label & komunitas independen</p>
      <div className="mt-5">
        <LogoLoop
          logos={PARTNERS.map((p) => ({ node: <span className="text-lg font-extrabold tracking-tight whitespace-nowrap text-white/40">{p}</span>, title: p }))}
          speed={50}
          gap={56}
          logoHeight={26}
          fadeOut
          fadeOutColor="#000000"
          pauseOnHover
          ariaLabel="Label dan komunitas mitra"
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Ekosistem: tiga peran dalam satu grid (menggantikan tiga section terpisah yang berulang)
// ---------------------------------------------------------------------------------------------
const ROLES = [
  {
    id: 'fan',
    image: roleFan,
    alt: 'Penonton konser di depan panggung bercahaya',
    label: 'Untuk pendengar',
    title: 'Semua gratis. Kualitas terbaik.',
    body: 'Tanpa batas skip, tanpa batas jam — dari indie kotamu hingga podcast dan cerita fiksi berseri.',
    features: [
      { icon: Music4, t: 'Lossless & Hi-Res gratis' },
      { icon: Mic2, t: 'Lirik sinkron & mode karaoke' },
      { icon: Radio, t: 'Live streaming konser' },
      { icon: Ticket, t: 'Presale untuk fan setia' },
    ],
    cta: 'Mulai mendengarkan',
    href: '/app',
  },
  {
    id: 'artis',
    image: roleArtist,
    alt: 'Mikrofon vintage di studio dengan cahaya bokeh',
    label: 'Untuk artis & manajemen',
    title: 'Karier dan panggung dalam satu dasbor.',
    body: 'Data streaming otomatis menjadi EPK yang menjual — tanpa double booking, tanpa DP hilang.',
    features: [
      { icon: TrendingUp, t: 'EPK dinamis dari data pendengar' },
      { icon: CalendarCheck2, t: 'Kalender anti-bentrok' },
      { icon: FileSignature, t: 'Kontrak & tanda tangan digital' },
      { icon: Wallet, t: 'Split fee otomatis ke tim' },
    ],
    cta: 'Buka Artist Studio',
    href: '/studio',
  },
  {
    id: 'promotor',
    image: rolePromotor,
    alt: 'Panggung festival dengan lampu kuning di depan ribuan penonton',
    label: 'Untuk promotor & EO',
    title: 'Booking artis yang tepat, dengan aman.',
    body: 'Cari berdasarkan audiens nyata di kota acaramu, harga transparan, dana aman di rekening bersama.',
    features: [
      { icon: Search, t: 'Audience Match per kota' },
      { icon: Users, t: 'Rating dua arah terverifikasi' },
      { icon: Landmark, t: 'Escrow mitra berizin BI' },
      { icon: Ticket, t: 'Tiket QR & check-in' },
    ],
    cta: 'Buka Promotor Hub',
    href: '/promotor',
  },
];

function Ecosystem() {
  return (
    <Section id="ekosistem">
      <Heading kicker="Satu ekosistem" title="Dibangun untuk semua yang menghidupkan musik." body="Pendengar, musisi, dan penyelenggara acara terhubung lewat data yang sama — dari pemutaran pertama hingga tepuk tangan terakhir." />
      <div className="mt-14 grid gap-5 lg:grid-cols-3">
        {ROLES.map((r) => (
          <article
            key={r.id}
            id={r.id}
            className="group flex scroll-mt-24 flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] transition hover:border-white/25 hover:bg-white/[0.05]"
          >
            <div className="relative aspect-[16/10] overflow-hidden">
              <img src={r.image} alt={r.alt} loading="lazy" className="size-full object-cover transition duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0b0b0b] via-black/10 to-transparent" />
              <span className="absolute top-4 left-4 rounded-full border border-white/20 bg-black/50 px-3 py-1 text-xs font-bold text-white backdrop-blur">{r.label}</span>
            </div>
            <div className="flex flex-1 flex-col p-6 pt-2">
              <h3 className="text-2xl leading-tight font-extrabold">{r.title}</h3>
              <p className="mt-2 text-white/60">{r.body}</p>
              <ul className="mt-6 flex-1 space-y-3">
                {r.features.map((f) => (
                  <li key={f.t} className="flex items-center gap-3 text-sm font-semibold text-white/85">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.06]">
                      <f.icon className="size-4 text-[#f0a3c8]" />
                    </span>
                    {f.t}
                  </li>
                ))}
              </ul>
              <Link to={r.href} className="mt-8 inline-flex items-center gap-2 font-bold text-white transition group-hover:gap-3">
                {r.cta} <ArrowRight className="size-4" />
              </Link>
            </div>
          </article>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Cara kerja + alur dana escrow
// ---------------------------------------------------------------------------------------------
function HowItWorks() {
  const steps = [
    { icon: Headphones, t: 'Dengar', b: 'Fan streaming gratis. Setiap pemutaran ≥ 30 detik menjadi data permintaan pasar per kota.' },
    { icon: CalendarCheck2, t: 'Booking', b: 'Promotor menemukan artis lewat Audience Match, negosiasi terstruktur, lalu kontrak elektronik.' },
    { icon: Mic2, t: 'Panggung', b: 'Fan mendapat tiket presale, artis tampil, dana cair H+1 setelah show — langsung terbagi ke tim.' },
  ];
  const escrow = [
    { t: 'Kontrak ditandatangani', s: 'Invoice DP terbit' },
    { t: 'Promotor bayar DP', s: 'Ditahan mitra escrow' },
    { t: 'Pelunasan H-7', s: 'Booked & secured' },
    { t: 'Show selesai', s: 'Jendela dispute 24 jam' },
    { t: 'Pencairan H+1', s: 'Split otomatis + PPh' },
  ];
  return (
    <Section className="relative bg-[radial-gradient(60%_50%_at_50%_0%,rgba(124,58,237,0.14),transparent)]">
      <Heading center kicker="Cara kerja" title="Dari pemutaran pertama ke panggung." body="Satu lingkaran data: dengar → booking → panggung." />
      <ol className="relative mt-14 grid gap-5 md:grid-cols-3">
        <span className="absolute top-12 right-[16%] left-[16%] hidden h-px bg-gradient-to-r from-transparent via-white/20 to-transparent md:block" aria-hidden />
        {steps.map((s, i) => (
          <li key={s.t} className="relative rounded-3xl border border-white/10 bg-[#0d0d0d] p-8 text-center">
            <span className={cx('mx-auto grid size-16 place-items-center rounded-2xl', BRAND_GRADIENT)}>
              <s.icon className="size-7 text-white" />
            </span>
            <p className="mt-6 text-xs font-bold tracking-[0.16em] text-white/40 uppercase">Langkah {i + 1}</p>
            <h3 className="mt-1 text-2xl font-extrabold">{s.t}</h3>
            <p className="mt-3 text-white/60">{s.b}</p>
          </li>
        ))}
      </ol>

      <div className="mt-6 rounded-3xl border border-white/10 bg-[#0d0d0d] p-6 md:p-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-6 text-gema-primary-text" />
            <h3 className="text-xl font-extrabold">Alur dana rekening bersama (escrow)</h3>
          </div>
          <p className="text-xs text-white/40">Dana dikelola mitra pembayaran berizin Bank Indonesia — bukan rekening operasional GEMA.</p>
        </div>
        <ol className="mt-8 grid gap-6 sm:grid-cols-2 md:grid-cols-5 md:gap-4">
          {escrow.map((e, i) => (
            <li key={e.t}>
              <div className="flex items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-gema-primary/50 bg-gema-primary/10 text-sm font-black text-gema-primary-text">{i + 1}</span>
                {i < escrow.length - 1 && <span className="hidden h-px flex-1 bg-gradient-to-r from-gema-primary/50 to-transparent md:block" />}
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
  return (
    <Section>
      <Heading
        kicker="Di panggung"
        title="Event mendatang"
        body="Konser, tur, launching album, dan gig kampus dari artis di GEMA."
        action={
          <Link to="/app/events" className="inline-flex items-center gap-2 rounded-full border border-white/25 px-6 py-3 font-bold transition hover:border-white/60 hover:bg-white/5">
            Semua event <ArrowRight className="size-4" />
          </Link>
        }
      />
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading && Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-56 animate-pulse rounded-3xl bg-white/5" />)}
        {isError && <p className="col-span-full text-white/50">Jadwal event belum dapat dimuat.</p>}
        {!isLoading && !isError && !events.length && <p className="col-span-full text-white/50">Belum ada event terjadwal — segera hadir.</p>}
        {events.slice(0, 4).map((e) => {
          const d = new Date(e.starts_at);
          return (
            <Link
              key={e.id}
              to={`/e/${e.slug}`}
              className="group relative flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0d0d0d] p-6 transition hover:-translate-y-1 hover:border-white/25"
            >
              <span className={cx('absolute inset-x-0 top-0 h-1 opacity-60 transition group-hover:opacity-100', BRAND_GRADIENT)} aria-hidden />
              <div className="flex items-baseline gap-2">
                <span className="text-5xl leading-none font-black">{d.getDate()}</span>
                <span className="text-sm font-bold text-white/60 uppercase">
                  {d.toLocaleDateString('id-ID', { month: 'short' })} · {d.toLocaleDateString('id-ID', { weekday: 'short' })}
                </span>
              </div>
              <h3 className="mt-5 line-clamp-2 text-lg leading-snug font-bold">{e.title}</h3>
              <p className="mt-2 flex items-start gap-1.5 text-sm text-white/55">
                <MapPin className="mt-0.5 size-3.5 shrink-0" /> {e.venue_name}, {e.city}
              </p>
              {/* Garis sobekan tiket */}
              <div className="relative my-5 border-t border-dashed border-white/15">
                <span className="absolute -top-3 -left-9 size-6 rounded-full bg-black" />
                <span className="absolute -top-3 -right-9 size-6 rounded-full bg-black" />
              </div>
              <div className="mt-auto flex items-center justify-between">
                <span className="text-sm">
                  <span className="text-white/50">Mulai </span>
                  <span className="font-bold">{e.min_price != null ? fmt.idrShort(e.min_price) : '—'}</span>
                </span>
                <span className="grid size-9 place-items-center rounded-full bg-white/10 transition group-hover:bg-white group-hover:text-black">
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
  return (
    <Section>
      <figure className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0d0d0d] px-6 py-14 text-center md:px-16">
        <div className="absolute inset-0 -z-0 bg-[radial-gradient(ellipse_at_bottom,rgba(236,72,153,0.16),transparent_60%)]" aria-hidden />
        <blockquote className="relative mx-auto max-w-3xl text-2xl leading-snug font-bold text-balance md:text-3xl">
          “Akhirnya data pendengar kami di Bandung bisa jadi bahan pitching ke promotor — dan DP-nya aman di rekening bersama.”
        </blockquote>
        <figcaption className="relative mt-8 flex items-center justify-center gap-3">
          <span className={cx('grid size-11 place-items-center rounded-full text-sm font-black text-white', BRAND_GRADIENT)}>SK</span>
          <span className="text-left">
            <span className="block font-bold">Senja Kolektif</span>
            <span className="block text-sm text-white/50">Band indie, Bandung</span>
          </span>
        </figcaption>
      </figure>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Harga
// ---------------------------------------------------------------------------------------------
function Pricing() {
  const t = usePricing();
  const fan = [
    { name: 'Gratis', price: 'Rp 0', note: 'selamanya', items: ['Musik tanpa batas, on-demand', 'Lossless & Hi-Res (opt-in Wi-Fi)', 'Lirik sinkron & playlist', 'Info event & presale fan setia', 'Iklan sesekali'], cta: 'Mulai mendengarkan', href: '/app', hl: false },
    { name: 'Premium', price: `Rp ${t.individual}`, note: '/bulan', items: ['Semua fitur Gratis', 'Podcast premium & audio fiksi', 'Bebas iklan', 'Unduhan tanpa batas', 'Early access tiket'], cta: 'Lihat paket Premium', href: '/premium', hl: true },
  ];
  const b2b = [
    { name: 'Starter', price: 'Gratis', items: ['EPK dinamis & rate card', 'Kalender & inbox booking', `Komisi artis ${t.artistCommission}`] },
    { name: 'Pro', price: 'Rp 199.000/bln', items: ['Analitik lanjutan & ekspor', 'Kontrak kustom', `Komisi artis ${t.proArtistCommission} · promotor ${t.proPromotorFee}`] },
    { name: 'Label', price: 'Hubungi kami', items: ['Multi-roster & batas harga', 'Ingest katalog massal', 'Laporan royalti terpusat'] },
  ];
  return (
    <section id="harga" className="scroll-mt-20 bg-[#f6f6f4] px-4 py-20 text-black md:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <p className="text-sm font-bold tracking-[0.16em] text-[#c0267a] uppercase">Harga</p>
          <h2 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Transparan sejak awal.</h2>
          <p className="mt-4 text-lg text-neutral-600">Musik gratis untuk semua. Kami dibayar ketika panggung terjadi.</p>
        </div>
        <div className="mx-auto mt-12 grid max-w-4xl gap-6 md:grid-cols-2">
          {fan.map((p) => {
            const card = (
              <div className={cx('flex h-full flex-col rounded-3xl p-8 text-left', p.hl ? 'bg-black text-white' : 'border border-neutral-200 bg-white')}>
                <p className="text-sm font-bold tracking-wide uppercase opacity-60">Pendengar</p>
                <h3 className="mt-1 text-3xl font-black">{p.name}</h3>
                <p className="mt-2 text-2xl font-extrabold">
                  {p.price}
                  <span className="text-base font-normal opacity-60"> {p.note}</span>
                </p>
                <ul className="mt-6 flex-1 space-y-2.5">
                  {p.items.map((i) => (
                    <li key={i} className="flex gap-2">
                      <BadgeCheck className={cx('size-5 shrink-0', p.hl ? 'text-gema-primary-text' : 'text-emerald-600')} /> {i}
                    </li>
                  ))}
                </ul>
                <Link to={p.href} className={cx('mt-8 rounded-full py-3.5 text-center font-bold transition hover:opacity-90', p.hl ? 'bg-white text-black' : 'bg-black text-white')}>
                  {p.cta}
                </Link>
              </div>
            );
            return p.hl ? (
              <StarBorder key={p.name} as="div" className="w-full !rounded-3xl" color="#ec4899" speed="5s" thickness={2}>
                {card}
              </StarBorder>
            ) : (
              <div key={p.name}>{card}</div>
            );
          })}
        </div>
        <h3 className="mt-20 text-center text-2xl font-black">GEMA Pro untuk artis, manajemen, label & promotor</h3>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {b2b.map((p) => (
            <div key={p.name} className="rounded-3xl border border-neutral-200 bg-white p-6">
              <h4 className="text-xl font-black">{p.name}</h4>
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
          Komisi booking off-air: promotor 3–5% (service fee) + artis 5–8% dari fee. Biaya payment & komisi tidak direfund kecuali kesalahan sistem GEMA. Angka bersifat indikatif selama beta.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// FAQ (dua kolom)
// ---------------------------------------------------------------------------------------------
const FAQS = [
  ['Apakah musik benar-benar gratis?', 'Ya. Streaming, playlist, lirik, kualitas audio terbaik, dan pemutaran tanpa batas gratis untuk semua pengguna terdaftar. Premium hanya untuk podcast premium, audio fiksi, dan pengalaman bebas iklan.'],
  ['Bagaimana royalti streaming dihitung?', 'GEMA memakai model user-centric (hybrid): pendapatan dari seorang pendengar hanya dibagi ke artis yang ia dengarkan. Hanya pemutaran ≥30 detik yang lolos deteksi fraud yang dihitung. Statement bulanan terbit paling lambat tanggal 15 bulan berikutnya, rinci per lagu dan pemegang hak.'],
  ['Apakah dana booking aman?', 'Pembayaran promotor ditahan di rekening bersama (escrow) milik mitra pembayaran berizin — bukan rekening operasional GEMA. Dana baru dicairkan H+1 setelah show selesai tanpa sengketa, dan otomatis dibagi sesuai kontrak.'],
  ['Bagaimana GEMA melindungi hak cipta?', 'Setiap unggahan melewati audio fingerprint, verifikasi identitas pengunggah, dan persetujuan split hak. Klaim pelanggaran ditangani dengan mekanisme notice-and-takedown maksimal 2×24 jam.'],
  ['Katalog saya sudah ada di GEMA, bagaimana klaim profil?', 'Masuk ke Artist Studio, pilih "Klaim profil", lalu verifikasi melalui akun media sosial resmi atau konfirmasi dari label/distributor Anda.'],
];

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const supportEmail = setting(usePlatformConfig(), 'general.support_email', 'bantuan@gema.id');
  return (
    <Section id="faq">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
        <div>
          <Heading kicker="FAQ" title="Pertanyaan umum" />
          <p className="mt-4 text-white/60">
            Belum terjawab?{' '}
            <a href={`mailto:${supportEmail}`} className="font-bold text-white underline-offset-4 hover:underline">
              Hubungi tim kami
            </a>
            .
          </p>
        </div>
        <div className="divide-y divide-white/10 border-y border-white/10">
          {FAQS.map(([q, a], i) => (
            <div key={q}>
              <button className="flex w-full items-center justify-between gap-4 py-5 text-left text-lg font-bold" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                {q}
                <ChevronDown className={cx('size-5 shrink-0 text-white/50 transition', open === i && 'rotate-180')} />
              </button>
              {open === i && <p className="pb-5 leading-relaxed text-white/60">{a}</p>}
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Penutup: waitlist + ketersediaan aplikasi (menggabungkan section "Unduh")
// ---------------------------------------------------------------------------------------------
const SEGMENTS = [
  ['fan', 'Fan / Pendengar'],
  ['artist', 'Artis / Band'],
  ['management', 'Manajemen Artis'],
  ['label', 'Label / Publisher'],
  ['promotor', 'Promotor / EO'],
] as const;
const CITIES = ['Jakarta', 'Bandung', 'Yogyakarta', 'Surabaya', 'Malang', 'Bali', 'Medan', 'Semarang', 'Makassar', 'Lainnya'];

function Waitlist() {
  const waitlistOpen = useModule('waitlist');
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
  const field = 'w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white placeholder:text-white/35 focus:border-white/50 focus:outline-none';
  return (
    <section id="waitlist" className="scroll-mt-20 px-4 pb-20 md:pb-24">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] border border-white/10">
        <div className="absolute inset-0 bg-gradient-to-br from-[#3b0f5c] via-[#6d1546] to-[#7a3a10]" aria-hidden />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.12),transparent_55%)]" aria-hidden />
        <div className="relative grid items-center gap-12 p-8 md:grid-cols-2 md:p-14">
          <div id="unduh" className="scroll-mt-24">
            <h2 className="text-4xl leading-[1.1] font-black tracking-tight md:text-5xl">Gabung lebih awal.</h2>
            <p className="mt-4 text-lg text-white/80">Pra-registrasi untuk fan, artis, manajemen, label, dan promotor. Program Founding Artist: take rate lebih rendah selama 12 bulan.</p>
            <ul className="mt-6 space-y-2.5 text-white/80">
              <li className="flex gap-2.5">
                <Star className="size-5 shrink-0" /> Kode referral untuk prioritas akses
              </li>
              <li className="flex gap-2.5">
                <ShieldCheck className="size-5 shrink-0" /> Data diproses sesuai UU PDP
              </li>
            </ul>
            <div className="mt-10 border-t border-white/15 pt-6">
              <p className="flex items-center gap-2 text-sm font-bold text-white/80">
                <Smartphone className="size-4" /> Dengarkan di mana saja
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to="/app" className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:scale-[1.03]">
                  Buka web player
                </Link>
                <span className="rounded-full border border-white/25 px-5 py-2.5 text-sm font-bold text-white/60">App Store · segera</span>
                <span className="rounded-full border border-white/25 px-5 py-2.5 text-sm font-bold text-white/60">Google Play · segera</span>
              </div>
            </div>
          </div>
          {!waitlistOpen ? (
            <div className="rounded-3xl bg-black/40 p-8 text-center backdrop-blur" role="status">
              <p className="text-sm font-bold tracking-wide uppercase">Waitlist ditutup</p>
              <p className="mt-3 text-white/80">Pendaftaran waitlist sedang ditutup. Kamu tetap bisa langsung mendengarkan lewat web player.</p>
              <Link to="/app" className="mt-6 inline-block rounded-full bg-white px-6 py-3 text-sm font-bold text-black transition hover:scale-[1.03]">
                Buka web player
              </Link>
            </div>
          ) : done ? (
            <div className="rounded-3xl bg-black/40 p-8 text-center backdrop-blur" role="status">
              <p className="text-sm font-bold tracking-wide uppercase">Terima kasih!</p>
              <p className="mt-2 text-5xl font-black">#{done.position}</p>
              <p className="mt-2 text-white/80">posisi kamu di antrean</p>
              <p className="mt-6 text-sm">Bagikan kode referral untuk naik antrean:</p>
              <p className="mt-2 inline-block rounded-lg bg-white px-4 py-2 font-mono text-lg font-bold text-black">{done.referral_code}</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4 rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur md:p-8">
              <label className="block">
                <span className="mb-1.5 block text-sm font-bold">Email</span>
                <input required type="email" className={field} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="nama@email.com" autoComplete="email" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-bold">Nama (opsional)</span>
                <input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
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
              <label className="flex items-start gap-3 text-sm text-white/80">
                <input type="checkbox" className="mt-1 size-4 accent-[#ec4899]" checked={form.consent_marketing} onChange={(e) => setForm({ ...form, consent_marketing: e.target.checked })} />
                Saya bersedia menerima informasi pemasaran dari GEMA. (Opsional — dapat ditarik kapan saja.)
              </label>
              <button disabled={busy} className="w-full rounded-full bg-white py-3.5 font-bold text-black transition hover:scale-[1.02] disabled:opacity-60">
                {busy ? 'Mendaftarkan…' : 'Gabung waitlist'}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  const ticketing = useModule('ticketing');
  return (
    <div className="min-h-full bg-black text-white">
      <PublicNav />
      <main>
        <Hero />
        <TrustBar />
        <Ecosystem />
        <HowItWorks />
        {ticketing && <UpcomingEvents />}
        <Testimonial />
        <Pricing />
        <Faq />
        <Waitlist />
      </main>
      <PublicFooter />
    </div>
  );
}
