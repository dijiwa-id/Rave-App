import { BarChart3, CalendarDays, Disc3, FileSignature, Inbox, LayoutDashboard, Mic2, Tags, UserRound, Users, Wallet, Radio } from 'lucide-react';
import { B2BLayout, type B2BNavItem } from '@/layouts/B2BLayout';
import { artistOrgs, useAuth } from '@/stores/auth';
import { OrgSwitcher, useB2BContext, useCurrentArtist } from '@/components/b2b/common';
import { OrgOnboarding } from '@/components/b2b/OrgOnboarding';
import { useModule } from '@/components/ModuleGate';
import { useDict } from '@/lib/i18n';

type NavKey = 'dashboard' | 'releases' | 'profile' | 'analytics' | 'epk' | 'rateCard' | 'calendar' | 'live' | 'bookings' | 'contracts' | 'finance' | 'team';
type Item = Omit<B2BNavItem, 'label'> & { key: NavKey; module?: 'booking' | 'live' };
const NAV: Item[] = [
  { to: '/studio', key: 'dashboard', icon: LayoutDashboard, end: true },
  { to: '/studio/releases', key: 'releases', icon: Disc3 },
  { to: '/studio/profile', key: 'profile', icon: UserRound },
  { to: '/studio/analytics', key: 'analytics', icon: BarChart3 },
  { to: '/studio/epk', key: 'epk', icon: Mic2, module: 'booking' },
  { to: '/studio/rate-card', key: 'rateCard', icon: Tags, module: 'booking' },
  { to: '/studio/calendar', key: 'calendar', icon: CalendarDays, module: 'booking' },
  { to: '/studio/live', key: 'live', icon: Radio, module: 'live' },
  { to: '/studio/bookings', key: 'bookings', icon: Inbox, module: 'booking' },
  { to: '/studio/contracts', key: 'contracts', icon: FileSignature, module: 'booking' },
  { to: '/studio/finance', key: 'finance', icon: Wallet },
  { to: '/studio/team', key: 'team', icon: Users },
];

export default function StudioLayout() {
  const user = useAuth((s) => s.user);
  const current = useCurrentArtist();
  const set = useB2BContext((s) => s.set);
  // Menu modul yang dimatikan Super Admin (modules.live / modules.booking) disembunyikan.
  const on = { live: useModule('live'), booking: useModule('booking') };
  const d = useDict('b2b').studio;
  const orgs = artistOrgs(user);
  if (!orgs.length) return <OrgOnboarding kind="artist" />;
  return (
    <B2BLayout
      product="Artist Studio"
      accent="#5B2A6E"
      nav={NAV.filter((n) => !n.module || on[n.module]).map(({ key, module: _m, ...n }) => ({ ...n, label: d.nav[key] }))}
      context={<OrgSwitcher label={d.artistSwitcher} orgs={orgs} value={current?.id} onChange={(id) => set({ artistOrgId: id })} />}
    />
  );
}
