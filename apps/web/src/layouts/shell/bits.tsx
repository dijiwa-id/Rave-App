import { useEffect, useRef, useState } from 'react';
import { cx } from '@/components/ui';

/**
 * Pegangan geser antar-panel. `side="left"`: menyeret ke kanan menambah lebar; `side="right"` sebaliknya.
 * Klik-ganda memanggil `onToggle` (ciutkan/bentangkan). Bisa juga digeser dengan panah kiri/kanan.
 */
export function ResizeHandle({
  side,
  width,
  onResize,
  onToggle,
  onRelease,
  label,
}: {
  side: 'left' | 'right';
  width: number;
  onResize: (w: number) => void;
  onToggle?: () => void;
  /** Dipanggil saat dilepas dengan lebar mentah terakhir (mis. untuk menciutkan bila terlalu sempit). */
  onRelease?: (raw: number) => void;
  label: string;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const raw = useRef(width);
  const [drag, setDrag] = useState(false);
  const dir = side === 'left' ? 1 : -1;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      title={label}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width };
        raw.current = width;
        setDrag(true);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        raw.current = start.current.w + (e.clientX - start.current.x) * dir;
        onResize(raw.current);
      }}
      onPointerUp={() => {
        if (!start.current) return;
        start.current = null;
        setDrag(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        onRelease?.(raw.current);
      }}
      onDoubleClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onResize(width - 16 * dir);
        else if (e.key === 'ArrowRight') onResize(width + 16 * dir);
        else if (e.key === 'Enter') onToggle?.();
        else return;
        e.preventDefault();
      }}
      className="group relative z-20 w-2 shrink-0 cursor-col-resize outline-none"
    >
      <span
        aria-hidden
        className={cx(
          'absolute inset-y-6 left-1/2 w-[3px] -translate-x-1/2 transition-colors',
          drag ? 'bg-rave-primary' : 'bg-transparent group-hover:bg-white/25 group-focus-visible:bg-rave-primary',
        )}
      />
    </div>
  );
}

/** Bilah ekualiser mini (penanda "sedang diputar"); diam bila `on` false atau prefers-reduced-motion. */
export function EqBars({ on, className }: { on: boolean; className?: string }) {
  return (
    <span className={cx('shell-eq', className)} data-on={on} aria-hidden>
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

const colorCache = new Map<string, string>();
/**
 * Warna dominan sampul (rata-rata berbobot saturasi dari gambar 24×24) untuk mewarnai latar panel.
 * Gambar katalog disajikan dari origin yang sama, jadi kanvas tidak "tainted"; bila gagal → `fallback`.
 */
export function useCoverColor(src: string | null | undefined, fallback = '#5b2a6e') {
  const [color, setColor] = useState(() => (src && colorCache.get(src)) || fallback);
  useEffect(() => {
    if (!src) return setColor(fallback);
    const hit = colorCache.get(src);
    if (hit) return setColor(hit);
    let alive = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 24;
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(img, 0, 0, 24, 24);
        const px = g.getImageData(0, 0, 24, 24).data;
        let r = 0, gg = 0, b = 0, wsum = 0;
        for (let i = 0; i < px.length; i += 4) {
          const R = px[i], G = px[i + 1], B = px[i + 2];
          const max = Math.max(R, G, B), min = Math.min(R, G, B);
          const lum = (max + min) / 2;
          // Utamakan piksel berwarna, abaikan yang nyaris hitam/putih.
          const w = (max - min + 8) * (lum < 24 || lum > 236 ? 0.15 : 1);
          r += R * w; gg += G * w; b += B * w; wsum += w;
        }
        if (!wsum) throw new Error('empty');
        // Batasi kecerahan & saturasi (HSL) agar teks putih dan aksen mustard tetap terbaca di atasnya.
        const [h, sat, l] = rgbToHsl(r / wsum, gg / wsum, b / wsum);
        const hex = `hsl(${Math.round(h)} ${Math.round(Math.min(sat, 0.62) * 100)}% ${Math.round(Math.min(Math.max(l, 0.16), 0.3) * 100)}%)`;
        colorCache.set(src, hex);
        if (alive) setColor(hex);
      } catch {
        if (alive) setColor(fallback);
      }
    };
    img.onerror = () => alive && setColor(fallback);
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src, fallback]);
  return color;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const dd = max - min;
  const s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
  const h = max === r ? (g - b) / dd + (g < b ? 6 : 0) : max === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
  return [h * 60, s, l];
}
