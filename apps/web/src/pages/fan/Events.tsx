import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Search } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { EventSummary, Paged } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { CardSkeleton, DarkError, FanPage } from '@/components/fan';
import { cx, EmptyState } from '@/components/ui';

const CITIES = ['Semua', 'Jakarta', 'Bandung', 'Yogyakarta', 'Surabaya', 'Malang', 'Bali', 'Medan', 'Semarang'];

export function EventCard({ e }: { e: EventSummary }) {
  return (
    <Link to={`/app/events/${e.slug}`} className="media-card block">
      <div className="relative mb-4">
        <img src={e.poster_url ?? `https://picsum.photos/seed/gema-ev-${e.id}/500/500`} alt="" loading="lazy" className="aspect-square w-full rounded-md object-cover" />
        <div className="absolute top-2 left-2 rounded-md bg-black/80 px-2 py-1 text-center">
          <p className="text-[10px] font-bold text-gema-green uppercase">{new Date(e.starts_at).toLocaleDateString('id-ID', { month: 'short' })}</p>
          <p className="text-lg leading-none font-black">{new Date(e.starts_at).getDate()}</p>
        </div>
      </div>
      <p className="truncate font-bold">{e.title}</p>
      <p className="truncate text-sm text-gema-muted">{e.artists.map((a) => a.name).join(', ')}</p>
      <p className="mt-1 flex items-center gap-1 truncate text-sm text-gema-muted">
        <MapPin className="size-3" /> {e.venue_name}, {e.city}
      </p>
      {e.min_price != null && <p className="mt-2 text-sm font-bold">Mulai {fmt.idr(e.min_price)}</p>}
    </Link>
  );
}

/** Jadwal event, tur, konser, launching album (REQ-EVT-01). */
export default function Events() {
  const user = useAuth((s) => s.user);
  const [city, setCity] = useState<string>(user?.city && CITIES.includes(user.city) ? user.city : 'Semua');
  const [q, setQ] = useState('');
  const query = useQuery({
    queryKey: ['events', 'list', city, q],
    queryFn: () => api<Paged<EventSummary>>('/v1/ticketing/events', { query: { city: city === 'Semua' ? undefined : city, q: q || undefined, limit: 60 } }),
    placeholderData: (p) => p,
  });
  const events = query.data?.data ?? [];
  return (
    <div className="min-h-full bg-gradient-to-b from-[#e8115b]/40 to-transparent to-50%">
      <FanPage>
        <h1 className="text-4xl font-black tracking-tight md:text-6xl">Event & Tiket</h1>
        <p className="mt-2 text-white/80">Konser, tur, launching album, dan gig kampus dari artis indie favoritmu.</p>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {CITIES.map((c) => (
            <button key={c} onClick={() => setCity(c)} aria-pressed={city === c} className={cx('rounded-full px-4 py-1.5 text-sm font-bold', city === c ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/20')}>
              {c}
            </button>
          ))}
          <label className="relative ml-auto w-full max-w-xs">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-gema-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari event atau artis" aria-label="Cari event" className="h-9 w-full rounded-full bg-white/10 pr-3 pl-9 text-sm focus:outline-none" />
          </label>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {query.isLoading && Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)}
          {events.map((e) => (
            <EventCard key={e.id} e={e} />
          ))}
        </div>
        {query.isError && <DarkError error={query.error} retry={() => query.refetch()} />}
        {!query.isLoading && !query.isError && !events.length && <EmptyState title="Belum ada event" body={city !== 'Semua' ? `Belum ada event di ${city}. Coba kota lain.` : 'Nantikan pengumuman berikutnya.'} />}
      </FanPage>
    </div>
  );
}
