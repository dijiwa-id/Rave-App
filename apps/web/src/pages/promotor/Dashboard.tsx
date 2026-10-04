import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import CountUp from '@/components/reactbits/CountUp';
import { api, fmt } from '@/lib/api';
import type { BookingSummary, EventSummary, Invoice } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { Button, Card, PageHeader } from '@/components/ui';
import { BookingStatusBadge, useCurrentPromotor } from '@/components/b2b/common';

export function KycBanner() {
  const user = useAuth((s) => s.user);
  if (!user || user.kyc_status === 'VERIFIED') return null;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
        <ShieldAlert className="size-5" />
        {user.kyc_status === 'PENDING' ? 'KYC sedang direview. Inquiry dapat dikirim setelah terverifikasi.' : 'Verifikasi identitas (KYC/KYB) wajib sebelum mengirim inquiry ke artis.'}
      </p>
      {user.kyc_status !== 'PENDING' && (
        <Link to="/promotor/team">
          <Button variant="ink" size="sm">
            Verifikasi sekarang
          </Button>
        </Link>
      )}
    </div>
  );
}

function Num({ label, value, prefix }: { label: string; value?: number; prefix?: string }) {
  return (
    <div className="rounded-xl border border-b2b-line bg-white p-4">
      <p className="text-xs font-semibold tracking-wide text-b2b-muted uppercase">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums">
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
  return (
    <div>
      <PageHeader
        title={org.name}
        subtitle="Temukan artis dengan basis pendengar nyata di kotamu — dana aman lewat rekening bersama."
        actions={
          <Link to="/promotor/discover">
            <Button variant="ink">Cari artis</Button>
          </Link>
        }
      />
      <KycBanner />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Num label="Negosiasi berjalan" value={bookings.data ? open : undefined} />
        <Num label="Booking terkonfirmasi" value={bookings.data ? confirmed : undefined} />
        <Num label="Tagihan menunggu" value={invoices.data ? due.length : undefined} />
        <Num label="Tiket terjual" value={events.data ? events.data.data.reduce((a, e) => a + (e.sold ?? 0), 0) : undefined} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Booking terbaru" action={<Link to="/promotor/bookings" className="text-sm font-bold text-b2b-muted hover:text-b2b-ink">Semua</Link>}>
          {!bookings.data?.data.length ? (
            <p className="text-sm text-b2b-muted">Belum ada inquiry. Mulai dari Cari Artis.</p>
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
        <Card title="Tagihan jatuh tempo" action={<Link to="/promotor/invoices" className="text-sm font-bold text-b2b-muted hover:text-b2b-ink">Bayar</Link>}>
          {!due.length ? (
            <p className="text-sm text-b2b-muted">Tidak ada tagihan tertunda.</p>
          ) : (
            <ul className="divide-y divide-b2b-line">
              {due.slice(0, 6).map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span>
                    <span className="font-bold">{i.description}</span>
                    <span className="block text-xs text-b2b-muted">jatuh tempo {fmt.dateTime(i.due_at)}</span>
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
