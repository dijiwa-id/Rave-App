import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { api } from '@/lib/api';
import type { ArtistSummary, Paged, PlaylistSummary, ReleaseSummary, Show, Track } from '@/lib/types';
import { trackToPlayable, usePlayer } from '@/stores/player';
import { CardSkeleton, DarkError, FanPage, MediaCard } from '@/components/fan';
import { usePlayMedia } from '@/components/fan/usePlayMedia';
import { cx, EmptyState } from '@/components/ui';

interface Summary {
  liked_count: number;
  playlists: PlaylistSummary[];
  followed_artists: string[];
  saved_releases: string[];
  recent_track_ids: string[];
}

type Tab = 'playlists' | 'podcasts' | 'artists' | 'albums';
const TABS: [Tab, string][] = [
  ['playlists', 'Playlist'],
  ['podcasts', 'Podcast'],
  ['artists', 'Artis'],
  ['albums', 'Album'],
];

/** Kartu besar "Lagu yang Disukai" (mockup Spotify 8). */
function LikedCard({ count }: { count: number }) {
  const nav = useNavigate();
  const playQueue = usePlayer((s) => s.playQueue);
  const likes = useQuery({ queryKey: ['likes'], queryFn: () => api<Paged<Track>>('/v1/library/likes') });
  const preview = (likes.data?.data ?? []).slice(0, 6);
  return (
    <div
      onClick={() => nav('/app/liked')}
      className="group relative col-span-2 flex min-h-[280px] cursor-pointer flex-col justify-end gap-5 rounded-lg bg-gradient-to-br from-[#450af5] to-[#8e8ee5] p-5 transition"
    >
      <p className="line-clamp-3 text-base">
        {preview.length
          ? preview.map((t, i) => (
              <span key={t.id}>
                <span className="text-white">{t.artist.name}</span> <span className="text-white/70">{t.title}</span>
                {i < preview.length - 1 && <span className="mx-1.5">•</span>}
              </span>
            ))
          : 'Simpan lagu dengan ikon hati, dan semuanya muncul di sini.'}
      </p>
      <div>
        <h2 className="text-3xl font-bold">Lagu yang Disukai</h2>
        <p className="mt-1 text-sm">{count} lagu disukai</p>
      </div>
      {preview.length > 0 && (
        <button
          aria-label="Putar lagu yang disukai"
          onClick={(e) => {
            e.stopPropagation();
            playQueue((likes.data?.data ?? []).map(trackToPlayable));
          }}
          className="absolute right-5 bottom-5 grid size-14 translate-y-2 place-items-center rounded-full bg-gema-green text-black opacity-0 shadow-xl transition group-hover:translate-y-0 group-hover:opacity-100"
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
  if (!ids.length) return <EmptyState title="Belum mengikuti artis" body="Ikuti artis untuk dapat kabar rilis baru dan jadwal manggung." action={<Link to="/app/search" className="rounded-full bg-white px-6 py-2.5 text-sm font-bold text-black">Cari artis</Link>} />;
  return (
    <>
      {(q.data?.data ?? []).map((a) => (
        <MediaCard key={a.id} title={a.name} subtitle="Artis" image={a.image_url} href={`/app/artist/${a.slug}`} round onPlay={() => play({ id: a.id, kind: 'artist' })} />
      ))}
    </>
  );
}

function AlbumsTab({ ids }: { ids: string[] }) {
  const qs = useQueries({ queries: ids.slice(0, 30).map((id) => ({ queryKey: ['release', id], queryFn: () => api<ReleaseSummary>(`/v1/catalog/releases/${id}`) })) });
  const play = usePlayMedia();
  if (!ids.length) return <EmptyState title="Belum ada album tersimpan" body="Simpan album favoritmu agar mudah diputar lagi." />;
  return (
    <>
      {qs.map((q, i) =>
        q.data ? (
          <MediaCard key={ids[i]} title={q.data.title} subtitle={q.data.artist.name} image={q.data.cover_url} href={`/app/album/${q.data.id}`} onPlay={() => play({ id: q.data!.id, kind: 'release' })} />
        ) : (
          <CardSkeleton key={ids[i]} />
        ),
      )}
    </>
  );
}

function PodcastsTab() {
  const q = useQuery({ queryKey: ['shows', 'PODCAST'], queryFn: () => api<Paged<Show>>('/v1/catalog/shows') });
  return (
    <>
      <Link to="/app/podcasts" className="flex aspect-square flex-col justify-end rounded-lg bg-[#056952] p-5">
        <p className="text-2xl font-bold">Episode Kamu</p>
        <p className="text-sm text-white/80">Lanjutkan yang belum selesai</p>
      </Link>
      {(q.data?.data ?? []).slice(0, 9).map((s) => (
        <MediaCard key={s.id} title={s.title} subtitle={s.publisher} image={s.cover_url} href={`/app/show/${s.id}`} />
      ))}
    </>
  );
}

export default function Library() {
  const [tab, setTab] = useState<Tab>('playlists');
  const play = usePlayMedia();
  const q = useQuery({ queryKey: ['library-summary'], queryFn: () => api<Summary>('/v1/library/summary') });
  return (
    <FanPage>
      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Koleksi">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('rounded-md px-4 py-2 text-sm font-bold', tab === k ? 'bg-gema-highlight text-white' : 'text-white hover:bg-white/10')}>
            {l}
          </button>
        ))}
      </div>
      <h1 className="mb-4 text-2xl font-bold">{TABS.find((t) => t[0] === tab)![1]}</h1>
      {q.isError && <DarkError error={q.error} retry={() => q.refetch()} />}
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {tab === 'playlists' && (
          <>
            <LikedCard count={q.data?.liked_count ?? 0} />
            {q.isLoading && Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
            {q.data?.playlists.map((p) => (
              <MediaCard key={p.id} title={p.title} subtitle={p.description || `Oleh ${p.owner.name}`} image={p.cover_url} href={`/app/playlist/${p.id}`} onPlay={() => play({ id: p.id, kind: 'playlist' })} />
            ))}
          </>
        )}
        {tab === 'artists' && <ArtistsTab ids={q.data?.followed_artists ?? []} />}
        {tab === 'albums' && <AlbumsTab ids={q.data?.saved_releases ?? []} />}
        {tab === 'podcasts' && <PodcastsTab />}
      </div>
    </FanPage>
  );
}
