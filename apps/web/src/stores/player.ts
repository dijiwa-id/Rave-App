import { create } from 'zustand';
import { api, ApiError } from '@/lib/api';
import { dict } from '@/lib/i18n';
import { useAuth } from '@/stores/auth';
import { safeGet, safeSet } from '@/lib/storage';
import type { PlaybackSession } from '@/lib/types';
import { runAdBreak, useAds } from '@/stores/ads';
import { toast } from '@/components/ui';

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
  /** Episode khusus Premium — tidak pernah didahului iklan (docs/API.md §11). */
  premium?: boolean;
  /** Konten berperingatan (horor/dewasa) — server hanya menayangkan promosi internal sesudahnya. */
  content_warning?: boolean;
}

export type Quality = 'auto' | 'low' | 'normal' | 'high' | 'lossless';

interface PlayerState {
  queue: Playable[];
  index: number;
  current: Playable | null;
  session: PlaybackSession | null;
  playing: boolean;
  /** Menunggu data: sesi dibuat, buffering, atau pemulihan stream. */
  buffering: boolean;
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
  seekBy: (deltaMs: number) => void;
  /** Muat ulang item sekarang (sesi baru) dari posisi terakhir — dipakai tombol "Coba lagi". */
  retry: () => void;
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
  else ensureFlushTimer();
}
// Interval 30 dtk hanya hidup selama ada event tertunda.
let flushTimer: ReturnType<typeof setInterval> | null = null;
function ensureFlushTimer() {
  if (flushTimer || !pending.length) return;
  flushTimer = setInterval(() => void flushEvents(), 30_000);
}
async function flushEvents(keepalive = false) {
  if (!pending.length) return;
  const events = pending;
  pending = [];
  try {
    await api('/v1/events/play', { body: { events }, keepalive });
  } catch (e) {
    // Offline / server sedang bermasalah: simpan lagi untuk dikirim nanti (REQ-STR-06).
    // Ditolak permanen (4xx selain 429) → dibuang, agar satu batch rusak tidak diulang selamanya.
    const retryable = !(e instanceof ApiError) || e.status >= 500 || e.status === 429;
    if (retryable) pending = events.concat(pending).slice(-200);
  } finally {
    if (!pending.length && flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    } else ensureFlushTimer();
  }
}
if (typeof window !== 'undefined') {
  // keepalive: permintaan tidak dibatalkan browser saat halaman ditutup/ditinggal.
  window.addEventListener('pagehide', () => void flushEvents(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushEvents(true);
  });
}

/** Percobaan pemulihan otomatis berturut-turut untuk item yang sama (direset saat item baru dimuat). */
let recoveries = 0;
const MAX_RECOVERIES = 2;

// Pesan galat diambil dari kamus saat terjadi (bukan konstanta modul) agar mengikuti bahasa aktif.
const errText = () => dict('common').player.errors;
/** Penjelasan "HQ/Lossless khusus Premium" cukup sekali per sesi aplikasi, bukan tiap lagu. */
let premiumQualityNotified = false;
/** audio.play() bisa ditolak: AbortError (src berganti) diabaikan; NotAllowedError = autoplay diblokir. */
function playSafe() {
  return audio.play().catch((e: unknown) => {
    const name = (e as { name?: string })?.name;
    if (name === 'AbortError') return;
    usePlayer.setState({ playing: false, buffering: false, error: name === 'NotAllowedError' ? errText().playBlocked : errText().playFailed });
    throw e;
  });
}

export const usePlayer = create<PlayerState>((set, get) => {
  /** resumeMs > 0: pemulihan item yang sama (stream kedaluwarsa/putus) — lanjut dari posisi terakhir, tanpa event skip/start. */
  async function load(item: Playable, resumeMs = 0) {
    const prev = get();
    if (!resumeMs) recoveries = 0;
    if (!resumeMs && prev.current && prev.playing && prev.positionMs < prev.durationMs - 2000) queueEvent('skip');
    // Hentikan audio lama sekarang: bila sesi item baru gagal (Premium, 5xx, offline), lagu sebelumnya tidak terus berbunyi.
    audio.pause();
    set({ current: item, session: null, positionMs: resumeMs, durationMs: item.duration_ms, error: null, buffering: true });
    if (!resumeMs) {
      playedMs = 0;
      lastProgressAt = 0;
    }
    try {
      const session = await api<PlaybackSession>('/v1/playback/sessions', {
        body: { [item.kind === 'track' ? 'track_id' : 'episode_id']: item.id, quality: get().quality },
      });
      if (get().current?.id !== item.id) return;
      set({ session, durationMs: session.duration_ms || item.duration_ms });
      if (session.quality_capped === 'premium' && !premiumQualityNotified) {
        premiumQualityNotified = true;
        toast.info(errText().premiumQuality);
      }
      audio.src = session.stream_url;
      if (resumeMs) audio.addEventListener('loadedmetadata', () => (audio.currentTime = resumeMs / 1000), { once: true });
      audio.volume = get().muted ? 0 : get().volume;
      await playSafe();
      if (get().current?.id !== item.id) return; // diganti item lain (AbortError)
      if (!resumeMs) queueEvent('start');
    } catch (e: any) {
      // Penolakan play() (DOMException) sudah ditangani playSafe.
      if (e instanceof DOMException) return;
      if (get().current?.id !== item.id) return; // galat item lama tidak menimpa item yang sedang diputar
      set({ playing: false, buffering: false, error: e?.status === 402 ? errText().premiumEpisode : e?.message ?? errText().playFailed });
    }
  }

  /** Indeks berikutnya untuk next/selesai alami; null = antrean habis. */
  function nextIndex(): number | null {
    const { queue, index, shuffle, repeat } = get();
    if (!queue.length) return null;
    const n = shuffle ? Math.floor(Math.random() * queue.length) : index + 1;
    if (n < queue.length) return n;
    return repeat === 'all' ? 0 : null;
  }

  /**
   * Lagu/episode selesai alami → satu-satunya titik jeda iklan (tier Gratis). Iklan diminta untuk item
   * BERIKUTNYA sebelum item itu mulai; runAdBreak resolve segera bila tidak ada iklan / gagal / Premium.
   * Selama jeda, playQueue/playOne hanya mengubah antrean — item terpilih diputar setelah iklan selesai.
   */
  async function onEnded() {
    queueEvent('complete');
    const { repeat, current, queue, index, muted, volume } = get();
    useAds.getState().setVolume(muted ? 0 : volume);
    if (repeat === 'one' && current) {
      await runAdBreak(current);
      // Pengguna memilih lagu lain selama iklan → putar pilihannya.
      if (get().queue !== queue || get().index !== index) return void load(get().queue[get().index]);
      audio.currentTime = 0;
      void playSafe().catch(() => {});
      return;
    }
    const n = nextIndex();
    if (n == null) return;
    set({ index: n });
    await runAdBreak(get().queue[n]);
    const item = get().queue[get().index];
    if (item) void load(item);
  }

  if (audio) {
    audio.addEventListener('play', () => {
      lastTick = performance.now();
      set({ playing: true });
    });
    audio.addEventListener('pause', () => set({ playing: false, buffering: false }));
    // Buffering: tampilkan indikator di tombol putar; selesai saat audio benar-benar berjalan/siap.
    audio.addEventListener('waiting', () => set({ buffering: true }));
    audio.addEventListener('stalled', () => audio.paused || set({ buffering: true }));
    audio.addEventListener('playing', () => {
      recoveries = 0;
      set({ buffering: false });
    });
    audio.addEventListener('canplay', () => set({ buffering: false }));
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
        set({ error: errText().previewEnded });
      }
      if (playedMs - lastProgressAt >= 15_000) {
        lastProgressAt = playedMs;
        queueEvent('progress');
      }
    });
    audio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(audio.duration)) set({ durationMs: audio.duration * 1000 });
    });
    audio.addEventListener('ended', () => void onEnded());
    audio.addEventListener('error', () => {
      const { current, session, positionMs } = get();
      if (!current || !session) return; // reset/logout, bukan galat stream
      // URL stream kedaluwarsa atau jaringan putus: buat sesi baru dan lanjutkan dari posisi terakhir.
      if (recoveries < MAX_RECOVERIES && navigator.onLine !== false) {
        recoveries++;
        void load(current, positionMs);
        return;
      }
      set({ playing: false, buffering: false, error: errText().streamUnavailable });
    });
    // Jaringan kembali setelah putus: coba lagi otomatis bila pemutaran terhenti karena galat stream.
    window.addEventListener('online', () => {
      const { current, session, error, positionMs } = get();
      if (current && session && error === errText().streamUnavailable) {
        recoveries = 0;
        void load(current, positionMs);
      }
    });
  }

  return {
    queue: [],
    index: -1,
    current: null,
    session: null,
    playing: false,
    buffering: false,
    positionMs: 0,
    durationMs: 0,
    volume: 0.8,
    muted: false,
    shuffle: false,
    repeat: 'off',
    quality: (safeGet('rave-quality') as Quality | null) ?? 'auto',
    error: null,

    async playQueue(items, startIndex = 0) {
      if (!items.length) return;
      set({ queue: items, index: startIndex });
      if (useAds.getState().busy) return; // diputar setelah jeda iklan selesai
      await load(items[startIndex]);
    },
    async playOne(item) {
      const { queue, index } = get();
      const q = [...queue.slice(0, index + 1), item, ...queue.slice(index + 1)];
      set({ queue: q, index: index + 1 });
      if (useAds.getState().busy) return;
      await load(item);
    },
    toggle() {
      if (useAds.getState().active) return useAds.getState().toggle();
      // Jeda iklan sedang disiapkan (antara lagu selesai dan iklan mulai): jangan memutar ulang lagu yang sudah selesai.
      if (useAds.getState().busy) return;
      if (!get().current) return;
      if (audio.paused) {
        if (get().error === errText().playBlocked) set({ error: null });
        void playSafe().catch(() => {});
      }
      else audio.pause();
    },
    // next/prev/seek manual: tanpa cek iklan (praktik umum), dan dikunci selama jeda iklan.
    next() {
      if (useAds.getState().busy) return;
      const n = nextIndex();
      if (n == null) {
        if (get().queue.length) audio.pause();
        return;
      }
      const { queue } = get();
      set({ index: n });
      void load(queue[n]);
    },
    prev() {
      if (useAds.getState().busy) return;
      const { queue, index } = get();
      if (audio.currentTime > 3 || index <= 0) {
        audio.currentTime = 0;
        return;
      }
      set({ index: index - 1 });
      void load(queue[index - 1]);
    },
    seek(ms) {
      if (useAds.getState().busy) return;
      audio.currentTime = ms / 1000;
      set({ positionMs: ms });
    },
    seekBy(deltaMs) {
      if (useAds.getState().busy || !get().current) return;
      const { durationMs } = get();
      get().seek(Math.max(0, Math.min(durationMs || Infinity, audio.currentTime * 1000 + deltaMs)));
    },
    retry() {
      const { current, positionMs } = get();
      if (!current) return;
      recoveries = 0;
      void load(current, positionMs);
    },
    setVolume(v) {
      audio.volume = v;
      useAds.getState().setVolume(v);
      set({ volume: v, muted: v === 0 });
    },
    toggleMute() {
      const muted = !get().muted;
      audio.volume = muted ? 0 : get().volume || 0.8;
      useAds.getState().setVolume(audio.volume);
      set({ muted });
    },
    toggleShuffle: () => set({ shuffle: !get().shuffle }),
    cycleRepeat: () => set({ repeat: get().repeat === 'off' ? 'all' : get().repeat === 'all' ? 'one' : 'off' }),
    setQuality(q) {
      safeSet('rave-quality', q);
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

// Logout (di tab ini atau tab lain): hentikan pemutaran dan buang event tertunda milik akun sebelumnya —
// event tidak boleh terkirim belakangan dengan token akun lain (salah atribusi stream & royalti).
if (typeof window !== 'undefined')
  useAuth.subscribe((s, prev) => {
    if (!prev.accessToken || s.accessToken) return;
    pending = [];
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    usePlayer.setState({ queue: [], index: 0, current: null, session: null, playing: false, buffering: false, positionMs: 0, error: null });
  });
