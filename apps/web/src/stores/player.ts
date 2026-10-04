import { create } from 'zustand';
import { api } from '@/lib/api';
import type { PlaybackSession } from '@/lib/types';

/** Item yang bisa diputar: lagu atau episode podcast/fiksi. */
export interface Playable {
  id: string;
  kind: 'track' | 'episode';
  title: string;
  subtitle: string; // nama artis / show
  subtitleHref?: string;
  image_url: string | null;
  duration_ms: number;
  artist_id?: string;
}

export type Quality = 'auto' | 'low' | 'normal' | 'high' | 'lossless';

interface PlayerState {
  queue: Playable[];
  index: number;
  current: Playable | null;
  session: PlaybackSession | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  quality: Quality;
  error: string | null;
  playQueue: (items: Playable[], startIndex?: number) => Promise<void>;
  playOne: (item: Playable) => Promise<void>;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (ms: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setQuality: (q: Quality) => void;
  addToQueue: (item: Playable) => void;
}

const audio = typeof window !== 'undefined' ? new Audio() : (null as unknown as HTMLAudioElement);
if (audio) audio.preload = 'auto';

// ---- Pelaporan play events (TDD §11.3: start, progress tiap 15 dtk, complete, skip) ----
let pending: any[] = [];
let lastProgressAt = 0;
let playedMs = 0;
let lastTick = 0;
function queueEvent(type: 'start' | 'progress' | 'complete' | 'skip') {
  const s = usePlayer.getState();
  if (!s.session || !s.current) return;
  pending.push({
    session_id: s.session.session_id,
    [s.current.kind === 'track' ? 'track_id' : 'episode_id']: s.current.id,
    type,
    position_ms: Math.round(s.positionMs),
    played_ms: Math.round(playedMs),
    at: new Date().toISOString(),
  });
  if (type !== 'progress' || pending.length >= 4) void flushEvents();
}
async function flushEvents() {
  if (!pending.length) return;
  const events = pending;
  pending = [];
  try {
    await api('/v1/events/play', { body: { events } });
  } catch {
    // Offline: simpan lagi untuk dikirim nanti (REQ-STR-06)
    pending = events.concat(pending).slice(-200);
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushEvents());
  setInterval(() => void flushEvents(), 30_000);
}

export const usePlayer = create<PlayerState>((set, get) => {
  async function load(item: Playable) {
    const prev = get();
    if (prev.current && prev.playing && prev.positionMs < prev.durationMs - 2000) queueEvent('skip');
    set({ current: item, session: null, positionMs: 0, durationMs: item.duration_ms, error: null });
    playedMs = 0;
    lastProgressAt = 0;
    try {
      const session = await api<PlaybackSession>('/v1/playback/sessions', {
        body: { [item.kind === 'track' ? 'track_id' : 'episode_id']: item.id, quality: get().quality },
      });
      if (get().current?.id !== item.id) return;
      set({ session, durationMs: session.duration_ms || item.duration_ms });
      audio.src = session.stream_url;
      audio.volume = get().muted ? 0 : get().volume;
      await audio.play();
      queueEvent('start');
    } catch (e: any) {
      set({ playing: false, error: e?.status === 402 ? 'Episode ini khusus Premium' : e?.message ?? 'Gagal memutar' });
    }
  }

  if (audio) {
    audio.addEventListener('play', () => {
      lastTick = performance.now();
      set({ playing: true });
    });
    audio.addEventListener('pause', () => set({ playing: false }));
    audio.addEventListener('timeupdate', () => {
      const now = performance.now();
      if (!audio.paused && lastTick) playedMs += Math.min(1000, now - lastTick);
      lastTick = now;
      const pos = audio.currentTime * 1000;
      const s = get();
      set({ positionMs: pos });
      // Pratinjau 30 detik untuk pengguna anonim (REQ-WEB-04)
      if (s.session?.preview_only && s.session.preview_ms && pos >= s.session.preview_ms) {
        audio.pause();
        set({ error: 'Pratinjau 30 detik berakhir — masuk untuk mendengar penuh, gratis.' });
      }
      if (playedMs - lastProgressAt >= 15_000) {
        lastProgressAt = playedMs;
        queueEvent('progress');
      }
    });
    audio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(audio.duration)) set({ durationMs: audio.duration * 1000 });
    });
    audio.addEventListener('ended', () => {
      queueEvent('complete');
      const { repeat } = get();
      if (repeat === 'one') {
        audio.currentTime = 0;
        void audio.play();
      } else get().next();
    });
    audio.addEventListener('error', () => set({ playing: false, error: 'Stream tidak tersedia' }));
  }

  return {
    queue: [],
    index: -1,
    current: null,
    session: null,
    playing: false,
    positionMs: 0,
    durationMs: 0,
    volume: 0.8,
    muted: false,
    shuffle: false,
    repeat: 'off',
    quality: (localStorage.getItem('gema-quality') as Quality) ?? 'auto',
    error: null,

    async playQueue(items, startIndex = 0) {
      if (!items.length) return;
      set({ queue: items, index: startIndex });
      await load(items[startIndex]);
    },
    async playOne(item) {
      const { queue, index } = get();
      const q = [...queue.slice(0, index + 1), item, ...queue.slice(index + 1)];
      set({ queue: q, index: index + 1 });
      await load(item);
    },
    toggle() {
      if (!get().current) return;
      if (audio.paused) void audio.play();
      else audio.pause();
    },
    next() {
      const { queue, index, shuffle, repeat } = get();
      if (!queue.length) return;
      let n = shuffle ? Math.floor(Math.random() * queue.length) : index + 1;
      if (n >= queue.length) {
        if (repeat !== 'all') {
          audio.pause();
          return;
        }
        n = 0;
      }
      set({ index: n });
      void load(queue[n]);
    },
    prev() {
      const { queue, index } = get();
      if (audio.currentTime > 3 || index <= 0) {
        audio.currentTime = 0;
        return;
      }
      set({ index: index - 1 });
      void load(queue[index - 1]);
    },
    seek(ms) {
      audio.currentTime = ms / 1000;
      set({ positionMs: ms });
    },
    setVolume(v) {
      audio.volume = v;
      set({ volume: v, muted: v === 0 });
    },
    toggleMute() {
      const muted = !get().muted;
      audio.volume = muted ? 0 : get().volume || 0.8;
      set({ muted });
    },
    toggleShuffle: () => set({ shuffle: !get().shuffle }),
    cycleRepeat: () => set({ repeat: get().repeat === 'off' ? 'all' : get().repeat === 'all' ? 'one' : 'off' }),
    setQuality(q) {
      localStorage.setItem('gema-quality', q);
      set({ quality: q });
    },
    addToQueue: (item) => set({ queue: [...get().queue, item] }),
  };
});

/** Helper konversi Track API → Playable. */
export function trackToPlayable(t: {
  id: string;
  title: string;
  duration_ms: number;
  artist: { id: string; name: string; slug: string };
  release: { cover_url: string | null };
}): Playable {
  return {
    id: t.id,
    kind: 'track',
    title: t.title,
    subtitle: t.artist.name,
    subtitleHref: `/app/artist/${t.artist.slug}`,
    image_url: t.release.cover_url,
    duration_ms: t.duration_ms,
    artist_id: t.artist.id,
  };
}
