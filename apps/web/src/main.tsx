import { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Link, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { b2bRoutes } from '@/routes/b2b';
import { fanRoutes, publicRoutes } from '@/routes/fan';
import { Toaster } from '@/components/ui';
import { RouteError, reloadOnceForChunkError } from '@/components/RouteError';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { useAuth } from '@/stores/auth';
import type { Me } from '@/lib/types';
import { setting, useBranding, usePlatformConfig } from '@/lib/platform';
import { applyPlatformDefault, initLocale, setLocale, useDict, useLocale } from '@/lib/i18n';

// Chunk lama hilang setelah deploy → muat ulang sekali (lihat juga RouteError).
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  reloadOnceForChunkError();
});

/** 404 RAVE: "jarum melompat" — poster punk bersih dengan tombol ke beranda, aplikasi, dan bantuan. */
function NotFound() {
  const d = useDict('common');
  return (
    <div className="grid min-h-full place-items-center bg-rave-ink bg-[radial-gradient(rgba(237,237,237,0.05)_1px,transparent_1.3px)] bg-[length:8px_8px] p-6 text-rave-paper">
      <div className="relative max-w-xl rotate-[-1deg] border-2 border-rave-ink bg-[#1e1c1f] p-8 text-center shadow-[10px_10px_0_#F4C21F] md:p-12">
        <span className="absolute -top-5 right-6 rotate-[6deg] border-2 border-rave-ink bg-rave-paper px-3 pt-1 pb-0.5 text-rave-ink shadow-[3px_3px_0_#0b0a0c]">
          <span className="block font-display text-xl leading-none uppercase">Side B</span>
          <span className="block font-label text-[9px] font-bold tracking-[0.16em] uppercase">{d.notFound.lostTrack}</span>
        </span>
        <p className="font-display text-[clamp(96px,22vw,180px)] leading-[0.8] text-rave-primary-text" aria-hidden>404</p>
        <h1 className="mt-4 text-3xl leading-none">{d.notFound.title}</h1>
        <p className="mt-3 text-white/70">{d.notFound.body}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/" className="rave-label inline-flex items-center border-2 border-rave-primary bg-rave-primary px-6 py-3.5 !text-[12px] text-rave-on-primary shadow-[4px_4px_0_#0b0a0c] transition hover:-translate-y-0.5">
            {d.notFound.home}
          </Link>
          <Link to="/app" className="rave-label inline-flex items-center border-2 border-rave-paper/70 px-6 py-3.5 !text-[12px] text-rave-paper shadow-[4px_4px_0_#0b0a0c] transition hover:-translate-y-0.5 hover:bg-rave-paper hover:text-rave-ink">
            {d.notFound.openApp}
          </Link>
          <Link to="/bantuan" className="rave-label inline-flex items-center px-4 py-3.5 !text-[12px] text-white/70 underline decoration-2 underline-offset-4 hover:text-rave-primary-text">
            {d.notFound.help}
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Navigasi baru selalu mulai dari atas halaman (window); tombol Back memulihkan posisi sebelumnya, dan tautan `/#id` tetap
 * menggulir ke section-nya. Aplikasi fan menggulir kontainer sendiri — direset oleh FanLayout.
 */
function Root() {
  // Halaman di-load lazy: target `#id` belum ada saat browser/ScrollRestoration mencoba menggulir — tunggu sampai ter-render.
  const { hash, key } = useLocation();
  useEffect(() => {
    if (!hash) return;
    let tries = 0;
    const t = setInterval(() => {
      const el = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (el) el.scrollIntoView();
      if (el || ++tries > 40) clearInterval(t);
    }, 50);
    return () => clearInterval(t);
  }, [hash, key]);
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

// Rute akar tanpa path: errorElement terakhir bila error lolos dari boundary layout.
const router = createBrowserRouter([
  { element: <Root />, errorElement: <RouteError />, children: [...publicRoutes, fanRoutes, ...b2bRoutes, { path: '*', element: <NotFound /> }] },
]);

/** Sinkronkan profil (/v1/me) saat aplikasi dibuka dengan sesi tersimpan. */
function SessionSync() {
  const token = useAuth((s) => s.accessToken);
  useEffect(() => {
    if (!token) return;
    api<Me>('/v1/me')
      .then((u) => useAuth.getState().setUser(u))
      .catch(() => {});
  }, [token]);
  return null;
}

/**
 * Bahasa: pilihan di akun menang (lintas perangkat); tanpa itu dipakai pilihan perangkat / bahasa browser /
 * default platform (general.default_locale). Data server yang bergantung bahasa dimuat ulang saat bahasa berganti.
 */
function LocaleSync() {
  const userLocale = useAuth((s) => s.user?.locale ?? null);
  const locale = useLocale((s) => s.locale);
  const platformDefault = setting(usePlatformConfig(), 'general.default_locale', 'id');
  useEffect(() => {
    if (userLocale && userLocale !== useLocale.getState().locale) void setLocale(userLocale);
  }, [userLocale]);
  useEffect(() => applyPlatformDefault(platformDefault), [platformDefault]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void queryClient.invalidateQueries();
  }, [locale]);
  return null;
}

/** Ganti bahasa me-remount router agar semua teks & format (tanggal, angka) konsisten. Audio hidup di store. */
function LocalizedApp() {
  const locale = useLocale((s) => s.locale);
  return <RouterProvider key={locale} router={router} />;
}

const PRIMARY_FONT_KEY = 'rave-primary-font';
const applyPrimaryFont = (v: string | null) => {
  if (v === 'primary2') document.documentElement.dataset.primaryFont = v;
  else delete document.documentElement.dataset.primaryFont;
};
// Pasang pilihan terakhir sebelum render pertama → tidak ada kedipan Primary Font 1 → 2 saat config dimuat.
try {
  applyPrimaryFont(localStorage.getItem(PRIMARY_FONT_KEY));
} catch {
  /* storage diblokir: tunggu config */
}

/** Favicon, judul tab, dan font primer mengikuti branding Super Admin (ikon unggahan, nama platform, `branding.primary_font`). */
function BrandingHead() {
  const { icon, name, primaryFont } = useBranding();
  const cfgLoaded = !!usePlatformConfig();
  useEffect(() => {
    if (!cfgLoaded) return; // jangan timpa cache dengan default sebelum config tiba
    applyPrimaryFont(primaryFont);
    try {
      localStorage.setItem(PRIMARY_FONT_KEY, primaryFont);
    } catch {
      /* abaikan */
    }
  }, [primaryFont, cfgLoaded]);
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    link.href = icon ?? '/favicon.svg';
    link.type = icon?.endsWith('.png') ? 'image/png' : 'image/svg+xml';
  }, [icon]);
  useEffect(() => {
    if (name.toUpperCase() !== 'RAVE') document.title = document.title.replace(/^RAVE\b/, name);
  }, [name]);
  return null;
}

void initLocale().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <SessionSync />
        <LocaleSync />
        <BrandingHead />
        <LocalizedApp />
        <Toaster />
      </QueryClientProvider>
    </StrictMode>,
  ),
);
