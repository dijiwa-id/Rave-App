import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { BookingSummary } from '@/lib/types';
import { PageHeader } from '@/components/ui';
import { BookingDetail, BookingList } from '@/components/b2b/BookingDetail';
import { BookingStatusBadge, Empty, QueryState, Table, useCurrentArtist } from '@/components/b2b/common';
import { useDict } from '@/lib/i18n';

export function StudioBookings() {
  const artist = useCurrentArtist()!;
  const t = useDict('b2b').studio.bookings;
  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <BookingList side="artist" artistId={artist.artist_id!} basePath="/studio/bookings" />
    </div>
  );
}

export function StudioBookingPage() {
  const { id } = useParams();
  const t = useDict('b2b').studio.bookings;
  return (
    <div>
      <Link to="/studio/bookings" className="mb-4 inline-flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
        <ArrowLeft className="size-4" /> {t.back}
      </Link>
      <BookingDetail id={id!} />
    </div>
  );
}

const WITH_CONTRACT = ['CONTRACT_SENT', 'SIGNED', 'BOOKED', 'BOOKED_AND_SECURED', 'AT_RISK', 'SHOW_DAY', 'COMPLETED', 'SETTLED', 'DISPUTED', 'CANCELLED_BY_PROMOTOR', 'CANCELLED_BY_ARTIST', 'FORCE_MAJEURE'];

export function ContractsList({ side, artistId, orgId, basePath }: { side: 'artist' | 'promotor'; artistId?: string; orgId?: string; basePath: string }) {
  const q = useQuery({
    queryKey: ['bookings', side, artistId, orgId, 'contracts'],
    queryFn: () => api<{ data: BookingSummary[] }>('/v1/booking/bookings', { query: { side, artist_id: artistId, org_id: orgId } }),
    enabled: !!(artistId || orgId),
  });
  const rows = q.data?.data.filter((b) => WITH_CONTRACT.includes(b.status)) ?? [];
  const t = useDict('b2b').studio.contracts;
  return (
    <QueryState q={q} empty={q.data && !rows.length ? <Empty title={t.emptyTitle} body={t.emptyBody} /> : undefined}>
      <Table head={[t.head.event, side === 'artist' ? t.head.promotor : t.head.artist, t.head.date, t.head.value, t.head.status, '']}>
        {rows.map((b) => (
          <tr key={b.id}>
            <td className="px-4 py-3 font-bold">{b.event_name}</td>
            <td className="px-4 py-3">{side === 'artist' ? b.promotor_org.name : b.artist.name}</td>
            <td className="px-4 py-3">{fmt.date(b.event_date)}</td>
            <td className="px-4 py-3 tabular-nums">{fmt.idr(b.latest_fee)}</td>
            <td className="px-4 py-3">
              <BookingStatusBadge status={b.status} />
            </td>
            <td className="px-4 py-3 text-right">
              <Link to={`${basePath}/${b.id}`} className="text-sm font-bold underline">
                {t.open}
              </Link>
            </td>
          </tr>
        ))}
      </Table>
    </QueryState>
  );
}

export function StudioContracts() {
  const artist = useCurrentArtist()!;
  const t = useDict('b2b').studio.contracts;
  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <ContractsList side="artist" artistId={artist.artist_id!} basePath="/studio/bookings" />
    </div>
  );
}
