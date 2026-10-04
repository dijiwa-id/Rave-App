import { Check, Download, Mic2, ShieldOff, Wallet } from 'lucide-react';
import { toast } from '@/components/ui';
import { PublicFooter, PublicNav } from './PublicChrome';

const PLANS = [
  { badge: 'Paket harian tersedia', name: 'Mini', price: 'Mulai Rp 2.500/hari', accounts: '1 akun, khusus seluler', items: ['Podcast premium di seluler', 'Bebas iklan', 'Unduh 30 episode di 1 perangkat'], trial: false },
  { badge: '1 bulan gratis', name: 'Individu', price: 'Rp 49.900/bulan setelah masa promo', accounts: '1 akun', items: ['Podcast premium & audio fiksi', 'Bebas iklan', 'Unduhan tanpa batas di 5 perangkat', 'Early access tiket presale'], trial: true },
  { badge: '1 bulan gratis', name: 'Pelajar', price: 'Rp 24.900/bulan setelah masa promo', accounts: '1 akun terverifikasi', items: ['Semua fitur Individu', 'Diskon khusus pelajar & mahasiswa', 'Verifikasi kampus'], trial: true },
  { badge: '1 bulan gratis', name: 'Duo', price: 'Rp 64.900/bulan setelah masa promo', accounts: '2 akun', items: ['Untuk dua orang serumah', 'Semua fitur Individu', 'Playlist Duo Mix'], trial: true },
];

const POWERS = [
  { icon: ShieldOff, t: 'Bebas iklan', b: 'Dengar tanpa jeda iklan.' },
  { icon: Mic2, t: 'Podcast & cerita premium', b: 'Seri eksklusif GEMA Originals.' },
  { icon: Download, t: 'Unduh tanpa batas', b: 'Hemat kuota, dengar offline.' },
  { icon: Wallet, t: 'Bayar sesukamu', b: 'QRIS, e-wallet, VA, kartu.' },
];

/** Halaman Premium ala mockup Spotify 4 (Rupiah). Billing berlangganan direncanakan Fase 3 (REQ-PAY-03). */
export default function Premium() {
  const subscribe = () => toast.info('Langganan Premium dibuka pada Fase 3. Musik tetap gratis untuk semua!');
  return (
    <div className="min-h-full bg-white text-black">
      <div className="bg-black text-white">
        <PublicNav />
      </div>
      <section className="bg-[#1e70e0] px-4 py-20 text-center text-white">
        <h1 className="text-4xl font-black md:text-5xl">Coba Premium gratis 1 bulan</h1>
        <p className="mt-4 text-lg">Rp 49.900/bulan sesudahnya. Musik tetap gratis — Premium untuk podcast, cerita, dan bebas iklan. Batalkan kapan saja.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button onClick={subscribe} className="rounded-full bg-black px-8 py-3.5 text-sm font-bold tracking-wide uppercase hover:scale-105">
            Mulai
          </button>
          <a href="#paket" className="rounded-full border-2 border-white px-8 py-3 text-sm font-bold tracking-wide uppercase hover:scale-105">
            Lihat paket lain
          </a>
        </div>
        <p className="mt-6 text-xs text-white/80">Syarat dan ketentuan berlaku. Promo 1 bulan tidak berlaku bagi yang sudah pernah mencoba Premium.</p>
      </section>
      <section className="px-4 py-20">
        <h2 className="text-center text-3xl font-black md:text-4xl">Kekuatan Premium</h2>
        <div className="mx-auto mt-12 grid max-w-5xl grid-cols-2 gap-8 md:grid-cols-4">
          {POWERS.map((p) => (
            <div key={p.t} className="text-center">
              <div className="mx-auto grid size-28 place-items-center rounded-full bg-neutral-100">
                <p.icon className="size-12" />
              </div>
              <h3 className="mt-5 font-bold">{p.t}</h3>
              <p className="mt-1 text-sm text-neutral-600">{p.b}</p>
            </div>
          ))}
        </div>
      </section>
      <section id="paket" className="bg-neutral-100 px-4 py-20">
        <h2 className="text-center text-3xl font-black md:text-4xl">Pilih Premium-mu</h2>
        <p className="mt-2 text-center text-sm">Dengar tanpa batas di ponsel, speaker, dan perangkat lain. QRIS · GoPay · OVO · DANA · VA · Visa · Mastercard</p>
        <div className="mx-auto mt-12 grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((p) => (
            <article key={p.name} className="flex flex-col rounded-lg bg-white p-5 shadow-md">
              <div className="flex flex-wrap gap-2">
                {p.trial && <span className="rounded bg-[#1e70e0] px-2 py-0.5 text-xs font-bold text-white">{p.badge}</span>}
                <span className="rounded border border-[#1e70e0] px-2 py-0.5 text-xs font-bold text-[#1e70e0]">Paket sekali bayar tersedia</span>
              </div>
              <h3 className="mt-3 text-2xl font-black">{p.name}</h3>
              <p className="text-sm">{p.price}</p>
              <p className="text-sm">{p.accounts}</p>
              <hr className="my-5 border-neutral-300" />
              <ul className="flex-1 space-y-2.5 text-sm">
                {p.items.map((i) => (
                  <li key={i} className="flex gap-2">
                    <Check className="size-4 shrink-0" /> {i}
                  </li>
                ))}
              </ul>
              <button onClick={subscribe} className="mt-6 rounded-full bg-black py-3 text-xs font-bold tracking-wide text-white uppercase hover:scale-[1.02]">
                Lihat paket
              </button>
              <p className="mt-3 text-[11px] text-neutral-500 underline">Syarat dan ketentuan berlaku.</p>
            </article>
          ))}
        </div>
      </section>
      <PublicFooter />
    </div>
  );
}
