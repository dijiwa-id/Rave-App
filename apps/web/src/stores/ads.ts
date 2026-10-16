import { create } from 'zustand';
import { api } from '@/lib/api';
import type { AdBreakRequest, AdBreakResponse, AdCreative, AdImpressionEvent } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import type { Playable } from '@/stores/player';

// Jeda iklan tier Gratis (docs/API.md §11). Pemutar memanggil `runAdBreak(next)` HANYA saat lagu/episode
// selesai alami, sebelum item berikutnya mulai — tidak pernah memotong lagu, tidak pada klik next/prev.
// Iklan bersifat best-effort: setiap kegagalan (jaringan, timeout, audio rusak) → langsung lanjut memutar.

const REQUEST_TIMEOUT_MS = 4000;
const TICK_MS = 250;

interface ActiveBreak {
  breakId: string | null;
  ads: AdCreative[];
  index: number;
  elapsedMs: number;
  paused: boolean;
}

interface AdsState {
  /** `ads.enabled` dari konfigurasi publik — disinkronkan oleh AdBreakOverlay. */
  enabled: boolean;
  /** true selama permintaan jeda berjalan atau iklan diputar → kontrol pemutar dikunci. */
  busy: boolean;
  active: ActiveBreak | null;
  volume: number;
  setEnabled: (v: boolean) => void;
  setVolume: (v: number) => void;
  toggle: () => void;
  skip: () => void;
  click: () => void;
}

// ---- Status internal pemutaran iklan (di luar store agar tidak memicu render) ----
let adAudio: HTMLAudioElement | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let lastTick = 0;
let finishBreak: (() => void) | null = null;

function sendEvent(id: string, event: AdImpressionEvent) {
  void api(`/v1/ads/impressions/${id}/events`, { body: { event } }).catch(() => {});
}

function stopMedia() {
  if (timer) clearInterval(timer);
  timer = null;
  if (adAudio) {
    adAudio.onended = adAudio.onerror = adAudio.ontimeupdate = null;
    adAudio.pause();
    adAudio.removeAttribute('src');
    adAudio = null;
  }
}

export const useAds = create<AdsState>((set, get) => ({
  enabled: true,
  busy: false,
  active: null,
  volume: 0.8,
  setEnabled: (enabled) => set({ enabled }),
  setVolume(volume) {
    set({ volume });
    if (adAudio) adAudio.volume = volume;
  },
  toggle() {
    const a = get().active;
    if (!a) return;
    const paused = !a.paused;
    set({ active: { ...a, paused } });
    if (adAudio) {
      if (paused) adAudio.pause();
      else void adAudio.play().catch(() => {});
    }
    lastTick = performance.now();
  },
  skip() {
    const a = get().active;
    const ad = a?.ads[a.index];
    if (!a || !ad || ad.skippable_after_s == null || a.elapsedMs < ad.skippable_after_s * 1000) return;
    sendEvent(ad.impression_id, 'skip');
    advance();
  },
  click() {
    const a = get().active;
    const ad = a?.ads[a.index];
    if (ad) sendEvent(ad.impression_id, 'click');
  },
}));

/** Iklan aktif saat ini (atau null). */
export function currentAd(s: Pick<AdsState, 'active'>): AdCreative | null {
  return s.active ? (s.active.ads[s.active.index] ?? null) : null;
}

function setElapsed(ms: number) {
  const a = useAds.getState().active;
  if (a) useAds.setState({ active: { ...a, elapsedMs: ms } });
}

/** Timer kartu display (dan fallback bila audio iklan gagal). Berhenti saat dijeda. */
function startTimer(ad: AdCreative) {
  if (timer) clearInterval(timer);
  lastTick = performance.now();
  timer = setInterval(() => {
    const a = useAds.getState().active;
    if (!a) return;
    const now = performance.now();
    const dt = now - lastTick;
    lastTick = now;
    if (a.paused) return;
    const ms = a.elapsedMs + dt;
    if (ms >= ad.duration_s * 1000) {
      sendEvent(ad.impression_id, 'complete');
      advance();
    } else setElapsed(ms);
  }, TICK_MS);
}

function playAd(index: number) {
  stopMedia();
  const a = useAds.getState().active;
  const ad = a?.ads[index];
  if (!a || !ad) return endBreak();
  useAds.setState({ active: { ...a, index, elapsedMs: 0, paused: false } });
  sendEvent(ad.impression_id, 'start');
  if (ad.type === 'audio' && ad.audio_url) {
    const el = new Audio(ad.audio_url);
    adAudio = el;
    el.volume = useAds.getState().volume;
    let fellBack = false;
    const fallback = () => {
      if (fellBack || adAudio !== el) return;
      fellBack = true;
      el.onended = el.onerror = el.ontimeupdate = null;
      el.pause();
      adAudio = null;
      startTimer(ad); // lanjut sebagai kartu bertimer dari posisi terakhir
    };
    el.ontimeupdate = () => setElapsed(el.currentTime * 1000);
    el.onended = () => {
      sendEvent(ad.impression_id, 'complete');
      advance();
    };
    el.onerror = fallback;
    el.play().catch(fallback);
  } else startTimer(ad);
}

function advance() {
  const a = useAds.getState().active;
  if (!a) return;
  if (a.index + 1 < a.ads.length) playAd(a.index + 1);
  else endBreak();
}

function endBreak() {
  stopMedia();
  useAds.setState({ active: null, busy: false });
  const done = finishBreak;
  finishBreak = null;
  done?.();
}

/** Pendengar yang mungkin menerima iklan: login, bukan Premium, iklan aktif secara global. */
function eligible() {
  const { accessToken, user } = useAuth.getState();
  return !!accessToken && !!user && !user.premium && useAds.getState().enabled;
}

/**
 * Minta jeda iklan sebelum `next` diputar; resolve setelah semua iklan selesai (atau segera bila tidak ada).
 * Tidak pernah reject.
 */
export async function runAdBreak(next: Playable): Promise<void> {
  if (!eligible() || useAds.getState().busy) return;
  useAds.setState({ busy: true });
  const body: AdBreakRequest = {
    placement: next.kind === 'episode' ? 'podcast_preroll' : 'between_tracks',
    content: {
      kind: next.kind,
      id: next.id,
      ...(next.premium ? { premium: true } : {}),
      ...(next.content_warning ? { content_warning: true } : {}),
    },
  };
  let res: AdBreakResponse | null = null;
  try {
    res = await Promise.race([
      api<AdBreakResponse>('/v1/ads/break', { body }),
      new Promise<null>((r) => setTimeout(() => r(null), REQUEST_TIMEOUT_MS)),
    ]);
  } catch {
    res = null;
  }
  if (!res?.ads?.length || !eligible()) {
    useAds.setState({ busy: false });
    return;
  }
  const ads = res.ads;
  return new Promise<void>((resolve) => {
    finishBreak = resolve;
    useAds.setState({ active: { breakId: res.break_id, ads, index: 0, elapsedMs: 0, paused: false } });
    playAd(0);
  });
}

/** Hentikan jeda (mis. logout) dan lanjutkan pemutar. */
export function abortAdBreak() {
  if (useAds.getState().active) endBreak();
}
