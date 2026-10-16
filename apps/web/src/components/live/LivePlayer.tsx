import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type Hls from 'hls.js';
import type { ErrorData, HlsConfig } from 'hls.js';
import { Loader2, Maximize, Minimize, Pause, PictureInPicture2, Play, RadioTower, RotateCw, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { api, ApiError, fmt } from '@/lib/api';
import type { LivePlayback, LiveStreamDetail } from '@/lib/types';
import { cx } from '@/components/ui';
import { usePlayer } from '@/stores/player';
import { isOnAir, LivePill, liveViewerId } from './common';

/**
 * Pemutar HLS live yang tahan gangguan (docs/API.md §10).
 * - URL bertanda tangan dari `POST /playback`, diperbarui sebelum `expires_at` dan saat 401/403;
 *   token baru disisipkan ke setiap request hls.js (xhrSetup) sehingga pemutaran tidak perlu diulang.
 * - hls.js (MSE, lazy-load agar bundle utama tetap kecil) di mana pun tersedia; HLS native hanya bila MSE tidak ada (iPhone).
 * - Pemulihan: NETWORK → backoff 1→10 dtk + playback URL baru; MEDIA → recoverMediaError lalu swapAudioCodec;
 *   lainnya → bangun ulang. 404 manifest saat LIVE/INTERRUPTED = "menunggu sinyal" (terus mencoba).
 * - Status dipoll tiap 10 dtk (query `['live-stream', id]`, dipakai bersama halaman tonton).
 */

let hlsModule: Promise<typeof Hls> | null = null;
// Build "light" (tanpa subtitle/EME/alt-audio) — cukup untuk live dan ±35% lebih kecil.
// Gagal muat (jaringan putus, deploy baru) tidak di-cache: percobaan berikutnya mengimpor ulang.
const loadHls = () =>
  (hlsModule ??= import('hls.js/light')
    .then((m) => m.default)
    .catch((e) => {
      hlsModule = null;
      throw e;
    }));

const HLS_CONFIG: Partial<HlsConfig> = {
  lowLatencyMode: false,
  liveSyncDurationCount: 3,
  liveMaxLatencyDurationCount: 8,
  maxLiveSyncPlaybackRate: 1.2,
  backBufferLength: 30,
  manifestLoadingMaxRetry: 6,
  manifestLoadingRetryDelay: 1000,
  manifestLoadingMaxRetryTimeout: 10_000,
  levelLoadingMaxRetry: 8,
  levelLoadingRetryDelay: 1000,
  levelLoadingMaxRetryTimeout: 10_000,
  fragLoadingMaxRetry: 8,
  fragLoadingRetryDelay: 1000,
  fragLoadingMaxRetryTimeout: 10_000,
};

type Phase = 'connecting' | 'waiting' | 'ready' | 'error';

const tokenOf = (url: string) => {
  try {
    return new URL(url, window.location.href).searchParams.get('token');
  } catch {
    return null;
  }
};

/** Hentikan pemutar musik agar dua sumber audio tidak bertumpuk. */
function pauseMusic() {
  const p = usePlayer.getState();
  if (p.playing) p.toggle();
}

export interface LivePlayerProps {
  streamId: string;
  /** Kirim heartbeat penonton (matikan untuk pratinjau studio). */
  countViewer?: boolean;
  className?: string;
  /** Konten tambahan di kartu "siaran berakhir". */
  endCard?: ReactNode;
  /** Pratinjau ringkas (tanpa ajakan "Ketuk untuk suara"). */
  preview?: boolean;
}

export function LivePlayer({ streamId, countViewer = true, className, endCard, preview }: LivePlayerProps) {
  const qc = useQueryClient();
  const stream = useQuery({
    queryKey: ['live-stream', streamId],
    queryFn: () => api<LiveStreamDetail>(`/v1/live/streams/${streamId}`),
    refetchInterval: 10_000,
  });
  const status = stream.data?.status;
  const active = isOnAir(status);

  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const tokenRef = useRef<string | null>(null);
  const rebuildRef = useRef<(() => void) | null>(null);

  const [phase, setPhase] = useState<Phase>('connecting');
  const [fatal, setFatal] = useState<string | null>(null);
  const [buffering, setBuffering] = useState(false);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [unmuteHint, setUnmuteHint] = useState(!preview);
  const [behind, setBehind] = useState(false);
  const [levels, setLevels] = useState<{ index: number; label: string }[]>([]);
  const [level, setLevel] = useState(-1);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewers, setViewers] = useState<number | null>(null);
  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // hls.js (MSE) diutamakan di mana pun MediaSource tersedia — kontrol retry/token/kualitas penuh. HLS native hanya
  // untuk browser tanpa MSE (iPhone). Catatan: Chrome ≥ 14x juga menjawab canPlayType('…mpegurl') = "maybe", tetapi
  // pemutar native-nya mem-polling playlist live jauh lebih agresif (terukur ±20 req/dtk) → jangan dipakai bila MSE ada.
  const [native] = useState(() => {
    if (typeof window === 'undefined') return false;
    const mse = 'MediaSource' in window || 'ManagedMediaSource' in window;
    return !mse && !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl');
  });

  /** Putar; bila autoplay diblokir walau muted, tampilkan tombol putar. */
  const tryPlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.play().catch((e: DOMException) => {
      if (e?.name === 'NotAllowedError' && !v.muted) {
        v.muted = true;
        v.play().catch(() => setPaused(true));
      } else setPaused(true);
    });
  }, []);

  // ---------- Mesin pemutaran (dibangun ulang saat stream aktif) ----------
  useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    let hls: Hls | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let backoff = 1000;
    let mediaErrors = 0;

    const teardown = () => {
      if (hls) {
        hls.destroy(); // melepas MediaSource & object URL-nya
        hls = null;
        hlsRef.current = null;
      }
      if (video.getAttribute('src')) {
        video.removeAttribute('src');
        video.load();
      }
    };
    const rebuildIn = (ms: number) => {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void build(), ms);
    };
    const retryWithBackoff = () => {
      const d = backoff;
      backoff = Math.min(backoff * 2, 10_000);
      rebuildIn(d);
    };

    /** Perbarui token sebelum kedaluwarsa (5 menit sebelumnya, minimal 30 dtk dari sekarang). */
    const scheduleRefresh = (expiresAt: string) => {
      clearTimeout(refreshTimer);
      const ms = Math.max(30_000, new Date(expiresAt).getTime() - Date.now() - 5 * 60_000);
      refreshTimer = setTimeout(async () => {
        const pb = await api<LivePlayback>(`/v1/live/streams/${streamId}/playback`, { method: 'POST' }).catch(() => null);
        if (disposed) return;
        if (pb) {
          tokenRef.current = tokenOf(pb.hls_url);
          scheduleRefresh(pb.expires_at);
        } else scheduleRefresh(new Date(Date.now() + 5 * 60_000 + 30_000).toISOString());
      }, ms);
    };

    async function loadPlayback(): Promise<LivePlayback | null> {
      try {
        const pb = await api<LivePlayback>(`/v1/live/streams/${streamId}/playback`, { method: 'POST' });
        if (disposed) return null; // pemutar sudah dibongkar: jangan pasang timer refresh baru
        tokenRef.current = tokenOf(pb.hls_url);
        scheduleRefresh(pb.expires_at);
        return pb;
      } catch (e) {
        if (disposed) return null;
        if (e instanceof ApiError) {
          if (e.status === 409) {
            // Belum/tidak live menurut server — tunggu & coba lagi (status dipoll terpisah).
            setPhase('waiting');
            rebuildIn(5000);
            return null;
          }
          if (e.status === 401) return fail('Masuk ke akunmu untuk menonton siaran ini.');
          if (e.status === 403) return fail('Siaran ini khusus pemegang tiket event terkait.');
          if (e.status === 404) return fail('Siaran tidak ditemukan.');
        }
        retryWithBackoff();
        return null;
      }
    }
    function fail(msg: string) {
      setFatal(msg);
      setPhase('error');
      return null;
    }

    function onHlsError(H: typeof Hls, data: ErrorData) {
      const code = data.response?.code;
      // Token kedaluwarsa/ditolak pada request non-fatal: perbarui token, hls.js memakai yang baru saat retry.
      if (!data.fatal) {
        if (code === 401 || code === 403)
          void api<LivePlayback>(`/v1/live/streams/${streamId}/playback`, { method: 'POST' })
            .then((pb) => {
              if (!disposed) tokenRef.current = tokenOf(pb.hls_url);
            })
            .catch(() => {});
        return;
      }
      if (data.type === H.ErrorTypes.NETWORK_ERROR) {
        const manifest = data.details === H.ErrorDetails.MANIFEST_LOAD_ERROR || data.details === H.ErrorDetails.LEVEL_LOAD_ERROR;
        if (manifest && code === 404) {
          // Belum ada segmen: penyiar belum mengirim sinyal / encoder baru mulai.
          setPhase('waiting');
          teardown();
          rebuildIn(3000);
          return;
        }
        teardown();
        if (code === 401 || code === 403) rebuildIn(250);
        else retryWithBackoff();
        return;
      }
      if (data.type === H.ErrorTypes.MEDIA_ERROR && hls) {
        mediaErrors += 1;
        if (mediaErrors === 1) return hls.recoverMediaError();
        if (mediaErrors === 2) {
          hls.swapAudioCodec();
          return hls.recoverMediaError();
        }
      }
      teardown();
      retryWithBackoff();
    }

    async function build() {
      if (disposed) return;
      clearTimeout(retryTimer);
      teardown();
      setFatal(null);
      setPhase((p) => (p === 'waiting' ? p : 'connecting'));
      const pb = await loadPlayback();
      if (!pb || disposed) return;
      if (native) {
        video!.src = pb.hls_url;
        tryPlay();
        return;
      }
      const H = await loadHls().catch(() => null);
      if (disposed) return;
      if (!H) return void retryWithBackoff();
      if (!H.isSupported()) return void fail('Browser ini tidak mendukung pemutaran live. Coba Chrome, Firefox, Edge, atau Safari terbaru.');
      mediaErrors = 0;
      hls = new H({
        ...HLS_CONFIG,
        // Sisipkan token terbaru ke semua URL HLS (playlist & segmen) — memungkinkan rotasi token tanpa memutus pemutaran.
        xhrSetup: (xhr, url) => {
          const t = tokenRef.current;
          if (!t) return;
          try {
            const u = new URL(url, window.location.href);
            if (u.searchParams.has('token') && u.searchParams.get('token') !== t) {
              u.searchParams.set('token', t);
              xhr.open('GET', u.toString(), true);
            }
          } catch {
            /* URL tak terurai — biarkan hls.js membuka apa adanya */
          }
        },
      });
      hlsRef.current = hls;
      hls.on(H.Events.MANIFEST_PARSED, (_e, d) => {
        backoff = 1000;
        const ls = d.levels.map((l, index) => ({ index, label: l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)} kbps` }));
        setLevels(ls.length > 1 ? ls : []);
        setLevel(-1);
        tryPlay();
      });
      hls.on(H.Events.FRAG_BUFFERED, () => {
        backoff = 1000;
        mediaErrors = 0;
        setPhase('ready');
      });
      hls.on(H.Events.ERROR, (_e, d) => onHlsError(H, d));
      hls.loadSource(pb.hls_url);
      hls.attachMedia(video!);
    }

    // Native: error elemen video → bangun ulang dengan backoff (URL baru).
    const onNativeError = () => {
      if (!native || disposed) return;
      teardown();
      retryWithBackoff();
    };
    const onNativeReady = () => {
      if (!native) return;
      backoff = 1000;
      setPhase('ready');
    };
    video.addEventListener('error', onNativeError);
    video.addEventListener('loadeddata', onNativeReady);

    rebuildRef.current = () => {
      backoff = 1000;
      void build();
    };
    void build();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearTimeout(refreshTimer);
      video.removeEventListener('error', onNativeError);
      video.removeEventListener('loadeddata', onNativeReady);
      rebuildRef.current = null;
      teardown();
    };
  }, [streamId, active, native, tryPlay]);

  // Stream kembali LIVE setelah INTERRUPTED tapi pemutar masih menunggu → coba sekarang (tanpa menunggu backoff).
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === 'INTERRUPTED' && status === 'LIVE' && phase !== 'ready') rebuildRef.current?.();
    prevStatus.current = status;
  }, [status, phase]);

  // ---------- Event elemen video ----------
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => {
      setBuffering(false);
      setPaused(false);
      if (!v.muted) pauseMusic();
    };
    const onVolume = () => {
      setMuted(v.muted);
      setVolume(v.volume);
      if (!v.muted && !v.paused) pauseMusic();
    };
    const onTime = () => {
      const hls = hlsRef.current;
      let edge: number | null = hls?.liveSyncPosition ?? null;
      if (edge == null && v.seekable.length) edge = v.seekable.end(v.seekable.length - 1);
      setBehind(edge != null && edge - v.currentTime > 15);
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('playing', onPlaying);
    v.addEventListener('volumechange', onVolume);
    v.addEventListener('timeupdate', onTime);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('volumechange', onVolume);
      v.removeEventListener('timeupdate', onTime);
    };
  }, []);

  // Musik mulai diputar saat video bersuara → bisukan video (bukan sebaliknya; pilihan terakhir pengguna menang).
  useEffect(
    () =>
      usePlayer.subscribe((s, prev) => {
        const v = videoRef.current;
        if (s.playing && !prev.playing && v && !v.muted && !v.paused) v.muted = true;
      }),
    [],
  );

  // Watchdog: video "berjalan" tapi currentTime diam 20 dtk saat LIVE → bangun ulang.
  useEffect(() => {
    if (status !== 'LIVE') return;
    let last = -1;
    let stuckSince = Date.now();
    const t = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused || phase !== 'ready') {
        stuckSince = Date.now();
        return;
      }
      if (v.currentTime !== last) {
        last = v.currentTime;
        stuckSince = Date.now();
      } else if (Date.now() - stuckSince > 20_000) {
        stuckSince = Date.now();
        rebuildRef.current?.();
      }
    }, 5000);
    return () => clearInterval(t);
  }, [status, phase]);

  // Heartbeat penonton tiap 15 dtk selama memutar.
  useEffect(() => {
    if (!active || !countViewer) return;
    let stop = false;
    const beat = async () => {
      const v = videoRef.current;
      if (!v || v.paused) return;
      const r = await api<{ viewers: number; status: string }>(`/v1/live/streams/${streamId}/heartbeat`, { body: { viewer_id: liveViewerId() } }).catch(() => null);
      if (stop || !r) return;
      setViewers(r.viewers);
      if (r.status !== status) qc.invalidateQueries({ queryKey: ['live-stream', streamId] });
    };
    const first = setTimeout(beat, 1500);
    const t = setInterval(beat, 15_000);
    return () => {
      stop = true;
      clearTimeout(first);
      clearInterval(t);
    };
  }, [streamId, active, countViewer, status, qc]);

  // Status ENDED → hentikan video (mesin sudah dibongkar oleh efek di atas).
  useEffect(() => {
    if (status === 'ENDED') {
      setLevels([]);
      setBehind(false);
    }
  }, [status]);

  useEffect(() => {
    const h = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => {
      document.removeEventListener('fullscreenchange', h);
      clearTimeout(hideTimer.current);
    };
  }, []);

  // ---------- Kontrol ----------
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // Kembali dari jeda pada live: lompat ke tepi live.
      const edge = hlsRef.current?.liveSyncPosition;
      if (edge != null && edge - v.currentTime > 15) v.currentTime = edge;
      tryPlay();
    } else v.pause();
  };
  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted && v.volume === 0) v.volume = 0.8;
    setUnmuteHint(false);
    if (v.paused) tryPlay();
  };
  const goLive = () => {
    const v = videoRef.current;
    if (!v) return;
    const edge = hlsRef.current?.liveSyncPosition ?? (v.seekable.length ? v.seekable.end(v.seekable.length - 1) - 3 : null);
    if (edge != null) v.currentTime = edge;
    tryPlay();
  };
  const toggleFullscreen = () => {
    const box = boxRef.current;
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
    if (box?.requestFullscreen) box.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.());
    else v?.webkitEnterFullscreen?.(); // iOS Safari
  };
  const togglePip = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch {
      /* tidak didukung / ditolak */
    }
  };
  const chooseLevel = (n: number) => {
    setLevel(n);
    if (hlsRef.current) hlsRef.current.currentLevel = n;
  };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input,select,textarea')) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'k') {
      e.preventDefault();
      togglePlay();
    } else if (k === 'm') toggleMute();
    else if (k === 'f') toggleFullscreen();
  };
  const poke = () => {
    setShowControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), 3000);
  };

  const s = stream.data;
  const pipOk = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;
  const shownViewers = viewers ?? s?.viewers ?? null;
  const loading = active && !fatal && (phase === 'connecting' || (phase === 'ready' && buffering));
  const controlsVisible = showControls || paused;

  return (
    <div
      ref={boxRef}
      tabIndex={0}
      onKeyDown={onKey}
      onMouseMove={poke}
      onTouchStart={poke}
      onMouseLeave={() => !paused && setShowControls(false)}
      aria-label={s ? `Pemutar live: ${s.title}` : 'Pemutar live'}
      className={cx('group/player relative aspect-video w-full overflow-hidden rounded-xl bg-black text-white outline-none focus-visible:ring-2 focus-visible:ring-white/60', className)}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        onClick={togglePlay}
        poster={s?.cover_url ?? s?.artist?.image_url ?? undefined}
        className={cx('size-full bg-black object-contain', !active && 'opacity-30')}
      />

      {/* ---- Lapisan status ---- */}
      {stream.isLoading && <Center><Loader2 className="size-10 animate-spin" /></Center>}
      {stream.isError && !stream.data && (
        <Center>
          <WifiOff className="size-8" />
          <p className="text-sm">Gagal memuat siaran.</p>
          <OverlayButton onClick={() => stream.refetch()}>Coba lagi</OverlayButton>
        </Center>
      )}
      {loading && <Center pointer="none"><Loader2 className="size-10 animate-spin drop-shadow" /></Center>}
      {active && phase === 'waiting' && status === 'LIVE' && (
        <Center>
          <RadioTower className="size-8 animate-pulse" />
          <p className="font-bold">Menunggu sinyal dari penyiar…</p>
          <p className="text-xs text-white/70">Video akan muncul otomatis.</p>
        </Center>
      )}
      {status === 'INTERRUPTED' && (
        <Center>
          <Loader2 className="size-8 animate-spin" />
          <p className="font-bold">Sinyal terputus — menyambung ulang…</p>
          <p className="text-xs text-white/70">Jangan tutup halaman ini, siaran akan berlanjut otomatis.</p>
        </Center>
      )}
      {active && fatal && (
        <Center>
          <WifiOff className="size-8" />
          <p className="max-w-sm text-center text-sm">{fatal}</p>
          <OverlayButton onClick={() => rebuildRef.current?.()}>
            <RotateCw className="size-4" /> Coba lagi
          </OverlayButton>
        </Center>
      )}
      {status === 'SCHEDULED' && (
        <Center>
          <RadioTower className="size-8" />
          <p className="font-bold">Siaran belum dimulai</p>
          {s?.scheduled_at && <p className="text-sm text-white/70">Dijadwalkan {fmt.dateTime(s.scheduled_at)}</p>}
        </Center>
      )}
      {status === 'ENDED' && (
        <Center className="bg-black/80">
          <p className="text-xs font-bold tracking-widest text-white/60 uppercase">Siaran telah berakhir</p>
          <p className="max-w-md text-center text-xl font-black">{s?.title}</p>
          {s && (
            <p className="text-sm text-white/70">
              {fmt.num(s.peak_viewers)} penonton puncak · {fmt.num(s.total_views)} total penonton
            </p>
          )}
          {endCard}
        </Center>
      )}
      {active && phase === 'ready' && paused && !buffering && (
        <Center pointer="none">
          <span className="grid size-16 place-items-center rounded-full bg-black/60">
            <Play className="ml-1 size-8 fill-white" />
          </span>
        </Center>
      )}

      {/* ---- Atas: LIVE + penonton ---- */}
      {active && (
        <div className="pointer-events-none absolute top-3 left-3">
          <LivePill viewers={shownViewers} interrupted={status === 'INTERRUPTED'} />
        </div>
      )}
      {active && muted && unmuteHint && phase === 'ready' && (
        <button onClick={toggleMute} className="absolute top-3 right-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-black shadow-lg transition hover:scale-105">
          <VolumeX className="size-4" /> Ketuk untuk suara
        </button>
      )}

      {/* ---- Bawah: kontrol ---- */}
      {active && (
        <div className={cx('absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/85 to-transparent px-3 pt-10 pb-2.5 transition-opacity duration-200', controlsVisible ? 'opacity-100' : 'opacity-0 group-focus-within/player:opacity-100')}>
          <CtlButton label={paused ? 'Putar (k)' : 'Jeda (k)'} onClick={togglePlay}>
            {paused ? <Play className="size-5 fill-white" /> : <Pause className="size-5 fill-white" />}
          </CtlButton>
          <CtlButton label={muted ? 'Suarakan (m)' : 'Bisukan (m)'} onClick={toggleMute}>
            {muted || volume === 0 ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </CtlButton>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            aria-label="Volume"
            onChange={(e) => {
              const v = videoRef.current;
              if (!v) return;
              v.volume = Number(e.target.value);
              v.muted = v.volume === 0;
              setUnmuteHint(false);
            }}
            className="hidden w-20 accent-white sm:block"
          />
          {behind ? (
            <button onClick={goLive} className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold hover:bg-white/25">
              <span className="size-2 rounded-full bg-white/60" /> Ke siaran langsung
            </button>
          ) : (
            <span className="ml-1 inline-flex items-center gap-1.5 text-xs font-bold">
              <span className="size-2 rounded-full bg-red-500" /> LIVE
            </span>
          )}
          <span className="flex-1" />
          {levels.length > 0 && (
            <select
              value={level}
              onChange={(e) => chooseLevel(Number(e.target.value))}
              aria-label="Kualitas video"
              className="rounded bg-black/60 px-1.5 py-1 text-xs font-bold text-white focus:outline-none"
            >
              <option value={-1}>Otomatis</option>
              {levels.map((l) => (
                <option key={l.index} value={l.index}>
                  {l.label}
                </option>
              ))}
            </select>
          )}
          {pipOk && (
            <CtlButton label="Picture-in-picture" onClick={togglePip}>
              <PictureInPicture2 className="size-5" />
            </CtlButton>
          )}
          <CtlButton label={fullscreen ? 'Keluar layar penuh (f)' : 'Layar penuh (f)'} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
          </CtlButton>
        </div>
      )}
    </div>
  );
}

function Center({ children, className, pointer }: { children: ReactNode; className?: string; pointer?: 'none' }) {
  return (
    <div className={cx('absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 p-4 text-center', pointer === 'none' && 'pointer-events-none bg-transparent', className)}>
      {children}
    </div>
  );
}

function OverlayButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="mt-1 inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-sm font-bold text-black hover:scale-105">
      {children}
    </button>
  );
}

function CtlButton({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="grid size-9 place-items-center rounded-full hover:bg-white/15">
      {children}
    </button>
  );
}
