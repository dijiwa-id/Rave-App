import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Globe, Lock, LogIn, Radio, Ticket } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { LiveStreamDetail } from '@/lib/types';
import { DarkError } from '@/components/fan';
import { PageLoader } from '@/components/ui';
import { Countdown, endedReason, isOnAir, LivePill, liveImage, useLiveSettings } from '@/components/live/common';
import { LivePlayer } from '@/components/live/LivePlayer';
import { LiveChat } from '@/components/live/LiveChat';
import { useDict } from '@/lib/i18n';

/** Kartu pengganti pemutar (akses ditolak / belum mulai / selesai). */
function Gate({ s, children }: { s: LiveStreamDetail; children: React.ReactNode }) {
  const img = liveImage(s);
  return (
    <div className="relative grid aspect-video w-full place-items-center overflow-hidden rounded-none bg-black">
      {img && <img src={img} alt="" className="absolute inset-0 size-full scale-110 object-cover opacity-30 blur-xl" />}
      <div className="relative flex max-w-md flex-col items-center gap-3 p-6 text-center">{children}</div>
    </div>
  );
}

/** /app/live/:id — pemutar + info + chat (kanan di desktop, bawah di ponsel). */
export default function LiveWatch() {
  const { id = '' } = useParams();
  const loc = useLocation();
  const settings = useLiveSettings();
  const d = useDict('fan');
  // Kunci query sama dengan LivePlayer → satu polling 10 dtk untuk status & akses.
  const q = useQuery({ queryKey: ['live-stream', id], queryFn: () => api<LiveStreamDetail>(`/v1/live/streams/${id}`), refetchInterval: 10_000 });

  if (q.isLoading) return <PageLoader />;
  // Polling gagal sesaat tidak boleh membongkar pemutar yang masih berjalan: galat hanya bila belum ada data sama sekali.
  if (!q.data) return <DarkError error={q.error} retry={() => q.refetch()} />;
  const s = q.data;
  const next = encodeURIComponent(loc.pathname);
  const eventKey = s.event?.slug ?? s.event?.id;

  let stage: React.ReactNode;
  if (s.status === 'ENDED') {
    stage = (
      <Gate s={s}>
        <p className="text-xs font-bold tracking-widest text-white/60 uppercase">{d.liveWatch.ended}</p>
        <p className="text-xl font-black">{s.title}</p>
        <p className="text-sm text-white/70">
          {s.ended_at && `${fmt.dateTime(s.ended_at)} · `}
          {d.liveWatch.peakViewers(fmt.num(s.peak_viewers))}
        </p>
        {s.ended_reason && <p className="text-xs text-white/50">{endedReason(s.ended_reason)}</p>}
        <Link to="/app/live" className="mt-2 rounded-none bg-white px-5 py-2 text-sm font-bold text-black hover:scale-105">
          {d.liveWatch.seeOther}
        </Link>
      </Gate>
    );
  } else if (!s.can_watch && s.access_reason === 'login_required') {
    stage = (
      <Gate s={s}>
        <Lock className="size-8" />
        <p className="text-lg font-bold">{d.liveWatch.signInToWatch}</p>
        <p className="text-sm text-white/70">{d.liveWatch.requiresAccount}</p>
        <Link to={`/login?next=${next}`} className="inline-flex items-center gap-2 rounded-none bg-white px-6 py-2.5 text-sm font-bold text-black hover:scale-105">
          <LogIn className="size-4" /> {d.liveWatch.signIn}
        </Link>
      </Gate>
    );
  } else if (!s.can_watch && s.access_reason === 'ticket_required') {
    stage = (
      <Gate s={s}>
        <Ticket className="size-8" />
        <p className="text-lg font-bold">{d.liveWatch.ticketHolders}</p>
        <p className="text-sm text-white/70">{s.event ? d.liveWatch.partOfEvent(s.event.title) : d.liveWatch.requiresTicket}</p>
        {eventKey && (
          <Link to={`/app/events/${eventKey}`} className="inline-flex items-center gap-2 rounded-none bg-rave-primary px-6 py-2.5 text-sm font-bold text-rave-on-primary hover:scale-105">
            <Ticket className="size-4" /> {d.liveWatch.buyTicket}
          </Link>
        )}
      </Gate>
    );
  } else if (s.status === 'SCHEDULED') {
    // Halaman terus dipoll (10 dtk); begitu LIVE, pemutar muncul otomatis.
    stage = (
      <Gate s={s}>
        <CalendarClock className="size-8" />
        <p className="text-lg font-bold">{d.liveWatch.notStarted}</p>
        {s.scheduled_at ? (
          <>
            <p className="text-sm text-white/70">{d.liveWatch.scheduled(fmt.dateTime(s.scheduled_at))}</p>
            <Countdown until={s.scheduled_at} className="text-3xl text-white" />
          </>
        ) : (
          <p className="text-sm text-white/70">{d.liveWatch.startingSoon}</p>
        )}
        <p className="text-xs text-white/50">{d.liveWatch.autoPlay}</p>
      </Gate>
    );
  } else {
    stage = <LivePlayer streamId={s.id} />;
  }

  const showChat = settings.chat && s.chat_enabled && s.can_watch;

  return (
    <div className="min-h-full px-4 pt-20 pb-12 md:px-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {stage}
          <div className="mt-5">
            <div className="flex flex-wrap items-center gap-2">
              {isOnAir(s.status) && <LivePill viewers={s.viewers} interrupted={s.status === 'INTERRUPTED'} />}
              {s.access === 'TICKET' ? (
                <span className="inline-flex items-center gap-1 rounded-none bg-rave-pink/20 px-2 py-0.5 text-[11px] font-bold text-rave-pink uppercase">
                  <Ticket className="size-3" /> {d.liveWatch.ticketHolders}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-none bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white/80 uppercase">
                  <Globe className="size-3" /> {d.liveWatch.free}
                </span>
              )}
              {s.started_at && isOnAir(s.status) && <span className="text-xs text-rave-muted">{d.shared.started(fmt.dateTime(s.started_at))}</span>}
            </div>
            <h1 className="mt-3 text-2xl font-black tracking-tight md:text-3xl">{s.title}</h1>
            <p className="mt-1 text-sm text-rave-muted">
              {s.artist ? (
                <Link to={`/app/artist/${s.artist.slug}`} className="font-bold text-white hover:underline">
                  {s.artist.name}
                </Link>
              ) : null}
              {s.artist && ' · '}
              {s.org.name}
            </p>
            {s.event && (
              <Link to={`/app/events/${eventKey}`} className="mt-3 inline-flex items-center gap-2 rounded-none bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
                <Radio className="size-4 text-rave-pink" />
                <span>
                  <span className="font-bold">{s.event.title}</span> · {s.event.city}, {fmt.date(s.event.starts_at)}
                </span>
              </Link>
            )}
            {s.description && <p className="mt-4 max-w-3xl text-sm leading-relaxed whitespace-pre-line text-rave-muted">{s.description}</p>}
          </div>
        </div>
        {showChat && <LiveChat streamId={s.id} disabled={s.status === 'ENDED'} className="h-[480px] lg:sticky lg:top-20 lg:h-[calc(100vh-14rem)]" />}
      </div>
    </div>
  );
}
