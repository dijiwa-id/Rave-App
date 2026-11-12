import { lazy, Suspense, type ComponentType } from 'react';
import type { RouteObject } from 'react-router-dom';
import type { AdminPermission } from '@rave/domain/settings';
import { RequireAdminAccess, RequireAuth, RequireRole } from '@/components/guards';
import { PageLoader } from '@/components/ui';
import { RouteError } from '@/components/RouteError';
import { ModuleGate, type ModuleKey } from '@/components/ModuleGate';

// Rute Artist Studio (/studio), Promotor Hub (/promotor), Back Office (/admin). Code-split per modul.
function named<M extends Record<string, any>>(loader: () => Promise<M>, key: keyof M) {
  const C = lazy(async () => ({ default: (await loader())[key] as ComponentType }));
  return (
    <Suspense fallback={<PageLoader />}>
      <C />
    </Suspense>
  );
}

// errorElement di layout + pembungkus tanpa path untuk anak (halaman crash tetap di dalam shell dasbor).
const B2B_ERR = <RouteError variant="b2b" />;
const guarded = (children: RouteObject[]): RouteObject[] => [{ errorElement: B2B_ERR, children }];
// Rute milik modul yang bisa dimatikan Super Admin → tampilkan keadaan "dinonaktifkan", bukan error 503.
const gated = (module: ModuleKey, children: RouteObject[]): RouteObject => ({ element: <ModuleGate module={module} variant="b2b" />, children });

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
  profile: () => import('@/pages/studio/Profile'),
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
const adminLive = () => import('@/pages/admin/AdminLive');
const adminAds = () => import('@/pages/admin/AdminAds');
// Live Streaming: satu modul untuk Studio & Promotor Hub (org dari pemilih layout).
const live = () => import('@/pages/live/LiveStudio');
const platform = {
  main: () => import('@/pages/admin/Platform'),
  settings: () => import('@/pages/admin/PlatformSettings'),
  storage: () => import('@/pages/admin/PlatformStorage'),
  roles: () => import('@/pages/admin/PlatformRoles'),
  landing: () => import('@/pages/admin/PlatformLanding'),
  integrations: () => import('@/pages/admin/PlatformIntegrations'),
  artwork: () => import('@/pages/admin/PlatformArtwork'),
};
const access = (perms: AdminPermission[], children: RouteObject[]): RouteObject => ({ element: <RequireAdminAccess perms={perms} />, children });

export const b2bRoutes: RouteObject[] = [
  {
    element: <RequireAuth />,
    errorElement: B2B_ERR,
    children: [
      {
        path: '/studio',
        element: named(studio.layout, 'default'),
        errorElement: B2B_ERR,
        children: guarded([
          { index: true, element: named(studio.dashboard, 'default') },
          { path: 'releases', element: named(studio.releases, 'default') },
          { path: 'releases/new', element: named(studio.newRelease, 'default') },
          { path: 'releases/:id', element: named(studio.release, 'default') },
          { path: 'analytics', element: named(studio.analytics, 'default') },
          { path: 'profile', element: named(studio.profile, 'default') },
          gated('booking', [
            { path: 'epk', element: named(studio.epk, 'default') },
            { path: 'rate-card', element: named(studio.rate, 'default') },
            { path: 'calendar', element: named(studio.calendar, 'default') },
            { path: 'bookings', element: named(studio.bookings, 'StudioBookings') },
            { path: 'bookings/:id', element: named(studio.bookings, 'StudioBookingPage') },
            { path: 'contracts', element: named(studio.bookings, 'StudioContracts') },
          ]),
          { path: 'finance', element: named(studio.finance, 'default') },
          { path: 'team', element: named(studio.team, 'default') },
          { path: 'live', element: named(live, 'StudioLive') },
          { path: 'live/:id', element: named(live, 'StudioLiveDetail') },
        ]),
      },
      {
        path: '/promotor',
        element: named(promotor.layout, 'default'),
        errorElement: B2B_ERR,
        children: guarded([
          { index: true, element: named(promotor.dashboard, 'default') },
          gated('booking', [
            { path: 'discover', element: named(promotor.discover, 'default') },
            { path: 'artists/:artistId', element: named(promotor.artist, 'default') },
            { path: 'bookings', element: named(promotor.bookings, 'PromotorBookings') },
            { path: 'bookings/:id', element: named(promotor.bookings, 'PromotorBookingPage') },
            { path: 'contracts', element: named(promotor.bookings, 'PromotorContracts') },
            { path: 'invoices', element: named(promotor.bookings, 'PromotorInvoices') },
            { path: 'ratings', element: named(promotor.bookings, 'PromotorRatings') },
          ]),
          { path: 'team', element: named(promotor.bookings, 'PromotorTeam') },
          gated('ticketing', [
            { path: 'events', element: named(promotor.events, 'PromotorEvents') },
            { path: 'events/new', element: named(promotor.events, 'NewEvent') },
            { path: 'events/:id/checkin', element: named(promotor.checkin, 'default') },
            { path: 'checkin', element: named(promotor.checkin, 'default') },
          ]),
          { path: 'live', element: named(live, 'PromotorLive') },
          { path: 'live/:id', element: named(live, 'PromotorLiveDetail') },
        ]),
      },
      {
        element: <RequireRole roles={['admin']} />,
        children: [
          {
            path: '/admin',
            element: named(admin, 'AdminLayout'),
            errorElement: B2B_ERR,
            // Izin per halaman = matriks "Peran & Akses" (ditegakkan juga di backend); Platform khusus Super Admin.
            children: guarded([
              { index: true, element: named(admin, 'AdminDashboard') },
              access(['qc.review'], [{ path: 'qc', element: named(admin, 'AdminQc') }]),
              access(['kyc.review'], [{ path: 'kyc', element: named(admin, 'AdminKyc') }]),
              access(['dispute.resolve'], [{ path: 'disputes', element: named(admin, 'AdminDisputes') }]),
              access(['live.moderate'], [{ path: 'live', element: named(adminLive, 'AdminLive') }]),
              access(['finance.view', 'finance.refund', 'finance.payout'], [{ path: 'finance', element: named(admin, 'AdminFinance') }]),
              access(['users.view'], [{ path: 'users', element: named(admin, 'AdminUsers') }]),
              access(['audit.view'], [{ path: 'audit', element: named(admin, 'AdminAudit') }]),
              // Iklan tier Gratis (docs/API.md §11) — tab via ?tab=overview|campaigns|policy.
              access(['ads.manage', 'ads.review'], [{ path: 'ads', element: named(adminAds, 'AdminAds') }]),
              {
                element: <RequireAdminAccess superOnly />,
                children: [
                  { path: 'platform', element: named(platform.main, 'PlatformDashboard') },
                  { path: 'platform/settings', element: named(platform.settings, 'PlatformSettings') },
                  { path: 'platform/landing', element: named(platform.landing, 'PlatformLanding') },
                  { path: 'platform/roles', element: named(platform.roles, 'PlatformRoles') },
                  { path: 'platform/storage', element: named(platform.storage, 'PlatformStorage') },
                  { path: 'platform/backups', element: named(platform.storage, 'PlatformBackups') },
                  { path: 'platform/integrations', element: named(platform.integrations, 'PlatformIntegrations') },
                  { path: 'platform/artwork', element: named(platform.artwork, 'PlatformArtwork') },
                  { path: 'platform/bus', element: named(platform.main, 'PlatformBus') },
                  { path: 'platform/admins', element: named(platform.main, 'PlatformAdmins') },
                ],
              },
            ]),
          },
        ],
      },
    ],
  },
];
