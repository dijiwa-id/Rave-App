import { useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Disc3, ListMusic, Mic2, Pause, ArrowDownAZ, Bookmark, Clock3, Heart, PanelLeftClose, PanelLeftOpen, Play, Plus, Radio, Search, Ticket, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useDict } from '@/lib/i18n';
import type { ArtistSummary, Paged, PlaylistSummary, ReleaseSummary } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { usePlayer } from '@/stores/player';
import { useLayout } from '@/stores/layout';
import { cx, toast } from '@/components/ui';
import { useModule } from '@/components/ModuleGate';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { useMediaPlaying, usePlayMedia } from '@/components/fan/usePlayMedia';
import { setting, usePlatformConfig } from '@/lib/platform';
import { useAnyLive } from '@/components/live/common';
import { EqBars } from './bits';
import { usePrefs } from '@/stores/prefs';

interface Summary {
  liked_count: number;
  playlists: PlaylistSummary[];
  followed_artists: string[];
  saved_releases: string[];
}

type Filter = 'all' | 'playlists' | 'artists' | 'albums';
type Kind = 'liked' | 'playlist' | 'artist' | 'album';
interface Item {
  key: string;
  kind: Kind;
  id: string;
  title: string;
  meta: string;
  image: string | null;
  href: string;
  /** 0 = urutan asli API (paling baru dulu). */
  order: number;
}

function useLibraryItems() {
  const token = useAuth((s) => s.accessToken);
  const d = useDict('common').shell;
  const sum = useQuery({ queryKey: ['library-summary'], queryFn: () => api<Summary>('/v1/library/summary'), enabled: !!token });
  const artistIds = sum.data?.followed_artists ?? [];
  const albumIds = (sum.data?.saved_releases ?? []).slice(0, 200);
  // Kunci query sama dengan halaman Library → cache dipakai bersama.
  const artists = useQuery({
    queryKey: ['artists', 'ids', artistIds.join(',')],
    queryFn: () => api<Paged<ArtistSummary>>('/v1/catalog/artists', { query: { ids: artistIds.join(',') } }),
    enabled: !!token && artistIds.length > 0,
  });
  const albums = useQuery({
    queryKey: ['releases-batch', albumIds.join(',')],
    queryFn: () => api<{ data: ReleaseSummary[] }>('/v1/catalog/releases', { query: { ids: albumIds.join(',') } }),
    enabled: !!token && albumIds.length > 0,
  });
  const items = useMemo<Item[]>(() => {
    if (!sum.data) return [];
    let n = 0;
    const out: Item[] = [{ key: 'liked', kind: 'liked', id: 'liked', title: '', meta: d.likedMeta(sum.data.liked_count), image: null, href: '/app/liked', order: n++ }];
    for (const p of sum.data.playlists) out.push({ key: `p-${p.id}`, kind: 'playlist', id: p.id, title: p.title, meta: d.playlistMeta(p.track_count), image: p.cover_url, href: `/app/playlist/${p.id}`, order: n++ });
    for (const a of artists.data?.data ?? []) out.push({ key: `a-${a.id}`, kind: 'artist', id: a.id, title: a.name, meta: d.artistMeta, image: a.image_url, href: `/app/artist/${a.slug}`, order: n++ });
    for (const r of albums.data?.data ?? []) out.push({ key: `r-${r.id}`, kind: 'album', id: r.id, title: r.title, meta: d.albumMeta(r.artist.name), image: r.cover_url, href: `/app/album/${r.id}`, order: n++ });
    return out;
  }, [sum.data, artists.data, albums.data, d]);
  return { items, loading: !!token && sum.isLoading, token };
}

const keyOf = (i: Item) => (i.kind === 'liked' ? 'liked' : `${i.kind === 'album' ? 'release' : i.kind}:${i.id}`);

/** Tombol putar kotak di atas sampul baris; berubah jadi Jeda (selalu tampil) saat item ini yang diputar. */
function RowPlay({ item, onPlay }: { item: Item; onPlay: () => void }) {
  const d = useDict('common');
  const { active, playing } = useMediaPlaying(keyOf(item));
  return (
    <button
      type="button"
      aria-label={playing ? d.fan.pause : `${d.player.play} ${item.title}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (active) usePlayer.getState().toggle();
        else onPlay();
      }}
      className={cx('absolute inset-0 grid place-items-center bg-black/55 transition focus-visible:opacity-100', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
    >
      <span key={playing ? 'pause' : 'play'} className="grid size-8 animate-[rave-pop_0.22s_ease-out] place-items-center border-2 border-rave-ink bg-rave-primary text-rave-on-primary shadow-[2px_2px_0_#0b0a0c]">
        {playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-px size-4 fill-current" />}
      </span>
    </button>
  );
}

/** Sampul baris library: selalu kotak (playlist/album/artis), atau "Lagu yang Disukai" ungu→mustard. */
function Thumb({ item, size }: { item: Item; size: string }) {
  if (item.kind === 'liked')
    return (
      <span className={cx('grid shrink-0 place-items-center border-2 border-rave-ink bg-gradient-to-br from-rave-purple via-rave-purple-soft to-rave-mustard', size)}>
        <Heart className="size-[42%] fill-white text-white" />
      </span>
    );
  return item.image ? (
    <img src={item.image} alt="" loading="lazy" decoding="async" className={cx('block shrink-0 border-2 border-rave-ink object-cover', item.kind === 'artist' && 'grayscale-[0.6]', size)} />
  ) : (
    // Tanpa sampul (mis. playlist baru): kotak blok berukuran tetap + ikon, agar baris & tombol putar tidak runtuh.
    <span className={cx('grid shrink-0 place-items-center border-2 border-rave-ink bg-gradient-to-br from-rave-highlight to-rave-plum text-rave-muted', size)}>
      {item.kind === 'artist' ? <Mic2 className="size-[40%]" /> : item.kind === 'album' ? <Disc3 className="size-[40%]" /> : <ListMusic className="size-[40%]" />}
    </span>
  );
}

/** Kanal cepat (Live/Podcast/Event) — tile stiker berwarna; di rel menjadi ikon. */
function useChannels() {
  const d = useDict('common').layout;
  const liveOn = setting(usePlatformConfig(), 'modules.live', true);
  const anyLive = useAnyLive(liveOn);
  const podcasts = useModule('podcasts');
  const ticketing = useModule('ticketing');
  return [
    liveOn && { to: '/app/live', label: d.live, icon: Radio, tone: 'bg-rave-berry', dot: anyLive },
    podcasts && { to: '/app/podcasts', label: d.podcasts.split(' ')[0], full: d.podcasts, icon: Bookmark, tone: 'bg-rave-purple', dot: false },
    ticketing && { to: '/app/events', label: d.eventsShort, full: d.events, icon: Ticket, tone: 'bg-rave-teal', dot: false },
  ].filter(Boolean) as { to: string; label: string; full?: string; icon: any; tone: string; dot: boolean }[];
}

function LiveDot() {
  return (
    <span className="relative flex size-2" aria-hidden>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-75 motion-reduce:animate-none" />
      <span className="relative inline-flex size-2 rounded-full bg-red-500" />
    </span>
  );
}

export function LibraryPanel({ rail }: { rail: boolean }) {
  const compact = usePrefs((x) => x.compactLibrary);
  const thumb = compact ? 'size-9' : 'size-12';
  const d = useDict('common');
  const s = d.shell;
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const toggleLeft = useLayout((x) => x.toggleLeft);
  const { items, loading, token } = useLibraryItems();
  const channels = useChannels();
  const play = usePlayMedia();
  const current = usePlayer((x) => x.current);
  const playing = usePlayer((x) => x.playing);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<'recent' | 'alpha'>('recent');
  const [q, setQ] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const liked = d.layout.likedSongs;
  const shown = useMemo(() => {
    const kindOf: Record<Filter, Kind[]> = { all: ['liked', 'playlist', 'artist', 'album'], playlists: ['liked', 'playlist'], artists: ['artist'], albums: ['album'] };
    const needle = q.trim().toLowerCase();
    let list = items.map((i) => (i.kind === 'liked' ? { ...i, title: liked } : i)).filter((i) => kindOf[filter].includes(i.kind));
    if (needle) list = list.filter((i) => i.title.toLowerCase().includes(needle) || i.meta.toLowerCase().includes(needle));
    if (sort === 'alpha') list = [...list].sort((a, b) => (a.kind === 'liked' ? -1 : b.kind === 'liked' ? 1 : a.title.localeCompare(b.title)));
    return list;
  }, [items, filter, sort, q, liked]);

  async function createPlaylist() {
    if (!token) return nav('/login');
    try {
      const n = items.filter((i) => i.kind === 'playlist').length + 1;
      const pl = await api<PlaylistSummary>('/v1/library/playlists', { body: { title: d.layout.newPlaylist(n) } });
      qc.invalidateQueries({ queryKey: ['library-summary'] });
      nav(`/app/playlist/${pl.id}`);
      toast.success(s.playlistCreated, { title: pl.title });
    } catch (e) {
      toast.error(e);
    }
  }

  const isActive = (i: Item) => loc.pathname === i.href || loc.pathname === decodeURI(i.href);
  const context = usePlayer((x) => x.context);
  const isPlayingFrom = (i: Item) => !!current && context === keyOf(i);
  const onPlay = (i: Item) => {
    if (i.kind === 'liked') return nav('/app/liked');
    void play({ id: i.id, kind: i.kind === 'album' ? 'release' : i.kind });
  };

  // ───────────── Rel ikon (diciutkan) ─────────────
  if (rail)
    return (
      <aside aria-label={d.layout.yourLibrary} className="shell-panel flex h-full w-full flex-col items-center gap-2 py-3">
        <button onClick={toggleLeft} title={s.expandLibrary} aria-label={s.expandLibrary} className="shell-icon-btn">
          <PanelLeftOpen className="size-5" />
        </button>
        <button onClick={createPlaylist} title={d.layout.createPlaylist} aria-label={d.layout.createPlaylist} className="shell-icon-btn">
          <Plus className="size-5" />
        </button>
        <div className="my-1 h-px w-8 bg-white/10" />
        {channels.map((c) => (
          <NavLink key={c.to} to={c.to} title={c.full ?? c.label} aria-label={c.full ?? c.label} className={({ isActive }) => cx('relative grid size-11 place-items-center border-2 border-rave-ink text-white transition hover:-translate-y-px', c.tone, isActive && 'outline-2 outline-offset-2 outline-rave-primary')}>
            <c.icon className="size-5" />
            {c.dot && (
              <span className="absolute -top-1 -right-1">
                <LiveDot />
              </span>
            )}
          </NavLink>
        ))}
        <div className="my-1 h-px w-8 bg-white/10" />
        <ul className="rave-scroll -mx-1 flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto px-1 pb-2">
          {shown.map((i) => (
            <li key={i.key}>
              <Link to={i.href} title={`${i.title} · ${i.meta}`} aria-label={i.title} className={cx('relative block size-12 transition hover:-translate-y-px', isActive(i) && 'outline-2 outline-offset-2 outline-rave-primary')}>
                <Thumb item={i} size="size-12" />
                {isPlayingFrom(i) && (
                  <span className="absolute inset-0 grid place-items-center bg-black/55">
                    <EqBars on={playing} />
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </aside>
    );

  // ───────────── Panel penuh ─────────────
  return (
    <aside aria-label={d.layout.yourLibrary} className="shell-panel flex h-full w-full min-w-0 flex-col">
      {/* Kepala panel: judul + aksi · navigasi kanal · alat library (filter, cari, urut). Lebar panel → @container. */}
      <div className="@container shrink-0 px-3 pt-3">
        <div className="flex items-center gap-1.5 pl-1">
          <div className="min-w-0 flex-1">
            <p className="shell-side-label">{s.sideA}</p>
            <h2 className="mt-1 truncate font-display text-2xl leading-none tracking-wide text-rave-paper uppercase">{d.layout.yourLibrary}</h2>
          </div>
          <button
            onClick={createPlaylist}
            title={d.layout.createPlaylist}
            aria-label={d.layout.createPlaylist}
            className="rave-btn flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 border-2 border-rave-ink bg-rave-primary px-2 text-sm font-bold text-rave-on-primary @[340px]:pr-3"
          >
            <Plus className="size-4" />
            <span className="hidden @[340px]:inline">{s.create}</span>
          </button>
          <button onClick={toggleLeft} title={s.collapseLibrary} aria-label={s.collapseLibrary} className="shell-icon-btn">
            <PanelLeftClose className="size-5" />
          </button>
        </div>

        {channels.length > 0 && (
          <nav aria-label={d.layout.menu} className="mt-3 flex flex-col">
            {channels.map((c) => (
              <NavLink key={c.to} to={c.to} className={({ isActive }) => cx('shell-row flex h-10 items-center gap-3 px-1.5 text-sm font-semibold', isActive ? 'shell-row--on text-rave-primary-text' : 'text-rave-paper/85 hover:text-white')}>
                <span className={cx('grid size-7 shrink-0 place-items-center border-2 border-rave-ink text-white', c.tone)}>
                  <c.icon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate">{c.full ?? c.label}</span>
                {c.dot && <LiveDot />}
              </NavLink>
            ))}
          </nav>
        )}

        {token && (
          <div className="mt-2 border-t border-white/[0.07] pt-3">
            <div role="tablist" aria-label={d.layout.yourLibrary} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
              {(['all', 'playlists', 'artists', 'albums'] as Filter[]).map((f) => (
                <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={cx('shell-chip shrink-0 !px-2.5 !py-1 !text-[12px]', filter === f && 'shell-chip--on')}>
                  {f === 'all' ? s.filterAll : f === 'playlists' ? s.filterPlaylists : f === 'artists' ? s.filterArtists : s.filterAlbums}
                </button>
              ))}
            </div>
            <div className="mt-2 mb-2 flex items-center gap-1.5">
              <label className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-rave-subtle" />
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setQ('')}
                  placeholder={s.searchLibrary}
                  aria-label={s.searchLibrary}
                  className="h-8 w-full border border-white/[0.08] bg-white/[0.05] pr-7 pl-8 text-[13px] text-white transition placeholder:text-rave-subtle hover:border-white/20 focus:border-rave-primary focus:bg-white/[0.07] focus:outline-none"
                />
                {q && (
                  <button onClick={() => (setQ(''), searchRef.current?.focus())} aria-label={s.clearSearch} className="absolute top-1/2 right-1 -translate-y-1/2 p-1 text-rave-muted hover:text-white">
                    <X className="size-3.5" />
                  </button>
                )}
              </label>
              <button
                onClick={() => setSort(sort === 'recent' ? 'alpha' : 'recent')}
                title={`${s.sortBy}: ${sort === 'recent' ? s.recents : s.alpha}`}
                aria-label={`${s.sortBy}: ${sort === 'recent' ? s.recents : s.alpha}`}
                className="flex h-8 shrink-0 items-center gap-1.5 border border-white/[0.08] px-2 font-label text-[10.5px] font-bold tracking-wider text-rave-muted uppercase transition hover:border-white/20 hover:text-white"
              >
                {sort === 'recent' ? <Clock3 className="size-3.5" /> : <ArrowDownAZ className="size-3.5" />}
                <span className="hidden @[320px]:inline">{sort === 'recent' ? s.recents : s.alpha}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rave-scroll min-h-0 flex-1 overflow-y-auto border-t border-white/[0.04] px-1.5 pt-1 pb-3">
        {!token ? (
          <div className="px-2 pt-4">
            <div className="shell-sticker p-4">
              <p className="font-display text-2xl leading-none text-rave-ink uppercase">{s.guestTitle}</p>
              <p className="mt-2 text-sm text-rave-ink/80">{s.guestBody}</p>
              <Link to="/login" className="rave-btn mt-4 inline-flex border-2 border-rave-ink bg-rave-ink px-4 py-2 text-sm font-bold text-rave-primary">
                {d.layout.logIn}
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-4 gap-y-2 px-1 text-[11px] text-rave-muted">
              <Link to="/ketentuan" className="hover:text-white">{d.layout.legal}</Link>
              <Link to="/bantuan" className="hover:text-white">{d.layout.help}</Link>
              <Link to="/privasi" className="hover:text-white">{d.layout.privacy}</Link>
              <Link to="/cookie" className="hover:text-white">{d.layout.cookie}</Link>
              <Link to="/iklan" className="hover:text-white">{d.layout.aboutAds}</Link>
            </div>
            <LanguageSwitch className="mt-4 px-1" />
          </div>
        ) : loading ? (
          <ul className="space-y-1 px-2 pt-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 py-1.5">
                <span className="size-12 animate-pulse bg-white/[0.06]" />
                <span className="flex-1 space-y-2">
                  <span className="block h-3 w-3/4 animate-pulse bg-white/[0.06]" />
                  <span className="block h-2.5 w-1/2 animate-pulse bg-white/[0.04]" />
                </span>
              </li>
            ))}
          </ul>
        ) : shown.length === 0 ? (
          <div className="px-3 pt-6 text-center">
            <p className="font-bold text-white">{q ? s.noMatch : s.emptyLibrary}</p>
            {!q && <p className="mt-1 text-sm text-rave-muted">{s.emptyLibraryBody}</p>}
          </div>
        ) : (
          <ul>
            {shown.map((i) => {
              const active = isActive(i);
              const from = isPlayingFrom(i);
              return (
                <li key={i.key}>
                  <Link
                    to={i.href}
                    className={cx('shell-row group flex items-center gap-3 px-2', compact ? 'py-1' : 'py-1.5', active && 'shell-row--on')}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span className={cx('relative block shrink-0', thumb)}>
                      <Thumb item={i} size={thumb} />
                      <RowPlay item={i} onPlay={() => onPlay(i)} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cx('block truncate font-semibold', compact ? 'text-sm' : 'text-[15px]', active || from ? 'text-rave-primary-text' : 'text-white')}>{i.title}</span>
                      <span className={cx('flex items-center gap-1 truncate text-rave-muted', compact ? 'text-xs' : 'text-[13px]')}>
                        {i.kind === 'liked' && <span className="inline-block size-2 shrink-0 rotate-45 bg-rave-primary" aria-hidden />}
                        {i.meta}
                      </span>
                    </span>
                    {from && <EqBars on={playing} className="mr-1" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}


