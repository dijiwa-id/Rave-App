import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Search } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { EventSummary, Paged } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { CardSkeleton, colorFor, DarkError, FanPage, glow } from '@/components/fan';
import { cx, EmptyState } from '@/components/ui';
import { localeTag, useDict } from '@/lib/i18n';

const CITIES = ['Semua', 'Jakarta', 'Bandung', 'Yogyakarta', 'Surabaya', 'Malang', 'Bali', 'Medan', 'Semarang'];

export function EventCard({ e }: { e: EventSummary }) {
  const d = useDict('fan');
  return (
    <Link to={`/app/events/${e.slug}`} className="media-card block">
      <div className="relative mb-4">
        {e.poster_url ? (
          <img src={e.poster_url} alt="" loading="lazy" decoding="async" className="aspect-square w-full rounded-none object-cover" />
        ) : (
          <div className="aspect-square w-full rounded-none" style={{ background: `linear-gradient(135deg, ${colorFor(e.id)}, ${colorFor(e.slug)})` }} />
        )}
        <div className="absolute top-2 left-2 rounded-none bg-black/80 px-2 py-1 text-center">
          <p className="text-[10px] font-bold text-rave-primary-text uppercase">{new Date(e.starts_at).toLocaleDateString(localeTag(), { month: 'short' })}</p>
          <p className="text-lg leading-none font-black">{new Date(e.starts_at).getDate()}</p>
        </div>
      </div>
      <p className="truncate font-bold">{e.title}</p>
      <p className="truncate text-sm text-rave-muted">{e.artists.map((a) => a.name).join(', ')}</p>
      <p className="mt-1 flex items-center gap-1 truncate text-sm text-rave-muted">
        <MapPin className="size-3" /> {e.venue_name}, {e.city}
      </p>
      {e.min_price != null && <p className="mt-2 text-sm font-bold">{d.shared.from(fmt.idr(e.min_price))}</p>}
    </Link>
  );
}

/** Jadwal event, tur, konser, launching album (REQ-EVT-01). */
export default function Events() {
  const user = useAuth((s) => s.user);
  const d = useDict('fan');
  const [city, setCity] = useState<string>(user?.city && CITIES.includes(user.city) ? user.city : 'Semua');
  const [q, setQ] = useState('');
  const query = useQuery({
    queryKey: ['events', 'list', city, q],
    queryFn: () => api<Paged<EventSummary>>('/v1/ticketing/events', { query: { city: city === 'Semua' ? undefined : city, q: q || undefined, limit: 60 } }),
    placeholderData: (p) => p,
  });
  const events = query.data?.data ?? [];
  return (
    <div className="min-h-full" style={{ background: glow('#8A2F3F', '55') }}>
      <FanPage>
        <h1 className="text-4xl font-black tracking-tight md:text-6xl">{d.events.title}</h1>
        <p className="mt-2 text-white/80">{d.events.subtitle}</p>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {CITIES.map((c) => (
            <button key={c} onClick={() => setCity(c)} aria-pressed={city === c} className={cx('rounded-none px-4 py-1.5 text-sm font-bold', city === c ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/20')}>
              {c === 'Semua' ? d.events.all : c}
            </button>
          ))}
          <label className="relative ml-auto w-full max-w-xs">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-rave-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={d.events.searchPlaceholder} aria-label={d.events.searchLabel} className="h-9 w-full rounded-none bg-white/10 pr-3 pl-9 text-sm focus:outline-none" />
          </label>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {query.isLoading && Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)}
          {events.map((e) => (
            <EventCard key={e.id} e={e} />
          ))}
        </div>
        {query.isError && <DarkError error={query.error} retry={() => query.refetch()} />}
        {!query.isLoading && !query.isError && !events.length && <EmptyState title={d.events.empty} body={city !== 'Semua' ? d.events.emptyCity(city) : d.events.emptyAll} />}
      </FanPage>
    </div>
  );
}
