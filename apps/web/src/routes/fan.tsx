import type { RouteObject } from 'react-router-dom';
import { FanLayout } from '@/layouts/FanLayout';
import { RequireAuth } from '@/components/guards';
import { page } from './lazy';

// Rute publik (landing, login, onboarding, premium, halaman SEO artis/event) + aplikasi fan (/app/*).
export const publicRoutes: RouteObject[] = [
  { path: '/', element: page(() => import('@/pages/public/Landing')) },
  { path: '/login', element: page(() => import('@/pages/public/Login')) },
  { path: '/onboarding', element: page(() => import('@/pages/public/Onboarding')) },
  { path: '/premium', element: page(() => import('@/pages/public/Premium')) },
  // URL publik terindeks (REQ-WEB-03): gema.id/a/{slug}, gema.id/e/{slug}
  {
    element: <FanLayout />,
    children: [
      { path: '/a/:slug', element: page(() => import('@/pages/fan/ArtistPage')) },
      { path: '/e/:slug', element: page(() => import('@/pages/fan/EventDetail')) },
    ],
  },
];

export const fanRoutes: RouteObject = {
  path: '/app',
  element: <FanLayout />,
  children: [
    // Dapat diakses anonim (pratinjau 30 detik)
    { index: true, element: page(() => import('@/pages/fan/Home')) },
    { path: 'search', element: page(() => import('@/pages/fan/Search')) },
    { path: 'genre/:id', element: page(() => import('@/pages/fan/Genre')) },
    { path: 'artist/:idOrSlug', element: page(() => import('@/pages/fan/ArtistPage')) },
    { path: 'album/:id', element: page(() => import('@/pages/fan/Album')) },
    { path: 'track/:id', element: page(() => import('@/pages/fan/Track')) },
    { path: 'playlist/:id', element: page(() => import('@/pages/fan/Playlist')) },
    { path: 'podcasts', element: page(() => import('@/pages/fan/Podcasts')) },
    { path: 'show/:id', element: page(() => import('@/pages/fan/ShowPage')) },
    { path: 'episode/:id', element: page(() => import('@/pages/fan/EpisodePage')) },
    { path: 'events', element: page(() => import('@/pages/fan/Events')) },
    { path: 'events/:idOrSlug', element: page(() => import('@/pages/fan/EventDetail')) },
    { path: 'lyrics', element: page(() => import('@/pages/fan/Lyrics')) },
    { path: 'queue', element: page(() => import('@/pages/fan/Queue')) },
    // Wajib login
    {
      element: <RequireAuth />,
      children: [
        { path: 'library', element: page(() => import('@/pages/fan/Library')) },
        { path: 'liked', element: page(() => import('@/pages/fan/Liked')) },
        { path: 'tickets', element: page(() => import('@/pages/fan/Tickets')) },
        { path: 'notifications', element: page(() => import('@/pages/fan/Notifications')) },
        { path: 'settings', element: page(() => import('@/pages/fan/Settings')) },
      ],
    },
  ],
};
