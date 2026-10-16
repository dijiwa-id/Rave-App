import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, Check, ChevronDown, Lock, Minus, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import type { Show } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { cx } from '@/components/ui';
import { useModule } from '@/components/ModuleGate';
import { usePricing } from '@/lib/pricing';
import { BRAND_GRADIENT, Heading, Section } from './marketing';
import { PublicFooter, PublicNav } from './PublicChrome';

/**
 * Halaman GEMA Premium. Prinsip produk (BRD): musik selalu gratis — Premium hanya untuk podcast & audio fiksi
 * premium, bebas iklan, unduhan tanpa batas, dan akses tiket lebih awal. Billing langganan dibuka pada fase
 * berikutnya (REQ-PAY-03), jadi CTA mengarah ke waitlist, bukan checkout palsu.
 */

const NOTIFY = '/#waitlist';

type Cell = boolean | string;
const COMPARE: { feature: string; free: Cell; premium: Cell }[] = [
  { feature: 'Musik on-demand tanpa batas', free: true, premium: true },
  { feature: 'Kualitas lossless & Hi-Res', free: true, premium: true },
  { feature: 'Lirik sinkron & playlist', free: true, premium: true },
  { feature: 'Live streaming konser', free: true, premium: true },
  { feature: 'Podcast & audio fiksi premium', free: 'Episode pilihan', premium: true },
  { feature: 'Bebas iklan', free: false, premium: true },
  { feature: 'Unduhan offline', free: false, premium: 'Tanpa batas' },
  { feature: 'Akses tiket presale', free: 'Fan setia', premium: 'Semua pelanggan' },
];

type Pricing = ReturnType<typeof usePricing>;

// Harga, masa coba, verifikasi pelajar, dan jumlah perangkat dari Super Admin (`subscription.*`).
const plans = (t: Pricing) => [
  { name: 'Individu', price: t.individual, who: '1 akun', items: ['Semua manfaat Premium', `Unduhan di ${t.devices} perangkat`, 'Early access tiket presale'], popular: true },
  { name: 'Pelajar', price: t.student, who: '1 akun terverifikasi kampus', items: ['Semua manfaat Individu', 'Verifikasi pelajar & mahasiswa', `Diperbarui setiap ${t.studentMonths} bulan`], popular: false },
  { name: 'Duo', price: t.duo, who: '2 akun dalam satu rumah', items: ['Semua manfaat Individu', 'Dua akun Premium terpisah', 'Playlist Duo Mix'], popular: false },
];

const PAYMENTS = ['QRIS', 'GoPay', 'OVO', 'DANA', 'Virtual Account', 'Kartu kredit'];

const faqs = (t: Pricing) => [
  ['Apakah saya harus berlangganan untuk mendengar musik?', 'Tidak. Semua musik di GEMA gratis selamanya, termasuk kualitas lossless, lirik sinkron, dan live streaming. Premium hanya menambah podcast & audio fiksi eksklusif, bebas iklan, unduhan, dan akses tiket lebih awal.'],
  ['Kapan Premium bisa dibeli?', 'Langganan dibuka bertahap setelah closed beta. Daftar di waitlist dan kami kabari lebih dulu' + (t.trial ? ` — pelanggan pertama mendapat masa coba gratis ${t.trial}.` : '.')],
  ['Apakah artis mendapat bagian dari Premium?', 'Ya. Pendapatan langganan dibagi dengan model user-centric: biaya langgananmu hanya mengalir ke kreator yang benar-benar kamu dengarkan.'],
  ['Bisakah saya berhenti kapan saja?', 'Bisa. Tidak ada kontrak; langganan berhenti di akhir periode berjalan dan akunmu kembali ke Gratis tanpa kehilangan playlist.'],
  ['Bagaimana verifikasi paket Pelajar?', `Cukup email kampus aktif atau kartu tanda mahasiswa. Verifikasi diperbarui setiap ${t.studentMonths} bulan.`],
];

function Mark({ v, highlight }: { v: Cell; highlight?: boolean }) {
  if (v === true) return <Check className={cx('mx-auto size-5', highlight ? 'text-[#f0a3c8]' : 'text-white/80')} aria-label="Termasuk" />;
  if (v === false) return <Minus className="mx-auto size-5 text-white/25" aria-label="Tidak termasuk" />;
  return <span className={cx('text-sm font-semibold', highlight ? 'text-white' : 'text-white/60')}>{v}</span>;
}

function Hero() {
  const premium = useAuth((s) => s.user?.premium);
  const t = usePricing();
  return (
    <section className="relative isolate overflow-hidden px-4 pt-20 pb-16 text-center md:pt-28">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_55%_at_50%_0%,rgba(168,85,247,0.28),rgba(236,72,153,0.12)_45%,transparent_75%)]" aria-hidden />
      <div className="mx-auto max-w-4xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white/80">
          <Sparkles className="size-4 text-[#f0a3c8]" /> GEMA Premium
        </span>
        <h1 className="mt-6 text-5xl leading-[1.05] font-black tracking-tight text-balance md:text-6xl lg:text-7xl">
          Musik tetap gratis.
          <br />
          <span className={cx('bg-clip-text text-transparent', BRAND_GRADIENT)}>Premium untuk sisanya.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/70">
          Podcast & audio fiksi eksklusif, tanpa iklan, unduhan tanpa batas, dan akses tiket lebih awal — mulai Rp {t.student} per bulan.
        </p>
        {premium ? (
          <div className="mt-9 inline-flex items-center gap-2 rounded-full bg-white/10 px-6 py-3.5 font-bold">
            <BadgeCheck className="size-5 text-gema-primary-text" /> Kamu sudah pelanggan Premium
          </div>
        ) : (
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <a href={NOTIFY} className="group inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 font-bold text-black shadow-[0_0_40px_-8px_rgba(236,72,153,0.7)] transition hover:scale-[1.03]">
              Ingatkan saya saat dibuka
              <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </a>
            <a href="#paket" className="inline-flex items-center rounded-full border border-white/25 px-7 py-3.5 font-bold transition hover:border-white/60 hover:bg-white/5">
              Lihat paket
            </a>
          </div>
        )}
        <p className="mt-5 text-sm text-white/45">Dibuka bertahap setelah closed beta{t.trial && ` · Gratis ${t.trial} untuk pelanggan pertama`} · Batalkan kapan saja</p>
      </div>
    </section>
  );
}

function Compare() {
  return (
    <Section className="!pt-8">
      <Heading center kicker="Gratis vs Premium" title="Semua yang penting tetap gratis." body="Premium melengkapi, bukan mengunci. Musik dan kualitas terbaiknya selalu terbuka untuk semua." />
      <div className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-3xl border border-white/10">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.03]">
              <th scope="col" className="p-4 text-sm font-bold text-white/60 md:px-6">
                Fitur
              </th>
              <th scope="col" className="w-28 p-4 text-center text-sm font-bold md:w-40">
                Gratis
              </th>
              <th scope="col" className="w-28 bg-white/[0.04] p-4 text-center text-sm font-bold md:w-40">
                <span className={cx('bg-clip-text text-transparent', BRAND_GRADIENT)}>Premium</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARE.map((r) => (
              <tr key={r.feature} className="border-b border-white/[0.06] last:border-0">
                <th scope="row" className="p-4 text-sm font-semibold text-white/85 md:px-6 md:text-base">
                  {r.feature}
                </th>
                <td className="p-4 text-center">
                  <Mark v={r.free} />
                </td>
                <td className="bg-white/[0.04] p-4 text-center">
                  <Mark v={r.premium} highlight />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Plans() {
  const t = usePricing();
  return (
    <Section id="paket">
      <Heading center kicker="Paket" title="Pilih yang pas untukmu." body="Harga per bulan, sudah termasuk pajak. Tanpa kontrak — berhenti kapan saja." />
      <div className="mt-12 grid items-stretch gap-5 md:grid-cols-3">
        {plans(t).map((p) => {
          const card = (
            <div className={cx('flex h-full flex-col rounded-3xl border p-7', p.popular ? 'border-transparent bg-[#0f0f10]' : 'border-white/10 bg-white/[0.03]')}>
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-black">{p.name}</h3>
                {p.popular && <span className={cx('rounded-full px-2.5 py-1 text-xs font-bold', BRAND_GRADIENT)}>Paling populer</span>}
              </div>
              <p className="mt-1 text-sm text-white/55">{p.who}</p>
              <p className="mt-6 flex items-baseline gap-1">
                <span className="text-sm font-bold text-white/60">Rp</span>
                <span className="text-4xl font-black tracking-tight">{p.price}</span>
                <span className="text-sm text-white/50">/bulan</span>
              </p>
              {t.trial && <p className="mt-1 text-xs font-semibold text-[#f0a3c8]">Gratis {t.trial} saat peluncuran</p>}
              <ul className="mt-6 flex-1 space-y-3 border-t border-white/10 pt-6">
                {p.items.map((i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-white/85">
                    <Check className="size-4 shrink-0 text-white/60" /> {i}
                  </li>
                ))}
              </ul>
              <a
                href={NOTIFY}
                className={cx('mt-8 rounded-full py-3 text-center text-sm font-bold transition', p.popular ? 'bg-white text-black hover:opacity-90' : 'border border-white/25 hover:border-white/60 hover:bg-white/5')}
              >
                Ingatkan saya
              </a>
            </div>
          );
          return p.popular ? (
            <div key={p.name} className={cx('rounded-3xl p-px shadow-[0_0_60px_-20px_rgba(236,72,153,0.6)]', BRAND_GRADIENT)}>
              {card}
            </div>
          ) : (
            <div key={p.name}>{card}</div>
          );
        })}
      </div>
      <p className="mt-8 text-center text-sm text-white/45">
        Pembayaran: {PAYMENTS.join(' · ')}
      </p>
    </Section>
  );
}

/** Konten eksklusif — diambil dari katalog nyata (acara dengan episode premium). */
function Exclusive() {
  const podcasts = useModule('podcasts');
  // `limit` tidak didukung server (catalog/routes.ts) → dipotong di klien.
  const q = useQuery({ queryKey: ['shows', 'premium-page'], queryFn: () => api<{ data: Show[] }>('/v1/catalog/shows'), enabled: podcasts });
  const shows = (q.data?.data ?? []).slice(0, 6);
  if (!podcasts) return null;
  if (!q.isLoading && !shows.length) return null;
  return (
    <Section>
      <Heading
        kicker="Eksklusif di Premium"
        title="Cerita yang tidak ada di tempat lain."
        body="Episode lengkap podcast dan audio fiksi dari GEMA Originals serta kreator independen."
        action={
          <Link to="/app/podcasts" className="inline-flex items-center gap-2 rounded-full border border-white/25 px-6 py-3 font-bold transition hover:border-white/60 hover:bg-white/5">
            Jelajahi <ArrowRight className="size-4" />
          </Link>
        }
      />
      <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {q.isLoading && Array.from({ length: 6 }).map((_, i) => <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-white/5" />)}
        {shows.map((s) => (
          <Link key={s.id} to={`/app/show/${s.id}`} className="group block">
            <div className="relative aspect-square overflow-hidden rounded-2xl bg-white/5">
              <img src={s.cover_url} alt={s.title} loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-105" />
              <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-bold backdrop-blur">
                <Lock className="size-3" /> Premium
              </span>
            </div>
            <p className="mt-3 truncate font-bold">{s.title}</p>
            <p className="truncate text-sm text-white/50">
              {s.kind === 'FICTION' ? 'Audio fiksi' : 'Podcast'} · {s.publisher}
            </p>
          </Link>
        ))}
      </div>
    </Section>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const FAQS = faqs(usePricing());
  return (
    <Section>
      <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
        <div>
          <Heading kicker="FAQ" title="Seputar Premium" />
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

export default function Premium() {
  return (
    <div className="min-h-full bg-black text-white">
      <PublicNav />
      <main>
        <Hero />
        <Compare />
        <Plans />
        <Exclusive />
        <Faq />
        <section className="px-4 pb-24">
          <div className="relative isolate mx-auto max-w-6xl overflow-hidden rounded-[2rem] border border-white/10 px-6 py-14 text-center">
            <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[#3b0f5c] via-[#6d1546] to-[#7a3a10]" aria-hidden />
            <h2 className="text-3xl font-black tracking-tight md:text-4xl">Mulai dengan yang gratis.</h2>
            <p className="mx-auto mt-3 max-w-xl text-white/75">Dengarkan seluruh katalog sekarang — tanpa kartu kredit. Kami kabari saat Premium dibuka.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/app" className="rounded-full bg-white px-7 py-3.5 font-bold text-black transition hover:scale-[1.03]">
                Mulai mendengarkan
              </Link>
              <a href={NOTIFY} className="rounded-full border border-white/30 px-7 py-3.5 font-bold transition hover:bg-white/10">
                Ingatkan saya
              </a>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
