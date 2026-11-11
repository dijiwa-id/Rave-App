import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import CountUp from '@/components/reactbits/CountUp';
import { api, fmt } from '@/lib/api';
import type { BookingSummary, EventSummary, Invoice } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { Button, Card, PageHeader } from '@/components/ui';
import { BookingStatusBadge, greeting, useCurrentPromotor } from '@/components/b2b/common';
import { useDict } from '@/lib/i18n';

export function KycBanner() {
  const user = useAuth((s) => s.user);
  const t = useDict('b2b').promotor.kycBanner;
  if (!user || user.kyc_status === 'VERIFIED') return null;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-none border border-amber-300 bg-amber-50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
        <ShieldAlert className="size-5" />
        {user.kyc_status === 'PENDING' ? t.pending : t.required}
      </p>
      {user.kyc_status !== 'PENDING' && (
        <Link to="/promotor/team">
          <Button variant="ink" size="sm">
            {t.verifyNow}
          </Button>
        </Link>
      )}
    </div>
  );
}

function Num({ label, value, prefix }: { label: string; value?: number; prefix?: string }) {
  return (
    <div className="b2b-surface b2b-accent-top min-w-0 rounded-none border border-b2b-line p-4 pt-5">
      <p className="rave-label truncate !text-[10.5px] text-b2b-muted">{label}</p>
      <p className="mt-2 truncate text-[clamp(1.4rem,2.6vw,1.85rem)] leading-none font-extrabold tracking-tight text-b2b-ink tabular-nums">
        {prefix}
        {value == null ? '—' : <CountUp to={value} separator="." duration={1.1} />}
      </p>
    </div>
  );
}

export default function PromotorDashboard() {
  const org = useCurrentPromotor()!;
  const bookings = useQuery({ queryKey: ['bookings', 'promotor', undefined, org.id, ''], queryFn: () => api<{ data: BookingSummary[] }>('/v1/booking/bookings', { query: { side: 'promotor', org_id: org.id } }) });
  const invoices = useQuery({ queryKey: ['invoices'], queryFn: () => api<{ data: Invoice[] }>('/v1/finance/invoices') });
  const events = useQuery({ queryKey: ['org-events', org.id], queryFn: () => api<{ data: (EventSummary & { sold: number; revenue: number })[] }>(`/v1/ticketing/orgs/${org.id}/events`) });
  const open = bookings.data?.data.filter((b) => ['INQUIRY', 'NEGOTIATING', 'AGREED', 'CONTRACT_SENT'].includes(b.status)).length;
  const confirmed = bookings.data?.data.filter((b) => ['BOOKED', 'BOOKED_AND_SECURED', 'SHOW_DAY'].includes(b.status)).length;
  const due = invoices.data?.data.filter((i) => i.status === 'PENDING') ?? [];
  const t = useDict('b2b').promotor.dashboard;
  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${org.name}`}
        subtitle={t.subtitle}
        actions={
          <Link to="/promotor/discover">
            <Button variant="ink">{t.findArtists}</Button>
          </Link>
        }
      />
      <KycBanner />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Num label={t.negotiating} value={bookings.data ? open : undefined} />
        <Num label={t.confirmed} value={bookings.data ? confirmed : undefined} />
        <Num label={t.invoicesDue} value={invoices.data ? due.length : undefined} />
        <Num label={t.ticketsSold} value={events.data ? events.data.data.reduce((a, e) => a + (e.sold ?? 0), 0) : undefined} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title={t.latestBookings} action={<Link to="/promotor/bookings" className="text-sm font-bold text-b2b-muted hover:text-b2b-ink">{t.all}</Link>}>
          {!bookings.data?.data.length ? (
            <p className="text-sm text-b2b-muted">{t.noInquiries}</p>
          ) : (
            <ul className="divide-y divide-b2b-line">
              {bookings.data.data.slice(0, 6).map((b) => (
                <li key={b.id}>
                  <Link to={`/promotor/bookings/${b.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{b.artist.name}</p>
                      <p className="text-xs text-b2b-muted">
                        {b.event_name} · {fmt.date(b.event_date)}
                      </p>
                    </div>
                    <BookingStatusBadge status={b.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t.dueInvoices} action={<Link to="/promotor/invoices" className="text-sm font-bold text-b2b-muted hover:text-b2b-ink">{t.pay}</Link>}>
          {!due.length ? (
            <p className="text-sm text-b2b-muted">{t.allPaid}</p>
          ) : (
            <ul className="divide-y divide-b2b-line">
              {due.slice(0, 6).map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span>
                    <span className="font-bold">{i.description}</span>
                    <span className="block text-xs text-b2b-muted">{t.dueAt(fmt.dateTime(i.due_at))}</span>
                  </span>
                  <span className="font-extrabold">{fmt.idr(i.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
