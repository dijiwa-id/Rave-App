import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { CalendarDays, MapPin, Ticket as TicketIcon } from 'lucide-react';
import TearTicket from '@/components/reactbits/TearTicket';
import { api, fmt } from '@/lib/api';
import type { Paged, Ticket } from '@/lib/types';
import { DarkError, FanPage } from '@/components/fan';
import { EmptyState, PageLoader, Spinner } from '@/components/ui';

/** QR berputar tiap 15 detik (anti-screenshot, REQ-TIX-02). */
function RotatingQr({ ticketId }: { ticketId: string }) {
  const q = useQuery({
    queryKey: ['ticket-qr', ticketId],
    queryFn: () => api<{ payload: string; expires_in: number }>(`/v1/ticketing/tickets/${ticketId}/qr`),
    refetchInterval: (query) => Math.max(2000, (query.state.data?.expires_in ?? 15) * 1000),
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <p className="text-xs text-red-500">QR gagal dimuat</p>;
  void tick;
  const left = Math.max(0, q.data.expires_in - Math.floor((Date.now() - q.dataUpdatedAt) / 1000));
  return (
    <div className="flex flex-col items-center gap-1">
      <QRCodeSVG value={q.data.payload} size={120} level="M" bgColor="#ffffff" fgColor="#000000" />
      <p className="text-[10px] font-semibold text-neutral-500 tabular-nums" aria-live="off">
        Berganti dalam {left}s
      </p>
    </div>
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
      <div className="flex flex-col gap-8">
        {upcoming.map((t) => (
          <TearTicket
            key={t.id}
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
                <p className="text-[11px] font-bold tracking-[0.14em] text-emerald-600 uppercase">{t.type_name}</p>
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
                <span className="text-gema-muted">{t.status === 'CHECKED_IN' ? `Check-in ${fmt.dateTime(t.checked_in_at)}` : 'Direfund'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </FanPage>
  );
}
