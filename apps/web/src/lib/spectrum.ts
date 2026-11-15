import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Amplop spektrum lagu (kontrak bersama web/desktop/mobile): GET /v1/catalog/tracks/:id/spectrum.
 * 200 → amplop · 202 → belum dibuat (coba lagi sekali ±30 dtk, maks. 2× per lagu per sesi) · 404/galat → animasi cadangan.
 * Satu permintaan per lagu (cache memori LRU 20 lagu), dibatalkan saat lagu berganti; antrean tidak di-prefetch.
 */
export interface TrackSpectrum {
  fps: number;
  bands: number;
  frames: number;
  durationMs: number;
  /** frames*bands byte, frame-major: data[f*bands + b] (0..255). */
  data: Uint8Array;
}

interface Payload {
  track_id: string;
  version: number;
  fps: number;
  bands: number;
  frames: number;
  duration_ms: number;
  data: string;
}

const LRU_MAX = 20;
const RETRY_MS = 30_000;
const MAX_RETRIES = 2;
/** null = tidak tersedia (404/data rusak) — tidak diminta ulang selama sesi. */
const cache = new Map<string, TrackSpectrum | null>();
const retries = new Map<string, number>();

function remember(id: string, v: TrackSpectrum | null) {
  cache.delete(id);
  cache.set(id, v);
  while (cache.size > LRU_MAX) cache.delete(cache.keys().next().value!);
}

function decode(p: Payload): TrackSpectrum | null {
  if (!(p.fps > 0) || !(p.bands > 0) || !(p.frames > 0) || typeof p.data !== 'string') return null;
  const bin = atob(p.data);
  if (bin.length !== p.frames * p.bands) return null;
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  return { fps: p.fps, bands: p.bands, frames: p.frames, durationMs: p.duration_ms, data };
}

/** Amplop untuk `trackId` (null = pakai animasi cadangan). Tidak pernah melempar. */
export function useTrackSpectrum(trackId: string | null): TrackSpectrum | null {
  const [state, setState] = useState<{ id: string | null; env: TrackSpectrum | null }>({ id: null, env: null });
  useEffect(() => {
    if (!trackId) return;
    if (cache.has(trackId)) {
      const hit = cache.get(trackId)!;
      remember(trackId, hit); // segarkan urutan LRU
      setState({ id: trackId, env: hit });
      return;
    }
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const res = await api<Response>(`/v1/catalog/tracks/${trackId}/spectrum`, { raw: true, auth: false, signal: ctl.signal });
        if (ctl.signal.aborted) return;
        if (res.status === 200) {
          const env = decode((await res.json()) as Payload);
          if (ctl.signal.aborted) return;
          remember(trackId, env);
          setState({ id: trackId, env });
        } else if (res.status === 202) {
          const n = retries.get(trackId) ?? 0;
          if (n < MAX_RETRIES) {
            retries.set(trackId, n + 1);
            timer = setTimeout(() => void load(), RETRY_MS);
          }
        } else if (res.status === 404) {
          remember(trackId, null);
        }
        // 5xx / lainnya: tidak di-cache → dicoba lagi saat lagu diputar kembali.
      } catch {
        /* jaringan / dibatalkan → animasi cadangan */
      }
    };
    void load();
    return () => {
      ctl.abort();
      clearTimeout(timer);
    };
  }, [trackId]);
  return trackId && state.id === trackId ? state.env : null;
}
