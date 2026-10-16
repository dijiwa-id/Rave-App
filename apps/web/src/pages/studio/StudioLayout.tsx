import { BarChart3, CalendarDays, Disc3, FileSignature, Inbox, LayoutDashboard, Mic2, Tags, UserRound, Users, Wallet, Radio } from 'lucide-react';
import { B2BLayout, type B2BNavItem } from '@/layouts/B2BLayout';
import { artistOrgs, useAuth } from '@/stores/auth';
import { OrgSwitcher, useB2BContext, useCurrentArtist } from '@/components/b2b/common';
import { OrgOnboarding } from '@/components/b2b/OrgOnboarding';
import { useModule } from '@/components/ModuleGate';

type Item = B2BNavItem & { module?: 'booking' | 'live' };
const NAV: Item[] = [
  { to: '/studio', label: 'Dasbor', icon: LayoutDashboard, end: true },
  { to: '/studio/releases', label: 'Karya & Rilis', icon: Disc3 },
  { to: '/studio/profile', label: 'Profil Artis', icon: UserRound },
  { to: '/studio/analytics', label: 'Analitik', icon: BarChart3 },
  { to: '/studio/epk', label: 'EPK', icon: Mic2, module: 'booking' },
  { to: '/studio/rate-card', label: 'Rate Card', icon: Tags, module: 'booking' },
  { to: '/studio/calendar', label: 'Kalender', icon: CalendarDays, module: 'booking' },
  { to: '/studio/live', label: 'Live', icon: Radio, module: 'live' },
  { to: '/studio/bookings', label: 'Inbox Booking', icon: Inbox, module: 'booking' },
  { to: '/studio/contracts', label: 'Kontrak', icon: FileSignature, module: 'booking' },
  { to: '/studio/finance', label: 'Keuangan', icon: Wallet },
  { to: '/studio/team', label: 'Tim & KYC', icon: Users },
];

export default function StudioLayout() {
  const user = useAuth((s) => s.user);
  const current = useCurrentArtist();
  const set = useB2BContext((s) => s.set);
  // Menu modul yang dimatikan Super Admin (modules.live / modules.booking) disembunyikan.
  const on = { live: useModule('live'), booking: useModule('booking') };
  const orgs = artistOrgs(user);
  if (!orgs.length) return <OrgOnboarding kind="artist" />;
  return (
    <B2BLayout
      product="Artist Studio"
      accent="#DA1C5C"
      nav={NAV.filter((n) => !n.module || on[n.module])}
      context={<OrgSwitcher label="Artis" orgs={orgs} value={current?.id} onChange={(id) => set({ artistOrgId: id })} />}
    />
  );
}
