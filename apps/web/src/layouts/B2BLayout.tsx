import { useState, type ComponentType } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ArrowLeft, Menu, X } from 'lucide-react';
import { GemaMark } from '@/components/ui/GemaLogo';
import { cx } from '@/components/ui';
import { useAuth } from '@/stores/auth';

export interface B2BNavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
}

/**
 * Shell dasbor B2B (Artist Studio, Promotor Hub, Back Office) — mode terang (BRD §12.1).
 * `context` = slot di atas navigasi (mis. pemilih artis/org).
 */
export function B2BLayout({ product, accent, nav, context }: { product: string; accent: string; nav: B2BNavItem[]; context?: React.ReactNode }) {
  const user = useAuth((s) => s.user);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const sidebar = (
    <div className="flex h-full flex-col">
      <Link to="/" className="flex items-center gap-2.5 px-5 py-5">
        <GemaMark className="size-8" invert />
        <span className="leading-tight">
          <span className="block text-lg font-extrabold tracking-tight text-b2b-ink">Gema</span>
          <span className="block text-[11px] font-bold tracking-[0.14em] uppercase" style={{ color: accent }}>
            {product}
          </span>
        </span>
      </Link>
      {context && <div className="px-3 pb-3">{context}</div>}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition', isActive ? 'bg-b2b-ink text-white' : 'text-b2b-muted hover:bg-black/5 hover:text-b2b-ink')
            }
          >
            <n.icon className="size-[18px]" />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-b2b-line p-4">
        <button onClick={() => navigate('/app')} className="mb-3 flex items-center gap-2 text-xs font-bold text-b2b-muted hover:text-b2b-ink">
          <ArrowLeft className="size-4" /> Kembali ke aplikasi dengar
        </button>
        <p className="truncate text-sm font-bold text-b2b-ink">{user?.display_name}</p>
        <p className="truncate text-xs text-b2b-muted">{user?.email}</p>
      </div>
    </div>
  );
  return (
    <div className="flex h-full bg-b2b-bg text-b2b-ink">
      <aside className="hidden w-64 shrink-0 border-r border-b2b-line bg-white lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-72 bg-white" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-b2b-line bg-white px-4 lg:hidden">
          <button onClick={() => setOpen(!open)} aria-label="Menu">
            {open ? <X /> : <Menu />}
          </button>
          <span className="font-extrabold">Gema {product}</span>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl p-4 md:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
