import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import CountUp from '@/components/reactbits/CountUp';
import { api, fmt } from '@/lib/api';
import type { ArtistAnalytics, BookingSummary, Release, Wallet } from '@/lib/types';
import { Badge, Button, Card, PageHeader } from '@/components/ui';
import { BookingStatusBadge, greeting, useCurrentArtist } from '@/components/b2b/common';
import { Sparkline } from '@/components/b2b/charts';
import { PendingSplits } from '@/components/b2b/PendingSplits';
import { ReleaseStatusBadge } from './Releases';
import { useDict } from '@/lib/i18n';

const ACTIVE = ['INQUIRY', 'NEGOTIATING', 'AGREED', 'CONTRACT_SENT', 'SIGNED', 'BOOKED', 'BOOKED_AND_SECURED', 'AT_RISK', 'SHOW_DAY'];

function Tile({ label, value, prefix, hint, spark }: { label: string; value: number | undefined; prefix?: string; hint?: string; spark?: number[] }) {
  return (
    <div className="b2b-surface b2b-accent-top min-w-0 rounded-none border border-b2b-line p-4 pt-5">
      <p className="rave-label truncate !text-[10.5px] text-b2b-muted">{label}</p>
      <p className="mt-2 truncate text-[clamp(1.4rem,2.6vw,1.85rem)] leading-none font-extrabold tracking-tight text-b2b-ink tabular-nums">
        {prefix}
        {value == null ? '—' : <CountUp to={value} separator="." duration={1.2} />}
      </p>
      {hint && <p className="mt-1 truncate text-xs text-b2b-muted">{hint}</p>}
      {spark && <Sparkline values={spark} className="mt-3" />}
    </div>
  );
}

export default function StudioDashboard() {
  const artist = useCurrentArtist()!;
  const aid = artist.artist_id!;
  const analytics = useQuery({ queryKey: ['analytics', aid, 28], queryFn: () => api<ArtistAnalytics>(`/v1/analytics/artists/${aid}/summary`, { query: { days: 28 } }) });
  const bookings = useQuery({ queryKey: ['bookings', 'artist', aid, undefined, ''], queryFn: () => api<{ data: BookingSummary[] }>('/v1/booking/bookings', { query: { side: 'artist', artist_id: aid } }) });
  const releases = useQuery({ queryKey: ['studio-releases', aid], queryFn: () => api<{ data: Release[] }>(`/v1/studio/artists/${aid}/releases`) });
  const wallet = useQuery({ queryKey: ['wallet', artist.id], queryFn: () => api<Wallet>(`/v1/finance/wallets/${artist.id}`), retry: false });
  const active = bookings.data?.data.filter((b) => ACTIVE.includes(b.status)) ?? [];
  const inquiries = active.filter((b) => b.status === 'INQUIRY').length;
  const t = useDict('b2b').studio.dashboard;

  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${artist.name}`}
        subtitle={t.subtitle}
        actions={
          <Link to="/studio/releases/new">
            <Button variant="ink">{t.newRelease}</Button>
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label={t.listeners} value={analytics.data?.listeners} hint={t.listenersHint} spark={analytics.data?.daily.map((d) => d.listeners)} />
        <Tile label={t.streams} value={analytics.data?.streams} hint={t.streamsHint} spark={analytics.data?.daily.map((d) => d.streams)} />
        <Tile label={t.activeBookings} value={bookings.data ? active.length : undefined} hint={t.newInquiries(inquiries)} />
        <Tile label={t.walletBalance} prefix="Rp " value={wallet.data?.balances.total} hint={t.withdrawable} />
      </div>

      <PendingSplits className="mt-6" />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title={t.latestBookings} action={<Link to="/studio/bookings" className="text-sm font-bold text-b2b-muted hover:text-b2b-ink">{t.all}</Link>}>
          {bookings.isLoading ? (
            <p className="text-sm text-b2b-muted">{t.loading}</p>
          ) : !bookings.data?.data.length ? (
            <p className="text-sm text-b2b-muted">{t.noBookings}</p>
          ) : (
            <ul className="divide-y divide-b2b-line">
              {bookings.data.data.slice(0, 5).map((b) => (
                <li key={b.id}>
                  <Link to={`/studio/bookings/${b.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{b.event_name || b.promotor_org.name}</p>
                      <p className="text-xs text-b2b-muted">
                        {b.promotor_org.name} · {fmt.date(b.event_date)} · {b.city}
                      </p>
                    </div>
                    <BookingStatusBadge status={b.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t.latestReleases} action={<Link to="/studio/releases" className="text-sm font-bold text-b2b-muted hover:text-b2b-ink">{t.all}</Link>}>
          {!releases.data?.data.length ? (
            <p className="text-sm text-b2b-muted">{t.noReleases}</p>
          ) : (
            <ul className="divide-y divide-b2b-line">
              {releases.data.data.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5">
                  {r.cover_url ? <img src={r.cover_url} alt="" className="size-10 rounded-none object-cover" /> : <div className="size-10 rounded-none bg-b2b-bg" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{r.title}</p>
                    <p className="text-xs text-b2b-muted">
                      {r.type} · {fmt.date(r.release_date)}
                    </p>
                  </div>
                  <ReleaseStatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        {analytics.data && (
          <Card title={t.topCities}>
            <div className="flex flex-wrap gap-2">
              {analytics.data.top_cities.slice(0, 6).map((c) => (
                <Badge key={c.city}>
                  {c.city} · {fmt.compact(c.listeners)}
                </Badge>
              ))}
            </div>
            <p className="mt-3 text-xs text-b2b-muted">{t.topCitiesNote}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
