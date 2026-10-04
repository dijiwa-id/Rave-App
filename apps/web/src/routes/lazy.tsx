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

export function Todo({ title }: { title: string }) {
  return (
    <div className="p-8 pt-24">
      <h1 className="text-3xl font-bold">{title}</h1>
      <p className="mt-2 opacity-70">Sedang dibangun.</p>
    </div>
  );
}
