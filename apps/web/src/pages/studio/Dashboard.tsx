import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import CountUp from '@/components/reactbits/CountUp';
import { api, fmt } from '@/lib/api';
import type { ArtistAnalytics, BookingSummary, Release, Wallet } from '@/lib/types';
import { Badge, Button, Card, PageHeader } from '@/components/ui';
import { BookingStatusBadge, useCurrentArtist } from '@/components/b2b/common';
import { Sparkline } from '@/components/b2b/charts';
import { PendingSplits } from '@/components/b2b/PendingSplits';
import { ReleaseStatusBadge } from './Releases';

const ACTIVE = ['INQUIRY', 'NEGOTIATING', 'AGREED', 'CONTRACT_SENT', 'SIGNED', 'BOOKED', 'BOOKED_AND_SECURED', 'AT_RISK', 'SHOW_DAY'];

function Tile({ label, value, prefix, hint, spark }: { label: string; value: number | undefined; prefix?: string; hint?: string; spark?: number[] }) {
  return (
    <div className="rounded-xl border border-b2b-line bg-b2b-card p-4">
      <p className="text-xs font-semibold tracking-wide text-b2b-muted uppercase">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-b2b-ink tabular-nums">
        {prefix}
        {value == null ? '—' : <CountUp to={value} separator="." duration={1.2} />}
      </p>
      {hint && <p className="mt-0.5 text-xs text-b2b-muted">{hint}</p>}
      {spark && <Sparkline values={spark} className="mt-2" />}
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

  return (
    <div>
      <PageHeader
        title={`Halo, ${artist.name}`}
        subtitle="Ringkasan 28 hari terakhir"
        actions={
          <Link to="/studio/releases/new">
            <Button variant="ink">Rilis baru</Button>
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Pendengar" value={analytics.data?.listeners} hint="unik, 28 hari" spark={analytics.data?.daily.map((d) => d.listeners)} />
        <Tile label="Stream" value={analytics.data?.streams} hint="qualified ≥ 30 dtk" spark={analytics.data?.daily.map((d) => d.streams)} />
        <Tile label="Booking aktif" value={bookings.data ? active.length : undefined} hint={`${inquiries} inquiry baru`} />
        <Tile label="Saldo wallet" prefix="Rp " value={wallet.data?.balances.total} hint="siap ditarik" />
      </div>

      <PendingSplits className="mt-6" />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Inbox booking terbaru" action={<Link to="/studio/bookings" className="text-sm font-bold text-b2b-muted hover:text-b2b-ink">Semua</Link>}>
          {bookings.isLoading ? (
            <p className="text-sm text-b2b-muted">Memuat…</p>
          ) : !bookings.data?.data.length ? (
            <p className="text-sm text-b2b-muted">Belum ada inquiry. Lengkapi EPK & rate card agar promotor menemukanmu.</p>
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
        <Card title="Rilis terbaru" action={<Link to="/studio/releases" className="text-sm font-bold text-b2b-muted hover:text-b2b-ink">Semua</Link>}>
          {!releases.data?.data.length ? (
            <p className="text-sm text-b2b-muted">Belum ada rilis.</p>
          ) : (
            <ul className="divide-y divide-b2b-line">
              {releases.data.data.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5">
                  {r.cover_url ? <img src={r.cover_url} alt="" className="size-10 rounded object-cover" /> : <div className="size-10 rounded bg-b2b-bg" />}
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
          <Card title="Top kota pendengar">
            <div className="flex flex-wrap gap-2">
              {analytics.data.top_cities.slice(0, 6).map((c) => (
                <Badge key={c.city}>
                  {c.city} · {fmt.compact(c.listeners)}
                </Badge>
              ))}
            </div>
            <p className="mt-3 text-xs text-b2b-muted">Data ini otomatis tampil di EPK dinamis sebagai bukti permintaan pasar.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
