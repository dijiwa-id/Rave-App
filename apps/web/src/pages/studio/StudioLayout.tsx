import { BarChart3, CalendarDays, Crown, Disc3, FileSignature, Headphones, Inbox, LayoutDashboard, LineChart, Mic2, Tags, UserRound, Users, Wallet, Radio } from 'lucide-react';
import { B2BLayout, type B2BNavItem } from '@/layouts/B2BLayout';
import { artistOrgs, useAuth } from '@/stores/auth';
import { OrgSwitcher, useB2BContext, useCurrentArtist } from '@/components/b2b/common';
import { OrgOnboarding } from '@/components/b2b/OrgOnboarding';
import { useModule } from '@/components/ModuleGate';
import { useDict } from '@/lib/i18n';
import { setting, usePlatformConfig } from '@/lib/platform';

type NavKey = 'dashboard' | 'releases' | 'profile' | 'analytics' | 'epk' | 'rateCard' | 'calendar' | 'live' | 'podcasts' | 'bookings' | 'contracts' | 'insights' | 'finance' | 'team' | 'pro';
type Item = Omit<B2BNavItem, 'label'> & { key: NavKey; module?: 'booking' | 'live' | 'podcasts' };
const NAV: Item[] = [
  { to: '/studio', key: 'dashboard', icon: LayoutDashboard, end: true },
  { to: '/studio/releases', key: 'releases', icon: Disc3 },
  { to: '/studio/profile', key: 'profile', icon: UserRound },
  { to: '/studio/analytics', key: 'analytics', icon: BarChart3 },
  { to: '/studio/epk', key: 'epk', icon: Mic2, module: 'booking' },
  { to: '/studio/rate-card', key: 'rateCard', icon: Tags, module: 'booking' },
  { to: '/studio/calendar', key: 'calendar', icon: CalendarDays, module: 'booking' },
  { to: '/studio/live', key: 'live', icon: Radio, module: 'live' },
  { to: '/studio/podcasts', key: 'podcasts', icon: Headphones, module: 'podcasts' },
  { to: '/studio/bookings', key: 'bookings', icon: Inbox, module: 'booking' },
  { to: '/studio/contracts', key: 'contracts', icon: FileSignature, module: 'booking' },
  { to: '/studio/insights', key: 'insights', icon: LineChart, module: 'booking' },
  { to: '/studio/finance', key: 'finance', icon: Wallet },
  { to: '/studio/team', key: 'team', icon: Users },
  { to: '/studio/pro', key: 'pro', icon: Crown },
];

export default function StudioLayout() {
  const user = useAuth((s) => s.user);
  const current = useCurrentArtist();
  const set = useB2BContext((s) => s.set);
  // Menu modul yang dimatikan Super Admin (modules.live / modules.booking) disembunyikan.
  const cfg = usePlatformConfig();
  // Menu Podcast: modul aktif + penerbitan kreator dibuka + jenis org saat ini diizinkan (Pengaturan → Podcaster).
  const podcastOk =
    useModule('podcasts') && setting(cfg, 'podcast.creator_enabled', true) && setting<string[]>(cfg, 'podcast.creator_org_types', ['ARTIST', 'CREATOR']).includes(current?.type ?? 'ARTIST');
  const on = { live: useModule('live'), booking: useModule('booking'), podcasts: podcastOk };
  const d = useDict('b2b').studio;
  const orgs = artistOrgs(user);
  if (!orgs.length) return <OrgOnboarding kind="artist" />;
  return (
    <B2BLayout
      product="Artist Studio"
      accent="#5B2A6E"
      nav={NAV.filter((n) => !n.module || on[n.module]).map(({ key, module: _m, ...n }) => ({ ...n, label: d.nav[key], ...(key === 'pro' && current?.pro ? { badge: 'PRO' } : {}) }))}
      context={<OrgSwitcher label={d.artistSwitcher} orgs={orgs} value={current?.id} onChange={(id) => set({ artistOrgId: id })} />}
    />
  );
}
