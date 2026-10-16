import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CalendarDays, ExternalLink, MapPin } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { Artist, EventSummary, Paged } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { useShallow } from 'zustand/react/shallow';
import { trackToPlayable, usePlayer } from '@/stores/player';
import { DarkError, MediaCard, PlayFab, Shelf, TrackTable } from '@/components/fan';
import { usePlayMedia } from '@/components/fan/usePlayMedia';
import { cx, PageLoader, toast } from '@/components/ui';
import { LivePill, liveHref, useLiveSettings, useLiveStreams } from '@/components/live/common';
import { useModule } from '@/components/ModuleGate';

export default function ArtistPage() {
  const { idOrSlug = '', slug } = useParams();
  const key = slug ?? idOrSlug;
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const { playQueue, current, playing, toggle } = usePlayer(useShallow((s) => ({ playQueue: s.playQueue, current: s.current, playing: s.playing, toggle: s.toggle })));
  const play = usePlayMedia();
  const [showAll, setShowAll] = useState(false);
  const q = useQuery({ queryKey: ['artist', key], queryFn: () => api<Artist>(`/v1/catalog/artists/${key}`) });
  const a = q.data;
  const follow = useQuery({ queryKey: ['follow', a?.id], queryFn: () => api<{ following: boolean }>(`/v1/library/follows/${a!.id}`), enabled: !!a && !!token });
  const liveOn = useLiveSettings().enabled;
  const live = useLiveStreams({ status: 'live', artist_id: a?.id, limit: 1 }, { enabled: liveOn && !!a });
  const ticketing = useModule('ticketing');
  const events = useQuery({ queryKey: ['events', 'artist', a?.id], queryFn: () => api<Paged<EventSummary>>('/v1/ticketing/events', { query: { artist_id: a!.id } }), enabled: !!a && ticketing });

  if (q.isLoading) return <PageLoader />;
  if (q.isError || !a) return <DarkError error={q.error} retry={() => q.refetch()} />;
  const following = !!follow.data?.following;
  const playingThis = !!current && a.top_tracks.some((t) => t.id === current.id);
  const allEvents = events.data?.data ?? [];
  const near = user?.city ? allEvents.filter((e) => e.city.toLowerCase() === user.city!.toLowerCase()) : [];

  async function toggleFollow() {
    if (!token) return toast.info('Masuk untuk mengikuti artis');
    qc.setQueryData(['follow', a!.id], { following: !following });
    try {
      await api(`/v1/library/follows/${a!.id}`, { method: following ? 'DELETE' : 'PUT' });
      qc.invalidateQueries({ queryKey: ['library-summary'] });
    } catch (e) {
      qc.setQueryData(['follow', a!.id], { following });
      toast.error(e);
    }
  }

  return (
    <div className="min-h-full pb-12">
      <header className="relative flex h-[40vh] min-h-[320px] items-end overflow-hidden">
        <img src={a.cover_url ?? a.image_url ?? ''} alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/30 to-[#121212]" />
        <div className="relative px-4 pb-6 md:px-8">
          {a.verified && (
            <p className="flex items-center gap-2 text-sm font-semibold">
              <BadgeCheck className="size-6 fill-[#3d91f4] text-white" /> Artis Terverifikasi
            </p>
          )}
          <h1 className="my-2 text-5xl font-black tracking-tighter md:text-8xl">{a.name}</h1>
          <p className="text-sm">
            {fmt.num(a.monthly_listeners)} pendengar bulanan
            {a.city && (
              <span className="ml-2 inline-flex items-center gap-1 text-white/80">
                <MapPin className="size-3.5" /> {a.city}
              </span>
            )}
          </p>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-6 px-4 py-6 md:px-8">
        {a.top_tracks.length > 0 && <PlayFab size="lg" playing={playingThis && playing} onClick={() => (playingThis ? toggle() : playQueue(a.top_tracks.map(trackToPlayable)))} />}
        <button onClick={toggleFollow} aria-pressed={following} className={cx('rounded-full border px-4 py-1.5 text-sm font-bold tracking-wide transition hover:scale-105', following ? 'border-white text-white' : 'border-gema-muted text-white hover:border-white')}>
          {following ? 'Mengikuti' : 'Ikuti'}
        </button>
        <Link to={`/promotor/artists/${a.id}`} className="inline-flex items-center gap-1.5 text-sm font-bold text-gema-muted hover:text-white">
          <ExternalLink className="size-4" /> EPK & booking
        </Link>
      </div>

      {live.data?.data[0] && (
        <Link to={liveHref(live.data.data[0])} className="mx-4 mb-8 flex items-center gap-4 rounded-xl bg-gradient-to-r from-red-700 to-red-900 p-4 transition hover:brightness-110 md:mx-8">
          <LivePill viewers={live.data.data[0].viewers} interrupted={live.data.data[0].status === 'INTERRUPTED'} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold tracking-widest uppercase">{a.name} LIVE sekarang</p>
            <p className="truncate font-bold">{live.data.data[0].title}</p>
          </div>
          <span className="shrink-0 rounded-full bg-white px-4 py-1.5 text-sm font-bold text-black">Tonton</span>
        </Link>
      )}

      {near.length > 0 && (
        <section className="mx-4 mb-8 rounded-xl bg-gradient-to-r from-gema-pink/80 to-gema-purple/80 p-5 md:mx-8">
          <p className="text-xs font-bold tracking-widest uppercase">Manggung dekatmu</p>
          {near.slice(0, 2).map((e) => (
            <Link key={e.id} to={`/app/events/${e.slug}`} className="mt-2 flex items-center justify-between gap-4 hover:underline">
              <span className="font-bold">
                {e.title} · {e.venue_name}, {e.city}
              </span>
              <span className="shrink-0 text-sm">{fmt.date(e.starts_at, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            </Link>
          ))}
        </section>
      )}

      <section className="mb-10">
        <h2 className="mb-4 px-4 text-2xl font-bold md:px-8">Populer</h2>
        {a.top_tracks.length ? <TrackTable tracks={showAll ? a.top_tracks : a.top_tracks.slice(0, 5)} showAlbum={false} /> : <p className="px-8 text-gema-muted">Belum ada lagu.</p>}
        {a.top_tracks.length > 5 && (
          <button onClick={() => setShowAll(!showAll)} className="mt-3 px-8 text-sm font-bold text-gema-muted hover:text-white">
            {showAll ? 'Tampilkan lebih sedikit' : 'Lihat selengkapnya'}
          </button>
        )}
      </section>

      <div className="px-4 md:px-8">
        <Shelf title="Diskografi">
          {a.releases.map((r) => (
            <MediaCard key={r.id} title={r.title} subtitle={`${r.release_date?.slice(0, 4)} · ${r.type === 'SINGLE' ? 'Single' : r.type}`} image={r.cover_url} href={`/app/album/${r.id}`} onPlay={() => play({ id: r.id, kind: 'release' })} />
          ))}
        </Shelf>

        {ticketing && (
        <section className="mb-10">
          <h2 className="mb-4 text-2xl font-bold">Jadwal manggung</h2>
          {allEvents.length ? (
            <ul className="divide-y divide-white/10">
              {allEvents.map((e) => (
                <li key={e.id}>
                  <Link to={`/app/events/${e.slug}`} className="flex items-center gap-4 rounded-md px-2 py-3 hover:bg-white/5">
                    <div className="w-14 shrink-0 rounded-md bg-white/10 py-1.5 text-center">
                      <p className="text-xs font-bold text-gema-primary-text uppercase">{new Date(e.starts_at).toLocaleDateString('id-ID', { month: 'short' })}</p>
                      <p className="text-xl font-black">{new Date(e.starts_at).getDate()}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{e.title}</p>
                      <p className="truncate text-sm text-gema-muted">
                        {e.venue_name}, {e.city}
                      </p>
                    </div>
                    <CalendarDays className="size-5 text-gema-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gema-muted">Belum ada jadwal manggung terdekat.</p>
          )}
        </section>
        )}

        {a.bio && (
          <section className="mb-10 max-w-3xl">
            <h2 className="mb-4 text-2xl font-bold">Tentang</h2>
            <div className="relative overflow-hidden rounded-lg">
              {a.image_url && <img src={a.image_url} alt="" className="h-64 w-full object-cover opacity-60" />}
              <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 to-transparent p-6">
                <p className="font-bold">{fmt.num(a.followers)} pengikut</p>
                <p className="mt-2 line-clamp-3 text-sm text-white/85">{a.bio}</p>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
