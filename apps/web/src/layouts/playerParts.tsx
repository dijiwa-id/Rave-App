import { useRef, useState, type ComponentProps } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Heart, Pause, Play } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { api, fmt } from '@/lib/api';
import { usePlayer } from '@/stores/player';
import { currentAd, useAds } from '@/stores/ads';
import { useAuth } from '@/stores/auth';
import { cx, Spinner, toast } from '@/components/ui';
import { dict, useDict } from '@/lib/i18n';

/** Tooltip kontrol terkunci selama iklan (fungsi agar mengikuti bahasa aktif). */
export const adLock = () => dict('common').player.adLock;
// aria-disabled (bukan disabled) agar tooltip tetap muncul; aksi sudah no-op di store selama jeda iklan.
export const LOCKED_CLS = 'cursor-not-allowed opacity-40';

/** iOS tidak mengizinkan JS mengatur volume media — kontrol volume disembunyikan di sana (pakai tombol fisik). */
export const VOLUME_CONTROLLABLE = typeof navigator === 'undefined' || !(/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** Keadaan turunan yang dipakai bar desktop, mini-player, dan sheet: satu sumber agar ketiganya selalu sinkron. */
export function usePlayerView() {
  // Semua field kecuali posisi (lihat <Progress/>) — useShallow agar tick timeupdate tidak me-render bilah.
  const p = usePlayer(
    useShallow((s) => ({
      current: s.current,
      session: s.session,
      playing: s.playing,
      buffering: s.buffering,
      volume: s.volume,
      muted: s.muted,
      shuffle: s.shuffle,
      repeat: s.repeat,
      error: s.error,
      toggle: s.toggle,
      next: s.next,
      prev: s.prev,
      retry: s.retry,
      setVolume: s.setVolume,
      toggleMute: s.toggleMute,
      toggleShuffle: s.toggleShuffle,
      cycleRepeat: s.cycleRepeat,
    })),
  );
  // Jeda iklan (stores/ads.ts): seek/next/prev/acak/ulang dikunci; tombol putar menjeda iklan.
  const adBusy = useAds((s) => s.busy);
  const adBreak = useAds((s) => s.active);
  const ad = currentAd({ active: adBreak });
  const locked = adBusy || !!ad;
  const playing = ad ? !adBreak!.paused : p.playing;
  const loading = !ad && p.buffering && !p.error;
  return { p, ad, adBreak, locked, playing, loading, lockTitle: (label: string) => (locked ? adLock() : label) };
}

/**
 * Slider kustom. Selama digeser nilai ditahan lokal dan baru dikirim saat dilepas (satu seek, bukan puluhan permintaan
 * range ke server stream). Area sentuh 32px; thumb selalu terlihat di layar sentuh.
 */
export function Range({
  value,
  max,
  onChange,
  className,
  label,
  valueText,
  big,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
  className?: string;
  label: string;
  valueText?: (v: number) => string;
  big?: boolean;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const dragging = useRef(false);
  const shown = drag ?? value;
  const pct = max > 0 ? Math.min(100, (shown / max) * 100) : 0;
  const dragVal = useRef<number | null>(null);
  const commit = () => {
    dragging.current = false;
    const v = dragVal.current;
    dragVal.current = null;
    setDrag(null);
    if (v != null) onChange(v);
  };
  return (
    <div className={cx('group relative flex items-center', big ? 'h-8' : 'h-8 md:h-3.5', className)}>
      <div className={cx('deck-groove w-full p-px', big ? 'h-2' : 'h-1.5')}>
        <div className={cx('h-full bg-rave-primary/80 group-hover:bg-rave-primary', drag != null && 'bg-rave-primary')} style={{ width: `${pct}%` }} />
      </div>
      <div
        className={cx('deck-thumb pointer-events-none absolute -translate-x-1/2', big ? 'h-4 w-6' : 'h-3 w-4')}
        style={{ left: `${pct}%` }}
      />
      <input
        aria-label={label}
        aria-valuetext={valueText?.(shown)}
        type="range"
        min={0}
        max={max || 1}
        step={max > 100 ? 100 : 0.01}
        value={shown}
        onPointerDown={() => (dragging.current = true)}
        onPointerUp={commit}
        onPointerCancel={commit}
        onBlur={commit}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (dragging.current) {
            dragVal.current = v;
            setDrag(v);
          }
          else onChange(v); // keyboard / teknologi bantu
        }}
        className="absolute inset-0 h-full w-full cursor-pointer touch-none opacity-0"
      />
    </div>
  );
}

/** Tombol ikon dengan area sentuh ≥44px di layar sentuh (36px di desktop). */
export function IconBtn({ className, children, ...p }: ComponentProps<'button'>) {
  return (
    <button type="button" {...p} className={cx('grid size-11 shrink-0 place-items-center rounded-full transition active:scale-90 motion-reduce:active:scale-100 md:size-9', className)}>
      {children}
    </button>
  );
}

/** Tombol putar/jeda utama (PLAY plastik mustard ala Walkman); spinner saat memuat/buffering. */
export function PlayButton({ big }: { big?: boolean }) {
  const { p, ad, playing, loading } = usePlayerView();
  const d = useDict('common');
  const label = ad ? (playing ? d.player.pauseAd : d.player.resumeAd) : loading ? d.player.loading : playing ? d.player.pause : d.player.play;
  return (
    <button type="button" onClick={p.toggle} aria-label={label} aria-busy={loading} className={cx('deck-key deck-key--play', big ? 'deck-key--lg' : 'min-w-[52px]')}>
      {loading ? <Spinner className={big ? 'size-7' : 'size-5'} /> : playing ? <Pause className={cx('fill-current', big ? 'size-7' : 'size-4')} /> : <Play className={cx('ml-0.5 fill-current', big ? 'size-7' : 'size-4')} />}
    </button>
  );
}

/**
 * Tombol "piano key" tape deck: aluminium sikat dengan simbol terukir. `toggle` → tampil LED (menyala saat aktif,
 * ditandai aria-pressed). `locked` = kontrol dikunci saat iklan (tetap fokusable, tidak bereaksi).
 */
export function DeckKey({ toggle, active, locked, size = 'md', className, children, ...p }: ComponentProps<'button'> & { toggle?: boolean; active?: boolean; locked?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      type="button"
      {...p}
      aria-pressed={toggle ? !!active : undefined}
      aria-disabled={locked || undefined}
      className={cx('deck-key', size === 'sm' && 'deck-key--sm', size === 'lg' && 'deck-key--lg', className)}
    >
      {children}
      {toggle && <span className="deck-led" aria-hidden />}
    </button>
  );
}

/** Baris progres: satu-satunya bagian yang berlangganan positionMs (~4×/dtk), sisa bilah tidak ikut render. */
export function Progress({ locked, big }: { locked: boolean; big?: boolean }) {
  const positionMs = usePlayer((s) => s.positionMs);
  const durationMs = usePlayer((s) => s.durationMs);
  const seek = usePlayer((s) => s.seek);
  const d = useDict('common');
  return (
    <div className="flex w-full items-center gap-2 text-[11px] text-rave-muted tabular-nums" title={locked ? d.player.adLock : undefined}>
      <span className="w-10 text-right">{fmt.duration(positionMs)}</span>
      <Range label={d.player.position} value={positionMs} max={durationMs} onChange={seek} big={big} valueText={(v) => d.player.positionOf(fmt.duration(v), fmt.duration(durationMs))} className={cx('flex-1', locked && 'pointer-events-none opacity-50')} />
      <span className="w-10">{fmt.duration(durationMs)}</span>
    </div>
  );
}

/** Progres iklan (tanpa seek) — pengganti <Progress/> selama jeda iklan. */
export function AdProgress({ elapsedMs, durationS, gradient }: { elapsedMs: number; durationS: number; gradient: string }) {
  const d = useDict('common');
  return (
    <div className="flex w-full items-center gap-2 text-[11px] text-rave-muted tabular-nums" title={d.player.adLock}>
      <span className="w-10 text-right">{fmt.duration(elapsedMs)}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/30" role="progressbar" aria-label={d.ads.progress} aria-valuemin={0} aria-valuemax={durationS} aria-valuenow={Math.round(elapsedMs / 1000)}>
        <div className={cx('h-1 rounded-full', gradient)} style={{ width: `${Math.min(100, (elapsedMs / (durationS * 1000)) * 100)}%` }} />
      </div>
      <span className="w-10">{fmt.duration(durationS * 1000)}</span>
    </div>
  );
}

/** Pesan galat pemutaran + tombol "Coba lagi" bila stream gagal. */
export function PlayerError({ className }: { className?: string }) {
  const { p } = usePlayerView();
  const d = useDict('common');
  if (!p.error) return null;
  return (
    <p role="status" className={cx('flex items-center gap-2 text-[11px] text-amber-400', className)}>
      <span className="min-w-0 truncate">{p.error}</span>
      {p.error === d.player.errors.streamUnavailable && (
        <button type="button" onClick={p.retry} className="shrink-0 rounded-none border border-amber-400/60 px-2 py-0.5 font-bold hover:bg-amber-400/10">
          {d.player.retry}
        </button>
      )}
    </p>
  );
}

/**
 * `batched`: status suka sudah diisi ke cache oleh pemanggil (TrackTable: satu permintaan untuk semua baris),
 * jadi tombol ini tidak mengambil sendiri — hanya membaca cache ['likes-contains', id].
 */
export function LikeButton({ trackId, className, batched }: { trackId: string; className?: string; batched?: boolean }) {
  const token = useAuth((s) => s.accessToken);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['likes-contains', trackId],
    queryFn: () => api<{ ids: string[] }>('/v1/library/likes/contains', { query: { ids: trackId } }),
    enabled: !!token && !batched,
  });
  const liked = !!data?.ids.includes(trackId);
  const d = useDict('common');
  async function toggle() {
    if (!token) return toast.info(d.player.signInToSave);
    qc.setQueryData(['likes-contains', trackId], { ids: liked ? [] : [trackId] });
    try {
      await api(`/v1/library/likes/${trackId}`, { method: liked ? 'DELETE' : 'PUT' });
      qc.invalidateQueries({ queryKey: ['likes'] });
      qc.invalidateQueries({ queryKey: ['library-summary'] });
      if (!liked) toast.success(d.player.addedToLiked);
    } catch (e) {
      qc.setQueryData(['likes-contains', trackId], { ids: liked ? [trackId] : [] });
      toast.error(e);
    }
  }
  return (
    // padding+margin negatif: area sentuh 44px (36px di desktop) tanpa menggeser tata letak.
    <button onClick={toggle} aria-label={liked ? d.player.removeLiked : d.player.saveLiked} aria-pressed={liked} className={cx('-m-3 grid place-items-center rounded-none p-3 transition md:-m-2 md:p-2 hover:scale-110 active:scale-90', liked ? 'text-rave-primary-text' : 'text-rave-muted hover:text-white', className)}>
      <Heart className={cx('size-5', liked && 'fill-current')} />
    </button>
  );
}

/** Spektrum dekoratif LCD: bergerak hanya saat memutar (dimatikan bila prefers-reduced-motion). */
const BARS = [0.62, 0.9, 0.48, 0.78, 0.35, 0.95, 0.55, 0.7, 0.42, 0.85, 0.5, 0.66];
export function Spectrum({ on }: { on: boolean }) {
  return (
    <span className="deck-spectrum" data-on={on} aria-hidden>
      {BARS.map((d, i) => (
        <span key={i} style={{ animationDuration: `${0.45 + d * 0.6}s`, animationDelay: `${-i * 0.13}s` }} />
      ))}
    </span>
  );
}

/** Layar LCD pemutar: waktu berjalan (atau sisa iklan), kualitas audio, status, dan spektrum. */
export function PlayerLcd({ className }: { className?: string }) {
  const { ad, adBreak, playing, loading, p } = usePlayerView();
  const positionMs = usePlayer((s) => s.positionMs);
  const quality = usePlayer((s) => s.session?.codec_label);
  const d = useDict('common');
  const ms = ad ? adBreak!.elapsedMs : positionMs;
  const status = ad ? d.player.lcdAd : loading ? 'BUFFER' : playing ? 'PLAY' : p.current ? 'PAUSE' : 'STOP';
  return (
    <div className={cx('deck-lcd', className)} role="timer" aria-label={d.player.playTime(fmt.duration(ms))}>
      <span className="deck-lcd__meta w-11">
        <span>{status}</span>
        <span className={quality ? undefined : 'deck-lcd__dim'}>{quality ?? '----'}</span>
      </span>
      <span className={cx('deck-lcd__time', !p.current && !ad && 'deck-lcd__dim')}>{fmt.duration(ms)}</span>
      <Spectrum on={playing && !loading} />
    </div>
  );
}
