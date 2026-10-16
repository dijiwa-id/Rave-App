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

export function PromotorBookings() {
  const org = useCurrentPromotor()!;
  return (
    <div>
      <PageHeader title="Inquiry & Negosiasi" subtitle="Semua negosiasi tercatat dalam thread; persetujuan otomatis memicu draf kontrak." />
      <BookingList side="promotor" orgId={org.id} basePath="/promotor/bookings" />
    </div>
  );
}

export function PromotorBookingPage() {
  const { id } = useParams();
  return (
    <div>
      <Link to="/promotor/bookings" className="mb-4 inline-flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
        <ArrowLeft className="size-4" /> Inquiry
      </Link>
      <BookingDetail id={id!} />
    </div>
  );
}

export function PromotorContracts() {
  const org = useCurrentPromotor()!;
  return (
    <div>
      <PageHeader title="Kontrak" subtitle="E-contract tersertifikasi (PSrE) dengan e-meterai bila dipersyaratkan." />
      <ContractsList side="promotor" orgId={org.id} basePath="/promotor/bookings" />
    </div>
  );
}

export function PromotorInvoices() {
  const q = useQuery({ queryKey: ['invoices'], queryFn: () => api<{ data: Invoice[] }>('/v1/finance/invoices') });
  const pending = q.data?.data.filter((i) => i.status === 'PENDING') ?? [];
  const rest = q.data?.data.filter((i) => i.status !== 'PENDING') ?? [];
  return (
    <div>
      <PageHeader title="Pembayaran & Invoice" subtitle="DP saat kontrak ditandatangani, pelunasan sebelum H-7. Dana ditahan escrow dan dicairkan H+1 setelah acara selesai." />
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title="Belum ada invoice" body="Invoice DP terbit otomatis setelah kontrak ditandatangani semua pihak." /> : undefined}>
        <div className="space-y-8">
          {pending.length > 0 && (
            <section>
              <h2 className="mb-3 font-extrabold">Menunggu pembayaran</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {pending.map((i) => (
                  <PayInvoice key={i.id} invoice={i} />
                ))}
              </div>
            </section>
          )}
          {rest.length > 0 && (
            <section>
              <h2 className="mb-3 font-extrabold">Riwayat</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                {rest.map((i) => (
                  <PayInvoice key={i.id} invoice={i} />
                ))}
              </div>
            </section>
          )}
        </div>
      </QueryState>
      <p className="mt-6 text-xs text-b2b-muted">Invoice B2B & faktur pajak atas fee platform tersedia sesuai status PKP. Komisi & biaya payment tidak direfund kecuali kesalahan sistem GEMA.</p>
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
  return (
    <div>
      <PageHeader title="Rating" subtitle="Rating dua arah double-blind: dibuka setelah kedua pihak mengisi atau setelah 14 hari." />
      <QueryState q={q} empty={q.data && !done.length ? <Empty title="Belum ada acara selesai" /> : undefined}>
        <ul className="divide-y divide-b2b-line overflow-hidden rounded-xl border border-b2b-line bg-b2b-card">
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
  return (
    <div>
      <PageHeader title="Tim & KYC" subtitle="Badge “Terverifikasi” tampil di profil promotor setelah KYC/KYB lolos." />
      <div className="grid gap-6 lg:grid-cols-2">
        <TeamPanel orgId={org.id} myRole={org.role} />
        <KycForm compact orgId={org.id} />
      </div>
    </div>
  );
}
