import { CalendarRange, FileSignature, Inbox, LayoutDashboard, Receipt, ScanLine, Search, Star, Users, Radio } from 'lucide-react';
import { B2BLayout, type B2BNavItem } from '@/layouts/B2BLayout';
import { promotorOrgs, useAuth } from '@/stores/auth';
import { OrgSwitcher, useB2BContext, useCurrentPromotor } from '@/components/b2b/common';
import { OrgOnboarding } from '@/components/b2b/OrgOnboarding';
import { useModule } from '@/components/ModuleGate';

type Item = B2BNavItem & { module?: 'booking' | 'ticketing' | 'live' };
const NAV: Item[] = [
  { to: '/promotor', label: 'Dasbor', icon: LayoutDashboard, end: true },
  { to: '/promotor/discover', label: 'Cari Artis', icon: Search, module: 'booking' },
  { to: '/promotor/bookings', label: 'Inquiry & Negosiasi', icon: Inbox, module: 'booking' },
  { to: '/promotor/contracts', label: 'Kontrak', icon: FileSignature, module: 'booking' },
  { to: '/promotor/invoices', label: 'Pembayaran & Invoice', icon: Receipt, module: 'booking' },
  { to: '/promotor/events', label: 'Event Saya', icon: CalendarRange, module: 'ticketing' },
  { to: '/promotor/checkin', label: 'Check-in', icon: ScanLine, module: 'ticketing' },
  { to: '/promotor/live', label: 'Live', icon: Radio, module: 'live' },
  { to: '/promotor/ratings', label: 'Rating', icon: Star, module: 'booking' },
  { to: '/promotor/team', label: 'Tim & KYC', icon: Users },
];

export default function PromotorLayout() {
  const user = useAuth((s) => s.user);
  const current = useCurrentPromotor();
  const set = useB2BContext((s) => s.set);
  // Menu modul yang dimatikan Super Admin (modules.live / booking / ticketing) disembunyikan.
  const on = { live: useModule('live'), booking: useModule('booking'), ticketing: useModule('ticketing') };
  const orgs = promotorOrgs(user);
  if (!orgs.length) return <OrgOnboarding kind="promotor" />;
  return (
    <B2BLayout
      product="Promotor Hub"
      accent="#e8115b"
      nav={NAV.filter((n) => !n.module || on[n.module])}
      context={<OrgSwitcher label="Organisasi" orgs={orgs} value={current?.id} onChange={(id) => set({ promotorOrgId: id })} />}
    />
  );
}
