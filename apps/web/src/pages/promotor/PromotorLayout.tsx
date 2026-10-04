import { CalendarRange, FileSignature, Inbox, LayoutDashboard, Receipt, ScanLine, Search, Star, Users } from 'lucide-react';
import { B2BLayout, type B2BNavItem } from '@/layouts/B2BLayout';
import { promotorOrgs, useAuth } from '@/stores/auth';
import { OrgSwitcher, useB2BContext, useCurrentPromotor } from '@/components/b2b/common';
import { OrgOnboarding } from '@/components/b2b/OrgOnboarding';

const NAV: B2BNavItem[] = [
  { to: '/promotor', label: 'Dasbor', icon: LayoutDashboard, end: true },
  { to: '/promotor/discover', label: 'Cari Artis', icon: Search },
  { to: '/promotor/bookings', label: 'Inquiry & Negosiasi', icon: Inbox },
  { to: '/promotor/contracts', label: 'Kontrak', icon: FileSignature },
  { to: '/promotor/invoices', label: 'Pembayaran & Invoice', icon: Receipt },
  { to: '/promotor/events', label: 'Event Saya', icon: CalendarRange },
  { to: '/promotor/checkin', label: 'Check-in', icon: ScanLine },
  { to: '/promotor/ratings', label: 'Rating', icon: Star },
  { to: '/promotor/team', label: 'Tim & KYC', icon: Users },
];

export default function PromotorLayout() {
  const user = useAuth((s) => s.user);
  const current = useCurrentPromotor();
  const set = useB2BContext((s) => s.set);
  const orgs = promotorOrgs(user);
  if (!orgs.length) return <OrgOnboarding kind="promotor" />;
  return (
    <B2BLayout
      product="Promotor Hub"
      accent="#e8115b"
      nav={NAV}
      context={<OrgSwitcher label="Organisasi" orgs={orgs} value={current?.id} onChange={(id) => set({ promotorOrgId: id })} />}
    />
  );
}
