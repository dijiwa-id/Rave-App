import type { AdminPermission } from '@rave/domain/settings';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Me, OrgClaim, TokenResponse } from '@/lib/types';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: Me | null;
  setSession: (t: TokenResponse) => void;
  setUser: (u: Me) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setSession: (t) => set({ accessToken: t.access_token, refreshToken: t.refresh_token, user: t.user }),
      setUser: (user) => set({ user }),
      clear: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    { name: 'rave-auth' },
  ),
);

// Sinkron antar-tab: token yang diperbarui / logout di tab lain langsung berlaku di tab ini.
if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key === 'rave-auth') void useAuth.persist.rehydrate();
  });

export const hasRole = (u: Me | null, ...roles: string[]) => !!u && (u.roles.includes('admin') || roles.some((r) => u.roles.includes(r)));

/** Super Admin platform (klaim `superadmin` atau admin_role SUPER_ADMIN) — satu-satunya yang boleh aksi tulis di /admin/platform. */
export const isSuperAdmin = (u: Me | null) => !!u && (u.roles.includes('superadmin') || u.admin_role === 'SUPER_ADMIN');
/** Izin back office (matriks "Peran & Akses"); Super Admin memegang semuanya. Backend tetap menegakkan sendiri. */
export const can = (u: Me | null, ...perms: AdminPermission[]) => isSuperAdmin(u) || perms.some((p) => !!u?.admin_permissions?.includes(p));

/** Org ARTIST/MANAGEMENT/LABEL yang memberi akses ke artis (dipakai Artist Studio). */
export const artistOrgs = (u: Me | null): OrgClaim[] => (u?.orgs ?? []).filter((o) => o.artist_id);
/** Org PROMOTOR/VENUE (IAM memberi keduanya peran `promotor`) — dipakai Promotor Hub. */
export const promotorOrgs = (u: Me | null): OrgClaim[] => (u?.orgs ?? []).filter((o) => o.type === 'PROMOTOR' || o.type === 'VENUE');
/** Org MANAGEMENT tempat user OWNER — boleh menautkan artis ke roster (POST /v1/orgs/:id/manage-artist). */
export const managementOrgs = (u: Me | null): OrgClaim[] => (u?.orgs ?? []).filter((o) => o.type === 'MANAGEMENT' && o.role === 'OWNER');
