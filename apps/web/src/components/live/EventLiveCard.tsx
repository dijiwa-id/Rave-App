import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, PlayCircle, Radio } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { LiveStream } from '@/lib/types';
import { Countdown, isOnAir, LivePill, liveHref, useLiveSettings } from './common';

/** Kartu "Tonton live streaming" di halaman event (status-aware): live > terjadwal > sudah tayang. */
export function EventLiveCard({ eventId }: { eventId: string }) {
  const { enabled } = useLiveSettings();
  const q = useQuery({
    queryKey: ['live-streams', 'event', eventId],
    queryFn: async () => {
      const get = (status: string) => api<{ data: LiveStream[] }>('/v1/live/streams', { query: { status, event_id: eventId, limit: 1 }, auth: false }).then((r) => r.data[0] ?? null).catch(() => null);
      const [live, upcoming, ended] = await Promise.all([get('live'), get('upcoming'), get('ended')]);
      return live ?? upcoming ?? ended;
    },
    enabled,
    refetchInterval: 60_000,
  });
  const s = q.data;
  if (!enabled || !s) return null;
  const onAir = isOnAir(s.status);
  return (
    <Link to={liveHref(s)} className={`mb-4 block rounded-xl p-5 transition hover:brightness-110 ${onAir ? 'bg-gradient-to-br from-red-700 to-red-950' : 'bg-gema-elevated'}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-bold">
          <Radio className="size-4" /> Live streaming
        </p>
        {onAir && <LivePill viewers={s.viewers} interrupted={s.status === 'INTERRUPTED'} />}
      </div>
      <p className="mt-2 font-bold">{s.title}</p>
      {s.status === 'SCHEDULED' && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-gema-muted">
          <CalendarClock className="size-4" /> {s.scheduled_at ? fmt.dateTime(s.scheduled_at) : 'Jadwal menyusul'}
          {s.scheduled_at && <Countdown until={s.scheduled_at} className="text-gema-primary-text" />}
        </p>
      )}
      {s.status === 'ENDED' && <p className="mt-1 text-sm text-gema-muted">Siaran sudah selesai {s.ended_at ? `· ${fmt.dateTime(s.ended_at)}` : ''}</p>}
      {s.access === 'TICKET' && s.status !== 'ENDED' && <p className="mt-2 text-xs text-white/70">Akses untuk pemegang tiket event ini — tonton dari mana saja.</p>}
      {s.status !== 'ENDED' && (
        <span className="mt-3 inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-sm font-bold text-black">
          <PlayCircle className="size-4" /> {onAir ? 'Tonton live streaming' : 'Lihat halaman siaran'}
        </span>
      )}
    </Link>
  );
}
