import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Lock } from 'lucide-react';
import { RaveLogo } from '@/components/ui/RaveLogo';
import { cx } from '@/components/ui';
import { useApplyDashboardTheme, useDashboardTheme } from '@/lib/theme';

/**
 * Kerangka halaman "bergabung" B2B (daftar Artis/Manajemen, Promotor/Venue, Podcaster) — satu tata letak untuk semuanya.
 * Mengikuti tema dasbor seperti Login & Onboarding fan. Desktop: narasi + manfaat di kiri, kartu formulir lengket di kanan;
 * mobile: bertumpuk dengan formulir tepat setelah judul agar aksi utama cepat dijangkau.
 */
export function JoinShell({
  product,
  icon: Icon,
  title,
  lead,
  points,
  steps,
  backLabel,
  note,
  aside,
  children,
}: {
  /** Nama produk tujuan (mis. "Promotor Hub") — tampil sebagai eyebrow. */
  product: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  lead?: string;
  points: readonly string[];
  /** Alur pendaftaran (opsional); `current` = indeks langkah aktif (0-based). */
  steps?: { labels: readonly string[]; current: number; ariaLabel: string };
  backLabel: string;
  /** Catatan kecil di bawah kartu (privasi, kebijakan). */
  note?: ReactNode;
  /** Konten tambahan di kolom kiri (petunjuk kontekstual, undangan tertunda). */
  aside?: ReactNode;
  /** Kartu formulir / status. */
  children: ReactNode;
}) {
  const { resolved } = useDashboardTheme();
  useApplyDashboardTheme(resolved);

  return (
    <div className="b2b-canvas flex min-h-full flex-col bg-b2b-bg text-b2b-ink">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-8 md:py-5">
        <Link to="/app" aria-label="RAVE">
          <RaveLogo dark={resolved !== 'dark'} className="h-8 md:h-9" />
        </Link>
        <Link to="/app" className="inline-flex items-center gap-1.5 text-sm font-bold text-b2b-muted transition hover:text-b2b-ink">
          <ArrowLeft className="size-4" />
          <span>{backLabel}</span>
        </Link>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-start gap-8 px-4 pt-4 pb-16 md:px-8 md:pt-10 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-14">
        <section className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-none bg-b2b-ink text-b2b-on-ink">
              <Icon className="size-5" />
            </span>
            <span className="font-label text-[11px] font-bold tracking-[0.16em] text-b2b-muted uppercase">{product}</span>
          </div>
          <h1 className="mt-5 max-w-xl text-3xl font-black tracking-tight text-balance md:text-[2.6rem] md:leading-[1.08]">{title}</h1>
          {lead && <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-b2b-muted">{lead}</p>}

          {steps && (
            <ol aria-label={steps.ariaLabel} className="mt-8 grid max-w-xl gap-2 sm:grid-cols-3">
              {steps.labels.map((label, i) => {
                const done = i < steps.current;
                const active = i === steps.current;
                return (
                  <li
                    key={label}
                    aria-current={active ? 'step' : undefined}
                    className={cx('flex items-center gap-2.5 border-2 px-3 py-2.5', active ? 'border-b2b-ink bg-b2b-card' : 'border-b2b-line')}
                  >
                    <span
                      className={cx(
                        'grid size-6 shrink-0 place-items-center border-2 text-[11px] font-black',
                        active ? 'border-b2b-ink bg-rave-primary text-rave-ink' : done ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted',
                      )}
                    >
                      {done ? <Check className="size-3.5" /> : i + 1}
                    </span>
                    <span className={cx('truncate text-xs font-bold', !active && !done && 'text-b2b-muted')}>{label}</span>
                  </li>
                );
              })}
            </ol>
          )}

          <ul className="mt-8 grid max-w-xl gap-x-6 gap-y-4 border-t border-b2b-line pt-6 sm:grid-cols-2">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-sm leading-snug">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center bg-b2b-ink text-b2b-on-ink" aria-hidden>
                  <Check className="size-3" />
                </span>
                <span>{p}</span>
              </li>
            ))}
          </ul>

          {aside && <div className="mt-8 max-w-xl space-y-4">{aside}</div>}
        </section>

        <div className="lg:sticky lg:top-8">
          <div className="b2b-surface b2b-accent-top rounded-none border border-b2b-line p-6 sm:p-7">{children}</div>
          {note && (
            <p className="mt-4 flex items-start gap-2 px-1 text-xs leading-relaxed text-b2b-muted">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              <span>{note}</span>
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

/** Pilihan jenis akun bergaya kartu (radio) — dipakai di semua formulir bergabung. */
export function JoinChoice<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; title: string; desc: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup">
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            type="button"
            key={o.id}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={cx(
              'relative rounded-none border-2 p-3 text-left transition focus-visible:ring-4 focus-visible:ring-rave-accent/25 focus-visible:outline-none',
              on ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink shadow-[inset_0_-3px_0_var(--color-rave-primary)]' : 'border-b2b-line hover:border-b2b-ink/50',
            )}
          >
            <p className="pr-5 text-sm font-bold">{o.title}</p>
            <p className={cx('mt-0.5 text-xs', on ? 'opacity-75' : 'text-b2b-muted')}>{o.desc}</p>
            {on && <Check className="absolute top-3 right-3 size-4" />}
          </button>
        );
      })}
    </div>
  );
}

/** Judul kartu formulir. */
export function JoinCardTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-lg font-black tracking-tight">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-b2b-muted">{subtitle}</p>}
    </div>
  );
}
