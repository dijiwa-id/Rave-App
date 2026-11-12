import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { api } from '@/lib/api';
import type { ArtistSummary, Paged, PlaylistSummary, ReleaseSummary, Show, Track } from '@/lib/types';
import { trackToPlayable, usePlayer } from '@/stores/player';
import { CardSkeleton, DarkError, FanPage, MediaCard } from '@/components/fan';
import { usePlayMedia } from '@/components/fan/usePlayMedia';
import { cx, EmptyState } from '@/components/ui';
import { useModule } from '@/components/ModuleGate';
import { useDict } from '@/lib/i18n';

interface Summary {
  liked_count: number;
  playlists: PlaylistSummary[];
  followed_artists: string[];
  saved_releases: string[];
  recent_track_ids: string[];
}

type Tab = 'playlists' | 'podcasts' | 'artists' | 'albums';
const TABS: Tab[] = ['playlists', 'podcasts', 'artists', 'albums'];

/** Kartu besar "Lagu yang Disukai" (mockup Spotify 8). */
function LikedCard({ count }: { count: number }) {
  const nav = useNavigate();
  const playQueue = usePlayer((s) => s.playQueue);
  const d = useDict('fan');
  const likes = useQuery({ queryKey: ['likes'], queryFn: () => api<Paged<Track>>('/v1/library/likes') });
  const preview = (likes.data?.data ?? []).slice(0, 6);
  return (
    <div
      onClick={() => nav('/app/liked')}
      className="group relative col-span-2 flex min-h-[280px] cursor-pointer flex-col justify-end gap-5 rounded-none bg-gradient-to-br from-[#5B2A6E] to-[#2A1233] p-5 transition"
    >
      <p className="line-clamp-3 text-base">
        {preview.length
          ? preview.map((t, i) => (
              <span key={t.id}>
                <span className="text-white">{t.artist.name}</span> <span className="text-white/70">{t.title}</span>
                {i < preview.length - 1 && <span className="mx-1.5">•</span>}
              </span>
            ))
          : d.library.likedEmpty}
      </p>
      <div>
        <h2 className="text-3xl font-bold">{d.library.likedSongs}</h2>
        <p className="mt-1 text-sm">{d.library.likedCount(count)}</p>
      </div>
      {preview.length > 0 && (
        <button
          aria-label={d.library.playLiked}
          onClick={(e) => {
            e.stopPropagation();
            playQueue((likes.data?.data ?? []).map(trackToPlayable));
          }}
          className="absolute right-5 bottom-5 grid size-14 translate-y-2 place-items-center rounded-full bg-rave-primary text-rave-on-primary opacity-0 shadow-xl transition group-hover:translate-y-0 group-hover:opacity-100"
        >
          <Play className="ml-0.5 size-6 fill-current" />
        </button>
      )}
    </div>
  );
}

function ArtistsTab({ ids }: { ids: string[] }) {
  const q = useQuery({
    queryKey: ['artists', 'ids', ids.join(',')],
    queryFn: () => api<Paged<ArtistSummary>>('/v1/catalog/artists', { query: { ids: ids.join(',') } }),
    enabled: ids.length > 0,
  });
  const play = usePlayMedia();
  const d = useDict('fan');
  if (!ids.length) return <EmptyState title={d.library.noArtists} body={d.library.noArtistsBody} action={<Link to="/app/search" className="rounded-none bg-white px-6 py-2.5 text-sm font-bold text-black">{d.library.findArtists}</Link>} />;
  return (
    <>
      {(q.data?.data ?? []).map((a) => (
        <MediaCard key={a.id} title={a.name} subtitle={d.shared.artist} image={a.image_url} href={`/app/artist/${a.slug}`} round onPlay={() => play({ id: a.id, kind: 'artist' })} />
      ))}
    </>
  );
}

function AlbumsTab({ ids }: { ids: string[] }) {
  // Satu request batch (sebelumnya satu request per album, dan album setelah urutan ke-30 tidak tampil).
  const list = ids.slice(0, 200);
  const q = useQuery({
    queryKey: ['releases-batch', list.join(',')],
    queryFn: () => api<{ data: ReleaseSummary[] }>('/v1/catalog/releases', { query: { ids: list.join(',') } }),
    enabled: list.length > 0,
  });
  const play = usePlayMedia();
  const d = useDict('fan');
  if (!ids.length) return <EmptyState title={d.library.noAlbums} body={d.library.noAlbumsBody} />;
  if (!q.data) return <>{list.slice(0, 12).map((id) => <CardSkeleton key={id} />)}</>;
  return (
    <>
      {q.data.data.map((r) => (
        <MediaCard key={r.id} title={r.title} subtitle={r.artist.name} image={r.cover_url} href={`/app/album/${r.id}`} onPlay={() => play({ id: r.id, kind: 'release' })} />
      ))}
    </>
  );
}

function PodcastsTab() {
  const q = useQuery({ queryKey: ['shows', 'PODCAST'], queryFn: () => api<Paged<Show>>('/v1/catalog/shows') });
  const d = useDict('fan');
  return (
    <>
      <Link to="/app/podcasts" className="flex aspect-square flex-col justify-end rounded-none bg-[#5B2A6E] p-5">
        <p className="text-2xl font-bold">{d.library.yourEpisodes}</p>
        <p className="text-sm text-white/80">{d.library.continueListening}</p>
      </Link>
      {(q.data?.data ?? []).slice(0, 9).map((s) => (
        <MediaCard key={s.id} title={s.title} subtitle={s.publisher} image={s.cover_url} href={`/app/show/${s.id}`} />
      ))}
    </>
  );
}

export default function Library() {
  const d = useDict('fan');
  const [tab, setTab] = useState<Tab>('playlists');
  const podcasts = useModule('podcasts');
  const tabs = TABS.filter((k) => k !== 'podcasts' || podcasts);
  useEffect(() => {
    if (!podcasts && tab === 'podcasts') setTab('playlists');
  }, [podcasts, tab]);
  const play = usePlayMedia();
  const q = useQuery({ queryKey: ['library-summary'], queryFn: () => api<Summary>('/v1/library/summary') });
  return (
    <FanPage>
      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label={d.library.tablistLabel}>
        {tabs.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('rounded-none px-4 py-2 text-sm font-bold', tab === k ? 'bg-rave-highlight text-white' : 'text-white hover:bg-white/10')}>
            {d.library.tabs[k]}
          </button>
        ))}
      </div>
      <h1 className="mb-4 text-2xl font-bold">{d.library.tabs[tab]}</h1>
      {q.isError && <DarkError error={q.error} retry={() => q.refetch()} />}
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {tab === 'playlists' && (
          <>
            <LikedCard count={q.data?.liked_count ?? 0} />
            {q.isLoading && Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
            {q.data?.playlists.map((p) => (
              <MediaCard key={p.id} title={p.title} subtitle={p.description || d.library.by(p.owner.name)} image={p.cover_url} href={`/app/playlist/${p.id}`} onPlay={() => play({ id: p.id, kind: 'playlist' })} />
            ))}
          </>
        )}
        {tab === 'artists' && <ArtistsTab ids={q.data?.followed_artists ?? []} />}
        {tab === 'albums' && <AlbumsTab ids={q.data?.saved_releases ?? []} />}
        {tab === 'podcasts' && podcasts && <PodcastsTab />}
      </div>
    </FanPage>
  );
}
