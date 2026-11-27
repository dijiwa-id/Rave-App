import { useQuery } from '@tanstack/react-query';

/** Berkas unduhan: desktop di /downloads/ (`npm run apps:publish`); Android dari GitHub Releases RAVE-Mobile-Apps. */
export interface AppAsset {
  file: string;
  url: string;
  size: number;
  sha256: string;
}
export interface AppDownloads {
  generated_at?: string;
  desktop?: { platform: 'windows'; version: string; installer: AppAsset; msi?: AppAsset };
  android?: { version: string; build: string | null; apk: AppAsset; min_android: string };
}

/** Rilis APK Android: GitHub Release terbaru repo RAVE-Mobile-Apps (tag `mobile-v<versi>`, aset `RAVE-mobile-<versi>+<build>-arm64.apk`). */
const MOBILE_RELEASE_API = 'https://api.github.com/repos/dijiwa-id/RAVE-Mobile-Apps/releases/latest';
/** Halaman rilis terbaru — cadangan bila API GitHub gagal (rate limit 60/jam per IP), tetap selalu versi terbaru. */
const MOBILE_RELEASE_PAGE = 'https://github.com/dijiwa-id/RAVE-Mobile-Apps/releases/latest';
const ANDROID_FALLBACK: NonNullable<AppDownloads['android']> = {
  version: '',
  build: null,
  apk: { file: '', url: MOBILE_RELEASE_PAGE, size: 0, sha256: '' },
  min_android: '7.0',
};

interface GhAsset {
  name: string;
  size: number;
  digest?: string | null;
  browser_download_url: string;
}

/** APK terbaru dari GitHub Releases; null bila gagal (rate limit/offline) → tautan ke halaman rilis terbaru. */
async function fetchAndroidRelease(): Promise<AppDownloads['android'] | null> {
  try {
    const r = await fetch(MOBILE_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return null;
    const rel = (await r.json()) as { tag_name?: string; assets?: GhAsset[] };
    const apks = (rel.assets ?? []).filter((a) => a.name.toLowerCase().endsWith('.apk'));
    const apk = apks.find((a) => /arm64/i.test(a.name)) ?? apks[0];
    if (!apk) return null;
    const m = /(\d+\.\d+\.\d+)(?:\+(\d+))?/.exec(apk.name) ?? /(\d+\.\d+\.\d+)/.exec(rel.tag_name ?? '');
    return {
      version: m?.[1] ?? (rel.tag_name ?? '').replace(/^mobile-v/, ''),
      build: m?.[2] ?? null,
      apk: { file: apk.name, url: apk.browser_download_url, size: apk.size, sha256: apk.digest?.replace(/^sha256:/, '') ?? '' },
      min_android: '7.0',
    };
  } catch {
    return null;
  }
}

async function fetchManifest(): Promise<AppDownloads> {
  try {
    const r = await fetch('/downloads/manifest.json', { cache: 'no-cache' });
    if (!r.ok || !r.headers.get('content-type')?.includes('json')) return {};
    return (await r.json()) as AppDownloads;
  } catch {
    return {};
  }
}

/**
 * Installer terbaru: desktop dari /downloads/manifest.json, Android dari GitHub Release terbaru
 * (bila API gagal: tautan ke halaman rilis terbaru di GitHub). Tanpa sumber sama sekali → objek kosong: tombol "segera".
 */
export function useAppDownloads() {
  return useQuery({
    queryKey: ['app-downloads'],
    queryFn: async (): Promise<AppDownloads> => {
      const [manifest, android] = await Promise.all([fetchManifest(), fetchAndroidRelease()]);
      // Android SELALU dari GitHub (tak pernah dari manifest lokal) agar pengguna memasang APK terbaru.
      return { ...manifest, android: android ?? ANDROID_FALLBACK };
    },
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/** Ukuran 0 = tak diketahui (tautan cadangan GitHub) → string kosong. */
export const fmtSize = (bytes: number) =>
  !bytes ? '' : (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
