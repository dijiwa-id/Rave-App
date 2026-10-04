import { api } from '@/lib/api';
import type { MediaItem, Release } from '@/lib/types';
import { trackToPlayable, usePlayer } from '@/stores/player';

/** Putar item media: rilis → semua lagu; artis → lagu populer; playlist → item. */
export function usePlayMedia() {
  const playQueue = usePlayer((s) => s.playQueue);
  return async (item: Pick<MediaItem, 'id' | 'kind'>) => {
    try {
      if (item.kind === 'release') {
        const r = await api<Release>(`/v1/catalog/releases/${item.id}`);
        await playQueue(r.tracks.map(trackToPlayable));
      } else if (item.kind === 'artist') {
        const a = await api<{ top_tracks: Release['tracks'] }>(`/v1/catalog/artists/${item.id}`);
        await playQueue(a.top_tracks.map(trackToPlayable));
      } else if (item.kind === 'playlist') {
        const p = await api<{ items: { track: Release['tracks'][number] }[] }>(`/v1/library/playlists/${item.id}`);
        await playQueue(p.items.map((i) => trackToPlayable(i.track)));
      }
    } catch {
      /* error ditampilkan player */
    }
  };
}

