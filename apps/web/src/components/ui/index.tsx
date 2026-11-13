import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { useBranding } from '@/lib/platform';
import { dict, useDict } from '@/lib/i18n';
import { create } from 'zustand';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

// ---------- Button ----------
/**
 * Satu sistem tombol untuk seluruh aplikasi: semua varian memakai border 2px, tinggi tetap per ukuran, ikon berukuran
 * seragam, dan (varian dasbor) bayangan sablon + umpan balik tekan yang sama — lihat `.rave-btn` di index.css.
 * Tombol tanpa label (ikon saja) otomatis persegi.
 */
type Variant = 'primary' | 'white' | 'outline' | 'ghost' | 'dark' | 'danger' | 'ink' | 'outline-ink';
const variants: Record<Variant, string> = {
  primary: 'rave-btn border-rave-ink bg-rave-primary text-rave-on-primary [--btn-shadow:#0b0a0c] hover:bg-rave-primary-hover',
  white: 'rave-btn border-rave-ink bg-rave-paper text-rave-ink [--btn-shadow:#0b0a0c]',
  outline: 'rave-btn rave-btn--flat border-white/40 text-white hover:border-white',
  ghost: 'rave-btn rave-btn--flat border-transparent text-rave-muted hover:text-white',
  dark: 'rave-btn rave-btn--flat border-transparent bg-rave-highlight text-white hover:bg-[#3e3e3e]',
  danger: 'rave-btn border-transparent bg-[#dc2626] text-white hover:bg-[#e53e3e]',
  ink: 'rave-btn border-transparent bg-b2b-ink text-b2b-on-ink',
  'outline-ink': 'rave-btn border-b2b-ink bg-b2b-card text-b2b-ink hover:border-rave-accent hover:text-rave-accent',
};
const sizes = {
  sm: 'h-8 text-[11px] [&>svg]:size-3.5',
  md: 'h-10 text-[12px] [&>svg]:size-4',
  lg: 'h-12 text-[13px] [&>svg]:size-4',
};
const pads = { sm: 'px-3', md: 'px-4', lg: 'px-6' };
const squares = { sm: 'w-8', md: 'w-10', lg: 'w-12' };
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  const iconOnly = (children === undefined || children === null || children === false) && !!icon;
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-none border-2 font-label leading-none font-bold tracking-[0.08em] whitespace-nowrap uppercase select-none disabled:pointer-events-none disabled:opacity-50 [&>svg]:shrink-0',
        variants[variant],
        sizes[size],
        iconOnly ? squares[size] : pads[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className={size === 'sm' ? 'size-3.5' : 'size-4'} /> : icon}
      {children}
    </button>
  );
});

// ---------- Form fields (tema: dark untuk fan, light untuk B2B) ----------
type Theme = { theme?: 'dark' | 'light' };
const fieldBase = (theme: 'dark' | 'light' = 'light') =>
  theme === 'dark'
    ? 'w-full rounded-none border border-[#727272] bg-[#181818] px-3.5 py-3 text-white placeholder:text-rave-subtle focus:border-white focus:outline-none'
    : 'w-full rounded-none border-2 border-b2b-line bg-b2b-card px-3.5 py-2.5 text-b2b-ink transition hover:border-b2b-ink/40 placeholder:text-b2b-muted/70 focus:border-b2b-ink focus:shadow-[3px_3px_0_var(--color-rave-mustard)] focus:outline-none';

export function Label({ children, hint, theme = 'light' }: { children: ReactNode; hint?: string } & Theme) {
  return (
    <span className={cx('mb-1.5 block text-sm font-bold', theme === 'dark' ? 'text-white' : 'text-b2b-ink')}>
      {children}
      {hint && <span className={cx('ml-2 font-normal', theme === 'dark' ? 'text-rave-muted' : 'text-b2b-muted')}>{hint}</span>}
    </span>
  );
}
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Theme>(function Input({ theme, className, ...p }, ref) {
  return <input ref={ref} className={cx(fieldBase(theme), className)} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & Theme>(function Textarea({ theme, className, ...p }, ref) {
  return <textarea ref={ref} className={cx(fieldBase(theme), 'min-h-24', className)} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & Theme>(function Select({ theme, className, ...p }, ref) {
  return <select ref={ref} className={cx(fieldBase(theme), className)} {...p} />;
});
export function Field({ label, hint, error, children, theme = 'light' }: { label: string; hint?: string; error?: string; children: ReactNode } & Theme) {
  return (
    <label className="block">
      <Label hint={hint} theme={theme}>
        {label}
      </Label>
      {children}
      {error && <span className="mt-1 block text-xs text-red-500">{error}</span>}
    </label>
  );
}

// ---------- Feedback ----------
/** Piringan hitam (alur + label ungu + spindle) — dasar semua indikator muat RAVE. */
const DISC_BG =
  'radial-gradient(circle, #181818 0 7%, transparent 7.5%), radial-gradient(circle, #5B2A6E 0 33%, #0b0b0b 33.5% 36%, transparent 36.5%), repeating-radial-gradient(circle, #0d0d0d 0 1.5px, #1a1a1a 1.5px 2.6px)';

/** Indikator muat mini: piringan berputar (tanpa logo) — dipakai di tombol & daftar. */
export function Spinner({ className = 'size-6' }: { className?: string }) {
  const d = useDict('common');
  return (
    <span
      role="status"
      aria-label={d.ui.loading}
      className={cx('inline-block shrink-0 animate-[rave-spin_1.1s_linear_infinite] rounded-full shadow-[0_0_0_1.5px_rgba(237,237,237,0.25)] motion-reduce:animate-none', className)}
      style={{ background: DISC_BG }}
    />
  );
}

/**
 * Loader sistem RAVE: piringan berputar dengan logo RAVE tetap tegak di tengah (hanya piringan yang berputar),
 * kilau diam agar putaran terbaca, dan label "Memuat…" bergaya flyer.
 */
export function VinylLoader({ size = 120, label }: { size?: number; label?: string }) {
  const b = useBranding();
  const d = useDict('common');
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-5">
      <span className="relative block" style={{ width: size, height: size }}>
        <span className="absolute inset-0 translate-x-[3px] translate-y-[4px] rounded-full bg-black/60 blur-md" aria-hidden />
        <span className="absolute inset-0 animate-[rave-spin_1.8s_linear_infinite] rounded-full shadow-[0_0_0_2px_#050505] motion-reduce:animate-none" style={{ background: DISC_BG }} aria-hidden />
        <span
          className="absolute inset-0 rounded-full bg-[conic-gradient(from_120deg,transparent_0deg,rgba(255,255,255,0.16)_20deg,transparent_55deg,transparent_180deg,rgba(255,255,255,0.1)_200deg,transparent_235deg)]"
          aria-hidden
        />
        <img src={b.logoDark} alt="" aria-hidden className="absolute top-1/2 left-1/2 w-[28%] -translate-x-1/2 -translate-y-1/2 drop-shadow-[1px_1px_0_#0b0a0c]" />
      </span>
      <span className="rave-label text-rave-primary-text">{label ?? d.ui.loadingEllipsis}</span>
    </div>
  );
}

export function PageLoader() {
  return (
    <div className="rave-loader-bg grid min-h-[calc(100dvh-4rem)] place-items-center">
      <VinylLoader />
    </div>
  );
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-none bg-white/10', className)} />;
}
export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      {icon && <div className="opacity-70">{icon}</div>}
      <h3 className="text-xl font-bold">{title}</h3>
      {body && <p className="max-w-md text-sm opacity-70">{body}</p>}
      {action}
    </div>
  );
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const d = useDict('common');
  const msg = (error as any)?.message ?? d.ui.genericError;
  return (
    <div className="rounded-none border border-red-500/30 bg-red-500/10 p-4 text-sm">
      <p className="font-semibold text-red-400">{d.ui.loadFailed}</p>
      <p className="mt-1 opacity-80">{msg}</p>
      {retry && (
        <button onClick={retry} className="mt-2 font-bold underline">
          {d.ui.retry}
        </button>
      )}
    </div>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'green' | 'blue' | 'amber' | 'red' | 'purple'; className?: string }) {
  const tones = {
    neutral: 'bg-b2b-ink/5 text-b2b-ink border-b2b-ink/10',
    green: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
    blue: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
    amber: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
    red: 'bg-red-500/15 text-red-600 border-red-500/30',
    purple: 'bg-violet-500/15 text-violet-600 border-violet-500/30',
  };
  return <span className={cx('inline-flex shrink-0 items-center gap-1 rounded-none border px-1.5 py-0.5 font-label text-[10.5px] font-bold tracking-[0.04em] whitespace-nowrap uppercase', tones[tone], className)}>{children}</span>;
}

// ---------- Modal ----------
export function Modal({ open, onClose, title, children, theme = 'light', wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean } & Theme) {
  const d = useDict('common');
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid animate-[rave-fade_.18s_ease-out] place-items-center bg-black/55 p-4 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal aria-label={title}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={cx(
          'max-h-[90vh] w-full animate-[rave-pop_.22s_cubic-bezier(.22,1,.36,1)] overflow-y-auto rounded-none p-6 shadow-2xl',
          wide ? 'max-w-3xl' : 'max-w-lg',
          theme === 'dark' ? 'bg-rave-highlight text-white' : 'b2b-chrome border border-b2b-line text-b2b-ink',
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} aria-label={d.ui.close} className="opacity-60 hover:opacity-100">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- Toast ----------
interface ToastItem {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}
export const useToast = create<{ items: ToastItem[]; push: (kind: ToastItem['kind'], text: string) => void; remove: (id: number) => void }>((set, get) => ({
  items: [],
  push(kind, text) {
    const id = Date.now() + Math.random();
    set({ items: [...get().items, { id, kind, text }] });
    setTimeout(() => get().remove(id), 4500);
  },
  remove: (id) => set({ items: get().items.filter((t) => t.id !== id) }),
}));
export const toast = {
  success: (t: string) => useToast.getState().push('success', t),
  error: (t: unknown) => useToast.getState().push('error', typeof t === 'string' ? t : ((t as any)?.message ?? dict('common').ui.genericError)),
  info: (t: string) => useToast.getState().push('info', t),
};
export function Toaster() {
  const items = useToast((s) => s.items);
  return (
    <div className="pointer-events-none fixed bottom-28 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          className={cx(
            'pointer-events-auto rounded-none px-4 py-3 text-sm font-semibold shadow-xl',
            t.kind === 'success' && 'bg-rave-primary text-rave-on-primary',
            t.kind === 'error' && 'bg-[#dc2626] text-white',
            t.kind === 'info' && 'bg-[#1F5C52] text-white',
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ---------- B2B card ----------
export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx('b2b-surface min-w-0 rounded-none border border-b2b-line p-4 transition-[border-color,box-shadow] duration-300 sm:p-5', className)}>
      {(title || action) && (
        <header className="mb-4 flex min-w-0 items-center justify-between gap-3 border-b border-dashed border-b2b-line pb-3">
          {title && <h2 className="min-w-0 truncate text-base font-bold text-b2b-ink">{title}</h2>}
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="b2b-surface b2b-accent-top group min-w-0 rounded-none border border-b2b-line p-4 pt-5">
      <p className="rave-label truncate !text-[10.5px] text-b2b-muted">{label}</p>
      <p className="mt-2 truncate text-[clamp(1.4rem,2.6vw,1.85rem)] leading-none font-extrabold tracking-tight text-b2b-ink tabular-nums">{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-b2b-muted">{hint}</p>}
    </div>
  );
}
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <span className="mb-3 flex h-1.5 w-14 overflow-hidden" aria-hidden>
          <span className="w-2/5 bg-rave-mustard" />
          <span className="flex-1 bg-rave-purple" />
        </span>
        <h1 className="text-[clamp(1.85rem,4vw,2.6rem)] leading-[0.95] text-balance break-words text-b2b-ink">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-sm text-b2b-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
