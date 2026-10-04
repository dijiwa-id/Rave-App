import { BarChart3, CalendarDays, Disc3, FileSignature, Inbox, LayoutDashboard, Mic2, Tags, Users, Wallet } from 'lucide-react';
import { B2BLayout, type B2BNavItem } from '@/layouts/B2BLayout';
import { artistOrgs, useAuth } from '@/stores/auth';
import { OrgSwitcher, useB2BContext, useCurrentArtist } from '@/components/b2b/common';
import { OrgOnboarding } from '@/components/b2b/OrgOnboarding';

const NAV: B2BNavItem[] = [
  { to: '/studio', label: 'Dasbor', icon: LayoutDashboard, end: true },
  { to: '/studio/releases', label: 'Karya & Rilis', icon: Disc3 },
  { to: '/studio/analytics', label: 'Analitik', icon: BarChart3 },
  { to: '/studio/epk', label: 'EPK', icon: Mic2 },
  { to: '/studio/rate-card', label: 'Rate Card', icon: Tags },
  { to: '/studio/calendar', label: 'Kalender', icon: CalendarDays },
  { to: '/studio/bookings', label: 'Inbox Booking', icon: Inbox },
  { to: '/studio/contracts', label: 'Kontrak', icon: FileSignature },
  { to: '/studio/finance', label: 'Keuangan', icon: Wallet },
  { to: '/studio/team', label: 'Tim & Split Fee', icon: Users },
];

export default function StudioLayout() {
  const user = useAuth((s) => s.user);
  const current = useCurrentArtist();
  const set = useB2BContext((s) => s.set);
  const orgs = artistOrgs(user);
  if (!orgs.length) return <OrgOnboarding kind="artist" />;
  return (
    <B2BLayout
      product="Artist Studio"
      accent="#1db954"
      nav={NAV}
      context={<OrgSwitcher label="Artis" orgs={orgs} value={current?.id} onChange={(id) => set({ artistOrgId: id })} />}
    />
  );
}
