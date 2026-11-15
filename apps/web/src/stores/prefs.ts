import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Pita equalizer (Hz) — sama dengan referensi: 60 · 150 · 400 · 1K · 2.4K · 15K. */
export const EQ_BANDS = [60, 150, 400, 1000, 2400, 15000] as const;
export const EQ_RANGE = 12; // ±12 dB
export type EqPreset = 'flat' | 'bass' | 'vocal' | 'acoustic' | 'electronic' | 'treble';
export const EQ_PRESETS: Record<EqPreset, number[]> = {
  flat: [0, 0, 0, 0, 0, 0],
  bass: [6, 4, 1, 0, 0, 0],
  vocal: [-2, -1, 2, 4, 3, 1],
  acoustic: [3, 2, 1, 1, 2, 2],
  electronic: [5, 3, 0, -1, 2, 4],
  treble: [0, 0, 0, 1, 4, 6],
};

/**
 * Preferensi pemutar & tampilan di perangkat ini (bukan akun): normalisasi volume, equalizer, tata letak library,
 * panel Sedang Diputar, dan animasi piringan. Efek audio diterapkan oleh lib/audioFx (berlangganan store ini).
 */
interface Prefs {
  normalize: boolean;
  eqOn: boolean;
  eq: number[];
  compactLibrary: boolean;
  autoOpenNowPlaying: boolean;
  vinylMotion: boolean;
  set: (p: Partial<Omit<Prefs, 'set' | 'setBand'>>) => void;
  setBand: (i: number, db: number) => void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set, get) => ({
      normalize: false,
      eqOn: false,
      eq: [...EQ_PRESETS.flat],
      compactLibrary: false,
      autoOpenNowPlaying: true,
      vinylMotion: true,
      set: (p) => set(p),
      setBand: (i, db) => {
        const eq = [...get().eq];
        eq[i] = Math.max(-EQ_RANGE, Math.min(EQ_RANGE, Math.round(db * 2) / 2));
        set({ eq });
      },
    }),
    { name: 'rave-prefs', partialize: ({ set: _s, setBand: _b, ...rest }) => rest },
  ),
);

/** Preset yang cocok dengan kurva saat ini (null = kustom). */
export function presetOf(eq: number[]): EqPreset | null {
  return (Object.keys(EQ_PRESETS) as EqPreset[]).find((k) => EQ_PRESETS[k].every((v, i) => v === eq[i])) ?? null;
}
