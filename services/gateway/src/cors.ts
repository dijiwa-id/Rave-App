/**
 * Origin aplikasi klien RAVE yang memanggil API langsung dari WebView (bukan dari origin web):
 * RAVE Desktop (Tauri v2) — Windows/Android WebView2 `http(s)://tauri.localhost`, macOS/Linux `tauri://localhost`.
 * Dibutuhkan untuk API (fetch) DAN stream/gambar ber-`crossOrigin` (equalizer & spektrum memakai Web Audio).
 * Aplikasi mobile (Flutter) memakai HTTP native, tidak terkena CORS.
 */
export const APP_ORIGINS = ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'] as const;

/**
 * Kebijakan CORS gateway.
 * - `CORS_ORIGINS=*` → semua origin; daftar dipisah koma → daftar itu (+ origin aplikasi).
 * - Kosong: dev = semua origin; produksi = PUBLIC_WEB_URL (+ origin aplikasi).
 * - `CORS_APP_ORIGINS=0` mematikan izin otomatis origin aplikasi desktop.
 */
export function corsOrigins(env: Record<string, string | undefined>, isDev: boolean): boolean | string[] {
  const raw = env.CORS_ORIGINS?.trim();
  if (raw === '*') return true;
  const apps = env.CORS_APP_ORIGINS === '0' ? [] : [...APP_ORIGINS];
  const list = raw ? raw.split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean) : null;
  if (!list && isDev) return true;
  const base = list ?? (env.PUBLIC_WEB_URL ? [new URL(env.PUBLIC_WEB_URL).origin] : []);
  const all = [...new Set([...base, ...apps])];
  return all.length ? all : false;
}
