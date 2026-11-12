import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Play } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { EventSummary, MediaItem, Paged, PlaylistSummary, Track } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { trackToPlayable, usePlayer } from '@/stores/player';
import { useModule } from '@/components/ModuleGate';
import { usePlayMedia } from '@/components/fan/usePlayMedia';
import { CardSkeleton, colorFor, DarkError, glow, greeting, MediaCard, MediaItemCard, Shelf } from '@/components/fan';
import { Skeleton } from '@/components/ui';
import { LiveCard, useLiveSettings, useLiveStreams } from '@/components/live/common';
import { SponsorBanner } from '@/components/ads/SponsorBanner';
import { useLanding } from '@/lib/landing';
import { useDict } from '@/lib/i18n';

interface HomeFeed {
  quick_picks: MediaItem[];
  sections: { id: string; title: string; kind: string; items: MediaItem[] }[];
}

function QuickPick({ item, onPlay }: { item: MediaItem; onPlay: () => void }) {
  const nav = useNavigate();
  const d = useDict('fan');
  return (
    <div onClick={() => nav(item.href)} className="rave-card group relative flex h-20 cursor-pointer items-center gap-4 overflow-hidden pr-16">
      {item.image_url ? <img src={item.image_url} alt="" decoding="async" width={80} height={80} className="size-20 shrink-0 object-cover shadow-xl" /> : <div className="size-20 shrink-0" style={{ background: colorFor(item.id) }} />}
      <Link to={item.href} onClick={(e) => e.stopPropagation()} className="line-clamp-2 font-bold text-white">
        {item.title}
      </Link>
      <button
        aria-label={d.shared.play(item.title)}
        onClick={(e) => {
          e.stopPropagation();
          onPlay();
        }}
        className="absolute right-4 grid size-12 place-items-center rounded-full bg-rave-primary text-rave-on-primary opacity-0 shadow-xl transition group-hover:opacity-100 focus:opacity-100"
      >
        <Play className="ml-0.5 size-5 fill-current" />
      </button>
    </div>
  );
}

/** Lagu yang baru diputar (unik, terbaru dulu) dari `GET /v1/library/history`. */
function RecentlyPlayed() {
  const playQueue = usePlayer((s) => s.playQueue);
  const d = useDict('fan');
  const q = useQuery({ queryKey: ['history'], queryFn: () => api<{ data: (Track & { played_at: string })[] }>('/v1/library/history'), staleTime: 30_000 });
  const seen = new Set<string>();
  const tracks = (q.data?.data ?? []).filter((t) => t.title && !seen.has(t.id) && seen.add(t.id)).slice(0, 6);
  if (!q.isLoading && !tracks.length) return null;
  return (
    <Shelf title={d.home.recentlyPlayed} loading={q.isLoading}>
      {tracks.map((t, i) => (
        <MediaCard key={t.id} title={t.title} subtitle={t.artist.name} image={t.release.cover_url} href={`/app/track/${t.id}`} onPlay={() => void playQueue(tracks.map(trackToPlayable), i)} />
      ))}
    </Shelf>
  );
}

export default function Home() {
  const d = useDict('fan');
  const user = useAuth((s) => s.user);
  const sponsorOn = useLanding().sections.sponsor;
  const token = useAuth((s) => s.accessToken);
  const play = usePlayMedia();
  const city = user?.city ?? undefined;
  const podcasts = useModule('podcasts');
  const ticketing = useModule('ticketing');
  const feed = useQuery({ queryKey: ['home', city], queryFn: () => api<HomeFeed>('/v1/catalog/home', { query: { city } }) });
  const featured = useQuery({ queryKey: ['featured-playlists'], queryFn: () => api<Paged<PlaylistSummary>>('/v1/library/playlists/featured') });
  const events = useQuery({ queryKey: ['events', 'near', city], queryFn: () => api<Paged<EventSummary>>('/v1/ticketing/events', { query: { city, limit: 10 } }), enabled: ticketing });
  const liveOn = useLiveSettings().enabled;
  const live = useLiveStreams({ status: 'live', limit: 8 }, { enabled: liveOn, refetchInterval: 60_000 });
  const tint = colorFor(feed.data?.quick_picks[0]?.id ?? 'home');

  return (
    <div className="min-h-full pb-12" style={{ background: glow(tint, '44') }}>
      <div className="px-4 pt-20 md:px-8">
        <p className="rave-label rave-eyebrow mb-3">{d.home.eyebrow}</p>
        <h1 className="mb-7 text-4xl leading-none md:text-6xl">{greeting()}</h1>
        {liveOn && !!live.data?.data.length && (
          <section className="mb-10">
            <div className="mb-4 flex items-end justify-between">
              <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                <span className="size-2.5 animate-pulse rounded-full bg-red-500" /> {d.shared.liveNow}
              </h2>
              <Link to="/app/live" className="text-sm font-bold text-rave-muted hover:underline">
                {d.shared.seeAll}
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {live.data.data.slice(0, 4).map((s) => (
                <LiveCard key={s.id} s={s} />
              ))}
            </div>
          </section>
        )}
        {feed.isError ? (
          <DarkError error={feed.error} retry={() => feed.refetch()} />
        ) : (
          <div className="rave-tilt mb-12 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {feed.isLoading
              ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)
              : feed.data!.quick_picks.slice(0, 6).map((it) => <QuickPick key={it.id} item={it} onPlay={() => play(it)} />)}
          </div>
        )}

        {feed.isLoading && (
          <Shelf title={d.home.loading} loading>
            {null}
          </Shelf>
        )}
        {token && <RecentlyPlayed />}
        {feed.data?.sections.map((s) =>
          s.items.length && (podcasts || !['shows', 'episodes'].includes(s.kind)) ? (
            <Shelf key={s.id} title={s.title}>
              {s.items.slice(0, 6).map((it) => (
                <MediaItemCard key={it.id} item={it} onPlay={['release', 'artist', 'playlist'].includes(it.kind) ? () => play(it) : undefined} />
              ))}
            </Shelf>
          ) : null,
        )}

        <Shelf title={d.home.featuredPlaylists} loading={featured.isLoading}>
          {(featured.data?.data ?? []).slice(0, 6).map((p) => (
            <MediaCard key={p.id} title={p.title} subtitle={p.description ?? d.shared.songs(p.track_count)} image={p.cover_url} href={`/app/playlist/${p.id}`} onPlay={() => play({ id: p.id, kind: 'playlist' })} />
          ))}
        </Shelf>

        {/* Slot sponsor display — hanya pengguna masuk non-Premium (anonim & Premium tidak melihat iklan);
            SponsorBanner sendiri menghormati `ads.enabled` dan tidak tampil tanpa kreatif dari Super Admin. */}
        {user && !user.premium && sponsorOn && <SponsorBanner className="mb-10" />}

        {ticketing && (
        <section className="mb-10">
          <div className="mb-4 flex items-end justify-between">
            <h2 className="text-2xl font-bold tracking-tight">{city ? d.home.nearYouCity(city) : d.home.upcomingEvents}</h2>
            <Link to="/app/events" className="text-sm font-bold text-rave-muted hover:underline">
              {d.shared.seeAll}
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {events.isLoading && Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
            {!events.isLoading && !events.data?.data.length && <p className="col-span-full text-sm text-rave-muted">{d.home.noEventsInCity}</p>}
            {(events.data?.data ?? []).slice(0, 5).map((e) => (
              <Link key={e.id} to={`/app/events/${e.slug}`} className="media-card block">
                {e.poster_url ? (
                  <img src={e.poster_url} alt="" className="mb-4 aspect-square w-full rounded-none object-cover" loading="lazy" decoding="async" />
                ) : (
                  <div className="mb-4 aspect-square w-full rounded-none" style={{ background: `linear-gradient(135deg, ${colorFor(e.id)}, ${colorFor(e.slug)})` }} />
                )}
                <p className="text-xs font-bold text-rave-primary-text uppercase">{fmt.date(e.starts_at, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                <p className="truncate font-bold">{e.title}</p>
                <p className="flex items-center gap-1 truncate text-sm text-rave-muted">
                  <MapPin className="size-3" />
                  {e.city}
                </p>
              </Link>
            ))}
          </div>
        </section>
        )}
      </div>
    </div>
  );
}
