import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ListMusic, Mic2, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import { BRAND_GRADIENT } from '@/components/ads/AdCard';
import { cx } from '@/components/ui';
import { useDict } from '@/lib/i18n';
import { usePlayer } from '@/stores/player';
import { NowPlayingSheet } from './NowPlaying';
import { AdProgress, DeckKey, IconBtn, LikeButton, PlayButton, PlayerError, PlayerLcd, Progress, Range, usePlayerView, VOLUME_CONTROLLABLE } from './playerParts';

export { LikeButton };

function Cover({ src, color, brand, className }: { src?: string | null; color?: string | null; brand?: boolean; className: string }) {
  if (src) return <img src={src} alt="" className={cx('shrink-0 rounded-none object-cover', className)} />;
  return <div className={cx('shrink-0 rounded-none', brand ? BRAND_GRADIENT : 'bg-rave-highlight', className)} style={color ? { background: color } : undefined} />;
}

/**
 * Pemutar bawah. Dua tampilan dari satu keadaan (usePlayerView):
 *  - ≥ md: bar 3 kolom klasik (info · kontrol · lirik/antrean/volume);
 *  - < md: mini-player ringkas; ketuk untuk membuka sheet "Sedang Diputar" berisi semua kontrol.
 */
export function PlayerBar() {
  const { p, ad, adBreak, locked, lockTitle } = usePlayerView();
  const [open, setOpen] = useState(false);
  const quality = usePlayer((s) => s.session?.codec_label);
  const VolIcon = p.muted || p.volume === 0 ? VolumeX : p.volume < 0.5 ? Volume1 : Volume2;
  const RepeatIcon = p.repeat === 'one' ? Repeat1 : Repeat;
  const title = ad ? ad.title : p.current?.title;
  const d = useDict('common');

  return (
    <>
      {/* ───── Mini-player (< md) ───── */}
      <footer aria-label={d.player.player} className="relative flex shrink-0 items-center gap-1 border-t-2 border-rave-primary bg-rave-black py-1.5 pr-2 pl-3 md:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label={d.player.openFull} aria-haspopup="dialog" className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left">
          {ad ? <Cover src={ad.image_url} color={ad.theme_color} brand={!ad.theme_color} className="size-11" /> : <Cover src={p.current?.image_url} className="size-11" />}
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-medium text-white">
              {ad && <span className={cx('shrink-0 rounded-none px-1.5 py-px text-[10px] font-extrabold uppercase', ad.is_house ? `${BRAND_GRADIENT} text-white` : 'bg-white text-black')}>{ad.label}</span>}
              <span className="truncate">{title ?? d.player.pickSong}</span>
            </span>
            <span className="block truncate text-xs text-rave-muted">{p.error ?? (ad ? ad.advertiser : p.current?.subtitle)}</span>
          </span>
        </button>
        {!ad && p.current?.kind === 'track' && <LikeButton trackId={p.current.id} className="mx-1" />}
        <PlayButton />
        {/* Garis progres tipis di tepi atas (hanya tampilan; seek ada di sheet) */}
        {!ad && <MiniProgress />}
      </footer>
      <NowPlayingSheet open={open} onClose={() => setOpen(false)} />

      {/* ───── Bar desktop (≥ md) ───── */}
      <footer className="rave-grain hidden h-[90px] shrink-0 items-center justify-between gap-4 border-t-2 border-rave-primary bg-rave-black px-4 md:flex" aria-label={d.player.player}>
        {/* Kiri: info lagu (atau iklan yang sedang tayang) */}
        <div className="flex w-[30%] min-w-0 items-center gap-3">
          {ad ? (
            <>
              <Cover src={ad.image_url} color={ad.theme_color} brand={!ad.theme_color} className="size-14" />
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-white">
                  <span className={cx('shrink-0 rounded-none px-1.5 py-px text-[10px] font-extrabold uppercase', ad.is_house ? `${BRAND_GRADIENT} text-white` : 'bg-white text-black')}>{ad.label}</span>
                  <span className="truncate">{ad.title}</span>
                </p>
                <p className="truncate text-xs text-rave-muted">
                  {ad.advertiser}
                  {adBreak!.ads.length > 1 && ` · ${d.ads.adOf(adBreak!.index + 1, adBreak!.ads.length)}`}
                </p>
              </div>
            </>
          ) : p.current ? (
            <>
              <Cover src={p.current.image_url} className="size-14" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{p.current.title}</p>
                {p.current.subtitleHref ? (
                  <Link to={p.current.subtitleHref} className="block truncate text-xs text-rave-muted hover:text-white hover:underline">
                    {p.current.subtitle}
                  </Link>
                ) : (
                  <p className="truncate text-xs text-rave-muted">{p.current.subtitle}</p>
                )}
              </div>
              {p.current.kind === 'track' && <LikeButton trackId={p.current.id} className="mx-2 shrink-0" />}
            </>
          ) : (
            <p className="text-sm text-rave-subtle">{d.player.pickSong}</p>
          )}
        </div>

        {/* Tengah: kontrol */}
        <div className="flex max-w-[722px] flex-1 flex-col items-center gap-0.5">
          <div className="mb-1 flex items-center gap-2">
          <PlayerLcd className="hidden lg:flex" />
          <div className="deck-tray">
            <DeckKey size="sm" toggle active={p.shuffle} locked={locked} onClick={p.toggleShuffle} title={lockTitle(d.player.shuffle)} aria-label={d.player.shuffle}>
              <Shuffle className="size-3.5" />
            </DeckKey>
            <DeckKey locked={locked} onClick={p.prev} title={lockTitle(d.player.prevShortcut)} aria-label={d.player.prev}>
              <SkipBack className="size-4 fill-current" />
            </DeckKey>
            <PlayButton />
            <DeckKey locked={locked} onClick={p.next} title={lockTitle(d.player.nextShortcut)} aria-label={d.player.next}>
              <SkipForward className="size-4 fill-current" />
            </DeckKey>
            <DeckKey size="sm" toggle active={p.repeat !== 'off'} locked={locked} onClick={p.cycleRepeat} title={lockTitle(d.player.repeat)} aria-label={p.repeat === 'one' ? d.player.repeatOne : p.repeat === 'all' ? d.player.repeatAll : d.player.repeat}>
              <RepeatIcon className="size-3.5" />
            </DeckKey>
          </div>
          </div>
          {ad ? <AdProgress elapsedMs={adBreak!.elapsedMs} durationS={ad.duration_s} gradient={BRAND_GRADIENT} /> : <Progress locked={locked} />}
          <PlayerError />
        </div>

        {/* Kanan: kualitas, lirik, antrean, volume */}
        <div className="flex w-[30%] items-center justify-end gap-1">
          {quality && (
            <span title={d.player.quality} className="mr-2 rounded-none border border-rave-primary/50 px-1.5 py-0.5 text-[10px] font-bold text-rave-primary-text lg:hidden">
              {quality}
            </span>
          )}
          <Link to="/app/lyrics" aria-label={d.player.lyrics} title={d.player.lyrics} className="grid size-9 place-items-center rounded-full text-rave-muted hover:text-white">
            <Mic2 className="size-4" />
          </Link>
          <Link to="/app/queue" aria-label={d.player.queue} title={d.player.queue} className="grid size-9 place-items-center rounded-full text-rave-muted hover:text-white">
            <ListMusic className="size-4" />
          </Link>
          {VOLUME_CONTROLLABLE && (
            <>
              <IconBtn onClick={p.toggleMute} aria-label={p.muted ? d.player.unmute : d.player.mute} title={p.muted ? d.player.unmuteShortcut : d.player.muteShortcut} aria-pressed={p.muted} className="text-rave-muted hover:text-white">
                <VolIcon className="size-4" />
              </IconBtn>
              <Range label={d.player.volume} value={p.muted ? 0 : p.volume} max={1} onChange={p.setVolume} valueText={(v) => `${Math.round(v * 100)}%`} className="w-24 shrink-0 lg:w-28" />
            </>
          )}
        </div>
      </footer>
    </>
  );
}

/** Progres mini-player: berlangganan positionMs sendiri agar bar tidak ikut render. */
function MiniProgress() {
  const pct = usePlayer((s) => (s.durationMs > 0 ? Math.min(100, (s.positionMs / s.durationMs) * 100) : 0));
  return (
    <div aria-hidden className="absolute inset-x-3 bottom-0 h-0.5 overflow-hidden rounded-full bg-white/15">
      <div className="h-full rounded-none bg-rave-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}
