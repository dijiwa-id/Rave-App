import { create } from 'zustand';
import { id, type Dict } from '@/locales/id';

/**
 * i18n RAVE (Bahasa Indonesia + English).
 *
 * - Kamus bertipe per namespace di `src/locales/{id,en}/<ns>.ts`. Kamus EN wajib `Shape<typeof id>` → kunci yang
 *   hilang/berlebih gagal di typecheck, jadi kedua bahasa selalu lengkap.
 * - Pemakaian di komponen: `const d = useDict('fan')` lalu `d.home.title` / `d.home.greet(name)` (nilai fungsi untuk
 *   kalimat berparameter & jamak). Di luar React (store, lib): `dict('common').x`.
 * - Kamus ID dibundel; kamus EN dimuat lazy (chunk terpisah) saat dipilih.
 * - Urutan pemilihan bahasa: pilihan akun (`users.locale`) → pilihan tersimpan di perangkat → bahasa browser →
 *   `general.default_locale` (Super Admin).
 * - Ganti bahasa me-remount pohon aplikasi (lihat main.tsx) agar SEMUA teks & format tanggal/angka konsisten;
 *   audio pemutar hidup di store sehingga tidak terputus.
 */

export type Locale = 'id' | 'en';
export const LOCALES: { code: Locale; label: string; short: string; tag: string }[] = [
  { code: 'id', label: 'Bahasa Indonesia', short: 'ID', tag: 'id-ID' },
  { code: 'en', label: 'English', short: 'EN', tag: 'en-US' },
];

/** Bentuk kamus terjemahan: string → string, fungsi dipertahankan, array/objek ditelusuri. */
export type Shape<T> = T extends string
  ? string
  : T extends (...args: infer A) => string
    ? (...args: A) => string
    : T extends readonly unknown[]
      ? { [K in keyof T]: Shape<T[K]> }
      : T extends object
        ? { [K in keyof T]: Shape<T[K]> }
        : T;

const STORAGE_KEY = 'rave-locale';

function readStored(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'id' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}
function writeStored(l: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    /* storage diblokir — pilihan tetap berlaku di sesi ini */
  }
}
function fromBrowser(): Locale | null {
  if (typeof navigator === 'undefined') return null;
  for (const l of navigator.languages ?? [navigator.language]) {
    const s = l.toLowerCase();
    if (s.startsWith('id') || s.startsWith('ms')) return 'id';
    if (s.startsWith('en')) return 'en';
  }
  return null;
}

interface LocaleState {
  locale: Locale;
  /** true bila bahasa dipilih pengguna (perangkat/akun), bukan tebakan — default platform tidak menimpanya. */
  explicit: boolean;
  dicts: Partial<Record<Locale, Dict | Shape<Dict>>>;
}

const stored = readStored();
/** Pratinjau CMS: iframe editor memaksa bahasa lewat `?cms_lang=` tanpa menyimpan pilihan. */
const forced = (() => {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get('cms_lang');
  return v === 'id' || v === 'en' ? v : null;
})();
export const useLocale = create<LocaleState>(() => ({
  locale: forced ?? stored ?? fromBrowser() ?? 'id',
  explicit: !!stored || !!forced,
  dicts: { id },
}));

let enLoading: Promise<void> | null = null;
/** Pastikan kamus bahasa tersedia (EN dimuat lazy). */
export function ensureLocale(l: Locale): Promise<void> {
  if (useLocale.getState().dicts[l]) return Promise.resolve();
  enLoading ??= import('@/locales/en').then((m) => useLocale.setState((s) => ({ dicts: { ...s.dicts, en: m.en } })));
  return enLoading;
}

function applyDocument(l: Locale) {
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

/**
 * Ganti bahasa. `explicit` = pilihan pengguna (disimpan di perangkat). Penyimpanan ke akun dilakukan pemanggil
 * (lihat `useLanguageSwitch` di components/LanguageSwitch) agar lib ini tidak bergantung pada API/auth.
 */
export async function setLocale(l: Locale, opts: { explicit?: boolean } = {}) {
  const explicit = opts.explicit ?? true;
  await ensureLocale(l);
  if (explicit) writeStored(l);
  applyDocument(l);
  useLocale.setState((s) => ({ locale: l, explicit: explicit || s.explicit }));
}

/** Terapkan default platform hanya bila pengguna belum memilih dan browser tidak memberi petunjuk. */
export function applyPlatformDefault(l: unknown) {
  const st = useLocale.getState();
  if ((l === 'id' || l === 'en') && !st.explicit && !fromBrowser() && st.locale !== l) void setLocale(l, { explicit: false });
}

/** Muat kamus bahasa awal sebelum render pertama (dipanggil di main.tsx). */
export async function initLocale() {
  const l = useLocale.getState().locale;
  applyDocument(l);
  try {
    await ensureLocale(l);
  } catch {
    // chunk EN gagal dimuat (offline) → tetap jalan dalam Bahasa Indonesia
    useLocale.setState({ locale: 'id' });
    applyDocument('id');
  }
}

export const currentLocale = () => useLocale.getState().locale;
/** Tag BCP-47 untuk Intl (tanggal, angka). */
export const localeTag = (l: Locale = currentLocale()) => (l === 'en' ? 'en-US' : 'id-ID');

/** Kamus namespace untuk bahasa aktif (di luar React). Jatuh ke ID bila kamus EN belum termuat. */
export function dict<N extends keyof Dict>(ns: N): Shape<Dict[N]> {
  const s = useLocale.getState();
  return ((s.dicts[s.locale] ?? id) as Shape<Dict>)[ns];
}

/** Hook: kamus namespace untuk bahasa aktif; komponen ikut render ulang saat bahasa berganti. */
export function useDict<N extends keyof Dict>(ns: N): Shape<Dict[N]> {
  const locale = useLocale((s) => s.locale);
  const d = useLocale((s) => s.dicts[locale] ?? id) as Shape<Dict>;
  return d[ns];
}
