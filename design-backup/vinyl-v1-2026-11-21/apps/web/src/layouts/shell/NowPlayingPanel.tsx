import { Link } from 'react-router-dom';
import { Cassette } from '@/components/fan/Cassette';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ListMusic, Mic2, Search, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { api, fmt } from '@/lib/api';
import { useDict } from '@/lib/i18n';
import type { Artist } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { usePlayer, type Playable } from '@/stores/player';
import { useLayout, type RightView } from '@/stores/layout';
import { BRAND_GRADIENT } from '@/components/ads/AdCard';
import { cx, toast } from '@/components/ui';
import { LikeButton, PlayerLcd, usePlayerView } from '../playerParts';
import { EqBars, useCoverColor } from './bits';
import { usePrefs } from '@/stores/prefs';

/** Sampul + piringan hitam yang menyembul & berputar saat lagu diputar. */
function VinylCover({ image, color, playing, label }: { image: string | null | undefined; color: string; playing: boolean; label?: string | null }) {
  return (
    <div className="shell-vinyl relative mx-auto w-full" data-on={playing}>
      <div className="shell-vinyl__disc" aria-hidden style={{ ['--disc-label' as any]: color }}>
        <span className="shell-vinyl__label">{image && <img src={image} alt="" className="size-full rounded-full object-cover" />}</span>
      </div>
      <div className="shell-vinyl__sleeve">
        {image ? <img src={image} alt="" className="size-full object-cover" /> : <div className={cx('size-full', BRAND_GRADIENT)} />}
        {label && <span className="shell-tape-label">{label}</span>}
      </div>
    </div>
  );
}

function ArtistCard({ id }: { id: string }) {
  const d = useDict('common').shell;
  const signIn = useDict('common').player.signInToSave;
  const token = useAuth((s) => s.accessToken);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['artist', id], queryFn: () => api<Artist>(`/v1/catalog/artists/${id}`), staleTime: 5 * 60_000 });
  const follow = useQuery({ queryKey: ['follow', id], queryFn: () => api<{ following: boolean }>(`/v1/library/follows/${id}`), enabled: !!token });
  const a = q.data;
  if (!a) return <div className="h-64 animate-pulse bg-white/[0.04]" />;
  const following = !!follow.data?.following;
  async function toggle() {
    if (!token) return toast.info(signIn);
    qc.setQueryData(['follow', id], { following: !following });
    try {
      await api(`/v1/library/follows/${id}`, { method: following ? 'DELETE' : 'PUT' });
      qc.invalidateQueries({ queryKey: ['library-summary'] });
      const img = a!.image_url;
      if (following) toast.info(d.unfollowedToast(a!.name), { image: img });
      else toast.success(d.followedToast(a!.name), { image: img });
    } catch (e) {
      qc.setQueryData(['follow', id], { following });
      toast.error(e);
    }
  }
  const img = a.cover_url || a.image_url;
  return (
    <section className="shell-card overflow-hidden">
      <div className="relative aspect-[4/3] overflow-hidden bg-rave-highlight">
        {img ? (
          <img src={img} alt="" loading="lazy" className="size-full object-cover transition duration-700 hover:scale-105" />
        ) : (
          <div className="rave-dots grid size-full place-items-center bg-gradient-to-br from-rave-purple to-rave-plum">
            <span className="font-display text-[96px] leading-none text-rave-primary/90">{a.name.slice(0, 1)}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
        <p className="absolute top-3 left-3 font-label text-[11px] font-bold tracking-[0.14em] text-white uppercase">{d.aboutArtist}</p>
      </div>
      <div className="p-4">
        <Link to={`/app/artist/${a.slug}`} className="flex items-center gap-1.5 font-display text-2xl leading-none text-white uppercase hover:text-rave-primary-text">
          {a.name}
          {a.verified && <BadgeCheck className="size-5 shrink-0 text-rave-primary" />}
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-rave-muted">{d.listeners(fmt.num(a.monthly_listeners))}</p>
          <button onClick={toggle} aria-pressed={following} className={cx('rave-btn shrink-0 border-2 border-rave-ink px-3 py-1 text-xs font-bold', following ? 'bg-transparent text-white !shadow-none outline outline-1 outline-white/40' : 'bg-rave-paper text-rave-ink')}>
            {following ? d.following : d.follow}
          </button>
        </div>
        {a.bio && <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-white/80">{a.bio}</p>}
        {a.genres.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {a.genres.slice(0, 4).map((g) => (
              <span key={g} className="border border-white/15 px-2 py-0.5 font-label text-[10px] tracking-wider text-rave-muted uppercase">
                {g}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function QueueRow({ p, n, active, onPlay }: { p: Playable; n: number; active?: boolean; onPlay?: () => void }) {
  const playing = usePlayer((s) => s.playing);
  return (
    <button type="button" onClick={onPlay} disabled={!onPlay} className={cx('shell-row group flex w-full items-center gap-3 px-2 py-1.5 text-left', active && 'shell-row--on')}>
      <span className="w-5 shrink-0 text-center font-label text-xs text-rave-subtle tabular-nums">{active ? <EqBars on={playing} /> : n}</span>
      {p.image_url ? <img src={p.image_url} alt="" loading="lazy" className="size-10 shrink-0 border-2 border-rave-ink object-cover" /> : <span className="size-10 shrink-0 bg-rave-highlight" />}
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate text-sm font-semibold', active ? 'text-rave-primary-text' : 'text-white')}>{p.title}</span>
        <span className="block truncate text-xs text-rave-muted">{p.subtitle}</span>
      </span>
      <span className="shrink-0 font-label text-[11px] text-rave-subtle tabular-nums">{fmt.duration(p.duration_ms)}</span>
    </button>
  );
}

function QueueList({ limit }: { limit?: number }) {
  const d = useDict('common').shell;
  const { queue, index, current } = usePlayer(useShallow((s) => ({ queue: s.queue, index: s.index, current: s.current })));
  const playQueue = usePlayer((s) => s.playQueue);
  const next = queue.slice(index + 1, limit ? index + 1 + limit : undefined);
  return (
    <div>
      {!limit && current && <QueueRow p={current} n={1} active />}
      {next.length ? (
        next.map((p, i) => <QueueRow key={`${p.id}-${i}`} p={p} n={i + 2} onPlay={() => playQueue(queue, index + 1 + i)} />)
      ) : (
        <p className="px-2 py-3 text-sm text-rave-muted">{d.queueEmpty}</p>
      )}
    </div>
  );
}

function Tabs({ view }: { view: RightView }) {
  const d = useDict('common').shell;
  const toggleRight = useLayout((s) => s.toggleRight);
  return (
    <div role="tablist" className="flex gap-1">
      {(['now', 'queue'] as RightView[]).map((v) => (
        <button key={v} role="tab" aria-selected={view === v} onClick={() => view !== v && toggleRight(v)} className={cx('shell-chip !py-1', view === v && 'shell-chip--on')}>
          {v === 'now' ? d.tabNow : d.tabQueue}
        </button>
      ))}
    </div>
  );
}

export function NowPlayingPanel() {
  const d = useDict('common');
  const s = d.shell;
  const { p, ad, playing } = usePlayerView();
  const view = useLayout((x) => x.rightView);
  const close = useLayout((x) => x.closeRight);
  const toggleRight = useLayout((x) => x.toggleRight);
  const quality = usePlayer((x) => x.session?.codec_label);
  const vinylMotion = usePrefs((x) => x.vinylMotion);
  const image = ad ? ad.image_url : p.current?.image_url;
  const color = useCoverColor(image, ad?.theme_color ?? '#5b2a6e');
  const title = ad ? ad.title : p.current?.title;
  const heading = ad ? s.sponsored : (p.current?.subtitle ?? d.player.nowPlaying);

  return (
    <aside aria-label={d.player.nowPlaying} className="shell-panel relative flex h-full w-full min-w-0 flex-col overflow-hidden">
      {/* Latar ambient mengikuti warna sampul */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px] transition-[background] duration-1000" style={{ background: `linear-gradient(180deg, ${color} 0%, color-mix(in srgb, ${color} 35%, transparent) 45%, transparent 100%)` }} />
      <div aria-hidden className="rave-dots pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-60 [mask-image:linear-gradient(180deg,black,transparent)]" />

      <header className="relative flex items-center gap-2 px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <p className="shell-side-label">{s.sideB}</p>
          <p className="truncate text-[15px] font-bold text-white">{view === 'queue' ? d.player.queue : heading}</p>
        </div>
        <Tabs view={view} />
        <button onClick={close} title={s.closePanel} aria-label={s.closePanel} className="shell-icon-btn !size-8">
          <X className="size-4" />
        </button>
      </header>

      <div className="rave-scroll relative min-h-0 flex-1 overflow-y-auto px-4 pb-5">
        {view === 'queue' ? (
          <div className="-mx-2 pt-1">
            <QueueList />
          </div>
        ) : !p.current && !ad ? (
          <div className="flex flex-col items-center px-2 pt-10 text-center">
            <div className="w-full max-w-[300px] px-1">
              <Cassette />
            </div>
            <p className="mt-6 font-display text-3xl leading-none text-white uppercase">{s.idleTitle}</p>
            <p className="mt-2 text-sm text-rave-muted">{s.idleBody}</p>
            <Link to="/app/search" className="rave-btn mt-5 inline-flex items-center gap-2 border-2 border-rave-ink bg-rave-primary px-4 py-2 text-sm font-bold text-rave-on-primary">
              <Search className="size-4" /> {s.idleCta}
            </Link>
          </div>
        ) : (
          <div className="space-y-5 pt-2">
            <VinylCover image={image} color={color} playing={playing && vinylMotion} label={ad ? ad.label : quality} />

            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-[30px] leading-[0.95] break-words text-white uppercase">{title}</h3>
                {ad ? (
                  <p className="mt-1 truncate text-sm text-white/75">{ad.advertiser}</p>
                ) : p.current?.subtitleHref ? (
                  <Link to={p.current.subtitleHref} className="mt-1 block truncate text-sm text-white/75 hover:text-white hover:underline">
                    {p.current.subtitle}
                  </Link>
                ) : (
                  <p className="mt-1 truncate text-sm text-white/75">{p.current?.subtitle}</p>
                )}
              </div>
              {!ad && p.current?.kind === 'track' && <LikeButton trackId={p.current.id} className="mt-1 [&>svg]:size-6" />}
            </div>

            <PlayerLcd className="w-full" />

            {!ad && (
              <div className="flex gap-2">
                <Link to="/app/lyrics" className="shell-chip flex items-center gap-1.5">
                  <Mic2 className="size-3.5" /> {s.lyricsCta}
                </Link>
                <button onClick={() => toggleRight('queue')} className="shell-chip flex items-center gap-1.5">
                  <ListMusic className="size-3.5" /> {s.openQueue}
                </button>
              </div>
            )}

            {!ad && p.current?.artist_id && <ArtistCard id={p.current.artist_id} />}

            {!ad && (
              <section className="shell-card p-3">
                <div className="mb-1 flex items-center justify-between px-1">
                  <h4 className="font-label text-[11px] font-bold tracking-[0.14em] text-white uppercase">{s.nextUp}</h4>
                  <button onClick={() => toggleRight('queue')} className="text-xs font-bold text-rave-muted hover:text-white hover:underline">
                    {s.openQueue}
                  </button>
                </div>
                <div className="-mx-1">
                  <QueueList limit={4} />
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
