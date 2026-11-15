import { useEffect, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { setting, usePlatformConfig } from '@/lib/platform';

export type ThemeChoice = 'light' | 'dark' | 'system';

/** Pilihan tema dasbor milik pengguna (per perangkat). null = ikut default platform. */
export const useThemePref = create<{ choice: ThemeChoice | null; set: (c: ThemeChoice | null) => void }>()(
  persist((set) => ({ choice: null, set: (choice) => set({ choice }) }), { name: 'rave-dashboard-theme' }),
);

const media = () => window.matchMedia('(prefers-color-scheme: dark)');
function useSystemDark() {
  return useSyncExternalStore(
    (cb) => {
      const m = media();
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => media().matches,
    () => false,
  );
}

/**
 * Tema efektif dasbor B2B: default dari Super Admin (`appearance.dashboard_theme`),
 * ditimpa pilihan pengguna bila `appearance.allow_user_theme` aktif; "system" mengikuti OS.
 */
export function useDashboardTheme() {
  const cfg = usePlatformConfig();
  const platformDefault = setting<ThemeChoice>(cfg, 'appearance.dashboard_theme', 'light');
  const allowUser = setting(cfg, 'appearance.allow_user_theme', true);
  const pref = useThemePref((s) => s.choice);
  const systemDark = useSystemDark();
  const choice: ThemeChoice = (allowUser && pref) || platformDefault;
  const resolved: 'light' | 'dark' = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;
  return { choice, resolved, allowUser, platformDefault, pref };
}

/** Pasang tema di <html> selama layout B2B aktif (agar modal, toast, dan scrollbar ikut). */
export function useApplyDashboardTheme(theme: 'light' | 'dark') {
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.b2bTheme = theme;
    return () => {
      delete el.dataset.b2bTheme;
    };
  }, [theme]);
}

// ───────────────────────── Tema aplikasi dengar (web player) ─────────────────────────
/** Pilihan tema aplikasi dengar di perangkat ini (dipakai tamu, dan cadangan bila akun belum memilih). */
export const usePlayerThemePref = create<{ choice: ThemeChoice | null; set: (c: ThemeChoice | null) => void }>()(
  persist((set) => ({ choice: null, set: (choice) => set({ choice }) }), { name: 'rave-player-theme' }),
);

/**
 * Tema efektif aplikasi dengar: pilihan akun (`users.theme`, ikut ke web/desktop/mobile) → pilihan perangkat →
 * default Super Admin (`appearance.player_theme`, bawaan gelap). `appearance.allow_user_theme` mati = selalu default.
 */
export function usePlayerTheme(accountChoice: ThemeChoice | null | undefined) {
  const cfg = usePlatformConfig();
  const platformDefault = setting<ThemeChoice>(cfg, 'appearance.player_theme', 'dark');
  const allowUser = setting(cfg, 'appearance.allow_user_theme', true);
  const device = usePlayerThemePref((s) => s.choice);
  const systemDark = useSystemDark();
  const choice: ThemeChoice = (allowUser && (accountChoice ?? device)) || platformDefault;
  const resolved: 'light' | 'dark' = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;
  return { choice, resolved, allowUser, platformDefault };
}

/** Pasang tema di <html data-fan-theme> selama layout aplikasi dengar aktif (modal, toast & scrollbar ikut). */
export function useApplyPlayerTheme(theme: 'light' | 'dark') {
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.fanTheme = theme;
    el.style.colorScheme = theme;
    return () => {
      delete el.dataset.fanTheme;
      el.style.colorScheme = '';
    };
  }, [theme]);
}
