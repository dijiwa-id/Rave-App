import { api } from '@/lib/api';
import type { MediaItem, Release } from '@/lib/types';
import { trackToPlayable, usePlayer } from '@/stores/player';
import { toast } from '@/components/ui';
import { dict } from '@/lib/i18n';

type Playable = Pick<MediaItem, 'id' | 'kind'>;

/** Kunci konteks antrean untuk sebuah item media (lihat `PlayerState.context`). */
export const mediaKey = (item: Playable) => `${item.kind}:${item.id}`;

/**
 * Status "sedang diputar" untuk satu konteks (kartu, baris library): `active` = antrean berasal dari item ini,
 * `playing` = aktif dan sedang berbunyi (tombol menampilkan Jeda).
 */
export function useMediaPlaying(key: string | null | undefined) {
  const active = usePlayer((s) => {
    if (!key || !s.current) return false;
    // Kartu lagu: aktif bila lagu itu yang sedang dimuat (apa pun asal antreannya).
    if (key.startsWith('track:') || key.startsWith('episode:')) return s.current.id === key.slice(key.indexOf(':') + 1);
    return s.context === key;
  });
  const playing = usePlayer((s) => s.playing || s.buffering);
  return { active, playing: active && playing };
}

/**
 * Putar item media: rilis → semua lagu; artis → lagu populer; playlist → item.
 * Bila antrean saat ini sudah berasal dari item yang sama, tombol menjeda/melanjutkan (tidak mengulang dari awal).
 */
export function usePlayMedia() {
  const playQueue = usePlayer((s) => s.playQueue);
  return async (item: Playable) => {
    const key = mediaKey(item);
    const s = usePlayer.getState();
    if (s.context === key && s.current) return s.toggle();
    try {
      let title = '';
      let image: string | null = null;
      if (item.kind === 'release') {
        const r = await api<Release>(`/v1/catalog/releases/${item.id}`);
        ({ title } = r);
        image = r.cover_url;
        await playQueue(r.tracks.map(trackToPlayable), 0, key);
      } else if (item.kind === 'artist') {
        const a = await api<{ name: string; image_url: string | null; top_tracks: Release['tracks'] }>(`/v1/catalog/artists/${item.id}`);
        title = a.name;
        image = a.image_url;
        await playQueue(a.top_tracks.map(trackToPlayable), 0, key);
      } else if (item.kind === 'playlist') {
        const p = await api<{ title: string; cover_url: string | null; items: { track: Release['tracks'][number] }[] }>(`/v1/library/playlists/${item.id}`);
        title = p.title;
        image = p.cover_url;
        await playQueue(p.items.map((i) => trackToPlayable(i.track)), 0, key);
      } else return;
      if (usePlayer.getState().context === key) toast.success(title, { title: dict('common').shell.nowSpinning, image, duration: 2600 });
    } catch {
      /* error ditampilkan player */
    }
  };
}
