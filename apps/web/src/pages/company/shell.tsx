import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Mail, type LucideIcon } from 'lucide-react';
import { SETTINGS_BY_KEY } from '@gema/domain/settings';
import { cx } from '@/components/ui';
import { setting, usePlatformConfig } from '@/lib/platform';
import { BRAND_GRADIENT, Heading, Section } from '@/pages/public/marketing';
import { PublicFooter, PublicNav } from '@/pages/public/PublicChrome';

// Kerangka halaman perusahaan (Tentang, Karier, Media, Untuk Artis/Promotor, Developer, Iklan, Investor):
// satu bahasa visual dengan landing — kanvas hitam, aksen gradien logo, tipografi besar, banyak ruang kosong.

export { Heading, Section };

/** Nilai parameter platform: nilai publik dari Super Admin bila ada, selain itu default registri pengaturan. */
export function useParam<T = number>(key: string): T {
  return setting<T>(usePlatformConfig(), key, SETTINGS_BY_KEY[key]?.default as T);
}

/** Satu alamat kontak resmi (`general.support_email`), dibedakan per keperluan lewat subjek email. */
export function useContact(subject: string) {
  const email = useParam<string>('general.support_email') || 'bantuan@gema.id';
  return { email, href: `mailto:${email}?subject=${encodeURIComponent(`[${subject}] `)}` };
}

export function CompanyPage({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} — GEMA`;
    return () => {
      document.title = prev;
    };
  }, [title]);
  return (
    <div className="min-h-full bg-black text-white">
      <PublicNav />
      <main>{children}</main>
      <PublicFooter />
    </div>
  );
}

export function PageHero({ kicker, title, lead, actions, aside }: { kicker: string; title: ReactNode; lead: string; actions?: ReactNode; aside?: ReactNode }) {
  return (
    <section className="relative isolate overflow-hidden px-4 pt-20 pb-16 md:pt-28 md:pb-24">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(55%_60%_at_15%_0%,rgba(102,45,145,0.35),rgba(218,28,92,0.12)_50%,transparent_80%)]" aria-hidden />
      <div className={cx('mx-auto max-w-6xl', !!aside && 'grid items-center gap-12 lg:grid-cols-[1.2fr_1fr]')}>
        <div className="max-w-3xl">
          <p className={cx('inline-block bg-clip-text text-sm font-bold tracking-[0.16em] text-transparent uppercase', BRAND_GRADIENT)}>{kicker}</p>
          <h1 className="mt-4 text-5xl leading-[1.04] font-black tracking-tight text-balance md:text-6xl lg:text-7xl">{title}</h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/70 md:text-xl">{lead}</p>
          {actions && <div className="mt-9 flex flex-wrap gap-3">{actions}</div>}
        </div>
        {aside}
      </div>
    </section>
  );
}

/** Tombol/tautan CTA: `primary` magenta GEMA, `light` putih, `ghost` garis. Path internal → Link, selain itu <a>. */
export function Cta({ to, children, variant = 'primary', icon = true }: { to: string; children: ReactNode; variant?: 'primary' | 'light' | 'ghost'; icon?: boolean }) {
  const cls = cx(
    'group inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-bold transition hover:scale-[1.03]',
    variant === 'primary' && 'bg-gema-primary text-white hover:bg-gema-primary-hover',
    variant === 'light' && 'bg-white text-black',
    variant === 'ghost' && 'border border-white/25 text-white hover:border-white',
  );
  const inner = (
    <>
      {children}
      {icon && <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />}
    </>
  );
  return to.startsWith('/') && !to.includes('#') ? (
    <Link to={to} className={cls}>
      {inner}
    </Link>
  ) : (
    <a href={to} className={cls}>
      {inner}
    </a>
  );
}

export interface CardItem {
  icon?: LucideIcon;
  title: string;
  body: string;
  meta?: string;
}

export function Cards({ items, cols = 3 }: { items: CardItem[]; cols?: 2 | 3 | 4 }) {
  return (
    <div className={cx('mt-12 grid gap-4 sm:grid-cols-2', cols === 3 && 'lg:grid-cols-3', cols === 4 && 'lg:grid-cols-4')}>
      {items.map(({ icon: Icon, title, body, meta }) => (
        <article key={title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-white/20 hover:bg-white/[0.05]">
          {Icon && (
            <span className="grid size-11 place-items-center rounded-xl bg-gema-primary/15 text-gema-primary-text">
              <Icon className="size-5" aria-hidden />
            </span>
          )}
          <h3 className={cx('text-lg font-bold', Icon && 'mt-5')}>{title}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-white/60">{body}</p>
          {meta && <p className="mt-4 text-xs font-bold tracking-[0.12em] text-white/40 uppercase">{meta}</p>}
        </article>
      ))}
    </div>
  );
}

export function Steps({ items }: { items: { title: string; body: string }[] }) {
  return (
    <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 md:grid-cols-2 lg:grid-cols-[repeat(var(--n),minmax(0,1fr))]" style={{ ['--n' as string]: items.length }}>
      {items.map((s, i) => (
        <li key={s.title} className="bg-black p-6">
          <span className="text-sm font-black text-gema-primary-text tabular-nums">{String(i + 1).padStart(2, '0')}</span>
          <h3 className="mt-3 font-bold">{s.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-white/60">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

export function Stats({ items, note }: { items: { value: string; label: string }[]; note?: string }) {
  return (
    <div className="mt-12">
      <dl className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((s) => (
          <div key={s.label} className="border-l-2 border-gema-primary pl-5">
            <dt className="sr-only">{s.label}</dt>
            <dd className="text-4xl font-black tracking-tight tabular-nums">{s.value}</dd>
            <dd className="mt-2 text-sm leading-relaxed text-white/60">{s.label}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="mt-8 text-xs text-white/40">{note}</p>}
    </div>
  );
}

/** Daftar cek dua kolom (prinsip, kebijakan, fakta). */
export function Checklist({ items }: { items: { title: string; body: string }[] }) {
  return (
    <ul className="mt-12 grid gap-x-12 gap-y-8 md:grid-cols-2">
      {items.map((it) => (
        <li key={it.title} className="flex gap-4">
          <span className="mt-2 size-2 shrink-0 rounded-full bg-gema-primary" aria-hidden />
          <div>
            <h3 className="font-bold">{it.title}</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed text-white/60">{it.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CtaBand({ title, body, children }: { title: string; body?: string; children: ReactNode }) {
  return (
    <Section>
      <div className="relative isolate overflow-hidden rounded-3xl border border-white/10 px-6 py-14 text-center md:px-16">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(70%_90%_at_50%_100%,rgba(218,28,92,0.28),rgba(102,45,145,0.18)_50%,transparent_80%)]" aria-hidden />
        <h2 className="mx-auto max-w-2xl text-3xl font-black tracking-tight text-balance md:text-4xl">{title}</h2>
        {body && <p className="mx-auto mt-4 max-w-xl text-white/65">{body}</p>}
        <div className="mt-8 flex flex-wrap justify-center gap-3">{children}</div>
      </div>
    </Section>
  );
}

/** CTA email ke kontak resmi dengan subjek keperluan. */
export function ContactCta({ subject, children, variant = 'primary' }: { subject: string; children: ReactNode; variant?: 'primary' | 'light' | 'ghost' }) {
  const { href } = useContact(subject);
  return (
    <a href={href} className={cx('inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-bold transition hover:scale-[1.03]', variant === 'primary' ? 'bg-gema-primary text-white hover:bg-gema-primary-hover' : variant === 'light' ? 'bg-white text-black' : 'border border-white/25 hover:border-white')}>
      <Mail className="size-4" aria-hidden /> {children}
    </a>
  );
}

export const pct = (n: number) => `${String(n).replace('.', ',')}%`;
