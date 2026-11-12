import { useEffect, useState } from 'react';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Link, NavLink } from 'react-router-dom';
import { AppleLogo, GooglePlay } from '@/components/fan/BrandIcons';
import { RaveLogo } from '@/components/ui/RaveLogo';
import { useAuth } from '@/stores/auth';
import { cx } from '@/components/ui';
import { useDict } from '@/lib/i18n';

const NAV_LINK = 'relative py-1.5 text-[14px] font-bold text-[#d6d6d6] transition hover:text-rave-paper after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:origin-left after:scale-x-0 after:bg-rave-primary after:transition-transform after:duration-500 hover:after:scale-x-100';

/**
 * Header RAVE (rave-website/landing.html): transparan saat di paling atas (menyatu dengan hero),
 * berubah hitam buram (blur) begitu halaman di-scroll. `-mb-[72px]` membuat hero naik ke bawah header,
 * sehingga hero di setiap halaman publik menambah padding atas 72px.
 */
export function PublicNav() {
  const token = useAuth((s) => s.accessToken);
  const d = useDict('public');
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header
      className={cx(
        'sticky top-0 z-40 -mb-[72px] border-b transition-[background-color,border-color,backdrop-filter] duration-300',
        solid ? 'border-white/[0.08] bg-[#0b0a0c]/75 backdrop-blur-xl backdrop-saturate-150' : 'border-transparent bg-transparent',
      )}
    >
      <div className="mx-auto flex h-[72px] max-w-[82.5rem] items-center justify-between gap-6 px-4">
        <Link to="/" aria-label={d.homeAria} className="shrink-0">
          <RaveLogo className="!h-10 drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]" />
        </Link>
        <nav className="hidden items-center gap-7 md:flex" aria-label={d.nav.main}>
          <NavLink to="/premium" className={NAV_LINK}>
            {d.nav.premium}
          </NavLink>
          <NavLink to="/untuk-artis" className={NAV_LINK}>
            {d.nav.artists}
          </NavLink>
          <NavLink to="/untuk-promotor" className={NAV_LINK}>
            {d.nav.promoters}
          </NavLink>
          <NavLink to="/berita" className={NAV_LINK}>
            {d.nav.news}
          </NavLink>
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageSwitch variant="text" className="mr-1 hidden border-r border-white/15 pr-4 sm:inline-flex" />
          {token ? (
            <Link to="/app" className="rave-label rounded-none bg-rave-primary px-5 py-3 !text-[11.5px] text-rave-on-primary transition hover:bg-rave-paper">
              {d.nav.openApp}
            </Link>
          ) : (
            <>
              <Link to="/login?signup=1" className="hidden px-2 text-sm font-bold text-[#cfcfcf] hover:text-rave-paper sm:inline">
                {d.nav.signUp}
              </Link>
              <Link to="/login" className="rave-label rounded-none bg-rave-primary px-5 py-3 !text-[11.5px] text-rave-on-primary transition hover:bg-rave-paper">
                {d.nav.logIn}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/** Href kolom footer; label diambil dari kamus (`footer.cols`) berdasarkan indeks. */
const COL_HREFS: string[][] = [
  ['/tentang', '/berita', '/karier', '/media'],
  ['/untuk-artis', '/untuk-promotor', '/developer', '/iklan', '/investor'],
  ['/bantuan', '/app', '/#unduh', '/premium'],
];

const STORES = [
  { icon: AppleLogo, store: 'App Store', href: '/#waitlist' },
  { icon: GooglePlay, store: 'Google Play', href: '/#waitlist' },
];

/** Tepi sobek (zigzag tak beraturan) untuk lembar kertas footer. */
const TORN = 'polygon(0 0,100% 0,100% 86%,97% 93%,94% 87%,90% 96%,86% 89%,82% 95%,78% 88%,73% 97%,69% 90%,65% 94%,61% 87%,57% 96%,52% 89%,48% 95%,44% 88%,40% 97%,35% 90%,31% 94%,27% 87%,23% 96%,18% 89%,14% 95%,10% 88%,6% 96%,3% 90%,0 95%)';

/**
 * Footer RAVE raw punk yang bersih: lembar kertas sobek berisi slogan (tinta), lalu blok tinta dengan lockup,
 * tautan bergaya setlist bernomor (mono), sosial persegi, dan baris legal + nomor katalog di atas garis putus-putus.
 */
export function PublicFooter() {
  const d = useDict('public');
  const f = d.footer;
  let n = 0;
  return (
    <footer className="relative bg-rave-ink text-sm text-rave-paper">
      {/* Lembar kertas sobek */}
      <div className="rave-crumple relative bg-rave-mustard text-rave-ink before:!opacity-[0.2]" style={{ clipPath: TORN }}>
        <div className="mx-auto flex max-w-[82.5rem] flex-wrap items-end justify-between gap-8 px-4 pt-16 pb-20 md:pt-20 md:pb-24">
          <p className="font-display text-[clamp(52px,8vw,112px)] leading-[0.88] uppercase">
            {f.sloganLine1}
            <br />
            <span className="text-rave-purple">{f.sloganLine2}</span>
          </p>
          {/* Unduh aplikasi — belum rilis: label "Segera di" & tautan ke waitlist (ganti ke URL toko saat rilis). */}
          <div className="flex flex-col items-start gap-3 md:items-end">
            <p className="rave-label text-rave-ink/75">{f.takeRave}</p>
            <div className="flex flex-wrap gap-3">
              {STORES.map(({ icon: Icon, store, href }) => (
                <a
                  key={store}
                  href={href}
                  aria-label={f.storeAria(store)}
                  className="group flex min-w-[11.5rem] items-center gap-3 border-2 border-rave-ink bg-rave-ink px-4 py-2.5 text-rave-paper shadow-[4px_4px_0_#5B2A6E] transition hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_#5B2A6E]"
                >
                  <Icon className="size-7 shrink-0" />
                  <span className="text-left leading-none">
                    <span className="block font-label text-[9.5px] font-bold tracking-[0.14em] text-rave-primary-text uppercase">{f.comingTo}</span>
                    <span className="mt-1 block font-display text-[1.6rem] leading-none uppercase">{store}</span>
                  </span>
                </a>
              ))}
            </div>
            <p className="font-label text-[10.5px] font-bold tracking-[0.06em] text-rave-ink/70 uppercase">{f.storeNote}</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[82.5rem] px-4 pt-14 pb-10">
        <div className="grid gap-12 md:grid-cols-[1.2fr_2fr]">
          <div>
            <RaveLogo className="!h-12" />
            <p className="mt-5 max-w-xs text-[15px] leading-relaxed text-white/65">{f.tagline}</p>
            {/* Ikon media sosial disembunyikan sampai akun resmi tersedia (tidak ada tautan palsu "#"). */}
          </div>
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            {f.cols.map(({ title: h, links: labels }, ci) => (
              <div key={h}>
                <p className="rave-label mb-4 border-b-2 border-rave-primary pb-2 text-rave-primary-text">{h}</p>
                <ul className="space-y-2.5">
                  {labels.map((t, li) => {
                    const href = COL_HREFS[ci][li];
                    const no = String(++n).padStart(2, '0');
                    const cls = 'group flex items-baseline gap-3 font-label text-[12px] font-bold tracking-[0.06em] text-white/80 uppercase transition hover:text-rave-primary-text';
                    const inner = (
                      <>
                        <span className="text-[10px] text-white/30 transition group-hover:text-rave-primary-text">{no}</span>
                        <span className="group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4">{t}</span>
                      </>
                    );
                    return (
                      <li key={t}>
                        {href.startsWith('/') && !href.includes('#') ? (
                          <Link to={href} className={cls}>
                            {inner}
                          </Link>
                        ) : (
                          <a href={href} className={cls}>
                            {inner}
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t-2 border-dashed border-white/15 pt-6 font-label text-[10.5px] tracking-[0.08em] text-white/45 uppercase">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link to="/ketentuan" className="hover:text-rave-paper">{f.terms}</Link>
            <Link to="/privasi" className="hover:text-rave-paper">{f.privacy}</Link>
            <Link to="/hak-cipta" className="hover:text-rave-paper">{f.copyright}</Link>
            <Link to="/cookie" className="hover:text-rave-paper">{f.cookie}</Link>
            <Link to="/iklan" className="hover:text-rave-paper">{f.aboutAds}</Link>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <LanguageSwitch variant="text" />
            <span>© 2026 RAVE · Rastek ID</span>
            <span className="text-rave-primary-text">RV-2026 · DIY or die</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
