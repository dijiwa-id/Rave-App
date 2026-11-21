import { useQuery } from '@tanstack/react-query';

/** Berkas unduhan di /downloads/ (folder `downloads/` repo; ditulis `npm run apps:publish`). */
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

/** Manifest installer terbaru. Tanpa manifest (404) → objek kosong: tombol menampilkan status "segera". */
export function useAppDownloads() {
  return useQuery({
    queryKey: ['app-downloads'],
    queryFn: async (): Promise<AppDownloads> => {
      const r = await fetch('/downloads/manifest.json', { cache: 'no-cache' });
      if (!r.ok || !r.headers.get('content-type')?.includes('json')) return {};
      return (await r.json()) as AppDownloads;
    },
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export const fmtSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
