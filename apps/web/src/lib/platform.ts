import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PlatformConfig } from '@/lib/types';
import defaultIcon from '@/assets/brand/gema-icon.svg';
import defaultLogo from '@/assets/brand/gema-logo.svg';
import defaultLogoDark from '@/assets/brand/gema-logo-dark.svg';

/** Logo resmi GEMA yang dibundel aplikasi (dipakai bila Super Admin tidak mengunggah logo lain). */
export const DEFAULT_BRAND = { logo: defaultLogo, logoDark: defaultLogoDark, icon: defaultIcon } as const;

/**
 * Konfigurasi publik platform (`GET /v1/platform/config`): banner, maintenance, modul, preview.
 * Tanpa login; gagal = diam (null) agar aplikasi tetap jalan bila service platform mati.
 */
export function usePlatformConfig() {
  const q = useQuery({
    queryKey: ['platform-config'],
    queryFn: () => api<PlatformConfig>('/v1/platform/config', { auth: false }).catch(() => null),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
  return q.data ?? null;
}

/** Baca satu kunci publik dengan fallback (mis. `setting(cfg, 'modules.podcasts', true)`). */
export function setting<T>(cfg: PlatformConfig | null, key: string, fallback: T): T {
  const v = cfg?.settings?.[key];
  return v === undefined || v === null ? fallback : (v as T);
}

/**
 * Branding efektif: unggahan Super Admin (`branding.*`) bila ada, selain itu logo resmi GEMA bawaan aplikasi
 * (src/assets/brand — lingkaran gradien "G" + wordmark).
 */
export function useBranding() {
  const cfg = usePlatformConfig();
  const logo = setting<string>(cfg, 'branding.logo_url', '') || null;
  const logoDark = setting<string>(cfg, 'branding.logo_dark_url', '') || null;
  return {
    name: setting<string>(cfg, 'general.platform_name', 'GEMA'),
    /** Logo untuk latar terang. */
    logo: logo ?? DEFAULT_BRAND.logo,
    /** Logo untuk latar gelap (fallback: unggahan logo terang, lalu bawaan gelap). */
    logoDark: logoDark ?? logo ?? DEFAULT_BRAND.logoDark,
    icon: setting<string>(cfg, 'branding.icon_url', '') || DEFAULT_BRAND.icon,
    /** true bila memakai logo bawaan (tidak ada unggahan). */
    isDefault: !logo && !logoDark,
  };
}
