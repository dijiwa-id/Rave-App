import { useEffect, useRef, useState } from 'react';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronDown, Moon, Sun, ChevronLeft, ChevronRight, Download, Heart, Monitor, Smartphone, Home, LayoutGrid, Library, LogOut, Radio, Search, Sparkles, Ticket, User } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtSize, useAppDownloads } from '@/lib/appDownloads';
import { useDict } from '@/lib/i18n';
import { hasRole, isSuperAdmin, useAuth } from '@/stores/auth';
import { RaveLogo } from '@/components/ui/RaveLogo';
import { cx } from '@/components/ui';
import { usePlayer } from '@/stores/player';
import { usePrefs } from '@/stores/prefs';
import { PlatformBanner } from '@/components/PlatformBanner';
import { setting, usePlatformConfig } from '@/lib/platform';
import { useAnyLive } from '@/components/live/common';
import { useModule } from '@/components/ModuleGate';
import { useMediaSession, usePlayerShortcuts } from '@/lib/playerControls';
import { PlayerBar } from './PlayerBar';
import { useApplyPlayerTheme, usePlayerTheme } from '@/lib/theme';
import { setPlayerTheme } from '@/lib/playerTheme';
import { AdBreakOverlay } from './AdBreak';
import { LEFT, RIGHT, useLayout, useLeftRoomy, useMediaQuery, useRightDocked, useRightOpen } from '@/stores/layout';
import { LibraryPanel } from './shell/LibraryPanel';
import { NowPlayingPanel } from './shell/NowPlayingPanel';
import { ResizeHandle } from './shell/bits';

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

/** Tombol ikon header: kotak bertinta + bayangan sablon (gaya kartu RAVE); hover/aktif mustard. */
const HDR_BTN =
  'relative grid size-9 shrink-0 place-items-center border-2 border-rave-ink bg-[#1e1c1f] text-rave-paper shadow-[3px_3px_0_#0b0a0c] transition hover:-translate-y-px hover:bg-rave-primary hover:text-rave-on-primary active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:pointer-events-none disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rave-primary';
const MENU_ITEM = 'flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-bold text-rave-paper/85 transition hover:bg-rave-primary hover:text-rave-on-primary';

/** Tombol unduh header: menu langsung ke installer Windows & APK Android terbaru (+ halaman /unduh). */
function DownloadMenu() {
  const d = useDict('common');
  const a = d.apps;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const q = useAppDownloads();
  const m = q.data ?? {};
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const items = [
    { key: 'win', icon: Monitor, name: a.windows, hint: a.windowsHint, asset: m.desktop?.installer, version: m.desktop?.version },
    { key: 'android', icon: Smartphone, name: a.android, hint: a.androidHint(m.android?.min_android ?? '7.0'), asset: m.android?.apk, version: m.android?.version },
  ];
  return (
    <div ref={ref} className="relative hidden xl:block">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" title={d.layout.installApp} aria-label={d.layout.installApp} className={cx(HDR_BTN, open && 'translate-x-[2px] translate-y-[2px] !shadow-none')}>
        <Download className="size-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-3 w-72 border-2 border-rave-ink bg-[#1e1c1f] text-sm shadow-[6px_6px_0_#F4C21F]" onClick={() => setOpen(false)}>
          <p className="border-b-2 border-dashed border-white/15 px-3 py-3 font-label text-[11px] font-bold tracking-[0.1em] text-rave-primary-text uppercase">{a.title}</p>
          <div className="p-1">
            {items.map(({ key, icon: Icon, name, hint, asset, version }) =>
              asset ? (
                <a key={key} role="menuitem" href={asset.url} download={asset.file} className={cx(MENU_ITEM, 'items-start')}>
                  <Icon className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block">{a.download} {name}</span>
                    <span className="block text-xs font-normal opacity-70">
                      {version && `v${version} · `}
                      {fmtSize(asset.size)} · {hint}
                    </span>
                  </span>
                </a>
              ) : (
                <span key={key} role="menuitem" aria-disabled className={cx(MENU_ITEM, 'pointer-events-none items-start opacity-50')}>
                  <Icon className="mt-0.5 size-4 shrink-0" />
                  <span>
                    <span className="block">{name}</span>
                    <span className="block text-xs font-normal">{q.isLoading ? '…' : a.soon}</span>
                  </span>
                </span>
              ),
            )}
          </div>
          <div className="border-t-2 border-dashed border-white/15 p-1">
            <Link role="menuitem" to="/unduh" className={MENU_ITEM}>
              {a.allOptions}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const user = useAuth((s) => s.user);
  const refreshToken = useAuth((s) => s.refreshToken);
  const clear = useAuth((s) => s.clear);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ticketing = useModule('ticketing');
  const podcasts = useModule('podcasts');
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
          {user?.verified && <VerifiedBadge size={14} className="hidden sm:inline-block" />}
          <ChevronDown className={cx('size-4 text-white/60 transition', open && 'rotate-180')} />
        </button>
        {open && (
          <div role="menu" className="absolute right-0 z-40 mt-3 w-64 border-2 border-rave-ink bg-[#1e1c1f] text-sm shadow-[6px_6px_0_#F4C21F]" onClick={() => setOpen(false)}>
            <div className="border-b-2 border-dashed border-white/15 px-3 py-3">
              <p className="flex items-center gap-1.5 truncate font-bold text-rave-paper">
                <span className="truncate">{user?.display_name}</span>
                {user?.verified && <VerifiedBadge size={15} />}
              </p>
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
              <Link role="menuitem" className={MENU_ITEM} to="/app/settings#downloads">
                <Download className="size-4" /> {d.layout.devicesDownloads}
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
              {podcasts && (
                <Link role="menuitem" className={MENU_ITEM} to="/podcaster">
                  {user?.orgs.some((o) => o.type === 'CREATOR') ? 'Podcaster Studio' : d.layout.registerPodcaster}
                </Link>
              )}
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

/** Kotak cari global (header ≥ md): mengetik membuka /app/search?q=… (debounce); Ctrl+K atau "/" memfokuskan. */
function SearchBox() {
  const nav = useNavigate();
  const loc = useLocation();
  const d = useDict('common');
  const onSearch = loc.pathname.startsWith('/app/search');
  const urlQ = onSearch ? (new URLSearchParams(loc.search).get('q') ?? '') : '';
  const [q, setQ] = useState(urlQ);
  const ref = useRef<HTMLInputElement>(null);
  const typed = useRef(false);
  // Keluar dari halaman cari → kosongkan; masuk dengan ?q= → isi.
  useEffect(() => {
    if (!typed.current) setQ(urlQ);
  }, [urlQ]);
  useEffect(() => {
    if (!typed.current) return;
    const t = setTimeout(() => {
      typed.current = false;
      const to = q ? `/app/search?q=${encodeURIComponent(q)}` : '/app/search';
      nav(to, { replace: onSearch });
    }, 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        typed.current = false;
        nav(q ? `/app/search?q=${encodeURIComponent(q)}` : '/app/search', { replace: onSearch });
      }}
      className="group relative w-full max-w-[480px]"
    >
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-rave-muted transition-colors group-focus-within:text-rave-primary" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => {
          typed.current = true;
          setQ(e.target.value);
        }}
        onFocus={() => !onSearch && !q && nav('/app/search')}
        placeholder={d.layout.searchPlaceholder}
        aria-label={d.layout.search}
        title="Ctrl+K"
        className="h-11 w-full border-2 border-rave-ink bg-[#1e1c1f] pr-14 pl-11 text-[15px] text-rave-paper shadow-[3px_3px_0_#0b0a0c] outline outline-1 -outline-offset-3 outline-white/[0.06] transition placeholder:text-rave-subtle hover:bg-[#242126] focus:border-rave-primary focus:bg-[#242126] focus:shadow-[3px_3px_0_#F4C21F] focus:outline-none"
      />
      <Link to="/app/search" title={d.shell.browse} aria-label={d.shell.browse} className="absolute inset-y-[2px] right-[2px] grid w-11 place-items-center border-l border-white/10 text-rave-muted transition hover:bg-rave-primary hover:text-rave-on-primary">
        <LayoutGrid className="size-5" />
      </Link>
    </form>
  );
}

/**
 * Saklar cepat Gelap ↔ Terang — hanya untuk TAMU (Pengaturan wajib login). Pengguna yang masuk memilih tema di
 * Pengaturan → Tampilan (Gelap / Terang / Sistem, tersinkron ke akun). Disembunyikan bila Super Admin mengunci tema.
 */
function ThemeQuickToggle() {
  const accountTheme = useAuth((s) => s.user?.theme);
  const { resolved, allowUser } = usePlayerTheme(accountTheme);
  const d = useDict('common').shell;
  if (!allowUser) return null;
  const toLight = resolved === 'dark';
  const label = toLight ? d.themeToLight : d.themeToDark;
  return (
    <button type="button" onClick={() => void setPlayerTheme(toLight ? 'light' : 'dark')} title={label} aria-label={label} className={HDR_BTN}>
      {toLight ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

/** Header global (≥ md): logo · Beranda + cari · Premium, notifikasi, akun. */
function GlobalHeader() {
  const token = useAuth((s) => s.accessToken);
  const lightTheme = usePlayerTheme(useAuth((s) => s.user?.theme)).resolved === 'light';
  const premium = useAuth((s) => !!s.user?.premium);
  const d = useDict('common');
  return (
    <header className="hidden h-16 shrink-0 items-center gap-4 px-4 md:flex">
      <div className="flex w-[200px] shrink-0 items-center lg:w-[260px]">
        <Link to="/" aria-label={d.layout.homeAria}>
          <RaveLogo className="!h-9" dark={lightTheme} />
        </Link>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        <NavLink to="/app" end aria-label={d.layout.home} title={d.layout.home} className={({ isActive }) => cx(HDR_BTN, '!size-11', isActive && '!bg-rave-primary !text-rave-on-primary')}>
          <Home className="size-5" />
        </NavLink>
        <SearchBox />
      </div>
      <div className="flex shrink-0 items-center justify-end gap-3 lg:min-w-[260px]">
        {token && !premium && (
          <Link to="/premium" className="rave-btn hidden -rotate-2 items-center gap-1.5 border-2 border-rave-ink bg-rave-paper px-3 py-1.5 font-label text-[11px] font-bold tracking-[0.1em] text-rave-ink uppercase hover:rotate-0 lg:flex">
            <Sparkles className="size-3.5" /> {d.shell.premium}
          </Link>
        )}
        {!token && <ThemeQuickToggle />}
        <DownloadMenu />
        {token ? (
          <UserMenu />
        ) : (
          <div className="flex items-center gap-2">
            <Link to="/login?signup=1" className="px-3 text-sm font-bold text-white/70 transition hover:text-rave-paper">
              {d.layout.signUp}
            </Link>
            <Link to="/login" className="rave-label border-2 border-rave-ink bg-rave-primary px-5 py-2.5 !text-[11.5px] text-rave-on-primary shadow-[3px_3px_0_#0b0a0c] transition hover:-translate-y-px hover:bg-rave-paper">
              {d.layout.logIn}
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}

/** Bar di dalam panel tengah: maju/mundur (semua layar); akun & kotak cari halaman Cari hanya di ponsel. */
function PanelBar({ scrolled }: { scrolled: boolean }) {
  const nav = useNavigate();
  const loc = useLocation();
  const token = useAuth((s) => s.accessToken);
  const onSearch = loc.pathname.startsWith('/app/search');
  const d = useDict('common');
  const [q, setQ] = useState(new URLSearchParams(loc.search).get('q') ?? '');
  const mobile = !useMediaQuery('(min-width: 768px)');
  useEffect(() => {
    if (!onSearch || !mobile) return;
    const t = setTimeout(() => nav(q ? `/app/search?q=${encodeURIComponent(q)}` : '/app/search', { replace: true }), 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <header className={cx('sticky top-0 z-30 flex h-16 items-center justify-between gap-4 px-4 transition-colors md:px-6', scrolled ? 'border-b border-white/[0.06] bg-rave-base/90 backdrop-blur-md' : 'bg-transparent')}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button onClick={() => nav(-1)} aria-label={d.layout.back} title={d.layout.back} className={HDR_BTN}>
          <ChevronLeft className="size-5" />
        </button>
        <button onClick={() => nav(1)} aria-label={d.layout.forward} title={d.layout.forward} className={cx(HDR_BTN, onSearch && mobile && 'hidden')}>
          <ChevronRight className="size-5" />
        </button>
        {onSearch && mobile && (
          <label className="relative ml-1 min-w-0 flex-1">
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
      <div className="md:hidden">
        {token ? (
          <UserMenu />
        ) : (
          <div className="flex items-center gap-2">
            <Link to="/login?signup=1" className="px-3 text-sm font-bold text-white/70 transition hover:text-rave-paper">
              {d.layout.signUp}
            </Link>
            <Link to="/login" className="rave-label border-2 border-rave-ink bg-rave-primary px-5 py-2.5 !text-[11.5px] text-rave-on-primary shadow-[3px_3px_0_#0b0a0c] transition hover:-translate-y-px hover:bg-rave-paper">
              {d.layout.logIn}
            </Link>
          </div>
        )}
      </div>
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

/** "[" ciutkan/bentangkan Library, "]" buka/tutup panel Sedang Diputar (bukan saat mengetik). */
function usePanelShortcuts() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === '[') useLayout.getState().toggleLeft();
      else if (e.key === ']') useLayout.getState().toggleRight('now');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
}

/**
 * Shell aplikasi fan RAVE — 3 panel (≥ md):
 *   [Side A · Library]  ┃  [kanvas halaman]  ┃  [Side B · Sedang Diputar]
 * Library bisa diciutkan jadi rel ikon & diubah lebarnya (seret/klik-ganda pegangan, tombol "["); md–lg selalu rel.
 * Panel kanan menempel di ≥ 1280px dan menjadi laci di atas kanvas di bawahnya ("]" / tombol di pemutar).
 * < md: tata letak ponsel lama (kanvas penuh + mini-player + nav bawah).
 */
export function FanLayout() {
  const token = useAuth((s) => s.accessToken);
  const accountTheme = useAuth((s) => s.user?.theme);
  const theme = usePlayerTheme(accountTheme);
  useApplyPlayerTheme(theme.resolved);
  const hasCurrent = usePlayer((s) => !!s.current);
  useMediaSession();
  usePlayerShortcuts();
  usePanelShortcuts();
  const mainRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();
  const desktop = useMediaQuery('(min-width: 768px)');
  const roomy = useLeftRoomy();
  const docked = useRightDocked();
  const L = useLayout();
  const rightAvailable = useMediaQuery('(min-width: 1024px)');
  const rail = !roomy || L.leftCollapsed;
  const rightOpen = useRightOpen();
  const showRight = rightAvailable && rightOpen;
  const d = useDict('common');
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [loc.pathname]);
  // Preferensi "Buka panel Sedang Diputar saat memutar": lagu baru mulai → buka Side B (hanya mode menempel).
  useEffect(
    () =>
      usePlayer.subscribe((s, prev) => {
        if (!s.current || s.current.id === prev.current?.id) return;
        if (!usePrefs.getState().autoOpenNowPlaying || !window.matchMedia('(min-width: 1280px)').matches) return;
        const l = useLayout.getState();
        if (!l.rightOpen) useLayout.setState({ rightOpen: true, rightView: 'now' });
      }),
    [],
  );
  // Laci kanan (layar sedang): pindah halaman → tutup.
  useEffect(() => {
    if (useLayout.getState().drawerOpen) useLayout.setState({ drawerOpen: false });
  }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div data-fan-shell className="flex h-full flex-col bg-rave-black">
      <PlatformBanner />
      <GlobalHeader />
      <div className="relative flex min-h-0 flex-1 md:px-2 md:pb-2">
        {desktop && (
          <>
            <div className="h-full shrink-0" style={{ width: rail ? LEFT.rail : L.leftWidth }}>
              <LibraryPanel rail={rail} />
            </div>
            {roomy ? (
              <ResizeHandle
                side="left"
                width={rail ? LEFT.rail : L.leftWidth}
                label={d.shell.resize}
                onResize={(w) => {
                  if (rail && w > LEFT.rail + 60) L.setLeftCollapsed(false);
                  if (!rail) L.setLeftWidth(w);
                }}
                onRelease={(raw) => !rail && raw < LEFT.min - 70 && L.setLeftCollapsed(true)}
                onToggle={L.toggleLeft}
              />
            ) : (
              <div className="w-2 shrink-0" />
            )}
          </>
        )}
        <div className="shell-main relative min-w-0 flex-1 overflow-hidden md:border-white/[0.06]">
          <main ref={mainRef} onScroll={(e) => setScrolled((e.target as HTMLElement).scrollTop > 40)} className="rave-scroll rave-app-canvas relative h-full overflow-y-auto">
            <PanelBar scrolled={scrolled} />
            <div className="-mt-16">
              <Outlet />
            </div>
          </main>
          {/* Jeda iklan tier Gratis — menutupi kanvas, pemutar tetap terlihat (docs/API.md §11) */}
          <AdBreakOverlay />
          {showRight && !docked && (
            <>
              <button aria-label={d.shell.closePanel} onClick={L.closeRight} className="absolute inset-0 z-30 bg-black/40 backdrop-blur-[1px]" />
              <div className="shell-drawer absolute inset-y-0 right-0 z-40 shadow-[-12px_0_32px_rgb(0_0_0/0.5)]" style={{ width: L.rightWidth }}>
                <NowPlayingPanel />
              </div>
            </>
          )}
        </div>
        {showRight && docked && (
          <>
            <ResizeHandle side="right" width={L.rightWidth} label={d.shell.resize} onResize={L.setRightWidth} onRelease={(raw) => raw < RIGHT.min - 80 && L.closeRight()} onToggle={L.closeRight} />
            <div className="h-full shrink-0" style={{ width: L.rightWidth }}>
              <NowPlayingPanel />
            </div>
          </>
        )}
      </div>
      {(token || hasCurrent) && <PlayerBar />}
      {!token && <PreviewBanner />}
      <MobileNav />
    </div>
  );
}
