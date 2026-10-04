import { lazy, Suspense, type ComponentType } from 'react';
import type { RouteObject } from 'react-router-dom';
import { RequireAuth, RequireRole } from '@/components/guards';
import { PageLoader } from '@/components/ui';

// Rute Artist Studio (/studio), Promotor Hub (/promotor), Back Office (/admin). Code-split per modul.
function named<M extends Record<string, any>>(loader: () => Promise<M>, key: keyof M) {
  const C = lazy(async () => ({ default: (await loader())[key] as ComponentType }));
  return (
    <Suspense fallback={<PageLoader />}>
      <C />
    </Suspense>
  );
}

const studio = {
  layout: () => import('@/pages/studio/StudioLayout'),
  dashboard: () => import('@/pages/studio/Dashboard'),
  releases: () => import('@/pages/studio/Releases'),
  newRelease: () => import('@/pages/studio/NewRelease'),
  release: () => import('@/pages/studio/ReleaseDetail'),
  analytics: () => import('@/pages/studio/Analytics'),
  epk: () => import('@/pages/studio/EpkEditor'),
  rate: () => import('@/pages/studio/RateCard'),
  calendar: () => import('@/pages/studio/Calendar'),
  bookings: () => import('@/pages/studio/Bookings'),
  finance: () => import('@/pages/studio/Finance'),
  team: () => import('@/pages/studio/Team'),
};
const promotor = {
  layout: () => import('@/pages/promotor/PromotorLayout'),
  dashboard: () => import('@/pages/promotor/Dashboard'),
  discover: () => import('@/pages/promotor/Discover'),
  artist: () => import('@/pages/promotor/ArtistProfile'),
  bookings: () => import('@/pages/promotor/Bookings'),
  events: () => import('@/pages/promotor/Events'),
  checkin: () => import('@/pages/promotor/Checkin'),
};
const admin = () => import('@/pages/admin/Admin');

export const b2bRoutes: RouteObject[] = [
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/studio',
        element: named(studio.layout, 'default'),
        children: [
          { index: true, element: named(studio.dashboard, 'default') },
          { path: 'releases', element: named(studio.releases, 'default') },
          { path: 'releases/new', element: named(studio.newRelease, 'default') },
          { path: 'releases/:id', element: named(studio.release, 'default') },
          { path: 'analytics', element: named(studio.analytics, 'default') },
          { path: 'epk', element: named(studio.epk, 'default') },
          { path: 'rate-card', element: named(studio.rate, 'default') },
          { path: 'calendar', element: named(studio.calendar, 'default') },
          { path: 'bookings', element: named(studio.bookings, 'StudioBookings') },
          { path: 'bookings/:id', element: named(studio.bookings, 'StudioBookingPage') },
          { path: 'contracts', element: named(studio.bookings, 'StudioContracts') },
          { path: 'finance', element: named(studio.finance, 'default') },
          { path: 'team', element: named(studio.team, 'default') },
        ],
      },
      {
        path: '/promotor',
        element: named(promotor.layout, 'default'),
        children: [
          { index: true, element: named(promotor.dashboard, 'default') },
          { path: 'discover', element: named(promotor.discover, 'default') },
          { path: 'artists/:artistId', element: named(promotor.artist, 'default') },
          { path: 'bookings', element: named(promotor.bookings, 'PromotorBookings') },
          { path: 'bookings/:id', element: named(promotor.bookings, 'PromotorBookingPage') },
          { path: 'contracts', element: named(promotor.bookings, 'PromotorContracts') },
          { path: 'invoices', element: named(promotor.bookings, 'PromotorInvoices') },
          { path: 'ratings', element: named(promotor.bookings, 'PromotorRatings') },
          { path: 'team', element: named(promotor.bookings, 'PromotorTeam') },
          { path: 'events', element: named(promotor.events, 'PromotorEvents') },
          { path: 'events/new', element: named(promotor.events, 'NewEvent') },
          { path: 'events/:id/checkin', element: named(promotor.checkin, 'default') },
          { path: 'checkin', element: named(promotor.checkin, 'default') },
        ],
      },
      {
        element: <RequireRole roles={['admin']} />,
        children: [
          {
            path: '/admin',
            element: named(admin, 'AdminLayout'),
            children: [
              { index: true, element: named(admin, 'AdminDashboard') },
              { path: 'qc', element: named(admin, 'AdminQc') },
              { path: 'kyc', element: named(admin, 'AdminKyc') },
              { path: 'disputes', element: named(admin, 'AdminDisputes') },
              { path: 'finance', element: named(admin, 'AdminFinance') },
              { path: 'users', element: named(admin, 'AdminUsers') },
              { path: 'audit', element: named(admin, 'AdminAudit') },
            ],
          },
        ],
      },
    ],
  },
];
