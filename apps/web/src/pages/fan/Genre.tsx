import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ArtistSummary, Paged, PlaylistSummary } from '@/lib/types';
import { colorFor, DarkError, MediaCard, Shelf } from '@/components/fan';
import { usePlayMedia } from '@/components/fan/usePlayMedia';
import { EmptyState } from '@/components/ui';

/** Halaman kategori/genre dari tile Jelajahi. */
export default function Genre() {
  const { id = '' } = useParams();
  const play = usePlayMedia();
  const artists = useQuery({ queryKey: ['artists', 'genre', id], queryFn: () => api<Paged<ArtistSummary>>('/v1/catalog/artists', { query: { genre: id } }) });
  const playlists = useQuery({ queryKey: ['featured-playlists', id], queryFn: () => api<Paged<PlaylistSummary>>('/v1/library/playlists/featured', { query: { tag: id } }) });
  const title = id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const color = colorFor(id);
  return (
    <div className="min-h-full pb-12" style={{ background: `linear-gradient(${color} 0, #121212 360px)` }}>
      <h1 className="px-4 pt-28 pb-10 text-5xl font-black tracking-tighter md:px-8 md:text-8xl">{title}</h1>
      <div className="px-4 md:px-8">
        {artists.isError && <DarkError error={artists.error} />}
        {!!playlists.data?.data.length && (
          <Shelf title="Playlist">
            {playlists.data.data.map((p) => (
              <MediaCard key={p.id} title={p.title} subtitle={p.description ?? ''} image={p.cover_url} href={`/app/playlist/${p.id}`} onPlay={() => play({ id: p.id, kind: 'playlist' })} />
            ))}
          </Shelf>
        )}
        <Shelf title="Artis" loading={artists.isLoading}>
          {(artists.data?.data ?? []).map((a) => (
            <MediaCard key={a.id} title={a.name} subtitle={a.city ?? 'Artis'} image={a.image_url} href={`/app/artist/${a.slug}`} round onPlay={() => play({ id: a.id, kind: 'artist' })} />
          ))}
        </Shelf>
        {!artists.isLoading && !artists.data?.data.length && !playlists.data?.data.length && <EmptyState title="Belum ada konten di kategori ini" />}
      </div>
    </div>
  );
}
