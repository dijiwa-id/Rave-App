import { Globe } from 'lucide-react';
import { api } from '@/lib/api';
import { LOCALES, setLocale, useDict, useLocale, type Locale } from '@/lib/i18n';
import type { Me } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { cx } from '@/components/ui';

/** Ganti bahasa: simpan di perangkat, lalu (bila login) di akun agar ikut ke perangkat lain. */
export async function switchLanguage(l: Locale) {
  await setLocale(l);
  const { accessToken, user } = useAuth.getState();
  if (!accessToken || user?.locale === l) return;
  try {
    const me = await api<Me>('/v1/me', { method: 'PATCH', body: { locale: l } });
    useAuth.getState().setUser(me);
  } catch {
    // Gagal menyimpan ke akun (offline, dsb.) — bahasa tetap berganti di perangkat ini.
  }
}

/**
 * Pemilih bahasa bersegmen ID | EN. `tone`: 'dark' (app & landing) atau 'auto' (dasbor B2B, mengikuti tema).
 * Tombol memakai aria-pressed + label lengkap untuk pembaca layar.
 */
export function LanguageSwitch({ className, tone = 'dark', showIcon = true, variant = 'segmented' }: { className?: string; tone?: 'dark' | 'auto'; showIcon?: boolean; variant?: 'segmented' | 'text' }) {
  const locale = useLocale((s) => s.locale);
  const d = useDict('common');
  if (variant === 'text')
    // Varian teks (header landing): "ID / EN", bahasa aktif bergaris bawah mustard; hover menggambar garis dari kiri.
    return (
      <div role="group" aria-label={d.language.label} className={cx('inline-flex items-center gap-2 font-label text-[11.5px] font-bold tracking-[0.12em]', className)}>
        {LOCALES.map((l, i) => {
          const on = l.code === locale;
          return (
            <span key={l.code} className="inline-flex items-center gap-2">
              {i > 0 && <span className="text-white/25" aria-hidden>/</span>}
              <button
                type="button"
                lang={l.code}
                aria-pressed={on}
                aria-label={l.label}
                title={l.label}
                onClick={() => !on && void switchLanguage(l.code)}
                className={cx(
                  'relative py-1 transition-colors after:absolute after:inset-x-0 after:-bottom-0.5 after:h-[2px] after:origin-left after:bg-rave-primary after:transition-transform after:duration-200 focus-visible:outline-none focus-visible:after:scale-x-100',
                  on ? 'cursor-default text-rave-paper after:scale-x-100' : 'text-white/50 after:scale-x-0 hover:text-rave-paper hover:after:scale-x-100',
                )}
              >
                {l.short}
              </button>
            </span>
          );
        })}
      </div>
    );
  return (
    <div role="group" aria-label={d.language.label} className={cx('inline-flex items-center gap-2', className)}>
      {showIcon && <Globe className={cx('size-4 shrink-0', tone === 'dark' ? 'text-white/60' : 'text-rave-muted')} aria-hidden />}
      <div className={cx('inline-flex border', tone === 'dark' ? 'border-white/25' : 'border-current/20')}>
        {LOCALES.map((l) => {
          const on = l.code === locale;
          return (
            <button
              key={l.code}
              type="button"
              lang={l.code}
              aria-pressed={on}
              aria-label={l.label}
              title={l.label}
              onClick={() => !on && void switchLanguage(l.code)}
              className={cx(
                'min-w-10 px-2.5 py-1.5 font-label text-[11px] font-bold tracking-[0.12em] transition',
                on ? 'bg-rave-primary text-rave-on-primary' : tone === 'dark' ? 'text-white/70 hover:bg-white/10 hover:text-white' : 'opacity-70 hover:opacity-100',
              )}
            >
              {l.short}
            </button>
          );
        })}
      </div>
    </div>
  );
}
