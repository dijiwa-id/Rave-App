import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { BookingSummary, Invoice } from '@/lib/types';
import { PageHeader } from '@/components/ui';
import { BookingDetail, BookingList } from '@/components/b2b/BookingDetail';
import { BookingStatusBadge, Empty, QueryState, useCurrentPromotor } from '@/components/b2b/common';
import { PayInvoice } from '@/components/b2b/PayInvoice';
import { ContractsList } from '../studio/Bookings';
import { TeamPanel } from '../studio/Team';
import { KycForm } from '@/components/b2b/OrgOnboarding';
import { useDict } from '@/lib/i18n';

export function PromotorBookings() {
  const org = useCurrentPromotor()!;
  const t = useDict('b2b').promotor.bookings;
  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <BookingList side="promotor" orgId={org.id} basePath="/promotor/bookings" />
    </div>
  );
}

export function PromotorBookingPage() {
  const { id } = useParams();
  const t = useDict('b2b').promotor.bookings;
  return (
    <div>
      <Link to="/promotor/bookings" className="mb-4 inline-flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
        <ArrowLeft className="size-4" /> {t.back}
      </Link>
      <BookingDetail id={id!} />
    </div>
  );
}

export function PromotorContracts() {
  const org = useCurrentPromotor()!;
  const t = useDict('b2b').promotor.contracts;
  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <ContractsList side="promotor" orgId={org.id} basePath="/promotor/bookings" />
    </div>
  );
}

export function PromotorInvoices() {
  const q = useQuery({ queryKey: ['invoices'], queryFn: () => api<{ data: Invoice[] }>('/v1/finance/invoices') });
  const pending = q.data?.data.filter((i) => i.status === 'PENDING') ?? [];
  const rest = q.data?.data.filter((i) => i.status !== 'PENDING') ?? [];
  const t = useDict('b2b').promotor.invoices;
  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title={t.emptyTitle} body={t.emptyBody} /> : undefined}>
        <div className="space-y-8">
          {pending.length > 0 && (
            <section>
              <h2 className="mb-3 font-extrabold">{t.pending}</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {pending.map((i) => (
                  <PayInvoice key={i.id} invoice={i} />
                ))}
              </div>
            </section>
          )}
          {rest.length > 0 && (
            <section>
              <h2 className="mb-3 font-extrabold">{t.history}</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {rest.map((i) => (
                  <PayInvoice key={i.id} invoice={i} />
                ))}
              </div>
            </section>
          )}
        </div>
      </QueryState>
      <p className="mt-6 text-xs text-b2b-muted">{t.note}</p>
    </div>
  );
}

export function PromotorRatings() {
  const org = useCurrentPromotor()!;
  const q = useQuery({
    queryKey: ['bookings', 'promotor', undefined, org.id, 'ratings'],
    queryFn: () => api<{ data: BookingSummary[] }>('/v1/booking/bookings', { query: { side: 'promotor', org_id: org.id } }),
  });
  const done = q.data?.data.filter((b) => ['COMPLETED', 'SETTLED'].includes(b.status)) ?? [];
  const t = useDict('b2b').promotor.ratings;
  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <QueryState q={q} empty={q.data && !done.length ? <Empty title={t.emptyTitle} body={t.emptyBody} /> : undefined}>
        <ul className="divide-y divide-b2b-line overflow-hidden rounded-none border border-b2b-line bg-b2b-card">
          {done.map((b) => (
            <li key={b.id}>
              <Link to={`/promotor/bookings/${b.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-b2b-bg/60">
                <span>
                  <span className="font-bold">{b.artist.name}</span>
                  <span className="block text-xs text-b2b-muted">
                    {b.event_name} · {fmt.date(b.event_date)}
                  </span>
                </span>
                <BookingStatusBadge status={b.status} />
              </Link>
            </li>
          ))}
        </ul>
      </QueryState>
    </div>
  );
}

export function PromotorTeam() {
  const org = useCurrentPromotor()!;
  const t = useDict('b2b').promotor.team;
  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <div className="grid gap-6 lg:grid-cols-2">
        <TeamPanel orgId={org.id} myRole={org.role} />
        <KycForm compact orgId={org.id} />
      </div>
    </div>
  );
}
