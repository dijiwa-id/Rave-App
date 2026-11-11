import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import halftone from '@/assets/brand/paper-halftone.webp';
import folded from '@/assets/brand/hero-poster-folded.webp';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CalendarDays, ExternalLink, MapPin } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { Artist, EventSummary, Paged } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { useShallow } from 'zustand/react/shallow';
import { trackToPlayable, usePlayer } from '@/stores/player';
import { colorFor, DarkError, MediaCard, PlayFab, Shelf, TrackTable } from '@/components/fan';
import { usePlayMedia } from '@/components/fan/usePlayMedia';
import { cx, PageLoader, toast } from '@/components/ui';
import { LivePill, liveHref, useLiveSettings, useLiveStreams } from '@/components/live/common';
import { useModule } from '@/components/ModuleGate';
import { localeTag, useDict } from '@/lib/i18n';

/** Tepi bawah sobek header band. */
const HEADER_TORN = 'polygon(0 0,100% 0,100% 94%,96% 97%,92% 93%,87% 98%,83% 94%,78% 99%,73% 95%,68% 98%,63% 93%,58% 97%,53% 94%,48% 99%,43% 95%,38% 98%,33% 93%,28% 97%,23% 94%,18% 99%,13% 95%,8% 98%,4% 94%,0 97%)';

/**
 * Header band seragam ala poster gig: foto artis dicetak fotokopi (hitam-putih kontras) + tinta duotone warna khas
 * band (deterministik dari ID) + lipatan poster + halftone + tepi bawah sobek; nama besar, stiker, cap kota, genre,
 * dan nomor katalog. Tanpa foto → poster tinta + piringan.
 */
function BandHeader({ a }: { a: Artist }) {
  const d = useDict('fan');
  const tint = colorFor(a.id);
  const img = a.cover_url ?? a.image_url;
  const cat = `RV-ART-${a.id.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()}`;
  return (
    <header className="relative isolate flex h-[46vh] min-h-[360px] items-end overflow-hidden" style={{ clipPath: HEADER_TORN, backgroundColor: tint }}>
      {img ? (
        <img src={img} alt="" className="absolute inset-0 -z-20 size-full object-cover grayscale contrast-[1.3] brightness-[1.05]" />
      ) : (
        <span className="rave-groove absolute top-1/2 right-[-8%] -z-20 aspect-square w-[60%] -translate-y-1/2 opacity-80" aria-hidden />
      )}
      <span className="absolute inset-0 -z-10 mix-blend-multiply" style={{ backgroundColor: tint }} aria-hidden />
      <span className="absolute inset-0 -z-10 bg-cover bg-center opacity-80 mix-blend-overlay" style={{ backgroundImage: `url(${folded})` }} aria-hidden />
      <span className="absolute inset-0 -z-10 bg-cover bg-center opacity-30 mix-blend-multiply" style={{ backgroundImage: `url(${halftone})` }} aria-hidden />
      <span className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(14,12,15,0.8),rgba(14,12,15,0.25)_60%,rgba(14,12,15,0.05)),linear-gradient(0deg,rgba(14,12,15,0.85),transparent_55%)]" aria-hidden />
      <span className="rave-catno absolute top-24 right-5 hidden text-rave-paper [writing-mode:vertical-rl] md:block">RAVE · {cat}</span>
      <div className="relative w-full px-4 pb-10 md:px-8">
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          {a.verified && (
            <span className="rave-sticker rave-label bg-rave-paper px-2.5 py-1 !text-[10px] text-rave-ink [--sticker-r:-3deg]">
              <BadgeCheck className="size-3.5" /> {d.artist.verified}
            </span>
          )}
          {a.city && (
            <span className="rave-stamp text-rave-paper [--stamp-r:2deg]">
              <MapPin className="size-3" /> {a.city}
            </span>
          )}
          {a.genres.slice(0, 3).map((g) => (
            <span key={g} className="border-2 border-rave-ink bg-rave-primary px-2 py-0.5 font-label text-[10px] font-bold tracking-[0.08em] text-rave-ink uppercase shadow-[2px_2px_0_#0b0a0c]">
              {g}
            </span>
          ))}
        </div>
        <h1 className="text-[clamp(52px,9vw,140px)] leading-[0.86] text-rave-paper drop-shadow-[4px_4px_0_#0b0a0c]">{a.name}</h1>
        <p className="mt-3 font-label text-[11px] font-bold tracking-[0.1em] text-rave-paper/80 uppercase">
          {d.artist.stats(fmt.num(a.monthly_listeners), fmt.num(a.followers))}
        </p>
      </div>
    </header>
  );
}

export default function ArtistPage() {
  const { idOrSlug = '', slug } = useParams();
  const key = slug ?? idOrSlug;
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const d = useDict('fan');
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
    if (!token) return toast.info(d.artist.signInToFollow);
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
      <BandHeader a={a} />
      <div className="flex flex-wrap items-center gap-6 px-4 py-6 md:px-8">
        {a.top_tracks.length > 0 && <PlayFab size="lg" playing={playingThis && playing} onClick={() => (playingThis ? toggle() : playQueue(a.top_tracks.map(trackToPlayable)))} />}
        <button onClick={toggleFollow} aria-pressed={following} className={cx('rounded-none border px-4 py-1.5 text-sm font-bold tracking-wide transition hover:scale-105', following ? 'border-white text-white' : 'border-rave-muted text-white hover:border-white')}>
          {following ? d.artist.following : d.artist.follow}
        </button>
        <Link to={`/promotor/artists/${a.id}`} className="inline-flex items-center gap-1.5 text-sm font-bold text-rave-muted hover:text-white">
          <ExternalLink className="size-4" /> {d.artist.epkBooking}
        </Link>
      </div>

      {live.data?.data[0] && (
        <Link to={liveHref(live.data.data[0])} className="mx-4 mb-8 flex items-center gap-4 rounded-none bg-gradient-to-r from-red-700 to-red-900 p-4 transition hover:brightness-110 md:mx-8">
          <LivePill viewers={live.data.data[0].viewers} interrupted={live.data.data[0].status === 'INTERRUPTED'} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold tracking-widest uppercase">{d.artist.liveNow(a.name)}</p>
            <p className="truncate font-bold">{live.data.data[0].title}</p>
          </div>
          <span className="shrink-0 rounded-none bg-white px-4 py-1.5 text-sm font-bold text-black">{d.artist.watch}</span>
        </Link>
      )}

      {near.length > 0 && (
        <section className="mx-4 mb-8 rounded-none bg-gradient-to-r from-rave-pink/80 to-rave-purple/80 p-5 md:mx-8">
          <p className="text-xs font-bold tracking-widest uppercase">{d.shared.nearYou}</p>
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
        <h2 className="mb-4 px-4 text-2xl font-bold md:px-8">{d.artist.popular}</h2>
        {a.top_tracks.length ? <TrackTable tracks={showAll ? a.top_tracks : a.top_tracks.slice(0, 5)} showAlbum={false} /> : <p className="px-8 text-rave-muted">{d.artist.noSongs}</p>}
        {a.top_tracks.length > 5 && (
          <button onClick={() => setShowAll(!showAll)} className="mt-3 px-8 text-sm font-bold text-rave-muted hover:text-white">
            {showAll ? d.artist.showLess : d.artist.showMore}
          </button>
        )}
      </section>

      <div className="px-4 md:px-8">
        <Shelf title={d.artist.discography}>
          {a.releases.map((r) => (
            <MediaCard key={r.id} title={r.title} subtitle={`${r.release_date?.slice(0, 4)} · ${r.type === 'SINGLE' ? d.album.types.SINGLE : r.type}`} image={r.cover_url} href={`/app/album/${r.id}`} onPlay={() => play({ id: r.id, kind: 'release' })} />
          ))}
        </Shelf>

        {ticketing && (
        <section className="mb-10">
          <h2 className="mb-4 text-2xl font-bold">{d.artist.gigs}</h2>
          {allEvents.length ? (
            <ul className="divide-y divide-white/10">
              {allEvents.map((e) => (
                <li key={e.id}>
                  <Link to={`/app/events/${e.slug}`} className="flex items-center gap-4 rounded-none px-2 py-3 hover:bg-white/5">
                    <div className="w-14 shrink-0 rounded-none bg-white/10 py-1.5 text-center">
                      <p className="text-xs font-bold text-rave-primary-text uppercase">{new Date(e.starts_at).toLocaleDateString(localeTag(), { month: 'short' })}</p>
                      <p className="text-xl font-black">{new Date(e.starts_at).getDate()}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{e.title}</p>
                      <p className="truncate text-sm text-rave-muted">
                        {e.venue_name}, {e.city}
                      </p>
                    </div>
                    <CalendarDays className="size-5 text-rave-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-rave-muted">{d.artist.noGigs}</p>
          )}
        </section>
        )}

        {a.bio && (
          <section className="mb-10 max-w-3xl">
            <h2 className="mb-4 text-2xl font-bold">{d.shared.about}</h2>
            <div className="relative overflow-hidden rounded-none">
              {a.image_url && <img src={a.image_url} alt="" className="h-64 w-full object-cover opacity-60" />}
              <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/90 to-transparent p-6">
                <p className="font-bold">{d.shared.followers(fmt.num(a.followers))}</p>
                <p className="mt-2 line-clamp-3 text-sm text-white/85">{a.bio}</p>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
