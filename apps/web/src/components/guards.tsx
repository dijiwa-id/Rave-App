import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { hasRole, useAuth } from '@/stores/auth';

/** Wajib login; simpan tujuan untuk redirect setelah login. */
export function RequireAuth() {
  const token = useAuth((s) => s.accessToken);
  const loc = useLocation();
  if (!token) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <Outlet />;
}

/** Wajib peran tertentu (admin selalu lolos). */
export function RequireRole({ roles, fallback = '/app' }: { roles: string[]; fallback?: string }) {
  const user = useAuth((s) => s.user);
  if (!hasRole(user, ...roles)) return <Navigate to={fallback} replace />;
  return <Outlet />;
}
