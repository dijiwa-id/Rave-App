import { Fragment, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { motion, useReducedMotion } from 'motion/react';
import { Bell, ChevronDown, Headphones, LogOut, Menu, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Sun, X } from 'lucide-react';
import { cx } from '@/components/ui';
import { api, fmt } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { PlatformBanner } from '@/components/PlatformBanner';
import { RaveLogo } from '@/components/ui/RaveLogo';
import { useBranding } from '@/lib/platform';
import { useDict } from '@/lib/i18n';
import { useApplyDashboardTheme, useDashboardTheme, useThemePref, type ThemeChoice } from '@/lib/theme';

export interface B2BNavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
  /** Judul seksi yang dirender di atas item ini (opsional; item tanpa `section` mengikuti seksi sebelumnya). */
  section?: string;
}

/** Sidebar diciutkan (desktop) — diingat per perangkat. */
const useSidebar = create<{ collapsed: boolean; toggle: () => void }>()(
  persist((set) => ({ collapsed: false, toggle: () => set((s) => ({ collapsed: !s.collapsed })) }), { name: 'rave-b2b-sidebar' }),
);

// Label diambil dari kamus saat render (bukan konstanta modul) agar mengikuti bahasa aktif.
const THEME_OPTIONS: { value: ThemeChoice; icon: ComponentType<{ className?: string }> }[] = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

/** Tutup popover saat klik di luar atau tekan Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

/** Pemilih tema ringkas di header (disembunyikan bila Super Admin mengunci tema). */
/** Tombol ikon header dasbor: kotak bertinta + bayangan sablon tipis (sama dengan header aplikasi dengar). */
const HDR_BTN =
  'relative grid size-9 shrink-0 place-items-center border-2 border-b2b-ink/85 bg-b2b-card text-b2b-ink shadow-[2px_2px_0_var(--b2b-card-border)] transition hover:-translate-y-px hover:bg-rave-primary hover:text-rave-ink active:translate-x-[2px] active:translate-y-[2px] active:shadow-none';

function ThemeMenu() {
  const { choice, allowUser, platformDefault, pref, resolved } = useDashboardTheme();
  const setPref = useThemePref((s) => s.set);
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const d = useDict('common');
  if (!allowUser) return null;
  const Current = resolved === 'dark' ? Moon : Sun;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-label={d.b2b.theme.menu}
        aria-expanded={open}
        className={HDR_BTN}
      >
        <Current className="size-[18px]" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-48 rounded-none border border-b2b-line bg-b2b-card p-1.5 shadow-xl">
          {THEME_OPTIONS.map((o) => (
            <button
              key={o.value}
              role="menuitemradio"
              aria-checked={choice === o.value}
              // Memilih default platform = kembali mengikuti default (bila Super Admin mengubahnya nanti, ikut berubah).
              onClick={() => {
                setPref(o.value === platformDefault ? null : o.value);
                setOpen(false);
              }}
              className={cx(
                'flex w-full items-center gap-2.5 rounded-none px-3 py-2 text-left text-sm font-semibold transition',
                choice === o.value ? 'bg-b2b-ink/5 text-b2b-ink' : 'text-b2b-muted hover:bg-b2b-ink/5 hover:text-b2b-ink',
              )}
            >
              <o.icon className="size-4" />
              <span className="flex-1">{d.b2b.theme[o.value]}</span>
              {o.value === platformDefault && !pref && <span className="text-[10px] font-bold text-b2b-muted uppercase">{d.b2b.theme.default}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface NotificationItem {
  id: string;
  category: string;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/**
 * Lonceng notifikasi dasbor (booking, pembayaran, pencairan, QC) — endpoint & cache `['unread']` sama dengan aplikasi dengar,
 * sehingga tautan /studio/… dan /promotor/… dari service notifikasi bisa dibuka langsung dari dasbor.
 */
function NotificationMenu() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const d = useDict('common');
  const unread = useQuery({ queryKey: ['unread'], queryFn: () => api<{ unread: number }>('/v1/notifications/unread-count'), refetchInterval: 30_000 });
  const list = useQuery({
    queryKey: ['notifications', 'b2b-menu'],
    queryFn: () => api<{ data: NotificationItem[] }>('/v1/notifications', { query: { limit: 12 } }),
    enabled: open,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['unread'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  async function openItem(n: NotificationItem) {
    setOpen(false);
    if (!n.read_at) await api(`/v1/notifications/${n.id}/read`, { body: {} }).catch(() => {});
    refresh();
    if (n.link) navigate(n.link);
  }
  async function readAll() {
    await api('/v1/notifications/read-all', { body: {} }).catch(() => {});
    refresh();
  }
  const count = unread.data?.unread ?? 0;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-label={count ? d.b2b.notificationsUnread(count) : d.b2b.notifications}
        aria-expanded={open}
        className={HDR_BTN}
      >
        <Bell className="size-[18px]" />
        {count > 0 && (
          <span className="absolute -top-2 -right-2 grid h-[18px] min-w-[18px] rotate-[6deg] place-items-center border-2 border-rave-ink bg-rave-primary px-1 font-label text-[10px] leading-none font-bold text-rave-ink">{count > 99 ? '99+' : count}</span>
        )}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-3 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-none border-2 border-[var(--b2b-card-border)] bg-b2b-card shadow-[5px_5px_0_var(--color-rave-mustard)]">
          <div className="flex items-center justify-between border-b border-b2b-line px-4 py-3">
            <p className="text-sm font-extrabold">{d.b2b.notifications}</p>
            {count > 0 && (
              <button onClick={readAll} className="text-xs font-bold text-b2b-muted hover:text-b2b-ink">
                {d.b2b.markAllRead}
              </button>
            )}
          </div>
          <div className="max-h-[28rem] overflow-y-auto p-1.5">
            {list.isLoading ? (
              <p className="px-3 py-6 text-center text-sm text-b2b-muted">{d.ui.loadingEllipsis}</p>
            ) : !list.data?.data.length ? (
              <p className="px-3 py-6 text-center text-sm text-b2b-muted">{d.b2b.noNotifications}</p>
            ) : (
              list.data.data.map((n) => (
                <button
                  key={n.id}
                  role="menuitem"
                  onClick={() => openItem(n)}
                  className="flex w-full gap-3 rounded-none px-3 py-2.5 text-left transition hover:bg-b2b-ink/5"
                >
                  <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-rave-primary')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cx('block text-sm', n.read_at ? 'font-semibold text-b2b-muted' : 'font-bold text-b2b-ink')}>{n.title}</span>
                    <span className="mt-0.5 block text-xs text-b2b-muted">{n.body}</span>
                    <span className="mt-1 block text-[11px] text-b2b-muted/80">{fmt.dateTime(n.created_at)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const initials = (name?: string | null) =>
  (name ?? '?')
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

/** Menu pengguna di header: identitas, peran, kembali ke aplikasi dengar, keluar. */
function UserMenu({ roleLabel }: { roleLabel?: string }) {
  const user = useAuth((s) => s.user);
  const refreshToken = useAuth((s) => s.refreshToken);
  const clear = useAuth((s) => s.clear);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const d = useDict('common');
  async function logout() {
    try {
      await api('/v1/auth/logout', { body: { refresh_token: refreshToken } });
    } catch {
      /* abaikan */
    }
    clear();
    navigate('/');
    qc.clear(); // buang cache data pengguna sebelumnya
  }
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={d.b2b.accountMenu}
        className={cx(
          'flex h-10 items-center gap-2.5 border-2 border-b2b-ink/85 bg-b2b-card pr-1 text-left shadow-[2px_2px_0_var(--b2b-card-border)] transition hover:-translate-y-px md:pr-2.5',
          open && 'translate-x-[2px] translate-y-[2px] !shadow-none',
        )}
      >
        <span className="grid size-9 shrink-0 place-items-center border-r-2 border-b2b-ink/85 bg-rave-purple font-display text-base leading-none text-rave-primary-text">
          {initials(user?.display_name)}
        </span>
        <span className="hidden min-w-0 md:block">
          <span className="block max-w-[11rem] truncate text-[13px] leading-tight font-bold">{user?.display_name}</span>
          {roleLabel && <span className="block font-label text-[9.5px] leading-tight font-bold tracking-[0.12em] text-b2b-muted uppercase">{roleLabel}</span>}
        </span>
        <ChevronDown className={cx('size-4 text-b2b-muted transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-3 w-64 rounded-none border-2 border-[var(--b2b-card-border)] bg-b2b-card p-1.5 shadow-[5px_5px_0_var(--color-rave-mustard)]">
          <div className="px-3 py-2.5">
            <p className="truncate text-sm font-bold">{user?.display_name}</p>
            <p className="truncate text-xs text-b2b-muted">{user?.email}</p>
            {roleLabel && <span className="mt-2 inline-block rounded-none bg-b2b-ink/5 px-2 py-0.5 text-[11px] font-bold">{roleLabel}</span>}
          </div>
          <div className="my-1 h-px bg-b2b-line" />
          <div className="px-3 py-2">
            <LanguageSwitch tone="auto" />
          </div>
          <div className="my-1 h-px bg-b2b-line" />
          <button role="menuitem" onClick={() => navigate('/app')} className="flex w-full items-center gap-2.5 rounded-none px-3 py-2 text-left text-sm font-semibold text-b2b-muted hover:bg-b2b-ink/5 hover:text-b2b-ink">
            <Headphones className="size-4" /> {d.b2b.backToListening}
          </button>
          <button role="menuitem" onClick={logout} className="flex w-full items-center gap-2.5 rounded-none px-3 py-2 text-left text-sm font-semibold text-b2b-muted hover:bg-b2b-ink/5 hover:text-b2b-ink">
            <LogOut className="size-4" /> {d.b2b.logout}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Shell dasbor B2B (Artist Studio, Promotor Hub, Back Office) — terang default (BRD §12.1), gelap bila dipilih
 * di Super Admin → Branding & Tema atau oleh pengguna. Logo & nama dari branding platform.
 * - Sidebar: logo + navigasi; dapat diciutkan menjadi rel ikon (desktop), menjadi drawer di layar < lg.
 * - Header: tombol sidebar, nama produk, pemilih tema, menu pengguna.
 * `context` = slot pemilih (mis. artis/org) — di sidebar saat terbuka, di header saat sidebar diciutkan.
 * `roleLabel` = peran yang ditampilkan di menu pengguna (mis. "Super Admin").
 */
export function B2BLayout({ product, accent, nav, context, roleLabel }: { product: string; accent: string; nav: B2BNavItem[]; context?: ReactNode; roleLabel?: string }) {
  const [drawer, setDrawer] = useState(false);
  const { collapsed, toggle } = useSidebar();
  const brand = useBranding();
  const { resolved } = useDashboardTheme();
  useApplyDashboardTheme(resolved);
  const location = useLocation();
  useEffect(() => setDrawer(false), [location.pathname]);
  const reduce = useReducedMotion();
  const d = useDict('common');

  /** `rail` = mode ikon (sidebar diciutkan di desktop). */
  const sidebar = (rail: boolean) => (
    <div className="flex h-full flex-col">
      <div className={cx('flex h-16 shrink-0 items-center border-b border-b2b-line', rail ? 'justify-center px-2' : 'px-5')}>
        <Link to="/" aria-label={d.b2b.homeOf(brand.name)} className="flex h-full items-center">
          {rail ? <img src={brand.icon} alt="" className="size-9 object-contain" /> : <RaveLogo className="h-9 max-w-[190px]" />}
        </Link>
      </div>
      {context && !rail && <div className="px-3 pt-4">{context}</div>}
      <nav className={cx('flex-1 overflow-x-hidden overflow-y-auto py-3', rail ? 'px-2' : 'px-3')} aria-label={d.b2b.navOf(product)}>
        {nav.map((n, i) => (
          <Fragment key={n.to}>
            {n.section &&
              (rail ? (
                <div className="mx-2 my-3 h-px bg-b2b-line" aria-hidden />
              ) : (
                <p className={cx('rave-label px-3 pb-1.5 !text-[10px] text-b2b-muted/80', i ? 'pt-5' : 'pt-1')}>{n.section}</p>
              ))}
            <NavLink
              to={n.to}
              end={n.end}
              title={rail ? n.label : undefined}
              aria-label={rail ? n.label : undefined}
              className={({ isActive }) =>
                cx(
                  'relative isolate mb-0.5 flex items-center rounded-none text-sm font-semibold transition-colors',
                  rail ? 'size-10 justify-center' : 'gap-3 px-3 py-2',
                  isActive ? 'text-b2b-on-ink' : 'text-b2b-muted hover:bg-b2b-ink/5 hover:text-b2b-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* Indikator aktif mustard RAVE — meluncur antar item saat berpindah halaman. */}
                  {isActive && (
                    <motion.span
                      layoutId={`b2b-nav-${product}-${rail ? 'rail' : 'full'}`}
                      className="absolute inset-0 -z-10 rounded-none bg-b2b-ink"
                      transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                      aria-hidden
                    />
                  )}
                  <n.icon className="size-[18px] shrink-0" />
                  {!rail && <span className="truncate">{n.label}</span>}
                </>
              )}
            </NavLink>
          </Fragment>
        ))}
      </nav>
    </div>
  );

  return (
    <div className="b2b-canvas flex h-full bg-b2b-bg text-b2b-ink">
      <aside className={cx('rave-rail rave-grain hidden shrink-0 border-r border-b2b-line bg-b2b-bg text-b2b-ink transition-[width] duration-200 lg:block', collapsed ? 'w-[68px]' : 'w-64')}>{sidebar(collapsed)}</aside>

      {drawer && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden" onClick={() => setDrawer(false)}>
          <aside className="rave-rail relative h-full w-72 max-w-[85vw] animate-[rave-pop_.22s_ease-out] bg-b2b-bg text-b2b-ink shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setDrawer(false)} aria-label={d.b2b.closeMenu} className="absolute top-4 right-3 grid size-8 place-items-center rounded-none text-b2b-muted hover:bg-b2b-ink/5">
              <X className="size-5" />
            </button>
            {sidebar(false)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <PlatformBanner />
        {/* z-30: backdrop-filter .b2b-chrome membentuk stacking context — tanpa z-index, kartu ber-transform di <main>
            (dirender belakangan) menimpa dropdown header. Tetap di bawah drawer (z-40). */}
        <header className="b2b-chrome relative z-30 flex h-16 shrink-0 items-center gap-2 border-b-2 border-[var(--b2b-card-border)] px-3 sm:gap-3 md:px-5">
          {/* pita aksen sablon di tepi bawah header (mustard → ungu) */}
          <span className="pointer-events-none absolute inset-x-0 -bottom-[2px] h-[2px] bg-[linear-gradient(90deg,#f4c21f_0_12%,#5b2a6e_12%_24%,transparent_24%)]" aria-hidden />
          <button onClick={() => setDrawer(true)} aria-label={d.b2b.openMenu} className={cx(HDR_BTN, 'lg:hidden')}>
            <Menu className="size-5" />
          </button>
          <button
            onClick={toggle}
            aria-label={collapsed ? d.b2b.expandSidebar : d.b2b.collapseSidebar}
            title={collapsed ? d.b2b.expandSidebar : d.b2b.collapseSidebar}
            className={cx(HDR_BTN, 'hidden lg:grid')}
          >
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </button>
          <img src={brand.icon} alt="" className="size-7 object-contain lg:hidden" />
          <p className="flex min-w-0 items-center gap-2.5 sm:ml-1">
            <span className="hidden size-2.5 shrink-0 rotate-45 border border-rave-ink sm:block" style={{ background: accent }} aria-hidden />
            <span className="truncate font-display text-xl leading-none tracking-wide uppercase">{product}</span>
          </p>
          {context && collapsed && <div className="ml-2 hidden w-56 lg:block [&_span]:hidden">{context}</div>}
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <NotificationMenu />
            <ThemeMenu />
            <div className="mx-1 hidden h-7 w-0.5 bg-b2b-line sm:block" aria-hidden />
            <UserMenu roleLabel={roleLabel} />
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <motion.div
            key={location.pathname}
            className="w-full px-4 py-5 sm:px-6 sm:py-6 xl:px-8 xl:py-8 2xl:px-10"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}
