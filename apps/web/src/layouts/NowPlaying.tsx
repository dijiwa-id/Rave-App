import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, ListMusic, Mic2, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import { BRAND_GRADIENT } from '@/components/ads/AdCard';
import { cx } from '@/components/ui';
import { useDict } from '@/lib/i18n';
import { usePlayer } from '@/stores/player';
import { AdProgress, DeckKey, IconBtn, LikeButton, PlayButton, PlayerError, PlayerLcd, Progress, Range, usePlayerView, VOLUME_CONTROLLABLE } from './playerParts';

/**
 * Tampilan penuh "Sedang Diputar" untuk ponsel/tablet kecil (< md): sampul besar, seek yang nyaman disentuh,
 * semua kontrol (acak, ulang, volume, kualitas) plus jalan pintas ke Lirik & Antrean yang tak muat di mini-player.
 */
export function NowPlayingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { p, ad, adBreak, locked, lockTitle } = usePlayerView();
  const quality = usePlayer((s) => s.session?.codec_label);
  const loc = useLocation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const d = useDict('common');

  // Pindah halaman (Lirik/Antrean/tautan artis) → tutup sheet.
  useEffect(() => {
    if (open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);

  // Escape menutup; fokus dipindah ke tombol tutup; kanvas di belakang tidak ikut ter-scroll.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  const VolIcon = p.muted || p.volume === 0 ? VolumeX : p.volume < 0.5 ? Volume1 : Volume2;
  const RepeatIcon = p.repeat === 'one' ? Repeat1 : Repeat;
  const title = ad ? ad.title : p.current?.title;
  const subtitle = ad ? ad.advertiser : p.current?.subtitle;
  const image = ad ? ad.image_url : p.current?.image_url;

  return (
    <div role="dialog" aria-modal="true" aria-label={d.player.nowPlaying} className="rave-sheet fixed inset-0 z-40 flex flex-col overflow-y-auto bg-gradient-to-b from-rave-highlight via-rave-elevated to-black pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="flex items-center justify-between px-3 py-2">
        <IconBtn ref={closeRef} onClick={onClose} aria-label={d.player.minimize} className="text-white hover:bg-white/10">
          <ChevronDown className="size-7" />
        </IconBtn>
        <p className="text-xs font-bold tracking-wider text-rave-muted uppercase">{ad ? d.player.ad : d.player.nowPlaying}</p>
        <span className="size-11" aria-hidden />
      </div>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-5 px-6 pb-6">
        <div className="mx-auto aspect-square w-full max-w-[min(100%,48dvh)] overflow-hidden rounded-none bg-rave-highlight shadow-card">
          {image ? <img src={image} alt="" className="size-full object-cover" /> : <div className={cx('size-full', ad && !ad.theme_color ? BRAND_GRADIENT : 'bg-rave-highlight')} style={ad?.theme_color ? { background: ad.theme_color } : undefined} />}
        </div>

        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold text-white">{title ?? d.player.pickSong}</p>
            {!ad && p.current?.subtitleHref ? (
              <Link to={p.current.subtitleHref} className="block truncate text-sm text-rave-muted hover:text-white hover:underline">
                {subtitle}
              </Link>
            ) : (
              <p className="truncate text-sm text-rave-muted">{subtitle}</p>
            )}
          </div>
          {!ad && p.current?.kind === 'track' && <LikeButton trackId={p.current.id} className="[&>svg]:size-6" />}
        </div>

        <PlayerLcd className="justify-between" />

        <div>
          {ad ? <AdProgress elapsedMs={adBreak!.elapsedMs} durationS={ad.duration_s} gradient={BRAND_GRADIENT} /> : <Progress locked={locked} big />}
          <PlayerError className="mt-1 justify-center" />
        </div>

        <div className="flex justify-center">
          <div className="deck-tray gap-2 p-2">
            <DeckKey toggle active={p.shuffle} locked={locked} onClick={p.toggleShuffle} title={lockTitle(d.player.shuffle)} aria-label={d.player.shuffle}>
              <Shuffle className="size-4" />
            </DeckKey>
            <DeckKey size="lg" locked={locked} onClick={p.prev} title={lockTitle(d.player.prev)} aria-label={d.player.prev}>
              <SkipBack className="size-6 fill-current" />
            </DeckKey>
            <PlayButton big />
            <DeckKey size="lg" locked={locked} onClick={p.next} title={lockTitle(d.player.next)} aria-label={d.player.next}>
              <SkipForward className="size-6 fill-current" />
            </DeckKey>
            <DeckKey toggle active={p.repeat !== 'off'} locked={locked} onClick={p.cycleRepeat} title={lockTitle(d.player.repeat)} aria-label={p.repeat === 'one' ? d.player.repeatOne : p.repeat === 'all' ? d.player.repeatAll : d.player.repeat}>
              <RepeatIcon className="size-4" />
            </DeckKey>
          </div>
        </div>

        {VOLUME_CONTROLLABLE && (
          <div className="flex items-center gap-2">
            <IconBtn onClick={p.toggleMute} aria-label={p.muted ? d.player.unmute : d.player.mute} aria-pressed={p.muted} className="text-rave-muted">
              <VolIcon className="size-5" />
            </IconBtn>
            <Range label={d.player.volume} value={p.muted ? 0 : p.volume} max={1} onChange={p.setVolume} valueText={(v) => `${Math.round(v * 100)}%`} className="flex-1" />
          </div>
        )}

        <div className="flex items-center justify-center gap-3 text-sm font-bold">
          <Link to="/app/lyrics" className="flex min-h-11 items-center gap-2 rounded-none bg-white/10 px-5 text-white hover:bg-white/20">
            <Mic2 className="size-4" /> {d.player.lyrics}
          </Link>
          <Link to="/app/queue" className="flex min-h-11 items-center gap-2 rounded-none bg-white/10 px-5 text-white hover:bg-white/20">
            <ListMusic className="size-4" /> {d.player.queue}
          </Link>
          {quality && !ad && (
            <span title={d.player.quality} className="rounded-none border border-rave-primary/50 px-1.5 py-0.5 text-[10px] font-bold text-rave-primary-text">
              {quality}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
