import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Tata letak 3 panel aplikasi fan (≥ md): Library (kiri) · kanvas (tengah) · Sedang Diputar (kanan).
 * Lebar & status lipat disimpan di perangkat agar tetap sama saat aplikasi dibuka lagi.
 */
export const LEFT = { min: 260, max: 440, def: 300, rail: 76 } as const;
export const RIGHT = { min: 320, max: 520, def: 420 } as const;

export type RightView = 'now' | 'queue';

interface LayoutState {
  leftCollapsed: boolean;
  leftWidth: number;
  /** Panel kanan menempel (≥ 1280px) — preferensi tersimpan. */
  rightOpen: boolean;
  /** Laci kanan di layar sedang (1024–1279px) — sementara, tidak disimpan; ditutup saat pindah halaman. */
  drawerOpen: boolean;
  rightWidth: number;
  rightView: RightView;
  toggleLeft: () => void;
  setLeftCollapsed: (v: boolean) => void;
  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
  /** Buka panel kanan pada tab tertentu; bila sudah terbuka di tab itu → tutup. Mode (menempel/laci) dari lebar layar saat itu. */
  toggleRight: (view?: RightView) => void;
  closeRight: () => void;
}

const DOCKED_Q = '(min-width: 1280px)';
const isDocked = () => typeof window !== 'undefined' && window.matchMedia(DOCKED_Q).matches;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

export const useLayout = create<LayoutState>()(
  persist(
    (set, get) => ({
      leftCollapsed: false,
      leftWidth: LEFT.def,
      rightOpen: true,
      drawerOpen: false,
      rightWidth: RIGHT.def,
      rightView: 'now',
      toggleLeft: () => set({ leftCollapsed: !get().leftCollapsed }),
      setLeftCollapsed: (v) => set({ leftCollapsed: v }),
      setLeftWidth: (w) => set({ leftWidth: clamp(w, LEFT.min, LEFT.max) }),
      setRightWidth: (w) => set({ rightWidth: clamp(w, RIGHT.min, RIGHT.max) }),
      toggleRight: (view) => {
        const s = get();
        const v = view ?? s.rightView;
        const key = isDocked() ? 'rightOpen' : 'drawerOpen';
        if (s[key] && s.rightView === v) set({ [key]: false });
        else set({ [key]: true, rightView: v });
      },
      closeRight: () => set(isDocked() ? { rightOpen: false } : { drawerOpen: false }),
    }),
    {
      name: 'rave-layout',
      // v1: default Side B diperlebar (340 → 420); lebar lama yang masih bawaan ikut diperbarui.
      version: 1,
      migrate: (old: any, v) => (v < 1 && old && (!old.rightWidth || old.rightWidth <= 340) ? { ...old, rightWidth: RIGHT.def } : old),
      partialize: (s) => ({ leftCollapsed: s.leftCollapsed, leftWidth: s.leftWidth, rightOpen: s.rightOpen, rightWidth: s.rightWidth, rightView: s.rightView }),
    },
  ),
);

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

/** Panel kanan menempel di samping kanvas hanya di layar lebar; di bawahnya tampil sebagai laci di atas kanvas. */
export const useRightDocked = () => useMediaQuery(DOCKED_Q);
/** Apakah panel kanan sedang terbuka pada mode layar saat ini (menempel → preferensi, laci → status sementara). */
export function useRightOpen() {
  const docked = useRightDocked();
  return useLayout((s) => (docked ? s.rightOpen : s.drawerOpen));
}
/** Library penuh hanya di ≥ lg; md–lg selalu rel ikon. */
export const useLeftRoomy = () => useMediaQuery('(min-width: 1024px)');
