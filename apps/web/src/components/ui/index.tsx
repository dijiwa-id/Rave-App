import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Loader2, X } from 'lucide-react';
import { create } from 'zustand';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

// ---------- Button ----------
type Variant = 'primary' | 'white' | 'outline' | 'ghost' | 'dark' | 'danger' | 'ink' | 'outline-ink';
const variants: Record<Variant, string> = {
  primary: 'bg-gema-primary text-white hover:bg-gema-primary-hover hover:scale-[1.03]',
  white: 'bg-white text-black hover:scale-[1.03]',
  outline: 'border border-white/40 text-white hover:border-white hover:scale-[1.03]',
  ghost: 'text-gema-muted hover:text-white',
  dark: 'bg-gema-highlight text-white hover:bg-[#3e3e3e]',
  danger: 'bg-[#dc2626] text-white hover:bg-[#ef4444]',
  ink: 'bg-b2b-ink text-b2b-on-ink hover:bg-b2b-ink/80',
  'outline-ink': 'border border-b2b-line bg-b2b-card text-b2b-ink hover:border-b2b-ink',
};
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
  const sizes = { sm: 'h-8 px-4 text-sm', md: 'h-10 px-6 text-sm', lg: 'h-12 px-8 text-base' };
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full font-bold tracking-wide transition-all duration-150 disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

// ---------- Form fields (tema: dark untuk fan, light untuk B2B) ----------
type Theme = { theme?: 'dark' | 'light' };
const fieldBase = (theme: 'dark' | 'light' = 'light') =>
  theme === 'dark'
    ? 'w-full rounded-md border border-[#727272] bg-[#121212] px-3.5 py-3 text-white placeholder:text-gema-subtle focus:border-white focus:outline-none'
    : 'w-full rounded-lg border border-b2b-line bg-b2b-card px-3.5 py-2.5 text-b2b-ink placeholder:text-b2b-muted/70 focus:border-b2b-ink focus:outline-none';

export function Label({ children, hint, theme = 'light' }: { children: ReactNode; hint?: string } & Theme) {
  return (
    <span className={cx('mb-1.5 block text-sm font-bold', theme === 'dark' ? 'text-white' : 'text-b2b-ink')}>
      {children}
      {hint && <span className={cx('ml-2 font-normal', theme === 'dark' ? 'text-gema-muted' : 'text-b2b-muted')}>{hint}</span>}
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
export function Spinner({ className = 'size-6' }: { className?: string }) {
  return <Loader2 className={cx('animate-spin text-gema-muted', className)} />;
}
export function PageLoader() {
  return (
    <div className="grid min-h-[40vh] place-items-center">
      <Spinner className="size-8" />
    </div>
  );
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-white/10', className)} />;
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
  const msg = (error as any)?.message ?? 'Terjadi kesalahan';
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm">
      <p className="font-semibold text-red-400">Gagal memuat</p>
      <p className="mt-1 opacity-80">{msg}</p>
      {retry && (
        <button onClick={retry} className="mt-2 font-bold underline">
          Coba lagi
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
  return <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold', tones[tone], className)}>{children}</span>;
}

// ---------- Modal ----------
export function Modal({ open, onClose, title, children, theme = 'light', wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean } & Theme) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal aria-label={title}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={cx(
          'max-h-[90vh] w-full overflow-y-auto rounded-xl p-6 shadow-2xl',
          wide ? 'max-w-3xl' : 'max-w-lg',
          theme === 'dark' ? 'bg-gema-highlight text-white' : 'bg-b2b-card text-b2b-ink',
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Tutup" className="opacity-60 hover:opacity-100">
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
  error: (t: unknown) => useToast.getState().push('error', typeof t === 'string' ? t : ((t as any)?.message ?? 'Terjadi kesalahan')),
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
            'pointer-events-auto rounded-lg px-4 py-3 text-sm font-semibold shadow-xl',
            t.kind === 'success' && 'bg-gema-primary text-white',
            t.kind === 'error' && 'bg-[#dc2626] text-white',
            t.kind === 'info' && 'bg-[#2e77d0] text-white',
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
    <section className={cx('rounded-xl border border-b2b-line bg-b2b-card p-5', className)}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-bold text-b2b-ink">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-b2b-line bg-b2b-card p-4">
      <p className="text-xs font-semibold tracking-wide text-b2b-muted uppercase">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-b2b-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-b2b-muted">{hint}</p>}
    </div>
  );
}
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-b2b-ink md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-b2b-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
