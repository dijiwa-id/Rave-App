import { Link } from 'react-router-dom';
import { Globe } from 'lucide-react';
import { Facebook, Instagram, XTwitter } from '@/components/fan/BrandIcons';
import { GemaLogo } from '@/components/ui/GemaLogo';
import { useAuth } from '@/stores/auth';

/** Navbar hitam ala mockup Spotify 4. */
export function PublicNav() {
  const token = useAuth((s) => s.accessToken);
  return (
    <header className="sticky top-0 z-40 bg-black/90 backdrop-blur">
      <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-4">
        <Link to="/" aria-label="Beranda GEMA">
          <GemaLogo />
        </Link>
        <nav className="flex items-center gap-1 text-sm font-bold sm:gap-6" aria-label="Navigasi utama">
          <Link to="/premium" className="hidden px-2 hover:text-gema-primary-text sm:inline">
            Premium
          </Link>
          <a href="/#faq" className="hidden px-2 hover:text-gema-primary-text sm:inline">
            Bantuan
          </a>
          <a href="/#unduh" className="hidden px-2 hover:text-gema-primary-text md:inline">
            Unduh
          </a>
          <span className="hidden h-4 w-px bg-white sm:inline" />
          {token ? (
            <Link to="/app" className="rounded-full bg-white px-6 py-2.5 text-black hover:scale-105">
              Buka Aplikasi
            </Link>
          ) : (
            <>
              <Link to="/login?signup=1" className="px-2 text-gema-muted hover:text-white">
                Daftar
              </Link>
              <Link to="/login" className="px-2 hover:text-gema-primary-text">
                Masuk
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

const COLS: [string, [string, string][]][] = [
  ['Perusahaan', [['Tentang', '/tentang'], ['Karier', '/karier'], ['Untuk Media', '/media']]],
  ['Komunitas', [['Untuk Artis', '/untuk-artis'], ['Untuk Promotor', '/untuk-promotor'], ['Developer', '/developer'], ['Iklan', '/iklan'], ['Investor', '/investor']]],
  ['Tautan Berguna', [['Bantuan', '/#faq'], ['Web Player', '/app'], ['Aplikasi Seluler Gratis', '/#unduh'], ['Premium', '/premium']]],
];

/** Footer ala mockup Spotify 4 (kolom tautan, sosial, legal). */
export function PublicFooter() {
  return (
    <footer className="bg-black px-4 pt-20 pb-10 text-sm">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-10 md:flex-row">
          <div className="w-44 shrink-0">
            <GemaLogo />
          </div>
          <div className="grid flex-1 grid-cols-2 gap-8 sm:grid-cols-3">
            {COLS.map(([h, links]) => (
              <div key={h}>
                <p className="mb-4 text-xs font-bold tracking-[0.1em] text-gema-subtle uppercase">{h}</p>
                <ul className="space-y-3">
                  {links.map(([t, href]) => (
                    <li key={t}>
                      {href.startsWith('/') && !href.includes('#') ? (
                        <Link to={href} className="hover:text-gema-primary-text">
                          {t}
                        </Link>
                      ) : (
                        <a href={href} className="hover:text-gema-primary-text">
                          {t}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex gap-4">
            {[Instagram, XTwitter, Facebook].map((I, i) => (
              <a key={i} href="#" aria-label={['Instagram', 'X', 'Facebook'][i]} className="grid size-10 place-items-center rounded-full bg-[#292929] hover:bg-gema-highlight">
                <I className="size-5" />
              </a>
            ))}
          </div>
        </div>
        <div className="mt-16 flex flex-wrap items-center justify-between gap-4 text-xs text-gema-subtle">
          <div className="flex flex-wrap gap-5">
            <a href="#">Ketentuan Layanan</a>
            <a href="#">Kebijakan Privasi</a>
            <a href="#">Kebijakan Hak Cipta</a>
            <a href="#">Cookie</a>
            <Link to="/iklan">Tentang Iklan</Link>
          </div>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1">
              <Globe className="size-3.5" /> Indonesia (Bahasa Indonesia)
            </span>
            <span>© 2026 GEMA · Rastek ID</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
