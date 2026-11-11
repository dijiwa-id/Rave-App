import { CalendarRange, FileSignature, Inbox, LayoutDashboard, Receipt, ScanLine, Search, Star, Users, Radio } from 'lucide-react';
import { B2BLayout, type B2BNavItem } from '@/layouts/B2BLayout';
import { promotorOrgs, useAuth } from '@/stores/auth';
import { OrgSwitcher, useB2BContext, useCurrentPromotor } from '@/components/b2b/common';
import { OrgOnboarding } from '@/components/b2b/OrgOnboarding';
import { useModule } from '@/components/ModuleGate';
import { useDict } from '@/lib/i18n';

type NavKey = 'dashboard' | 'discover' | 'bookings' | 'contracts' | 'invoices' | 'events' | 'checkin' | 'live' | 'ratings' | 'team';
type Item = Omit<B2BNavItem, 'label'> & { key: NavKey; module?: 'booking' | 'ticketing' | 'live' };
const NAV: Item[] = [
  { to: '/promotor', key: 'dashboard', icon: LayoutDashboard, end: true },
  { to: '/promotor/discover', key: 'discover', icon: Search, module: 'booking' },
  { to: '/promotor/bookings', key: 'bookings', icon: Inbox, module: 'booking' },
  { to: '/promotor/contracts', key: 'contracts', icon: FileSignature, module: 'booking' },
  { to: '/promotor/invoices', key: 'invoices', icon: Receipt, module: 'booking' },
  { to: '/promotor/events', key: 'events', icon: CalendarRange, module: 'ticketing' },
  { to: '/promotor/checkin', key: 'checkin', icon: ScanLine, module: 'ticketing' },
  { to: '/promotor/live', key: 'live', icon: Radio, module: 'live' },
  { to: '/promotor/ratings', key: 'ratings', icon: Star, module: 'booking' },
  { to: '/promotor/team', key: 'team', icon: Users },
];

export default function PromotorLayout() {
  const user = useAuth((s) => s.user);
  const current = useCurrentPromotor();
  const set = useB2BContext((s) => s.set);
  // Menu modul yang dimatikan Super Admin (modules.live / booking / ticketing) disembunyikan.
  const on = { live: useModule('live'), booking: useModule('booking'), ticketing: useModule('ticketing') };
  const orgs = promotorOrgs(user);
  const d = useDict('b2b').promotor;
  if (!orgs.length) return <OrgOnboarding kind="promotor" />;
  return (
    <B2BLayout
      product="Promotor Hub"
      accent="#F4C21F"
      nav={NAV.filter((n) => !n.module || on[n.module]).map(({ key, module: _m, ...n }) => ({ ...n, label: d.nav[key] }))}
      context={<OrgSwitcher label={d.orgSwitcher} orgs={orgs} value={current?.id} onChange={(id) => set({ promotorOrgId: id })} />}
    />
  );
}
