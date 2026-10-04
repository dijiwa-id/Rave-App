import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { api } from '@/lib/api';
import type { ArtistSummary, Category, Episode, Paged, ReleaseSummary, Show, Track } from '@/lib/types';
import { trackToPlayable, usePlayer } from '@/stores/player';
import { DarkError, FanPage, MediaCard, Shelf, TrackTable } from '@/components/fan';
import { EmptyState, Skeleton } from '@/components/ui';
import { usePlayMedia } from '@/components/fan/usePlayMedia';

interface SearchResult {
  artists: ArtistSummary[];
  tracks: Track[];
  releases: ReleaseSummary[];
  shows: Show[];
  episodes: Episode[];
}

/** Tile kategori berwarna (mockup Spotify 2). */
function CategoryTile({ c }: { c: Category }) {
  return (
    <Link to={c.href} className="relative block aspect-square overflow-hidden rounded-lg p-4 transition hover:scale-[1.02]" style={{ background: c.color }}>
      <span className="text-2xl font-bold break-words text-white">{c.name}</span>
      {c.image_url && <img src={c.image_url} alt="" className="absolute -right-4 -bottom-2 size-[45%] rotate-[25deg] rounded shadow-[0_2px_4px_rgba(0,0,0,0.2)]" loading="lazy" />}
    </Link>
  );
}

function Browse() {
  const q = useQuery({ queryKey: ['browse'], queryFn: () => api<Paged<Category>>('/v1/catalog/browse') });
  return (
    <FanPage>
      <h1 className="mb-6 text-2xl font-bold">Jelajahi semua</h1>
      {q.isError && <DarkError error={q.error} retry={() => q.refetch()} />}
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {q.isLoading && Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="aspect-square" />)}
        {q.data?.data.map((c) => <CategoryTile key={c.id} c={c} />)}
      </div>
    </FanPage>
  );
}

function TopResult({ r }: { r: SearchResult }) {
  const nav = useNavigate();
  const play = usePlayMedia();
  const playQueue = usePlayer((s) => s.playQueue);
  const a = r.artists[0];
  const t = r.tracks[0];
  if (!a && !t) return null;
  const isArtist = !!a;
  const href = isArtist ? `/app/artist/${a.slug}` : `/app/track/${t.id}`;
  return (
    <div onClick={() => nav(href)} className="group relative cursor-pointer rounded-lg bg-gema-elevated p-5 transition hover:bg-gema-highlight">
      <img src={(isArtist ? a.image_url : t.release.cover_url) ?? ''} alt="" className={`mb-5 size-24 object-cover shadow-xl ${isArtist ? 'rounded-full' : 'rounded'}`} />
      <p className="truncate text-3xl font-bold">{isArtist ? a.name : t.title}</p>
      <p className="mt-1 text-sm text-gema-muted">
        {isArtist ? 'Artis' : t.artist.name} <span className="ml-2 rounded-full bg-black/40 px-3 py-1 text-xs font-bold text-white">{isArtist ? 'Artis' : 'Lagu'}</span>
      </p>
      <button
        aria-label="Putar hasil teratas"
        onClick={(e) => {
          e.stopPropagation();
          isArtist ? play({ id: a.id, kind: 'artist' }) : playQueue([trackToPlayable(t)]);
        }}
        className="absolute right-5 bottom-5 grid size-12 translate-y-2 place-items-center rounded-full bg-gema-green text-black opacity-0 shadow-xl transition group-hover:translate-y-0 group-hover:opacity-100"
      >
        <Play className="ml-0.5 size-5 fill-current" />
      </button>
    </div>
  );
}

function Results({ q }: { q: string }) {
  const res = useQuery({ queryKey: ['search', q], queryFn: () => api<SearchResult>('/v1/catalog/search', { query: { q } }), placeholderData: (p) => p });
  const play = usePlayMedia();
  if (res.isError) return <DarkError error={res.error} retry={() => res.refetch()} />;
  const r = res.data;
  if (res.isLoading || !r)
    return (
      <FanPage>
        <Shelf title="Mencari…" loading>
          {null}
        </Shelf>
      </FanPage>
    );
  const empty = !r.artists.length && !r.tracks.length && !r.releases.length && !r.shows.length && !r.episodes.length;
  if (empty) return <EmptyState title={`Tidak ada hasil untuk "${q}"`} body="Periksa ejaan, atau coba kata kunci lain — nama artis, judul lagu, atau potongan lirik." />;
  return (
    <div className="pt-20 pb-12">
      <div className="grid gap-6 px-4 md:px-8 lg:grid-cols-[2fr_3fr]">
        <section>
          <h2 className="mb-4 text-2xl font-bold">Hasil teratas</h2>
          <TopResult r={r} />
        </section>
        {r.tracks.length > 0 && (
          <section className="min-w-0">
            <h2 className="mb-4 text-2xl font-bold">Lagu</h2>
            <div className="-mx-4 md:-mx-8">
              <TrackTable tracks={r.tracks.slice(0, 4)} showAlbum={false} numbered={false} />
            </div>
          </section>
        )}
      </div>
      <div className="mt-10 px-4 md:px-8">
        {r.artists.length > 0 && (
          <Shelf title="Artis">
            {r.artists.slice(0, 6).map((a) => (
              <MediaCard key={a.id} title={a.name} subtitle="Artis" image={a.image_url} href={`/app/artist/${a.slug}`} round onPlay={() => play({ id: a.id, kind: 'artist' })} />
            ))}
          </Shelf>
        )}
        {r.releases.length > 0 && (
          <Shelf title="Album & rilis">
            {r.releases.slice(0, 6).map((a) => (
              <MediaCard key={a.id} title={a.title} subtitle={`${a.release_date?.slice(0, 4)} · ${a.artist.name}`} image={a.cover_url} href={`/app/album/${a.id}`} onPlay={() => play({ id: a.id, kind: 'release' })} />
            ))}
          </Shelf>
        )}
        {r.shows.length > 0 && (
          <Shelf title="Podcast & cerita">
            {r.shows.slice(0, 6).map((s) => (
              <MediaCard key={s.id} title={s.title} subtitle={s.publisher} image={s.cover_url} href={`/app/show/${s.id}`} />
            ))}
          </Shelf>
        )}
        {r.episodes.length > 0 && (
          <Shelf title="Episode">
            {r.episodes.slice(0, 6).map((e) => (
              <MediaCard key={e.id} title={e.title} subtitle={e.description} image={e.cover_url} href={`/app/episode/${e.id}`} />
            ))}
          </Shelf>
        )}
      </div>
    </div>
  );
}

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get('q')?.trim();
  return q ? <Results q={q} /> : <Browse />;
}

