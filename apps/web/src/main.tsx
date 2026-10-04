import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { b2bRoutes } from '@/routes/b2b';
import { fanRoutes, publicRoutes } from '@/routes/fan';
import { Toaster } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import type { Me } from '@/lib/types';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    },
  },
});

function NotFound() {
  return (
    <div className="grid h-full place-items-center bg-gema-base p-8 text-center">
      <div>
        <p className="text-6xl font-black">404</p>
        <p className="mt-2 text-gema-muted">Halaman tidak ditemukan.</p>
        <Link to="/app" className="mt-6 inline-block rounded-full bg-white px-8 py-3 font-bold text-black">
          Ke Beranda
        </Link>
      </div>
    </div>
  );
}

const router = createBrowserRouter([...publicRoutes, fanRoutes, ...b2bRoutes, { path: '*', element: <NotFound /> }]);

/** Sinkronkan profil (/v1/me) saat aplikasi dibuka dengan sesi tersimpan. */
function SessionSync() {
  const token = useAuth((s) => s.accessToken);
  useEffect(() => {
    if (!token) return;
    api<Me>('/v1/me')
      .then((u) => useAuth.getState().setUser(u))
      .catch(() => {});
  }, [token]);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionSync />
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
