import { useEffect, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { setting, usePlatformConfig } from '@/lib/platform';

export type ThemeChoice = 'light' | 'dark' | 'system';

/** Pilihan tema dasbor milik pengguna (per perangkat). null = ikut default platform. */
export const useThemePref = create<{ choice: ThemeChoice | null; set: (c: ThemeChoice | null) => void }>()(
  persist((set) => ({ choice: null, set: (choice) => set({ choice }) }), { name: 'gema-dashboard-theme' }),
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
