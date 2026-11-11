import type { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { Empty } from '@/components/b2b/common';
import { EmptyState } from '@/components/ui';
import { setting, usePlatformConfig } from '@/lib/platform';
import { useDict } from '@/lib/i18n';

/** Modul yang bisa dimatikan Super Admin (`modules.*` di packages/domain/src/settings.ts). */
export type ModuleKey = 'booking' | 'ticketing' | 'waitlist' | 'live' | 'podcasts';

/** true bila modul aktif. Default aktif saat konfigurasi belum termuat / service platform mati (sama seperti gateway). */
export function useModule(key: ModuleKey): boolean {
  return setting(usePlatformConfig(), `modules.${key}`, true);
}

/**
 * Pembungkus rute/halaman milik satu modul: saat modul dimatikan, tampilkan keadaan kosong
 * alih-alih membiarkan pengguna menabrak 503 dari gateway. Tanpa `children` → merender `<Outlet />`
 * (dipakai sebagai elemen rute induk tanpa path).
 */
export function ModuleGate({ module, variant = 'fan', children }: { module: ModuleKey; variant?: 'fan' | 'b2b'; children?: ReactNode }) {
  const d = useDict('common');
  if (useModule(module)) return <>{children ?? <Outlet />}</>;
  const title = d.modules.disabledTitle(d.modules.labels[module]);
  const body = d.modules.disabledBody;
  return variant === 'b2b' ? <Empty title={title} body={body} /> : <EmptyState title={title} body={body} />;
}
