import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Bookmark, ChevronDown, ChevronLeft, ChevronRight, Download, Globe, Heart, Home, Library, LogOut, Plus, Radio, Search, Ticket, User } from 'lucide-react';
import { api } from '@/lib/api';
import type { PlaylistSummary } from '@/lib/types';
import { hasRole, isSuperAdmin, useAuth } from '@/stores/auth';
import { GemaLogo } from '@/components/ui/GemaLogo';
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
    <NavLink to={to} end={end} className={({ isActive }) => cx('flex items-center gap-4 px-6 py-2 text-sm font-bold transition', isActive ? 'text-white' : 'text-gema-muted hover:text-white')}>
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
  return (
    <span className="relative flex size-2" aria-label="Ada yang sedang live">
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
  const { data } = useQuery({
    queryKey: ['library-summary'],
    queryFn: () => api<{ playlists: PlaylistSummary[] }>('/v1/library/summary'),
    enabled: !!token,
  });
  async function createPlaylist() {
    if (!token) return nav('/login');
    try {
      const pl = await api<PlaylistSummary>('/v1/library/playlists', { body: { title: `Playlist Saya #${(data?.playlists.length ?? 0) + 1}` } });
      qc.invalidateQueries({ queryKey: ['library-summary'] });
      nav(`/app/playlist/${pl.id}`);
    } catch (e) {
      toast.error(e);
    }
  }
  return (
    <aside className="hidden w-[240px] shrink-0 flex-col bg-black pt-6 md:flex">
      <Link to="/" className="mb-6 px-6">
        <GemaLogo />
      </Link>
      <nav className="flex flex-col">
        <SideLink to="/app" icon={Home} end>
          Beranda
        </SideLink>
        <SideLink to="/app/search" icon={Search}>
          Cari
        </SideLink>
        <SideLink to="/app/library" icon={Library}>
          Koleksi Kamu
        </SideLink>
        {live.enabled && (
          <NavLink to="/app/live" className={({ isActive }) => cx('flex items-center gap-4 px-6 py-2 text-sm font-bold transition', isActive ? 'text-white' : 'text-gema-muted hover:text-white')}>
            <Radio className="size-6" />
            Live
            {live.anyLive && <LiveDot />}
          </NavLink>
        )}
      </nav>
      <div className="mt-6 flex flex-col gap-1">
        <button onClick={createPlaylist} className="group flex items-center gap-4 px-6 py-2 text-sm font-bold text-gema-muted hover:text-white">
          <span className="grid size-6 place-items-center rounded-sm bg-gema-muted text-black group-hover:bg-white">
            <Plus className="size-4" />
          </span>
          Buat Playlist
        </button>
        <NavLink to="/app/liked" className={({ isActive }) => cx('flex items-center gap-4 px-6 py-2 text-sm font-bold', isActive ? 'text-white' : 'text-gema-muted hover:text-white')}>
          <span className="grid size-6 place-items-center rounded-sm bg-gradient-to-br from-[#450af5] to-[#c4efd9]">
            <Heart className="size-3 fill-white text-white" />
          </span>
          Lagu yang Disukai
        </NavLink>
        {podcasts && (
          <NavLink to="/app/podcasts" className={({ isActive }) => cx('flex items-center gap-4 px-6 py-2 text-sm font-bold', isActive ? 'text-white' : 'text-gema-muted hover:text-white')}>
            <span className="grid size-6 place-items-center rounded-sm bg-[#662d91]">
              <Bookmark className="size-3 fill-gema-primary-text text-gema-primary-text" />
            </span>
            Podcast & Cerita
          </NavLink>
        )}
        {ticketing && (
          <NavLink to="/app/events" className={({ isActive }) => cx('flex items-center gap-4 px-6 py-2 text-sm font-bold', isActive ? 'text-white' : 'text-gema-muted hover:text-white')}>
            <span className="grid size-6 place-items-center rounded-sm bg-gema-pink">
              <Ticket className="size-3 text-white" />
            </span>
            Event & Tiket
          </NavLink>
        )}
      </div>
      <hr className="mx-6 my-3 border-white/10" />
      <div className="gema-scroll flex-1 overflow-y-auto px-6">
        {token ? (
          <ul className="space-y-3 py-1">
            {data?.playlists.map((p) => (
              <li key={p.id}>
                <NavLink to={`/app/playlist/${p.id}`} className={({ isActive }) => cx('block truncate text-sm', isActive ? 'text-white' : 'text-gema-muted hover:text-white')}>
                  {p.title}
                </NavLink>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-3 pt-2 text-[11px] text-gema-muted">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <a href="#">Legal</a>
              <a href="#">Pusat Privasi</a>
              <a href="#">Kebijakan Privasi</a>
              <a href="#">Cookie</a>
              <a href="#">Tentang Iklan</a>
            </div>
            {/* Satu-satunya bahasa saat ini (belum ada i18n) — label informasi, bukan tombol. */}
            <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-gema-subtle px-3 py-1.5 text-sm font-bold text-white">
              <Globe className="size-4" /> Bahasa Indonesia
            </p>
          </div>
        )}
      </div>
      <a href="/#unduh" className="flex items-center gap-4 px-6 py-4 text-sm font-bold text-gema-muted hover:text-white">
        <Download className="size-6" /> Instal Aplikasi
      </a>
    </aside>
  );
}

function UserMenu() {
  const user = useAuth((s) => s.user);
  const refreshToken = useAuth((s) => s.refreshToken);
  const clear = useAuth((s) => s.clear);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ticketing = useModule('ticketing');
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
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
      <Link to="/app/notifications" aria-label="Notifikasi" className="relative grid size-8 place-items-center rounded-full bg-black/70 text-gema-muted hover:text-white">
        <Bell className="size-4" />
        {!!unread?.unread && <span className="absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full bg-gema-primary px-1 text-[10px] font-bold text-white">{unread.unread}</span>}
      </Link>
      <div ref={ref} className="relative">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-full bg-black/70 p-0.5 pr-2 text-sm font-bold hover:bg-gema-highlight" aria-expanded={open}>
          <span className="grid size-7 place-items-center rounded-full bg-[#535353]">
            {user?.avatar_url ? <img src={user.avatar_url} alt="" className="size-7 rounded-full" /> : <User className="size-4" />}
          </span>
          <span className="hidden max-w-32 truncate sm:inline">{user?.display_name}</span>
          <ChevronDown className="size-4" />
        </button>
        {open && (
          <div className="absolute right-0 z-40 mt-2 w-56 rounded-md bg-gema-highlight p-1 text-sm shadow-2xl" onClick={() => setOpen(false)}>
            {ticketing && (
              <Link className="block rounded px-3 py-2.5 hover:bg-white/10" to="/app/tickets">
                Tiket Saya
              </Link>
            )}
            <Link className="block rounded px-3 py-2.5 hover:bg-white/10" to="/app/settings">
              Profil & Pengaturan
            </Link>
            <Link className="block rounded px-3 py-2.5 hover:bg-white/10" to="/premium">
              Premium
            </Link>
            <hr className="my-1 border-white/10" />
            <Link className="block rounded px-3 py-2.5 hover:bg-white/10" to="/studio">
              {b2b ? 'Artist Studio' : 'Daftar sebagai Artis'}
            </Link>
            <Link className="block rounded px-3 py-2.5 hover:bg-white/10" to="/promotor">
              {promotor ? 'Promotor Hub' : 'Daftar sebagai Promotor'}
            </Link>
            {hasRole(user, 'admin') && user?.roles.includes('admin') && (
              <Link className="block rounded px-3 py-2.5 hover:bg-white/10" to={isSuperAdmin(user) ? '/admin/platform' : '/admin'}>
                {isSuperAdmin(user) ? 'Super Admin' : 'Back Office'}
              </Link>
            )}
            <hr className="my-1 border-white/10" />
            <button onClick={logout} className="flex w-full items-center gap-2 rounded px-3 py-2.5 text-left hover:bg-white/10">
              <LogOut className="size-4" /> Keluar
            </button>
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
  const [q, setQ] = useState(new URLSearchParams(loc.search).get('q') ?? '');
  useEffect(() => {
    if (!onSearch) return;
    const t = setTimeout(() => nav(q ? `/app/search?q=${encodeURIComponent(q)}` : '/app/search', { replace: true }), 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <header className={cx('sticky top-0 z-30 flex h-16 items-center justify-between gap-4 px-4 transition-colors md:px-8', scrolled ? 'bg-[#121212]/95 backdrop-blur' : 'bg-transparent')}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button onClick={() => nav(-1)} aria-label="Kembali" className="grid size-8 place-items-center rounded-full bg-black/70 text-white">
          <ChevronLeft className="size-5" />
        </button>
        <button onClick={() => nav(1)} aria-label="Maju" className="grid size-8 place-items-center rounded-full bg-black/70 text-white">
          <ChevronRight className="size-5" />
        </button>
        {onSearch && (
          <label className="relative ml-2 w-full max-w-[364px]">
            <Search className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-black" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Mau dengar apa?"
              className="h-10 w-full rounded-full bg-white pr-4 pl-10 text-sm text-black placeholder:text-[#757575] focus:outline-none"
            />
          </label>
        )}
      </div>
      {token ? (
        <UserMenu />
      ) : (
        <div className="flex items-center gap-2">
          <Link to="/login?signup=1" className="px-4 text-sm font-bold text-gema-muted hover:scale-105 hover:text-white">
            Daftar
          </Link>
          <Link to="/login" className="rounded-full bg-white px-8 py-3 text-sm font-bold text-black hover:scale-105">
            Masuk
          </Link>
        </div>
      )}
    </header>
  );
}

function PreviewBanner() {
  return (
    <div className="flex items-center justify-between gap-4 bg-gradient-to-r from-[#af2896] to-[#509bf5] px-4 py-3">
      <div>
        <p className="text-xs font-semibold tracking-[0.12em] uppercase">Pratinjau GEMA</p>
        <p className="text-sm">Daftar untuk mendengar lagu & podcast tanpa batas. Gratis, tanpa kartu kredit.</p>
      </div>
      <Link to="/login?signup=1" className="shrink-0 rounded-full bg-white px-8 py-3 text-sm font-bold text-black hover:scale-105">
        Daftar gratis
      </Link>
    </div>
  );
}

function MobileNav() {
  const item = 'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] active:bg-white/5';
  const live = useLiveNav();
  const ticketing = useModule('ticketing');
  return (
    <nav aria-label="Navigasi utama" className="flex shrink-0 border-t border-white/10 bg-black pb-[env(safe-area-inset-bottom)] md:hidden">
      <NavLink to="/app" end className={({ isActive }) => cx(item, isActive ? 'text-white' : 'text-gema-muted')}>
        <Home className="size-5" />
        Beranda
      </NavLink>
      <NavLink to="/app/search" className={({ isActive }) => cx(item, isActive ? 'text-white' : 'text-gema-muted')}>
        <Search className="size-5" />
        Cari
      </NavLink>
      <NavLink to="/app/library" className={({ isActive }) => cx(item, isActive ? 'text-white' : 'text-gema-muted')}>
        <Library className="size-5" />
        Koleksi
      </NavLink>
      {live.enabled && (
        <NavLink to="/app/live" className={({ isActive }) => cx(item, 'relative', isActive ? 'text-white' : 'text-gema-muted')}>
          <Radio className="size-5" />
          Live
          {live.anyLive && (
            <span className="absolute top-1.5 right-[calc(50%-14px)]">
              <LiveDot />
            </span>
          )}
        </NavLink>
      )}
      {ticketing && (
        <NavLink to="/app/events" className={({ isActive }) => cx(item, isActive ? 'text-white' : 'text-gema-muted')}>
          <Ticket className="size-5" />
          Event
        </NavLink>
      )}
    </nav>
  );
}

/** Shell aplikasi fan (mockup UI UX Spotify 1–10): sidebar hitam, kanvas gelap, player bar bawah. */
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
    <div className="flex h-full flex-col bg-black">
      <PlatformBanner />
      <div className="relative flex min-h-0 flex-1">
        <Sidebar />
        <main ref={mainRef} onScroll={(e) => setScrolled((e.target as HTMLElement).scrollTop > 40)} className="gema-scroll relative min-w-0 flex-1 overflow-y-auto bg-gema-base">
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
