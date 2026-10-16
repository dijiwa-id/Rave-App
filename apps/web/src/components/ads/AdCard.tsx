import type { ReactNode } from 'react';
import { ExternalLink, Volume2 } from 'lucide-react';
import type { AdCreative } from '@/lib/types';
import { cx } from '@/components/ui';

// Kartu kreatif iklan seperti tampil di pemutar fan (docs/API.md §11). Dipakai juga sebagai pratinjau
// di Back Office (form kampanye & modal tinjauan), jadi selalu bertema gelap — sama seperti aplikasi fan.

export type AdCardCreative = Pick<AdCreative, 'type' | 'advertiser' | 'title' | 'body' | 'image_url' | 'click_url' | 'cta_label' | 'theme_color' | 'duration_s' | 'skippable_after_s' | 'label'>;

export const BRAND_GRADIENT = 'bg-gradient-to-br from-[#a855f7] via-[#ec4899] to-[#f6851f]';

/** Hex aman untuk style inline (input bebas dari form admin). */
const safeHex = (c: string | null | undefined) => (c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : null);

const clock = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export function AdCard({
  ad,
  position,
  elapsedMs = 0,
  paused,
  onSkip,
  onCta,
  footer,
  className,
}: {
  ad: AdCardCreative;
  /** "Iklan 1 dari 2" — dihilangkan bila hanya satu iklan. */
  position?: { index: number; total: number };
  elapsedMs?: number;
  paused?: boolean;
  onSkip?: () => void;
  onCta?: () => void;
  footer?: ReactNode;
  className?: string;
}) {
  const dur = Math.max(1, ad.duration_s);
  const elapsed = Math.min(dur, elapsedMs / 1000);
  const remaining = dur - elapsed;
  const skipAt = ad.skippable_after_s;
  const canSkip = skipAt != null && elapsed >= skipAt;
  const color = safeHex(ad.theme_color);
  const house = ad.label === 'Dari GEMA';
  return (
    <article
      className={cx('w-full max-w-md overflow-hidden rounded-2xl bg-[#181818] text-white shadow-2xl ring-1 ring-white/10', className)}
      aria-label={`${ad.label}: ${ad.advertiser} — ${ad.title}`}
    >
      {/* Visual: gambar, atau gradien dari theme_color / gradien merek */}
      <div
        className={cx('relative aspect-[16/9] w-full', !ad.image_url && !color && BRAND_GRADIENT)}
        style={!ad.image_url && color ? { background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 45%, #000))` } : undefined}
      >
        {ad.image_url ? (
          <img src={ad.image_url} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <p className="line-clamp-3 text-2xl font-black tracking-tight text-white drop-shadow">{ad.title || ad.advertiser}</p>
          </div>
        )}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-3">
          <span className={cx('rounded-full px-2.5 py-0.5 text-[11px] font-extrabold tracking-wide uppercase', house ? `${BRAND_GRADIENT} text-white` : 'bg-white text-black')}>{ad.label}</span>
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
            {ad.type === 'audio' && (
              <span className="flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5">
                <Volume2 className="size-3" /> Audio
              </span>
            )}
            {position && position.total > 1 && (
              <span className="rounded-full bg-black/40 px-2 py-0.5">
                Iklan {position.index + 1} dari {position.total}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="p-5">
        <p className="text-xs font-bold tracking-wide text-gema-muted uppercase">{ad.advertiser || 'Pengiklan'}</p>
        <h3 className="mt-1 text-lg leading-snug font-extrabold">{ad.title || 'Judul iklan'}</h3>
        {ad.body && <p className="mt-1.5 line-clamp-3 text-sm text-gema-muted">{ad.body}</p>}

        <div className="mt-4 flex items-center gap-2">
          {ad.click_url && (
            <button
              type="button"
              onClick={onCta}
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-black transition hover:scale-[1.02] motion-reduce:hover:scale-100"
            >
              {ad.cta_label || 'Pelajari'} <ExternalLink className="size-3.5" />
            </button>
          )}
          {skipAt != null && (
            <button
              type="button"
              onClick={onSkip}
              disabled={!canSkip || !onSkip}
              className={cx(
                'inline-flex h-10 items-center justify-center rounded-full border border-white/30 px-5 text-sm font-bold transition',
                canSkip ? 'hover:border-white' : 'cursor-not-allowed text-white/50',
                !ad.click_url && 'flex-1',
              )}
            >
              {canSkip ? 'Lewati' : `Lewati dalam ${Math.ceil(skipAt - elapsed)}`}
            </button>
          )}
        </div>

        {/* Progres iklan */}
        <div className="mt-4 flex items-center gap-3 text-[11px] text-gema-muted tabular-nums">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-label="Progres iklan" aria-valuemin={0} aria-valuemax={dur} aria-valuenow={Math.round(elapsed)}>
            <div className="h-1 rounded-full bg-white motion-safe:transition-[width] motion-safe:duration-300 motion-safe:ease-linear" style={{ width: `${(elapsed / dur) * 100}%` }} />
          </div>
          <span className="w-10 text-right">{paused ? 'Jeda' : clock(remaining)}</span>
        </div>
        {footer}
      </div>
    </article>
  );
}
