import type { RouteObject } from 'react-router-dom';
import { FanLayout } from '@/layouts/FanLayout';
import { RequireAuth } from '@/components/guards';
import { RouteError } from '@/components/RouteError';
import { ModuleGate } from '@/components/ModuleGate';
import { page } from './lazy';

// Pola boundary: errorElement di layout (layout crash) + rute pembungkus tanpa path di dalamnya
// agar halaman crash tampil di dalam <Outlet/> dan shell/pemutar tetap hidup.
const guarded = (children: RouteObject[]): RouteObject[] => [{ errorElement: <RouteError />, children }];

// Rute publik (landing, login, onboarding, premium, halaman SEO artis/event) + aplikasi fan (/app/*).
export const publicRoutes: RouteObject[] = [
  { path: '/', element: page(() => import('@/pages/public/Landing')) },
  { path: '/login', element: page(() => import('@/pages/public/Login')) },
  { path: '/onboarding', element: page(() => import('@/pages/public/Onboarding')) },
  { path: '/premium', element: page(() => import('@/pages/public/Premium')) },
  // Link EPK privat dari Studio (`/epk/{slug}?token=…`, booking/routes-artist.ts)
  { path: '/epk/:slug', element: page(() => import('@/pages/public/EpkPublic')) },
  // Halaman perusahaan (tautan footer): tentang, karier, media, artis, promotor, developer, iklan, investor
  { path: '/tentang', element: page(() => import('@/pages/company/About')) },
  { path: '/karier', element: page(() => import('@/pages/company/Careers')) },
  { path: '/media', element: page(() => import('@/pages/company/Press')) },
  { path: '/untuk-artis', element: page(() => import('@/pages/company/ForArtists')) },
  { path: '/untuk-promotor', element: page(() => import('@/pages/company/ForPromoters')) },
  { path: '/developer', element: page(() => import('@/pages/company/Developers')) },
  { path: '/iklan', element: page(() => import('@/pages/company/Advertise')) },
  { path: '/investor', element: page(() => import('@/pages/company/Investors')) },
  // URL publik terindeks (REQ-WEB-03): gema.id/a/{slug}, gema.id/e/{slug}
  {
    element: <FanLayout />,
    errorElement: <RouteError />,
    children: guarded([
      { path: '/a/:slug', element: page(() => import('@/pages/fan/ArtistPage')) },
      { element: <ModuleGate module="ticketing" />, children: [{ path: '/e/:slug', element: page(() => import('@/pages/fan/EventDetail')) }] },
    ]),
  },
];

export const fanRoutes: RouteObject = {
  path: '/app',
  element: <FanLayout />,
  errorElement: <RouteError />,
  children: guarded([
    // Dapat diakses anonim (pratinjau 30 detik)
    { index: true, element: page(() => import('@/pages/fan/Home')) },
    { path: 'search', element: page(() => import('@/pages/fan/Search')) },
    { path: 'genre/:id', element: page(() => import('@/pages/fan/Genre')) },
    { path: 'artist/:idOrSlug', element: page(() => import('@/pages/fan/ArtistPage')) },
    { path: 'album/:id', element: page(() => import('@/pages/fan/Album')) },
    { path: 'track/:id', element: page(() => import('@/pages/fan/Track')) },
    { path: 'playlist/:id', element: page(() => import('@/pages/fan/Playlist')) },
    // Modul yang bisa dimatikan Super Admin: rute dibuka langsung → keadaan "dinonaktifkan", bukan 503 mentah.
    {
      element: <ModuleGate module="podcasts" />,
      children: [
        { path: 'podcasts', element: page(() => import('@/pages/fan/Podcasts')) },
        { path: 'show/:id', element: page(() => import('@/pages/fan/ShowPage')) },
        { path: 'episode/:id', element: page(() => import('@/pages/fan/EpisodePage')) },
      ],
    },
    {
      element: <ModuleGate module="ticketing" />,
      children: [
        { path: 'events', element: page(() => import('@/pages/fan/Events')) },
        { path: 'events/:idOrSlug', element: page(() => import('@/pages/fan/EventDetail')) },
      ],
    },
    { path: 'live', element: page(() => import('@/pages/fan/Live')) },
    { path: 'live/:id', element: page(() => import('@/pages/fan/LiveWatch')) },
    { path: 'lyrics', element: page(() => import('@/pages/fan/Lyrics')) },
    { path: 'queue', element: page(() => import('@/pages/fan/Queue')) },
    // Wajib login
    {
      element: <RequireAuth />,
      children: [
        { path: 'library', element: page(() => import('@/pages/fan/Library')) },
        { path: 'liked', element: page(() => import('@/pages/fan/Liked')) },
        { element: <ModuleGate module="ticketing" />, children: [{ path: 'tickets', element: page(() => import('@/pages/fan/Tickets')) }] },
        { path: 'notifications', element: page(() => import('@/pages/fan/Notifications')) },
        { path: 'settings', element: page(() => import('@/pages/fan/Settings')) },
      ],
    },
  ]),
};
