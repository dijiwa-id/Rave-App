import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Clock3, Music2, Pause, Play } from 'lucide-react';
import { fmt } from '@/lib/api';
import type { MediaItem, Track } from '@/lib/types';
import { cx, Skeleton } from '@/components/ui';
import { LikeButton } from '@/layouts/PlayerBar';
import { trackToPlayable, usePlayer, type Playable } from '@/stores/player';

/** Warna gradien header deterministik dari string (pengganti ekstraksi warna dominan artwork). */
const PALETTE = ['#1e3264', '#8d67ab', '#e8115b', '#148a08', '#bc5900', '#509bf5', '#27856a', '#af2896', '#503750', '#ba5d07', '#477d95', '#e13300'];
export function colorFor(key: string | undefined | null): string {
  let h = 0;
  for (const c of key ?? 'gema') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function PlayFab({ onClick, playing, size = 'md', className, label = 'Putar' }: { onClick: (e: React.MouseEvent) => void; playing?: boolean; size?: 'md' | 'lg'; className?: string; label?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={playing ? 'Jeda' : label}
      className={cx(
        'grid place-items-center rounded-full bg-gema-green text-black shadow-[0_8px_8px_rgba(0,0,0,0.3)] transition hover:scale-105 hover:bg-[#3be477]',
        size === 'lg' ? 'size-14' : 'size-12',
        className,
      )}
    >
      {playing ? <Pause className="size-6 fill-current" /> : <Play className="ml-0.5 size-6 fill-current" />}
    </button>
  );
}

/** Kartu media ala mockup (gambar persegi, judul tebal, deskripsi 2 baris, tombol play hijau saat hover). */
export function MediaCard({ title, subtitle, image, href, round, onPlay }: { title: string; subtitle?: string; image?: string | null; href: string; round?: boolean; onPlay?: () => void }) {
  const nav = useNavigate();
  return (
    <div className="media-card group cursor-pointer" onClick={() => nav(href)}>
      <div className="relative mb-4">
        {image ? (
          <img src={image} alt="" loading="lazy" className={cx('aspect-square w-full object-cover shadow-[var(--shadow-card)]', round ? 'rounded-full' : 'rounded-md')} />
        ) : (
          <div className={cx('grid aspect-square w-full place-items-center bg-gema-highlight', round ? 'rounded-full' : 'rounded-md')}>
            <Music2 className="size-12 text-gema-subtle" />
          </div>
        )}
        {onPlay && (
          <PlayFab
            className="absolute right-2 bottom-2 translate-y-2 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 focus:translate-y-0 focus:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
          />
        )}
      </div>
      <Link to={href} onClick={(e) => e.stopPropagation()} className="block truncate font-bold text-white">
        {title}
      </Link>
      {subtitle && <p className="mt-1 line-clamp-2 text-sm text-gema-muted">{subtitle}</p>}
    </div>
  );
}

export function MediaItemCard({ item, onPlay }: { item: MediaItem; onPlay?: () => void }) {
  return <MediaCard title={item.title} subtitle={item.subtitle} image={item.image_url} href={item.href} round={item.kind === 'artist'} onPlay={onPlay} />;
}

export function Shelf({ title, href, children, loading }: { title: string; href?: string; children: ReactNode; loading?: boolean }) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-end justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-white hover:underline">{href ? <Link to={href}>{title}</Link> : title}</h2>
        {href && (
          <Link to={href} className="text-sm font-bold text-gema-muted hover:underline">
            Lihat semua
          </Link>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {loading ? Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} />) : children}
      </div>
    </section>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-lg bg-gema-elevated p-4">
      <Skeleton className="mb-4 aspect-square w-full" />
      <Skeleton className="mb-2 h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

/** Header halaman (gradien dari warna kunci + gambar + judul besar), mockup Spotify 9. */
export function HeroHeader({ color, image, kicker, title, meta, round }: { color: string; image?: string | null; kicker?: string; title: string; meta?: ReactNode; round?: boolean }) {
  const big = title.length < 18 ? 'text-5xl md:text-7xl lg:text-8xl' : title.length < 32 ? 'text-4xl md:text-6xl' : 'text-3xl md:text-5xl';
  return (
    <header className="relative px-4 pt-24 pb-6 md:px-8" style={{ background: `linear-gradient(${color}, ${color}99 60%, transparent)` }}>
      <div className="flex flex-col items-start gap-6 md:flex-row md:items-end">
        {image !== undefined &&
          (image ? (
            <img src={image} alt="" className={cx('size-44 shrink-0 object-cover shadow-[0_4px_60px_rgba(0,0,0,0.5)] md:size-56', round ? 'rounded-full' : 'rounded')} />
          ) : (
            <div className="grid size-44 shrink-0 place-items-center rounded bg-gema-highlight shadow-2xl md:size-56">
              <Music2 className="size-16 text-gema-subtle" />
            </div>
          ))}
        <div className="min-w-0">
          {kicker && <p className="text-sm font-bold">{kicker}</p>}
          <h1 className={cx('my-2 font-black tracking-tighter break-words text-white', big)}>{title}</h1>
          {meta && <div className="flex flex-wrap items-center gap-1 text-sm text-white/90">{meta}</div>}
        </div>
      </div>
    </header>
  );
}

export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-6 bg-gradient-to-b from-black/30 to-transparent px-4 py-6 md:px-8">{children}</div>;
}

/** Tabel lagu (#, judul+artis, album, durasi) dengan baris aktif hijau. */
export function TrackTable({ tracks, showAlbum = true, showCover = true, onRemove, numbered = true }: { tracks: Track[]; showAlbum?: boolean; showCover?: boolean; onRemove?: (index: number) => void; numbered?: boolean }) {
  const { current, playing, playQueue, toggle } = usePlayer();
  const queue: Playable[] = tracks.map(trackToPlayable);
  return (
    <div className="px-4 md:px-8" role="table" aria-label="Daftar lagu">
      <div role="row" className="mb-2 grid grid-cols-[24px_1fr_40px] items-center gap-4 border-b border-white/10 px-4 pb-2 text-xs tracking-widest text-gema-muted uppercase md:grid-cols-[24px_4fr_3fr_80px]">
        <span>#</span>
        <span>Judul</span>
        <span className="hidden md:block">{showAlbum ? 'Album' : ''}</span>
        <Clock3 className="size-4 justify-self-end" aria-label="Durasi" />
      </div>
      {tracks.map((t, i) => {
        const active = current?.id === t.id;
        return (
          <div
            role="row"
            key={`${t.id}-${i}`}
            onDoubleClick={() => playQueue(queue, i)}
            className="group grid grid-cols-[24px_1fr_40px] items-center gap-4 rounded-md px-4 py-2 text-sm text-gema-muted hover:bg-white/10 md:grid-cols-[24px_4fr_3fr_80px]"
          >
            <button onClick={() => (active ? toggle() : playQueue(queue, i))} aria-label={`Putar ${t.title}`} className="w-6 text-right">
              <span className={cx('group-hover:hidden', active && 'text-gema-green')}>{active && playing ? '♪' : numbered ? i + 1 : '•'}</span>
              <Play className="hidden size-4 fill-white text-white group-hover:inline" />
            </button>
            <div className="flex min-w-0 items-center gap-3">
              {showCover && (t.release.cover_url ? <img src={t.release.cover_url} alt="" className="size-10 rounded" /> : <div className="size-10 rounded bg-gema-highlight" />)}
              <div className="min-w-0">
                <Link to={`/app/track/${t.id}`} className={cx('block truncate text-base hover:underline', active ? 'text-gema-green' : 'text-white')}>
                  {t.title}
                </Link>
                <p className="truncate">
                  {t.explicit && <span className="mr-1.5 rounded-sm bg-gema-muted px-1 text-[10px] font-bold text-black">E</span>}
                  <Link to={`/app/artist/${t.artist.slug}`} className="hover:text-white hover:underline">
                    {t.artist.name}
                  </Link>
                </p>
              </div>
            </div>
            <Link to={`/app/album/${t.release.id}`} className="hidden truncate hover:text-white hover:underline md:block">
              {showAlbum ? t.release.title : ''}
            </Link>
            <div className="flex items-center justify-end gap-3">
              <span className="hidden opacity-0 group-hover:opacity-100 sm:inline">
                <LikeButton trackId={t.id} />
              </span>
              <span className="tabular-nums">{fmt.duration(t.duration_ms)}</span>
              {onRemove && (
                <button onClick={() => onRemove(i)} className="hidden text-xs font-bold group-hover:inline hover:text-white" aria-label={`Hapus ${t.title}`}>
                  ✕
                </button>
              )}
            </div>
          </div>
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
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 18) return 'Selamat sore';
  return 'Selamat malam';
}

export function DarkError({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="m-8 rounded-lg bg-white/5 p-6 text-sm">
      <p className="font-bold">Gagal memuat konten</p>
      <p className="mt-1 text-gema-muted">{(error as any)?.message ?? 'Layanan sedang tidak tersedia.'}</p>
      {retry && (
        <button onClick={retry} className="mt-3 rounded-full border border-white/40 px-4 py-1.5 text-xs font-bold hover:border-white">
          Coba lagi
        </button>
      )}
    </div>
  );
}
