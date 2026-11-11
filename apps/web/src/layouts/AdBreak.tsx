import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdCard, BRAND_GRADIENT } from '@/components/ads/AdCard';
import { setting, usePlatformConfig } from '@/lib/platform';
import { abortAdBreak, currentAd, useAds } from '@/stores/ads';
import { useAuth } from '@/stores/auth';
import { cx } from '@/components/ui';
import { useDict } from '@/lib/i18n';

// UI jeda iklan di aplikasi fan (docs/API.md §11). Logika jeda ada di stores/ads.ts; komponen ini hanya
// menampilkan kartu iklan di atas kanvas (pemutar tetap terlihat di bawah) dan menyinkronkan `ads.enabled`.

/** Buka tujuan CTA: tautan internal (`/premium`) di dalam aplikasi, selain itu tab baru. */
export function useAdCta() {
  const nav = useNavigate();
  return (url: string | null) => {
    if (!url) return;
    useAds.getState().click();
    if (url.startsWith('/') && !url.startsWith('//')) nav(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };
}

export function AdBreakOverlay() {
  const cfg = usePlatformConfig();
  const enabled = setting<boolean>(cfg, 'ads.enabled', true) !== false;
  const token = useAuth((s) => s.accessToken);
  const premium = useAuth((s) => !!s.user?.premium);
  const active = useAds((s) => s.active);
  const ad = currentAd({ active });
  const cta = useAdCta();
  const nav = useNavigate();
  const d = useDict('common');

  useEffect(() => useAds.getState().setEnabled(enabled), [enabled]);
  // Logout / naik ke Premium di tengah jeda → hentikan iklan, pemutar lanjut.
  useEffect(() => {
    if (!token || premium) abortAdBreak();
  }, [token, premium]);

  if (!active || !ad) return null;
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="region" aria-label={d.ads.breakRegion} aria-live="polite">
      <div className={cx('pointer-events-none absolute inset-0 opacity-20', BRAND_GRADIENT)} aria-hidden />
      <div className="relative w-full max-w-md">
        <p className="mb-3 text-center text-xs font-semibold text-white/70">{d.ads.breakNotice}</p>
        <AdCard
          key={ad.impression_id}
          ad={ad}
          position={{ index: active.index, total: active.ads.length }}
          elapsedMs={active.elapsedMs}
          paused={active.paused}
          onSkip={() => useAds.getState().skip()}
          onCta={() => cta(ad.click_url)}
          className="mx-auto"
          footer={
            !ad.is_house && (
              <button type="button" onClick={() => nav('/premium')} className="mt-3 w-full text-center text-xs font-semibold text-rave-muted hover:text-white hover:underline">
                {d.ads.goPremium}
              </button>
            )
          }
        />
      </div>
    </div>
  );
}
