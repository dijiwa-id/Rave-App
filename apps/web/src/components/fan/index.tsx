import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, Music2, Pause, Play } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import { dict, useDict } from '@/lib/i18n';
import { useAuth } from '@/stores/auth';
import type { MediaItem, Track } from '@/lib/types';
import { cx, Skeleton, Spinner } from '@/components/ui';
import { LikeButton } from '@/layouts/PlayerBar';
import { AddToPlaylist } from './AddToPlaylist';
import { useMediaPlaying } from './usePlayMedia';
import { trackToPlayable, usePlayer, type Playable } from '@/stores/player';

/** Warna gradien header deterministik dari string (pengganti ekstraksi warna dominan artwork). */
const PALETTE = ['#5B2A6E', '#8A2F3F', '#1F5C52', '#B8901A', '#2A1233', '#7A3E91', '#6B2431', '#24463F', '#4A1F5C', '#9A6B12', '#3B2F45', '#5E3A1E'];
export function colorFor(key: string | undefined | null): string {
  let h = 0;
  for (const c of key ?? 'rave') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/**
 * SATU tombol putar/jeda untuk seluruh aplikasi player: kotak mustard bertepi ink + bayangan sablon.
 *  - `playKey` (disarankan): tombol tahu sendiri apakah itemnya sedang diputar → ikon Jeda, dan klik saat aktif
 *    menjeda/melanjutkan (tidak mengulang). Kunci: `release:` · `playlist:` · `artist:` · `liked` · `track:`/`episode:`.
 *  - tanpa `playKey`: pemanggil mengatur `playing` & aksinya sendiri.
 * Ukuran: xs 32px (baris) · sm 40px (kartu ringkas) · md 48px (kartu) · lg 56px (header halaman).
 */
export function PlayFab({ onClick, playing: playingProp, playKey, size = 'md', className, label }: { onClick: (e: React.MouseEvent) => void; playing?: boolean; playKey?: string; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string; label?: string }) {
  const d = useDict('common');
  const ctx = useMediaPlaying(playKey);
  const playing = playKey ? ctx.playing : !!playingProp;
  const loading = usePlayer((s) => !!playKey && ctx.active && s.buffering && !s.error);
  const icon = size === 'xs' ? 'size-4' : size === 'sm' ? 'size-5' : 'size-6';
  return (
    <button
      type="button"
      onClick={(e) => {
        if (playKey && ctx.active) {
          e.stopPropagation();
          usePlayer.getState().toggle();
        } else onClick(e);
      }}
      aria-label={playing ? d.fan.pause : (label ?? d.fan.play)}
      aria-pressed={playKey ? playing : undefined}
      className={cx(
        'play-fab grid shrink-0 place-items-center rounded-none border-2 border-rave-ink bg-rave-primary text-rave-on-primary transition hover:bg-rave-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rave-paper',
        size === 'xs' ? 'size-8 shadow-[2px_2px_0_#0b0a0c]' : size === 'sm' ? 'size-10 shadow-[3px_3px_0_#0b0a0c]' : size === 'lg' ? 'size-14 shadow-[3px_3px_0_#0b0a0c]' : 'size-12 shadow-[3px_3px_0_#0b0a0c]',
        className,
      )}
    >
      <span key={loading ? 'load' : playing ? 'pause' : 'play'} className="grid animate-[rave-pop_0.22s_ease-out]">
        {loading ? <Spinner className={icon} /> : playing ? <Pause className={cx(icon, 'fill-current')} /> : <Play className={cx(icon, 'ml-0.5 fill-current')} />}
      </span>
    </button>
  );
}

/**
 * Kartu media RAVE. Semua gambar persegi (konsisten), tombol putar kotak mustard yang berubah menjadi Jeda saat
 * item ini yang sedang diputar (`playKey`: `release:<id>` · `playlist:<id>` · `artist:<id>` · `track:<id>`).
 * Klik tombol saat aktif = jeda/lanjut, bukan mengulang dari awal.
 * `variant="artist"`: kartu poster gig — foto duotone + halftone (berwarna saat hover/diputar), nama besar di atas foto,
 * sudut kanan atas terpotong & bilah mustard di sisi kiri; berbeda jelas dari kartu lagu/album.
 */
export function MediaCard({
  title,
  subtitle,
  image,
  href,
  round,
  variant,
  playKey,
  onPlay,
}: {
  title: string;
  subtitle?: string;
  image?: string | null;
  href: string;
  /** @deprecated foto artis kini persegi — setara `variant="artist"`. */
  round?: boolean;
  variant?: 'media' | 'artist';
  playKey?: string;
  onPlay?: () => void;
}) {
  const nav = useNavigate();
  const d = useDict('common');
  const { active, playing } = useMediaPlaying(playKey);
  const artist = variant === 'artist' || round;
  const fab = onPlay && (
    <PlayFab
      label={`${d.fan.play} ${title}`}
      className={cx(
        'absolute right-2 bottom-2 transition-all duration-300',
        active ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 focus:translate-y-0 focus:opacity-100',
      )}
      playKey={playKey}
      onClick={(e) => {
        e.stopPropagation();
        onPlay();
      }}
    />
  );

  if (artist)
    return (
      <div className={cx('artist-card group cursor-pointer', active && 'artist-card--active')} onClick={() => nav(href)}>
        <div className="artist-card__shadow">
        <div className="artist-card__frame relative">
          {image ? (
            <img src={image} alt="" loading="lazy" decoding="async" className="artist-card__photo aspect-square w-full object-cover" />
          ) : (
            <div className="grid aspect-square w-full place-items-center bg-gradient-to-br from-rave-purple to-rave-plum">
              <span className="font-display text-7xl leading-none text-rave-primary/90">{title.slice(0, 1)}</span>
            </div>
          )}
          <span className="artist-card__halftone" aria-hidden />
          <div className="absolute inset-x-0 bottom-0 flex items-end gap-2 p-3 pr-16">
            <Link to={href} onClick={(e) => e.stopPropagation()} className="artist-card__name line-clamp-2 font-display text-[26px] leading-[0.92] tracking-wide text-rave-paper uppercase">
              {title}
            </Link>
          </div>
          {active && (
            <span className="absolute top-2.5 left-3 flex items-center gap-1.5 font-label text-[10px] font-bold tracking-[0.14em] text-rave-primary uppercase">
              <EqMini on={playing} /> {playing ? d.fan.nowOnAir : d.fan.paused}
            </span>
          )}
          {fab}
        </div>
        </div>
        {subtitle && <p className="mt-2.5 truncate pl-3 font-label text-[11px] tracking-[0.08em] text-rave-muted uppercase">{subtitle}</p>}
      </div>
    );

  return (
    <div className={cx('media-card group cursor-pointer', active && 'media-card--active')} onClick={() => nav(href)}>
      <div className="relative mb-4">
        {image ? (
          <img src={image} alt="" loading="lazy" decoding="async" className="aspect-square w-full rounded-none border-2 border-rave-ink object-cover" />
        ) : (
          <div className="grid aspect-square w-full place-items-center rounded-none bg-rave-highlight">
            <Music2 className="size-12 text-rave-subtle" />
          </div>
        )}
        {fab}
      </div>
      <Link to={href} onClick={(e) => e.stopPropagation()} className={cx('block truncate font-bold', active ? 'text-rave-primary-text' : 'text-white')}>
        {title}
      </Link>
      {subtitle && <p className="mt-1 line-clamp-2 text-sm text-rave-muted">{subtitle}</p>}
    </div>
  );
}

function EqMini({ on }: { on: boolean }) {
  return (
    <span className="shell-eq" data-on={on} aria-hidden>
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

export function MediaItemCard({ item, onPlay }: { item: MediaItem; onPlay?: () => void }) {
  return <MediaCard title={item.title} subtitle={item.subtitle} image={item.image_url} href={item.href} variant={item.kind === 'artist' ? 'artist' : 'media'} playKey={`${item.kind}:${item.id}`} onPlay={onPlay} />;
}

/**
 * Rak kartu = slider horizontal (mengikuti referensi): 4 kartu terlihat penuh di desktop (2,2 di ponsel, 3 di tablet),
 * tepi kiri/kanan memudar (gradien) saat masih ada kartu di baliknya, tombol ‹ › kotak di header, scroll-snap per kartu.
 */
export function Shelf({ title, href, children, loading }: { title: string; href?: string; children: ReactNode; loading?: boolean }) {
  const d = useDict('common');
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    measure();
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, children, loading]);
  const page = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.98, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 className="min-w-0 truncate text-[1.75rem] leading-none text-white md:text-3xl">{href ? <Link to={href} className="hover:text-rave-primary-text">{title}</Link> : title}</h2>
        <div className="flex shrink-0 items-center gap-3">
          {href && (
            <Link to={href} className="rave-label text-rave-muted transition hover:text-rave-primary-text">
              {d.fan.seeAll}
            </Link>
          )}
          {!(edge.start && edge.end) && (
            <div className="hidden gap-1.5 md:flex">
              <button type="button" onClick={() => page(-1)} disabled={edge.start} aria-label={d.layout.back} className="shelf-nav">
                <ChevronLeft className="size-4" />
              </button>
              <button type="button" onClick={() => page(1)} disabled={edge.end} aria-label={d.layout.forward} className="shelf-nav">
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="shelf" data-start={edge.start} data-end={edge.end}>
        <div ref={track} onScroll={measure} className="shelf__track">
          {loading ? Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} />) : children}
        </div>
      </div>
    </section>
  );
}

/**
 * Choice chips RAVE (filter tunggal): kotak bertepi tipis; terpilih = mustard bertepi ink + bayangan sablon.
 * Bergulir horizontal di layar sempit; panah kiri/kanan berpindah pilihan (pola radiogroup).
 */
export function ChoiceChips<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: any; dot?: boolean }[]; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const i = options.findIndex((o) => o.value === value);
        const n = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
        onChange(n.value);
        requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
      }}
      className={cx('-mx-1 flex gap-2 overflow-x-auto px-1 pt-0.5 pb-2 [scrollbar-width:none]', className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cx('choice-chip', on && 'choice-chip--on')}
          >
            {o.icon && <o.icon className="size-4 shrink-0" />}
            {o.label}
            {o.dot && <span className="size-1.5 animate-pulse rounded-full bg-red-500 motion-reduce:animate-none" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-none bg-rave-elevated p-4">
      <Skeleton className="mb-4 aspect-square w-full" />
      <Skeleton className="mb-2 h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

/** Header halaman: cahaya warna kunci yang transparan (tekstur kanvas tetap terlihat) + sampul + judul besar. */
export function HeroHeader({ color, image, kicker, title, meta, round }: { color: string; image?: string | null; kicker?: string; title: string; meta?: ReactNode; round?: boolean }) {
  const big = title.length < 18 ? 'text-5xl md:text-7xl lg:text-8xl' : title.length < 32 ? 'text-4xl md:text-6xl' : 'text-3xl md:text-5xl';
  return (
    <header className="relative px-4 pt-24 pb-6 md:px-8" style={{ background: glow(color) }}>
      <div className="flex flex-col items-start gap-6 md:flex-row md:items-end">
        {image !== undefined &&
          (image ? (
            <img src={image} alt="" className={cx('size-44 shrink-0 object-cover shadow-[6px_6px_0_#0b0a0c] md:size-56', 'rounded-none border-2 border-rave-ink')} />
          ) : (
            <div className="grid size-44 shrink-0 place-items-center rounded-none bg-rave-highlight shadow-2xl md:size-56">
              <Music2 className="size-16 text-rave-subtle" />
            </div>
          ))}
        <div className="min-w-0">
          {kicker && <p className="rave-label text-rave-primary-text">{kicker}</p>}
          <h1 className={cx('my-3 leading-[0.9] break-words text-white', big)}>{title}</h1>
          {meta && <div className="flex flex-wrap items-center gap-1 text-sm text-white/90">{meta}</div>}
        </div>
      </div>
    </header>
  );
}

export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-6 px-4 py-6 md:px-8">{children}</div>;
}

/** Cahaya warna kunci halaman yang transparan & lembut — dipakai semua header app agar seragam di atas kanvas. */
export function glow(color: string, strength = '66') {
  return `radial-gradient(70rem 26rem at 18% -10%, ${color}${strength}, transparent 70%)`;
}

/** Batas `ids` per permintaan /v1/library/likes/contains (dipotong server di 200). */
const LIKES_BATCH_MAX = 200;

/**
 * Satu permintaan status suka untuk semua baris, lalu isi cache per-id ['likes-contains', id] yang dibaca
 * LikeButton `batched`. Entri per-id yang lebih baru (toggle optimistis) tidak ditimpa data batch lama.
 */
function useBatchedLikes(ids: string[]) {
  const token = useAuth((s) => s.accessToken);
  const qc = useQueryClient();
  const key = useMemo(() => [...new Set(ids)].slice(0, LIKES_BATCH_MAX), [ids]);
  const { data, dataUpdatedAt } = useQuery({
    queryKey: ['likes-contains-batch', key],
    queryFn: () => api<{ ids: string[] }>('/v1/library/likes/contains', { query: { ids: key.join(',') } }),
    enabled: !!token && key.length > 0,
  });
  useEffect(() => {
    if (!data) return;
    const liked = new Set(data.ids);
    for (const id of key) {
      const st = qc.getQueryState(['likes-contains', id]);
      if (st && st.dataUpdatedAt > dataUpdatedAt) continue;
      qc.setQueryData(['likes-contains', id], { ids: liked.has(id) ? [id] : [] }, { updatedAt: dataUpdatedAt });
    }
  }, [data, dataUpdatedAt, key, qc]);
  return useMemo(() => new Set(key), [key]);
}

type RowProps = {
  t: Track;
  i: number;
  active: boolean;
  playing: boolean;
  showAlbum: boolean;
  showCover: boolean;
  numbered: boolean;
  batched: boolean;
  onPlay: (i: number) => void;
  onToggle: () => void;
  onRemove?: (index: number) => void;
  onMove?: (index: number, dir: -1 | 1) => void;
  count: number;
  playlistId?: string;
};

// memo: baris hanya render ulang bila status aktif/putar berubah, bukan setiap perubahan store pemutar.
const TrackRow = memo(function TrackRow({ t, i, active, playing, showAlbum, showCover, numbered, batched, onPlay, onToggle, onRemove, onMove, count, playlistId }: RowProps) {
  const d = useDict('common');
  return (
    <div
      role="row"
      onDoubleClick={() => onPlay(i)}
      className="group grid grid-cols-[24px_minmax(0,1fr)_84px] items-center gap-4 rounded-none px-4 py-2 text-sm text-rave-muted hover:bg-white/10 @[640px]:grid-cols-[24px_minmax(0,4fr)_minmax(0,3fr)_150px]"
    >
      <button onClick={() => (active ? onToggle() : onPlay(i))} aria-label={active && playing ? d.fan.pause : d.fan.playTrack(t.title)} aria-pressed={active ? playing : undefined} className="grid h-6 w-6 place-items-end">
        <span className={cx('group-hover:hidden group-focus-within:hidden', active && 'text-rave-primary-text')}>
          {active && playing ? <EqMini on /> : numbered ? i + 1 : '•'}
        </span>
        <span className={cx('hidden size-6 place-items-center border-2 border-rave-ink bg-rave-primary text-rave-on-primary shadow-[2px_2px_0_#0b0a0c] group-hover:grid group-focus-within:grid')}>
          {active && playing ? <Pause className="size-3 fill-current" /> : <Play className="ml-px size-3 fill-current" />}
        </span>
      </button>
      <div className="flex min-w-0 items-center gap-3">
        {showCover && (t.release.cover_url ? <img src={t.release.cover_url} alt="" loading="lazy" decoding="async" width={40} height={40} className="size-10 rounded-none" /> : <div className="size-10 rounded-none bg-rave-highlight" />)}
        <div className="min-w-0">
          <Link to={`/app/track/${t.id}`} className={cx('block truncate text-base hover:underline', active ? 'text-rave-primary-text' : 'text-white')}>
            {t.title}
          </Link>
          <p className="truncate">
            {t.explicit && <span className="mr-1.5 rounded-none bg-rave-muted px-1 text-[10px] font-bold text-black">E</span>}
            <Link to={`/app/artist/${t.artist.slug}`} className="hover:text-white hover:underline">
              {t.artist.name}
            </Link>
          </p>
        </div>
      </div>
      <Link to={`/app/album/${t.release.id}`} className="hidden truncate hover:text-white hover:underline @[640px]:block">
        {showAlbum ? t.release.title : ''}
      </Link>
      <div className="flex items-center justify-end gap-2 sm:gap-3">
        {/* Tambah ke playlist: selalu tampak di layar sentuh, muncul saat hover/fokus di desktop */}
        <AddToPlaylist trackId={t.id} trackTitle={t.title} excludePlaylistId={playlistId} className="sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 sm:aria-expanded:opacity-100" />
        <span className="hidden opacity-0 group-hover:opacity-100 sm:inline">
          <LikeButton trackId={t.id} batched={batched} />
        </span>
        <span className="tabular-nums">{fmt.duration(t.duration_ms)}</span>
        {onMove && (
          <span className="hidden items-center gap-0.5 group-focus-within:inline-flex group-hover:inline-flex">
            <button onClick={() => onMove(i, -1)} disabled={i === 0} className="hover:text-white disabled:opacity-30" aria-label={d.fan.moveUp(t.title)}>
              <ChevronUp className="size-4" />
            </button>
            <button onClick={() => onMove(i, 1)} disabled={i === count - 1} className="hover:text-white disabled:opacity-30" aria-label={d.fan.moveDown(t.title)}>
              <ChevronDown className="size-4" />
            </button>
          </span>
        )}
        {onRemove && (
          <button onClick={() => onRemove(i)} className="hidden text-xs font-bold group-hover:inline hover:text-white" aria-label={d.fan.remove(t.title)}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
});

/** Tabel lagu (#, judul+artis, album, durasi) dengan baris aktif berwarna primer. */
export function TrackTable({
  tracks,
  showAlbum = true,
  showCover = true,
  onRemove,
  onMove,
  numbered = true,
  playlistId,
  context,
}: {
  tracks: Track[];
  /** Kunci konteks antrean (mis. `release:<id>`) agar tombol putar header ikut menjadi Jeda saat diputar dari baris. */
  context?: string;
  /** Playlist yang sedang dibuka — tidak ditawarkan lagi di menu "Tambah ke playlist". */
  playlistId?: string;
  showAlbum?: boolean;
  showCover?: boolean;
  onRemove?: (index: number) => void;
  /** Urutkan ulang (playlist milik sendiri): -1 naik, 1 turun. */
  onMove?: (index: number, dir: -1 | 1) => void;
  numbered?: boolean;
}) {
  const currentId = usePlayer((s) => s.current?.id);
  const playing = usePlayer((s) => s.playing);
  const playQueue = usePlayer((s) => s.playQueue);
  const toggle = usePlayer((s) => s.toggle);
  // Kunci isi (bukan identitas array): banyak pemanggil mengirim `tracks.slice(...)` baru tiap render.
  const idsKey = tracks.map((t) => t.id).join(',');
  const queue: Playable[] = useMemo(() => tracks.map(trackToPlayable), [idsKey]);
  const ids = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey]);
  const batchedIds = useBatchedLikes(ids);
  const onPlay = useCallback((i: number) => void playQueue(queue, i, context ?? null), [playQueue, queue, context]);
  const d = useDict('common');
  return (
    <div className="@container px-4 md:px-8" role="table" aria-label={d.fan.trackList}>
      <div role="row" className="mb-2 grid grid-cols-[24px_minmax(0,1fr)_84px] items-center gap-4 border-b border-white/10 px-4 pb-2 text-xs tracking-widest text-rave-muted uppercase @[640px]:grid-cols-[24px_minmax(0,4fr)_minmax(0,3fr)_150px]">
        <span>#</span>
        <span>{d.fan.colTitle}</span>
        <span className="hidden @[640px]:block">{showAlbum ? d.fan.colAlbum : ''}</span>
        <Clock3 className="size-4 justify-self-end" aria-label={d.fan.colDuration} />
      </div>
      {tracks.map((t, i) => {
        const active = currentId === t.id;
        return (
          <TrackRow
            key={`${t.id}-${i}`}
            t={t}
            i={i}
            active={active}
            playing={active && playing}
            showAlbum={showAlbum}
            showCover={showCover}
            numbered={numbered}
            batched={batchedIds.has(t.id)}
            onPlay={onPlay}
            onToggle={toggle}
            onRemove={onRemove}
            onMove={onMove}
            count={tracks.length}
            playlistId={playlistId}
          />
        );
      })}
    </div>
  );
}

export function FanPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('px-4 pt-20 pb-12 md:px-8', className)}>{children}</div>;
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  const t = dict('common').fan;
  if (h < 11) return t.greetMorning;
  if (h < 15) return t.greetAfternoon;
  if (h < 18) return t.greetLateAfternoon;
  return t.greetEvening;
}

export function DarkError({ error, retry }: { error: unknown; retry?: () => void }) {
  const d = useDict('common');
  return (
    <div className="m-8 rounded-none bg-white/5 p-6 text-sm">
      <p className="font-bold">{d.fan.contentLoadFailed}</p>
      <p className="mt-1 text-rave-muted">{(error as any)?.message ?? d.fan.serviceUnavailable}</p>
      {retry && (
        <button onClick={retry} className="mt-3 rounded-none border border-white/40 px-4 py-1.5 text-xs font-bold hover:border-white">
          {d.ui.retry}
        </button>
      )}
    </div>
  );
}
