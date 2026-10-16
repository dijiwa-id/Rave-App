import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { CalendarDays, MapPin, RotateCcw, Ticket as TicketIcon } from 'lucide-react';
import TearTicket from '@/components/reactbits/TearTicket';
import { api, fmt } from '@/lib/api';
import type { Order, OrderRefund, Paged, RefundQuote, Ticket, TicketRefundReason } from '@/lib/types';
import { DarkError, FanPage } from '@/components/fan';
import { Button, EmptyState, Modal, PageLoader, Spinner, toast } from '@/components/ui';
import { setting, usePlatformConfig } from '@/lib/platform';

/** QR berputar tiap 15 detik (anti-screenshot, REQ-TIX-02). */
/** Hitung mundur tersendiri: tick 1 dtk hanya me-render teks ini, bukan QR. */
function QrCountdown({ expiresIn, updatedAt }: { expiresIn: number; updatedAt: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, expiresIn - Math.floor((Date.now() - updatedAt) / 1000));
  return (
    <p className="text-[10px] font-semibold text-neutral-500 tabular-nums" aria-live="off">
      Berganti dalam {left}s
    </p>
  );
}

function RotatingQr({ ticketId }: { ticketId: string }) {
  const q = useQuery({
    queryKey: ['ticket-qr', ticketId],
    queryFn: () => api<{ payload: string; expires_in: number }>(`/v1/ticketing/tickets/${ticketId}/qr`),
    refetchInterval: (query) => Math.max(2000, (query.state.data?.expires_in ?? 15) * 1000),
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
  const payload = q.data?.payload;
  // SVG QR hanya dibangun ulang saat payload berganti.
  const qr = useMemo(() => (payload ? <QRCodeSVG value={payload} size={120} level="M" bgColor="#ffffff" fgColor="#000000" /> : null), [payload]);
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <p className="text-xs text-red-500">QR gagal dimuat</p>;
  return (
    <div className="flex flex-col items-center gap-1">
      {qr}
      <QrCountdown expiresIn={q.data.expires_in} updatedAt={q.dataUpdatedAt} />
    </div>
  );
}

const REASON_LABEL: Record<TicketRefundReason, string> = {
  event_cancelled: 'Event dibatalkan',
  rescheduled: 'Jadwal berubah',
  buyer_request: 'Permintaan kamu',
  late_payment: 'Pembayaran terlambat',
  admin: 'Keputusan tim GEMA',
};

/** Ringkasan status refund untuk riwayat tiket. */
function refundLabel(r: OrderRefund) {
  const amount = r.amount !== null ? fmt.idr(r.amount) : '';
  if (r.status === 'COMPLETED') return `Direfund ${amount} · ${REASON_LABEL[r.reason]}`;
  if (r.status === 'PENDING') return `Refund diproses · ${REASON_LABEL[r.reason]}`;
  if (r.status === 'REVIEW') return 'Refund sedang ditinjau tim GEMA';
  return 'Refund tertunda — tim GEMA akan menghubungimu';
}

/** Pratinjau & pengajuan refund satu order (berlaku untuk semua tiket di order itu). */
function RefundDialog({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const qc = useQueryClient();
  const sla = setting<number>(usePlatformConfig(), 'refund.event_cancel_sla_days', 14);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['refund-quote', ticket.order_id], queryFn: () => api<RefundQuote>(`/v1/ticketing/orders/${ticket.order_id}/refund`), staleTime: 0 });
  async function submit() {
    setBusy(true);
    try {
      await api<Order>(`/v1/ticketing/orders/${ticket.order_id}/refund`, { method: 'POST' });
      toast.success('Refund diajukan. Tiket di order ini sudah tidak berlaku.');
      qc.invalidateQueries({ queryKey: ['tickets', 'mine'] });
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? 'Refund gagal diajukan');
    } finally {
      setBusy(false);
    }
  }
  const d = q.data;
  return (
    <Modal open onClose={onClose} title="Ajukan refund" theme="dark">
      {q.isLoading && <Spinner />}
      {q.isError && <p className="text-sm text-red-400">Gagal memuat ketentuan refund.</p>}
      {d && (
        <div className="space-y-4 text-sm">
          <p className="font-bold">{ticket.event.title}</p>
          <p className={d.eligible ? 'text-white/80' : 'text-white/60'}>{d.message}</p>
          {d.eligible && (
            <dl className="divide-y divide-white/10 rounded-xl border border-white/10">
              <div className="flex justify-between gap-4 px-4 py-3">
                <dt className="text-white/55">Dikembalikan</dt>
                <dd className="font-bold tabular-nums">
                  {fmt.idr(d.amount)} <span className="font-normal text-white/50">({d.pct}%)</span>
                </dd>
              </div>
              {d.deadline && (
                <div className="flex justify-between gap-4 px-4 py-3">
                  <dt className="text-white/55">Batas pengajuan</dt>
                  <dd>{fmt.dateTime(d.deadline)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-4 px-4 py-3">
                <dt className="text-white/55">Dana kembali ke</dt>
                <dd>Metode pembayaran asal, maks. {sla} hari</dd>
              </div>
            </dl>
          )}
          {d.eligible && <p className="text-xs text-white/50">Refund berlaku untuk semua tiket dalam order ini dan tidak dapat dibatalkan. QR akan langsung nonaktif.</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              {d.eligible ? 'Batal' : 'Tutup'}
            </Button>
            {d.eligible && (
              <Button variant="primary" loading={busy} onClick={submit}>
                Ajukan refund {fmt.idr(d.amount)}
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function useTicketWidth() {
  const [w, setW] = useState(() => Math.min(620, window.innerWidth - 40));
  useEffect(() => {
    const h = () => setW(Math.min(620, window.innerWidth - 40));
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return w;
}

export default function Tickets() {
  const width = useTicketWidth();
  const [refunding, setRefunding] = useState<Ticket | null>(null);
  const q = useQuery({ queryKey: ['tickets', 'mine'], queryFn: () => api<Paged<Ticket>>('/v1/ticketing/tickets/mine') });
  if (q.isLoading) return <PageLoader />;
  const tickets = q.data?.data ?? [];
  const upcoming = tickets.filter((t) => t.status === 'VALID');
  const past = tickets.filter((t) => t.status !== 'VALID');
  return (
    <FanPage>
      <h1 className="mb-2 text-4xl font-black tracking-tight">Tiket Saya</h1>
      <p className="mb-8 text-gema-muted">Tunjukkan QR di gerbang. Kode berganti tiap 15 detik — screenshot tidak berlaku.</p>
      {q.isError && <DarkError error={q.error} retry={() => q.refetch()} />}
      {!q.isError && !tickets.length && (
        <EmptyState icon={<TicketIcon className="size-12" />} title="Belum ada tiket" body="Temukan event dari artis favoritmu." action={<Link to="/app/events" className="rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black">Lihat event</Link>} />
      )}
      {!q.isError && tickets.length > 0 && !upcoming.length && (
        <p className="rounded-xl border border-white/10 px-5 py-4 text-sm text-gema-muted">
          Tidak ada tiket aktif.{' '}
          <Link to="/app/events" className="font-bold text-white hover:underline">
            Cari event berikutnya
          </Link>
        </p>
      )}
      <div className="flex flex-col gap-8">
        {upcoming.map((t) => (
          <div key={t.id} className="flex flex-col items-start gap-2">
          <TearTicket
            width={width}
            height={200}
            stubSize={width < 420 ? 150 : 170}
            background="#ffffff"
            color="#111111"
            stubBackground="#f4f4f4"
            disabled
            className="data-[disabled]:!opacity-100"
            ariaLabel={`Tiket ${t.event.title}`}
            stub={
              <div className="grid h-full place-items-center">
                <RotatingQr ticketId={t.id} />
              </div>
            }
          >
            <div className="flex h-full flex-col justify-between p-5 text-black">
              <div>
                <p className="text-[11px] font-bold tracking-[0.14em] text-gema-primary-text uppercase">{t.type_name}</p>
                <Link to={`/app/events/${t.event.slug}`} className="mt-1 line-clamp-2 text-xl leading-tight font-black hover:underline">
                  {t.event.title}
                </Link>
              </div>
              <div className="space-y-1 text-xs text-neutral-600">
                <p className="flex items-center gap-1.5">
                  <CalendarDays className="size-3.5" /> {fmt.dateTime(t.event.starts_at)}
                </p>
                <p className="flex items-center gap-1.5">
                  <MapPin className="size-3.5" /> {t.event.venue_name}, {t.event.city}
                </p>
                <p className="font-semibold text-black">{t.holder_name}</p>
              </div>
            </div>
          </TearTicket>
            <button onClick={() => setRefunding(t)} className="inline-flex items-center gap-1.5 text-xs font-bold text-gema-muted hover:text-white">
              <RotateCcw className="size-3.5" aria-hidden /> Tidak bisa hadir? Cek ketentuan refund
            </button>
          </div>
        ))}
      </div>
      {past.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-xl font-bold">Riwayat</h2>
          <ul className="divide-y divide-white/10">
            {past.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-3 text-sm">
                <span>
                  <strong>{t.event.title}</strong> · {t.type_name}
                </span>
                <span className="text-right text-gema-muted">
                  {t.status === 'CHECKED_IN' ? `Check-in ${fmt.dateTime(t.checked_in_at)}` : t.refund ? refundLabel(t.refund) : 'Direfund'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {refunding && <RefundDialog ticket={refunding} onClose={() => setRefunding(null)} />}
    </FanPage>
  );
}
