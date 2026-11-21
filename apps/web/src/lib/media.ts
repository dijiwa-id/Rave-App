/**
 * URL gambar upload dalam ukuran tampilan (performa/LCP): `/v1/catalog/media/<id>.png` → `…?w=<px × DPR>`; server
 * catalog mengirim varian WebP yang dibulatkan ke lebar standar & di-cache. URL lain (demo-art, eksternal,
 * blob, data:) dikembalikan apa adanya.
 */
export function sized<T extends string | null | undefined>(url: T, cssPx: number): T {
  if (!url || !url.startsWith('/v1/catalog/media/') || url.includes('?') || !/\.(jpe?g|png|webp)$/i.test(url)) return url;
  const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1);
  return `${url}?w=${Math.ceil(cssPx * dpr)}` as T;
}
