import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Mail, type LucideIcon } from 'lucide-react';
import { SETTINGS_BY_KEY } from '@rave/domain/settings';
import { cx } from '@/components/ui';
import { setting, usePlatformConfig } from '@/lib/platform';
import { currentLocale } from '@/lib/i18n';
import { BTN_GHOST, BTN_PRIMARY, CARD_TITLE, Heading, Section } from '@/pages/public/marketing';
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
  const email = useParam<string>('general.support_email') || 'bantuan@rave.id';
  return { email, href: `mailto:${email}?subject=${encodeURIComponent(`[${subject}] `)}` };
}

export function CompanyPage({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} — RAVE`;
    return () => {
      document.title = prev;
    };
  }, [title]);
  return (
    <div className="min-h-full overflow-x-clip bg-rave-ink text-rave-paper">
      <PublicNav />
      <main>{children}</main>
      <PublicFooter />
    </div>
  );
}

export function PageHero({ kicker, title, lead, actions, aside }: { kicker: string; title: ReactNode; lead: string; actions?: ReactNode; aside?: ReactNode }) {
  return (
    <section className="relative isolate overflow-hidden px-4 pt-[9.5rem] pb-16 md:pt-[11.5rem] md:pb-24">
      <div className="rave-grain rave-crumple !absolute inset-0 -z-10 bg-[radial-gradient(110%_90%_at_80%_0%,#4a1f5c_0,#2a1233_45%,#181818_100%)]" aria-hidden />
      <div className={cx('mx-auto max-w-[82.5rem]', !!aside && 'grid items-center gap-12 lg:grid-cols-[1.2fr_1fr]')}>
        <div className="max-w-3xl">
          <p className="rave-label rave-eyebrow !text-[12px]">{kicker}</p>
          <h1 className="mt-6 text-6xl leading-[0.9] text-balance md:text-7xl lg:text-[6.5rem]">{title}</h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/70 md:text-xl">{lead}</p>
          {actions && <div className="mt-9 flex flex-wrap gap-3">{actions}</div>}
        </div>
        {aside}
      </div>
    </section>
  );
}

/** Tombol/tautan CTA seragam (marketing BTN_*): `primary` mustard, `light` paper, `ghost` garis. Path internal → Link, selain itu <a>. */
export function Cta({ to, children, variant = 'primary', icon = true }: { to: string; children: ReactNode; variant?: 'primary' | 'light' | 'ghost'; icon?: boolean }) {
  const cls = variant === 'primary' ? BTN_PRIMARY : variant === 'light' ? cx(BTN_PRIMARY, '!border-rave-paper !bg-rave-paper') : BTN_GHOST;
  const inner = (
    <>
      {children}
      {icon && <ArrowRight className="size-4 transition group-hover:translate-x-1" aria-hidden />}
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

export function Cards({ items, cols = 3 }: { items: readonly CardItem[]; cols?: 2 | 3 | 4 }) {
  return (
    <div className={cx('rave-tilt mt-14 grid gap-8 sm:grid-cols-2', cols === 3 && 'lg:grid-cols-3', cols === 4 && 'lg:grid-cols-4')}>
      {items.map(({ icon: Icon, title, body, meta }) => (
        <article key={title} className="rave-card rave-taped relative rounded-none p-6 pt-8">
          {Icon && (
            <span className="grid size-11 -rotate-3 place-items-center rounded-none bg-rave-purple text-rave-primary-text shadow-[3px_3px_0_#0e0c0f]">
              <Icon className="size-5" aria-hidden />
            </span>
          )}
          <h3 className={cx('text-2xl', CARD_TITLE, Icon && 'mt-5')}>{title}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-white/60">{body}</p>
          {meta && <p className="rave-label mt-4 text-white/40">{meta}</p>}
        </article>
      ))}
    </div>
  );
}

export function Steps({ items }: { items: readonly { title: string; body: string }[] }) {
  return (
    <ol className="mt-12 grid gap-px overflow-hidden rounded-none border border-white/10 bg-white/10 md:grid-cols-2 lg:grid-cols-[repeat(var(--n),minmax(0,1fr))]" style={{ ['--n' as string]: items.length }}>
      {items.map((s, i) => (
        <li key={s.title} className="bg-[#1d1d1d] p-6">
          <span className="font-display text-3xl leading-none text-rave-primary-text tabular-nums">{String(i + 1).padStart(2, '0')}</span>
          <h3 className={cx('mt-3 text-xl', CARD_TITLE)}>{s.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-white/60">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

export function Stats({ items, note }: { items: readonly { value: string; label: string }[]; note?: string }) {
  return (
    <div className="mt-12">
      <dl className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((s) => (
          <div key={s.label} className="border-l-2 border-rave-primary pl-5">
            <dt className="sr-only">{s.label}</dt>
            <dd className="font-display text-5xl leading-none text-rave-primary-text tabular-nums">{s.value}</dd>
            <dd className="mt-2 text-sm leading-relaxed text-white/60">{s.label}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="mt-8 text-xs text-white/40">{note}</p>}
    </div>
  );
}

/** Daftar cek dua kolom (prinsip, kebijakan, fakta). */
export function Checklist({ items }: { items: readonly { title: string; body: string }[] }) {
  return (
    <ul className="mt-12 grid gap-x-12 gap-y-8 md:grid-cols-2">
      {items.map((it) => (
        <li key={it.title} className="flex gap-4">
          <span className="mt-2 size-2 shrink-0 rounded-full bg-rave-primary" aria-hidden />
          <div>
            <h3 className={cx('text-xl', CARD_TITLE)}>{it.title}</h3>
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
      <div className="rave-crumple relative isolate border-2 border-rave-ink bg-[#1e1c1f] bg-[radial-gradient(rgba(237,237,237,0.04)_1px,transparent_1.2px)] bg-[length:6px_6px] px-6 py-16 text-center shadow-[10px_10px_0_#F4C21F] before:!opacity-35 md:px-16">
        <h2 className="mx-auto max-w-3xl text-5xl leading-[0.95] text-balance md:text-6xl">{title}</h2>
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
    <a href={href} className={variant === 'primary' ? BTN_PRIMARY : variant === 'light' ? cx(BTN_PRIMARY, '!border-rave-paper !bg-rave-paper') : BTN_GHOST}>
      <Mail className="size-4" aria-hidden /> {children}
    </a>
  );
}

/** Persen dengan pemisah desimal sesuai bahasa aktif (ID: koma, EN: titik). */
export const pct = (n: number) => `${currentLocale() === 'en' ? String(n) : String(n).replace('.', ',')}%`;
