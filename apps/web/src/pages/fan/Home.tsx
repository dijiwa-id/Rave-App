import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { GettingStarted, MiniShelf, PickTile } from '@/components/fan/GettingStarted';
import { useQuery } from '@tanstack/react-query';
import { Disc3, MapPin, MicVocal, Podcast, Radio, Sparkles, Ticket } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { EventSummary, MediaItem, Paged, PlaylistSummary, Track } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { trackToPlayable, usePlayer } from '@/stores/player';
import { useModule } from '@/components/ModuleGate';
import { useMediaPlaying, usePlayMedia } from '@/components/fan/usePlayMedia';
import { CardSkeleton, colorFor, DarkError, glow, greeting, MediaCard, ChoiceChips, MediaItemCard, PlayFab, Shelf } from '@/components/fan';
import { cx, Skeleton } from '@/components/ui';
import { LiveCard, useLiveSettings, useLiveStreams } from '@/components/live/common';
import { SponsorBanner } from '@/components/ads/SponsorBanner';
import { useLanding } from '@/lib/landing';
import { useDict } from '@/lib/i18n';

interface HomeFeed {
  quick_picks: MediaItem[];
  sections: { id: string; title: string; kind: string; items: MediaItem[] }[];
}

function QuickPickPlay({ item, label, onPlay }: { item: MediaItem; label: string; onPlay: () => void }) {
  const { active } = useMediaPlaying(`${item.kind}:${item.id}`);
  return (
    <PlayFab
      size="sm"
      playKey={`${item.kind}:${item.id}`}
      label={label}
      onClick={(e) => {
        e.stopPropagation();
        onPlay();
      }}
      className={cx('absolute right-4 transition', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
    />
  );
}

function QuickPick({ item, onPlay }: { item: MediaItem; onPlay: () => void }) {
  const nav = useNavigate();
  const d = useDict('fan');
  return (
    <div onClick={() => nav(item.href)} className="rave-card group relative flex h-20 cursor-pointer items-center gap-4 overflow-hidden pr-[4.25rem]">
      {item.image_url ? <img src={item.image_url} alt="" decoding="async" width={80} height={80} className="size-20 shrink-0 object-cover shadow-xl" /> : <div className="size-20 shrink-0" style={{ background: colorFor(item.id) }} />}
      <Link to={item.href} onClick={(e) => e.stopPropagation()} className="line-clamp-2 font-bold text-white">
        {item.title}
      </Link>
      <QuickPickPlay item={item} label={d.shared.play(item.title)} onPlay={onPlay} />
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
        <MediaCard key={t.id} title={t.title} subtitle={t.artist.name} image={t.release.cover_url} href={`/app/track/${t.id}`} playKey={`track:${t.id}`} onPlay={() => void playQueue(tracks.map(trackToPlayable), i)} />
      ))}
    </Shelf>
  );
}

type HomeTab = 'all' | 'music' | 'artists' | 'podcasts' | 'live' | 'events';
/** Bagian beranda yang tampil per chip. */
const SHOWS: Record<HomeTab, { quick: string[] | null; recent: boolean; sections: string[]; featured: boolean; live: boolean; events: boolean; sponsor: boolean }> = {
  all: { quick: null, recent: true, sections: ['releases', 'artists', 'shows', 'episodes', 'playlists'], featured: true, live: false, events: true, sponsor: true },
  music: { quick: ['release', 'artist', 'playlist'], recent: true, sections: ['releases', 'artists', 'playlists'], featured: true, live: false, events: false, sponsor: false },
  artists: { quick: ['artist'], recent: false, sections: ['artists'], featured: false, live: false, events: false, sponsor: false },
  podcasts: { quick: ['show', 'episode'], recent: false, sections: ['shows', 'episodes'], featured: false, live: false, events: false, sponsor: false },
  live: { quick: [], recent: false, sections: [], featured: false, live: true, events: false, sponsor: false },
  events: { quick: [], recent: false, sections: [], featured: false, live: false, events: true, sponsor: false },
};

export default function Home() {
  const d = useDict('fan');
  const [params, setParams] = useSearchParams();
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
  const anyLive = !!live.data?.data.length;
  const chips = [
    { value: 'all' as HomeTab, label: d.home.chips.all, icon: Sparkles },
    { value: 'music' as HomeTab, label: d.home.chips.music, icon: Disc3 },
    { value: 'artists' as HomeTab, label: d.home.chips.artists, icon: MicVocal },
    ...(podcasts ? [{ value: 'podcasts' as HomeTab, label: d.home.chips.podcasts, icon: Podcast }] : []),
    ...(liveOn ? [{ value: 'live' as HomeTab, label: d.home.chips.live, icon: Radio, dot: anyLive }] : []),
    ...(ticketing ? [{ value: 'events' as HomeTab, label: d.home.chips.events, icon: Ticket }] : []),
  ];
  const raw = params.get('tab') as HomeTab | null;
  const tab: HomeTab = raw && chips.some((c) => c.value === raw) ? raw : 'all';
  const show = SHOWS[tab];
  const showGs = tab === 'all' && !feed.isError;
  const featuredList = (featured.data?.data ?? []).slice(0, 8);
  const covers = [...(feed.data?.quick_picks ?? []).map((q) => q.image_url), ...featuredList.map((p) => p.cover_url)].filter(Boolean) as string[];
  const setTab = (t: HomeTab) => setParams(t === 'all' ? {} : { tab: t }, { replace: true });
  const quick = (feed.data?.quick_picks ?? []).filter((it) => !show.quick || show.quick.includes(it.kind));
  const sections = (feed.data?.sections ?? []).filter((x) => x.items.length && show.sections.includes(x.kind) && (podcasts || !['shows', 'episodes'].includes(x.kind)));
  const nothing =
    !feed.isLoading &&
    !quick.length &&
    !sections.length &&
    !(show.recent && token) &&
    !(show.featured && (featured.data?.data.length ?? 0) > 0) &&
    !(show.live && liveOn && anyLive) &&
    !(show.events && ticketing);

  return (
    <div className="min-h-full pb-12" style={{ background: glow(tint, '44') }}>
      <div className="px-4 pt-20 md:px-8">
        <p className="rave-label rave-eyebrow mb-3">{d.home.eyebrow}</p>
        <h1 className="mb-5 text-4xl leading-none md:text-6xl">{greeting()}</h1>
        <ChoiceChips value={tab} onChange={setTab} options={chips} label={d.home.chipsLabel} className="mb-7" />
        <div key={tab} className="animate-[rave-fade_.25s_ease-out]">
        {showGs && (
          <GettingStarted
            covers={covers}
            liveOn={liveOn}
            eventsOn={ticketing}
            aside={
              featuredList.length > 0 ? (
                <MiniShelf tiles title={user ? d.home.gs.madeFor(user.display_name.split(' ')[0]) : d.home.gs.madeForGuest}>
                  {featuredList.map((p) => (
                    <PickTile key={p.id} title={p.title} subtitle={p.description ?? d.shared.songs(p.track_count)} image={p.cover_url} href={`/app/playlist/${p.id}`} playKey={`playlist:${p.id}`} label={d.shared.play(p.title)} onPlay={() => play({ id: p.id, kind: 'playlist' })} />
                  ))}
                </MiniShelf>
              ) : undefined
            }
          />
        )}
        {nothing && <p className="mb-12 border-l-2 border-rave-primary bg-white/[0.04] px-4 py-3 text-sm text-rave-muted">{d.home.filterEmpty}</p>}
        {show.live && liveOn && anyLive && (
          <div className="mb-12">
            <MiniShelf title={d.shared.liveNow} href="/app/live">
              {live.data!.data.map((s) => (
                <div key={s.id} className="live-slide">
                  <LiveCard s={s} />
                </div>
              ))}
            </MiniShelf>
          </div>
        )}
        {feed.isError ? (
          <DarkError error={feed.error} retry={() => feed.refetch()} />
        ) : (
          (feed.isLoading || quick.length > 0) && (
            <div className="@container mb-12">
            <div className="rave-tilt grid grid-cols-1 gap-5 @[520px]:grid-cols-2 @[980px]:grid-cols-3">
              {feed.isLoading
                ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)
                : quick.slice(0, 6).map((it) => <QuickPick key={it.id} item={it} onPlay={() => play(it)} />)}
            </div>
            </div>
          )
        )}

        {feed.isLoading && show.sections.length > 0 && (
          <Shelf title={d.home.loading} loading>
            {null}
          </Shelf>
        )}
        {token && show.recent && <RecentlyPlayed />}
        {sections.map((s) => (
          <Shelf key={s.id} title={s.title}>
            {s.items.slice(0, 10).map((it) => (
              <MediaItemCard key={it.id} item={it} onPlay={['release', 'artist', 'playlist'].includes(it.kind) ? () => play(it) : undefined} />
            ))}
          </Shelf>
        ))}

        {show.featured && !(showGs && featuredList.length > 0) && (
        <Shelf title={d.home.featuredPlaylists} loading={featured.isLoading}>
          {(featured.data?.data ?? []).slice(0, 6).map((p) => (
            <MediaCard key={p.id} title={p.title} subtitle={p.description ?? d.shared.songs(p.track_count)} image={p.cover_url} href={`/app/playlist/${p.id}`} playKey={`playlist:${p.id}`} onPlay={() => play({ id: p.id, kind: 'playlist' })} />
          ))}
        </Shelf>
        )}

        {/* Slot sponsor display — hanya pengguna masuk non-Premium (anonim & Premium tidak melihat iklan);
            SponsorBanner sendiri menghormati `ads.enabled` dan tidak tampil tanpa kreatif dari Super Admin. */}
        {show.sponsor && user && !user.premium && sponsorOn && <SponsorBanner className="mb-10" />}

        {show.events && ticketing && (
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
    </div>
  );
}
