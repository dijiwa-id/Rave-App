import { lazy, Suspense, type ComponentType } from 'react';
import { PageLoader } from '@/components/ui';

/** Code-split halaman: `page(() => import('@/pages/fan/Home'))` (default export). */
export function page(loader: () => Promise<{ default: ComponentType<any> }>) {
  const C = lazy(loader);
  return (
    <Suspense fallback={<PageLoader />}>
      <C />
    </Suspense>
  );
}
