import { StrictMode, useEffect } from 'react';
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
import { useBranding } from '@/lib/platform';

// Chunk lama hilang setelah deploy → muat ulang sekali (lihat juga RouteError).
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  reloadOnceForChunkError();
});

function NotFound() {
  return (
    <div className="grid h-full place-items-center bg-gema-base p-8 text-center">
      <div>
        <p className="text-6xl font-black">404</p>
        <p className="mt-2 text-gema-muted">Halaman tidak ditemukan.</p>
        <Link to="/app" className="mt-6 inline-block rounded-full bg-white px-8 py-3 font-bold text-black">
          Ke Beranda
        </Link>
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

/** Favicon & judul tab mengikuti branding Super Admin (ikon unggahan, nama platform). */
function BrandingHead() {
  const { icon, name } = useBranding();
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    link.href = icon ?? '/favicon.svg';
    link.type = icon?.endsWith('.png') ? 'image/png' : 'image/svg+xml';
  }, [icon]);
  useEffect(() => {
    if (name.toUpperCase() !== 'GEMA') document.title = document.title.replace(/^GEMA\b/, name);
  }, [name]);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionSync />
      <BrandingHead />
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
