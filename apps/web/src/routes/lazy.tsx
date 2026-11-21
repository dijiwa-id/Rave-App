import { lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react';
import { PageLoader } from '@/components/ui';

/** true sampai halaman pertama selesai dimuat — selama itu fallback = loader boot yang sama dengan index.html. */
let firstLoad = true;

/**
 * Loader boot (markup & kelas identik dengan `<div class="rave-boot">` di index.html; gaya inline-nya tetap ada di
 * dokumen). Fase putaran disambung lewat animation-delay negatif → pengguna melihat SATU loader yang terus berputar
 * sejak HTML pertama hingga halaman tampil, bukan loader boot lalu loader halaman yang berbeda.
 */
function BootLoader() {
  const phase = typeof performance === 'undefined' ? 0 : performance.now() % 1800;
  return (
    <div className="rave-boot" role="status" aria-label="Memuat RAVE">
      <div>
        <div className="rave-boot__disc">
          <div className="rave-boot__spin" style={{ animationDelay: `-${Math.round(phase)}ms` }} />
          <div className="rave-boot__shine" />
          <img className="rave-boot__logo" src="/rave-logo.webp" alt="" />
        </div>
        <div className="rave-boot__label">Memuat…</div>
      </div>
    </div>
  );
}

function Fallback() {
  return firstLoad ? <BootLoader /> : <PageLoader />;
}

function Loaded({ children }: { children: ReactNode }) {
  useEffect(() => {
    firstLoad = false;
  }, []);
  return children;
}

/** Code-split halaman: `page(() => import('@/pages/fan/Home'))` (default export). */
export function page(loader: () => Promise<{ default: ComponentType<any> }>) {
  const C = lazy(loader);
  return (
    <Suspense fallback={<Fallback />}>
      <Loaded>
        <C />
      </Loaded>
    </Suspense>
  );
}
