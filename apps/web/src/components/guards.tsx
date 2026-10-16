import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { AdminPermission } from '@gema/domain/settings';
import { Empty } from '@/components/b2b/common';
import { can, hasRole, isSuperAdmin, useAuth } from '@/stores/auth';

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

/**
 * Halaman back office: wajib izin dari matriks "Peran & Akses" (salah satu dari `perms`), atau Super Admin saja
 * (`superOnly`, area Platform). Tanpa akses → pesan jelas di dalam shell, bukan error API.
 */
export function RequireAdminAccess({ perms = [], superOnly }: { perms?: AdminPermission[]; superOnly?: boolean }) {
  const user = useAuth((s) => s.user);
  const ok = superOnly ? isSuperAdmin(user) : can(user, ...perms);
  if (!ok)
    return (
      <Empty
        title="Anda tidak memiliki akses ke halaman ini"
        body={superOnly ? 'Area Platform khusus Super Admin.' : 'Peran admin Anda belum diberi izin untuk area ini. Hubungi Super Admin bila Anda membutuhkannya.'}
      />
    );
  return <Outlet />;
}
