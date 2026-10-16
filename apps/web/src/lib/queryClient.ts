import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';

// Modul terpisah agar store/api bisa membersihkan cache (logout) tanpa impor melingkar ke main.tsx.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    },
  },
});
