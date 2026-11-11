import { useEffect, useRef, useState } from 'react';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Bookmark, ChevronDown, ChevronLeft, ChevronRight, Download, Heart, Home, Library, LogOut, Plus, Radio, Search, Ticket, User } from 'lucide-react';
import { api } from '@/lib/api';
import { useDict } from '@/lib/i18n';
import type { PlaylistSummary } from '@/lib/types';
import { hasRole, isSuperAdmin, useAuth } from '@/stores/auth';
import { RaveLogo } from '@/components/ui/RaveLogo';
import { cx, toast } from '@/components/ui';
import { usePlayer } from '@/stores/player';
import { PlatformBanner } from '@/components/PlatformBanner';
import { setting, usePlatformConfig } from '@/lib/platform';
import { useAnyLive } from '@/components/live/common';
import { useModule } from '@/components/ModuleGate';
import { useMediaSession, usePlayerShortcuts } from '@/lib/playerControls';
import { PlayerBar } from './PlayerBar';
import { AdBreakOverlay } from './AdBreak';

function SideLink({ to, icon: Icon, children, end }: { to: string; icon: any; children: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cx('relative mx-3 flex items-center gap-4 rounded-none px-3 py-2 text-sm font-bold transition', isActive ? 'bg-white/[0.07] text-white before:absolute before:inset-y-2 before:-left-3 before:w-1 before:rounded-r before:bg-rave-primary' : 'text-rave-muted hover:bg-white/[0.04] hover:text-white')}>
      <Icon className="size-6" />
      {children}
    </NavLink>
  );
}

/** Menu "Live" (disembunyikan bila modules.live mati) dengan titik merah saat ada yang sedang live. */
function useLiveNav() {
  const enabled = setting(usePlatformConfig(), 'modules.live', true);
  const anyLive = useAnyLive(enabled);
  return { enabled, anyLive };
}
function LiveDot() {
  const d = useDict('common');
  return (
    <span className="relative flex size-2" aria-label={d.layout.liveNow}>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
      <span className="relative inline-flex size-2 rounded-full bg-red-500" />
    </span>
  );
}

function Sidebar() {
  const token = useAuth((s) => s.accessToken);
  const nav = useNavigate();
  const qc = useQueryClient();
  // Modul podcast & ticketing bisa dimatikan Super Admin (modules.*).
  const podcasts = useModule('podcasts');
  const ticketing = useModule('ticketing');
  const live = useLiveNav();
  const d = useDict('common');
  const { data } = useQuery({
    queryKey: ['library-summary'],
    queryFn: () => api<{ playlists: PlaylistSummary[] }>('/v1/library/summary'),
    enabled: !!token,
  });
  async function createPlaylist() {
    if (!token) return nav('/login');
    try {
      const pl = await api<PlaylistSummary>('/v1/library/playlists', { body: { title: d.layout.newPlaylist((data?.playlists.length ?? 0) + 1) } });
      qc.invalidateQueries({ queryKey: ['library-summary'] });
      nav(`/app/playlist/${pl.id}`);
    } catch (e) {
      toast.error(e);
    }
  }
  return (
    <aside className="hidden w-[240px] shrink-0 flex-col border-r border-white/[0.06] bg-rave-black pt-6 md:flex">
      <Link to="/" className="mb-7 px-6" aria-label={d.layout.homeAria}>
        <RaveLogo className="!h-9" />
      </Link>
      <p className="rave-label mb-2 px-6 text-rave-subtle">{d.layout.menu}</p>
      <nav className="flex flex-col gap-0.5">
        <SideLink to="/app" icon={Home} end>
          {d.layout.home}
        </SideLink>
        <SideLink to="/app/search" icon={Search}>
          {d.layout.search}
        </SideLink>
        <SideLink to="/app/library" icon={Library}>
          {d.layout.yourLibrary}
        </SideLink>
        {live.enabled && (
          <NavLink to="/app/live" className={({ isActive }) => cx('relative mx-3 flex items-center gap-4 rounded-none px-3 py-2 text-sm font-bold transition', isActive ? 'bg-white/[0.07] text-white before:absolute before:inset-y-2 before:-left-3 before:w-1 before:rounded-r before:bg-rave-primary' : 'text-rave-muted hover:bg-white/[0.04] hover:text-white')}>
            <Radio className="size-6" />
            {d.layout.live}
            {live.anyLive && <LiveDot />}
          </NavLink>
        )}
      </nav>
      <p className="rave-label mt-6 mb-2 px-6 text-rave-subtle">{d.layout.library}</p>
      <div className="flex flex-col gap-0.5">
        <button onClick={createPlaylist} className="group mx-3 flex items-center gap-4 rounded-none px-3 py-1.5 text-sm font-bold text-rave-muted transition hover:bg-white/[0.04] hover:text-white">
          <span className="grid size-6 place-items-center rounded-none bg-rave-muted text-black group-hover:bg-white">
            <Plus className="size-4" />
          </span>
          {d.layout.createPlaylist}
        </button>
        <NavLink to="/app/liked" className={({ isActive }) => cx('mx-3 flex items-center gap-4 rounded-none px-3 py-1.5 text-sm font-bold transition', isActive ? 'bg-white/[0.07] text-white' : 'text-rave-muted hover:bg-white/[0.04] hover:text-white')}>
          <span className="grid size-6 place-items-center rounded-none bg-gradient-to-br from-[#5B2A6E] to-[#F4C21F]">
            <Heart className="size-3 fill-white text-white" />
          </span>
          {d.layout.likedSongs}
        </NavLink>
        {podcasts && (
          <NavLink to="/app/podcasts" className={({ isActive }) => cx('mx-3 flex items-center gap-4 rounded-none px-3 py-1.5 text-sm font-bold transition', isActive ? 'bg-white/[0.07] text-white' : 'text-rave-muted hover:bg-white/[0.04] hover:text-white')}>
            <span className="grid size-6 place-items-center rounded-none bg-[#5B2A6E]">
              <Bookmark className="size-3 fill-rave-primary-text text-rave-primary-text" />
            </span>
            {d.layout.podcasts}
          </NavLink>
        )}
        {ticketing && (
          <NavLink to="/app/events" className={({ isActive }) => cx('mx-3 flex items-center gap-4 rounded-none px-3 py-1.5 text-sm font-bold transition', isActive ? 'bg-white/[0.07] text-white' : 'text-rave-muted hover:bg-white/[0.04] hover:text-white')}>
            <span className="grid size-6 place-items-center rounded-none bg-rave-pink">
              <Ticket className="size-3 text-white" />
            </span>
            {d.layout.events}
          </NavLink>
        )}
      </div>
      <hr className="mx-6 my-3 border-white/10" />
      <div className="rave-scroll flex-1 overflow-y-auto px-6">
        {token ? (
          <ul className="space-y-3 py-1">
            {data?.playlists.map((p) => (
              <li key={p.id}>
                <NavLink to={`/app/playlist/${p.id}`} className={({ isActive }) => cx('block truncate text-sm', isActive ? 'text-white' : 'text-rave-muted hover:text-white')}>
                  {p.title}
                </NavLink>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-3 pt-2 text-[11px] text-rave-muted">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <Link to="/ketentuan" className="hover:text-white">{d.layout.legal}</Link>
              <Link to="/bantuan" className="hover:text-white">{d.layout.help}</Link>
              <Link to="/privasi" className="hover:text-white">{d.layout.privacy}</Link>
              <Link to="/cookie" className="hover:text-white">{d.layout.cookie}</Link>
              <Link to="/iklan" className="hover:text-white">{d.layout.aboutAds}</Link>
            </div>
            <LanguageSwitch className="mt-4" />
          </div>
        )}
      </div>
      <div className="p-4">
        <a
          href="/#unduh"
          className="rave-label flex items-center justify-center gap-2 rounded-none border border-rave-primary/70 px-4 py-3 !text-[11px] text-rave-primary-text transition hover:bg-rave-primary hover:text-rave-on-primary"
        >
          <Download className="size-4" /> {d.layout.installApp}
        </a>
      </div>
    </aside>
  );
}

/** Tombol ikon header: kotak bertinta + bayangan sablon (gaya kartu RAVE); hover/aktif mustard. */
const HDR_BTN =
  'relative grid size-9 shrink-0 place-items-center border-2 border-rave-ink bg-[#1e1c1f] text-rave-paper shadow-[3px_3px_0_#0b0a0c] transition hover:-translate-y-px hover:bg-rave-primary hover:text-rave-on-primary active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:pointer-events-none disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rave-primary';
const MENU_ITEM = 'flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-bold text-rave-paper/85 transition hover:bg-rave-primary hover:text-rave-on-primary';

function UserMenu() {
  const user = useAuth((s) => s.user);
  const refreshToken = useAuth((s) => s.refreshToken);
  const clear = useAuth((s) => s.clear);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ticketing = useModule('ticketing');
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const d = useDict('common');
  const { data: unread } = useQuery({
    queryKey: ['unread'],
    queryFn: () => api<{ unread: number }>('/v1/notifications/unread-count'),
    refetchInterval: 30_000,
  });
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  async function logout() {
    try {
      await api('/v1/auth/logout', { body: { refresh_token: refreshToken } });
    } catch {
      /* abaikan */
    }
    clear();
    nav('/');
    // Buang cache data pengguna (likes, library, tiket…) agar tidak bocor ke sesi berikutnya.
    qc.clear();
  }
  const b2b = hasRole(user, 'artist', 'manager', 'label');
  const promotor = hasRole(user, 'promotor');
  return (
    <div className="flex items-center gap-3">
      <Link to="/app/notifications" aria-label={d.layout.notifications} title={d.layout.notifications} className={HDR_BTN}>
        <Bell className="size-4" />
        {!!unread?.unread && (
          <span className="absolute -top-2 -right-2 grid h-[18px] min-w-[18px] rotate-[6deg] place-items-center border-2 border-rave-ink bg-rave-primary px-1 font-label text-[10px] leading-none font-bold text-rave-on-primary">
            {unread.unread > 99 ? '99+' : unread.unread}
          </span>
        )}
      </Link>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-haspopup="menu"
          className={cx(
            'flex h-9 items-center gap-2 border-2 border-rave-ink bg-[#1e1c1f] pr-2.5 text-rave-paper shadow-[3px_3px_0_#0b0a0c] transition hover:-translate-y-px',
            open && 'translate-x-[2px] translate-y-[2px] !shadow-none',
          )}
        >
          <span className="grid size-8 shrink-0 place-items-center overflow-hidden border-r-2 border-rave-ink bg-rave-purple">
            {user?.avatar_url ? <img src={user.avatar_url} alt="" className="size-full object-cover" /> : <span className="font-display text-base leading-none text-rave-primary-text">{(user?.display_name ?? '?').slice(0, 1).toUpperCase()}</span>}
          </span>
          <span className="hidden max-w-32 truncate font-label text-[11px] font-bold tracking-[0.08em] uppercase sm:inline">{user?.display_name}</span>
          <ChevronDown className={cx('size-4 text-white/60 transition', open && 'rotate-180')} />
        </button>
        {open && (
          <div role="menu" className="absolute right-0 z-40 mt-3 w-64 border-2 border-rave-ink bg-[#1e1c1f] text-sm shadow-[6px_6px_0_#F4C21F]" onClick={() => setOpen(false)}>
            <div className="border-b-2 border-dashed border-white/15 px-3 py-3">
              <p className="truncate font-bold text-rave-paper">{user?.display_name}</p>
              <p className="truncate text-xs text-white/50">{user?.email}</p>
            </div>
            <div className="p-1">
              {ticketing && (
                <Link role="menuitem" className={MENU_ITEM} to="/app/tickets">
                  <Ticket className="size-4" /> {d.layout.myTickets}
                </Link>
              )}
              <Link role="menuitem" className={MENU_ITEM} to="/app/settings">
                <User className="size-4" /> {d.layout.profileSettings}
              </Link>
              <Link role="menuitem" className={MENU_ITEM} to="/premium">
                <Heart className="size-4" /> Premium
              </Link>
            </div>
            <div className="border-t-2 border-dashed border-white/15 p-1">
              <Link role="menuitem" className={MENU_ITEM} to="/studio">
                {b2b ? 'Artist Studio' : d.layout.registerArtist}
              </Link>
              <Link role="menuitem" className={MENU_ITEM} to="/promotor">
                {promotor ? 'Promotor Hub' : d.layout.registerPromotor}
              </Link>
              {hasRole(user, 'admin') && user?.roles.includes('admin') && (
                <Link role="menuitem" className={MENU_ITEM} to={isSuperAdmin(user) ? '/admin/platform' : '/admin'}>
                  {isSuperAdmin(user) ? 'Super Admin' : 'Back Office'}
                </Link>
              )}
            </div>
            <div className="border-t-2 border-dashed border-white/15 p-1">
              <button role="menuitem" onClick={logout} className={MENU_ITEM}>
                <LogOut className="size-4" /> {d.layout.logout}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TopBar({ scrolled }: { scrolled: boolean }) {
  const nav = useNavigate();
  const loc = useLocation();
  const token = useAuth((s) => s.accessToken);
  const onSearch = loc.pathname.startsWith('/app/search');
  const d = useDict('common');
  const [q, setQ] = useState(new URLSearchParams(loc.search).get('q') ?? '');
  useEffect(() => {
    if (!onSearch) return;
    const t = setTimeout(() => nav(q ? `/app/search?q=${encodeURIComponent(q)}` : '/app/search', { replace: true }), 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <header className={cx('sticky top-0 z-30 flex h-16 items-center justify-between gap-4 px-4 transition-colors md:px-8', scrolled ? 'border-b border-white/[0.06] bg-rave-base/90 backdrop-blur-md' : 'bg-transparent')}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button onClick={() => nav(-1)} aria-label={d.layout.back} title={d.layout.back} className={HDR_BTN}>
          <ChevronLeft className="size-5" />
        </button>
        <button onClick={() => nav(1)} aria-label={d.layout.forward} title={d.layout.forward} className={HDR_BTN}>
          <ChevronRight className="size-5" />
        </button>
        {onSearch && (
          <label className="relative ml-2 w-full max-w-[364px]">
            <Search className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-black" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={d.layout.searchPlaceholder}
              className="h-10 w-full rounded-none border-2 border-rave-ink bg-rave-paper pr-4 pl-10 text-sm text-rave-ink shadow-[3px_3px_0_#0b0a0c] placeholder:text-[#6b6570] focus:border-rave-primary focus:outline-none"
            />
          </label>
        )}
      </div>
      {token ? (
        <UserMenu />
      ) : (
        <div className="flex items-center gap-2">
          <Link to="/login?signup=1" className="px-3 text-sm font-bold text-white/70 transition hover:text-rave-paper">
            {d.layout.signUp}
          </Link>
          <Link
            to="/login"
            className="rave-label border-2 border-rave-ink bg-rave-primary px-5 py-2.5 !text-[11.5px] text-rave-on-primary shadow-[3px_3px_0_#0b0a0c] transition hover:-translate-y-px hover:bg-rave-paper"
          >
            {d.layout.logIn}
          </Link>
        </div>
      )}
    </header>
  );
}

function PreviewBanner() {
  const d = useDict('common');
  return (
    <div className="rave-dots flex items-center justify-between gap-4 border-t-2 border-rave-ink bg-rave-purple px-4 py-3">
      <div>
        <p className="rave-label text-rave-primary-text">{d.layout.previewKicker}</p>
        <p className="text-sm text-rave-paper/90">{d.layout.previewBody}</p>
      </div>
      <Link to="/login?signup=1" className="shrink-0 rounded-none bg-rave-primary px-8 py-3 text-sm font-bold text-rave-on-primary transition hover:scale-105 hover:bg-rave-primary-hover">
        {d.layout.signUpFree}
      </Link>
    </div>
  );
}

function MobileNav() {
  const item = 'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] active:bg-white/5';
  const live = useLiveNav();
  const ticketing = useModule('ticketing');
  const d = useDict('common');
  return (
    <nav aria-label={d.layout.mainNav} className="flex shrink-0 border-t border-white/10 bg-rave-black pb-[env(safe-area-inset-bottom)] md:hidden">
      <NavLink to="/app" end className={({ isActive }) => cx(item, isActive ? 'text-rave-primary-text' : 'text-rave-muted')}>
        <Home className="size-5" />
        {d.layout.home}
      </NavLink>
      <NavLink to="/app/search" className={({ isActive }) => cx(item, isActive ? 'text-rave-primary-text' : 'text-rave-muted')}>
        <Search className="size-5" />
        {d.layout.search}
      </NavLink>
      <NavLink to="/app/library" className={({ isActive }) => cx(item, isActive ? 'text-rave-primary-text' : 'text-rave-muted')}>
        <Library className="size-5" />
        {d.layout.library}
      </NavLink>
      {live.enabled && (
        <NavLink to="/app/live" className={({ isActive }) => cx(item, 'relative', isActive ? 'text-rave-primary-text' : 'text-rave-muted')}>
          <Radio className="size-5" />
          {d.layout.live}
          {live.anyLive && (
            <span className="absolute top-1.5 right-[calc(50%-14px)]">
              <LiveDot />
            </span>
          )}
        </NavLink>
      )}
      {ticketing && (
        <NavLink to="/app/events" className={({ isActive }) => cx(item, isActive ? 'text-rave-primary-text' : 'text-rave-muted')}>
          <Ticket className="size-5" />
          {d.layout.eventsShort}
        </NavLink>
      )}
    </nav>
  );
}

/** Shell aplikasi fan RAVE (rave-website/index.html): sidebar hitam, kanvas ink bergradien plum, player bar bawah. */
export function FanLayout() {
  const token = useAuth((s) => s.accessToken);
  const hasCurrent = usePlayer((s) => !!s.current);
  useMediaSession();
  usePlayerShortcuts();
  const mainRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [loc.pathname]);
  return (
    <div className="flex h-full flex-col bg-rave-black">
      <PlatformBanner />
      <div className="relative flex min-h-0 flex-1">
        <Sidebar />
        <main ref={mainRef} onScroll={(e) => setScrolled((e.target as HTMLElement).scrollTop > 40)} className="rave-scroll rave-app-canvas relative min-w-0 flex-1 overflow-y-auto">
          <TopBar scrolled={scrolled} />
          <div className="-mt-16">
            <Outlet />
          </div>
        </main>
        {/* Jeda iklan tier Gratis — menutupi kanvas, pemutar tetap terlihat (docs/API.md §11) */}
        <AdBreakOverlay />
      </div>
      {(token || hasCurrent) && <PlayerBar />}
      {!token && <PreviewBanner />}
      <MobileNav />
    </div>
  );
}
