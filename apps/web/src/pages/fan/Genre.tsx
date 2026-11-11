import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ArtistSummary, Category, Paged, PlaylistSummary, ReleaseSummary, Track } from '@/lib/types';
import { colorFor, DarkError, glow, MediaCard, Shelf, TrackTable } from '@/components/fan';
import { usePlayMedia } from '@/components/fan/usePlayMedia';
import { EmptyState } from '@/components/ui';
import { useDict } from '@/lib/i18n';

interface BrowseCategory {
  category: Category;
  artists: ArtistSummary[];
  releases: ReleaseSummary[];
  tracks: Track[];
}

/** Halaman kategori/genre dari tile Jelajahi — isi dari `GET /v1/catalog/browse/:id` (genre kategori sudah di-resolve server). */
export default function Genre() {
  const { id = '' } = useParams();
  const play = usePlayMedia();
  const t = useDict('fan');
  const browse = useQuery({ queryKey: ['browse', id], queryFn: () => api<BrowseCategory>(`/v1/catalog/browse/${encodeURIComponent(id)}`) });
  const playlists = useQuery({ queryKey: ['featured-playlists', id], queryFn: () => api<Paged<PlaylistSummary>>('/v1/library/playlists/featured', { query: { tag: id } }) });
  const d = browse.data;
  const title = d?.category.name ?? id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const color = d?.category.color ?? colorFor(id);
  const empty = !browse.isLoading && !d?.artists.length && !d?.releases.length && !d?.tracks.length && !playlists.data?.data.length;
  return (
    <div className="min-h-full pb-12" style={{ background: glow(color, '88') }}>
      <h1 className="px-4 pt-28 pb-10 text-5xl font-black tracking-tighter md:px-8 md:text-8xl">{title}</h1>
      <div className="px-4 md:px-8">
        {browse.isError && <DarkError error={browse.error} retry={() => browse.refetch()} />}
        {!!playlists.data?.data.length && (
          <Shelf title={t.shared.playlist}>
            {playlists.data.data.map((p) => (
              <MediaCard key={p.id} title={p.title} subtitle={p.description ?? ''} image={p.cover_url} href={`/app/playlist/${p.id}`} onPlay={() => play({ id: p.id, kind: 'playlist' })} />
            ))}
          </Shelf>
        )}
        {(browse.isLoading || !!d?.artists.length) && (
          <Shelf title={t.shared.artist} loading={browse.isLoading}>
            {(d?.artists ?? []).map((a) => (
              <MediaCard key={a.id} title={a.name} subtitle={a.city ?? t.shared.artist} image={a.image_url} href={`/app/artist/${a.slug}`} round onPlay={() => play({ id: a.id, kind: 'artist' })} />
            ))}
          </Shelf>
        )}
        {!!d?.releases.length && (
          <Shelf title={t.genre.releases}>
            {d.releases.map((r) => (
              <MediaCard key={r.id} title={r.title} subtitle={`${r.release_date?.slice(0, 4)} · ${r.artist.name}`} image={r.cover_url} href={`/app/album/${r.id}`} onPlay={() => play({ id: r.id, kind: 'release' })} />
            ))}
          </Shelf>
        )}
      </div>
      {!!d?.tracks.length && (
        <section className="mt-6">
          <h2 className="mb-3 px-4 text-2xl font-bold md:px-8">{t.genre.popularSongs}</h2>
          <TrackTable tracks={d.tracks} />
        </section>
      )}
      {empty && <EmptyState title={t.shared.noContentInCategory} />}
    </div>
  );
}
