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
    { name: 'gema-auth' },
  ),
);

export const hasRole = (u: Me | null, ...roles: string[]) => !!u && (u.roles.includes('admin') || roles.some((r) => u.roles.includes(r)));

/** Org ARTIST/MANAGEMENT/LABEL yang memberi akses ke artis (dipakai Artist Studio). */
export const artistOrgs = (u: Me | null): OrgClaim[] => (u?.orgs ?? []).filter((o) => o.artist_id);
export const promotorOrgs = (u: Me | null): OrgClaim[] => (u?.orgs ?? []).filter((o) => o.type === 'PROMOTOR');
