import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Kolom lirik bergulir mulus untuk panggung karaoke (layar penuh) — dipakai web & desktop (salinan identik).
 *
 * - SATU transform pada "pita" lirik (GPU) menggeser baris aktif ke tengah layar; tiap baris hanya mengubah
 *   transform/opacity/filter sesuai jaraknya dari baris aktif, dengan tunda bertingkat kecil sehingga perpindahan
 *   terasa seperti gelombang, bukan potongan.
 * - Klik baris mana pun → lompat ke waktunya. Roda mouse / seret → jelajah bebas; kembali mengikuti lagu otomatis
 *   setelah diam beberapa detik atau lewat tombol "Ikuti lirik".
 * - Tinggi baris aktif bisa berubah (hitung mundur, teks panjang) → ResizeObserver menghitung ulang posisi.
 * - Gerak dikurangi → tanpa transisi & tanpa blur. Hanya transform/opacity/filter: tidak ada layout thrash.
 */
export type ScrollerLine = { time_ms: number; text: string };

const FOLLOW_AFTER_MS = 4000;
const DRAG_THRESHOLD = 6;

export function LyricScroller({
  lines,
  active,
  reduce,
  onSeek,
  renderActive,
  renderGap,
  followLabel,
  className,
}: {
  lines: ScrollerLine[];
  /** Indeks baris aktif; −1 = sebelum baris pertama (intro). */
  active: number;
  reduce: boolean;
  onSeek: (ms: number) => void;
  /** Isi baris aktif yang berteks (mis. sapuan mustard). */
  renderActive: (index: number) => ReactNode;
  /** Isi slot jeda aktif (intro −1 atau baris kosong ♪), mis. hitung mundur. */
  renderGap: (index: number) => ReactNode;
  followLabel: string;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const hoverIdle = useRef<number | undefined>(undefined);
  const track = useRef<HTMLDivElement>(null);
  const items = useRef(new Map<number, HTMLElement>());
  const [base, setBase] = useState(0); // offset yang menengahkan baris aktif
  const [manual, setManual] = useState(0); // geseran jelajah pengguna
  const [browsing, setBrowsing] = useState(false);
  const idle = useRef<number | undefined>(undefined);
  const drag = useRef<{ y: number; start: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const measure = useCallback(() => {
    const vp = viewport.current;
    const el = items.current.get(active) ?? items.current.get(-1);
    if (!vp || !el) return;
    setBase(vp.clientHeight / 2 - (el.offsetTop + el.offsetHeight / 2));
  }, [active]);

  useLayoutEffect(measure, [measure, lines]);
  useEffect(() => {
    const ro = new ResizeObserver(() => measure());
    if (viewport.current) ro.observe(viewport.current);
    if (track.current) ro.observe(track.current);
    return () => ro.disconnect();
  }, [measure]);

  const follow = useCallback(() => {
    window.clearTimeout(idle.current);
    setBrowsing(false);
    setManual(0);
  }, []);
  const browse = useCallback(
    (next: (m: number) => number) => {
      const t = track.current;
      const vp = viewport.current;
      if (!t || !vp) return;
      // Batas jelajah: pita tidak boleh lepas seluruhnya dari layar.
      const min = -(t.scrollHeight - vp.clientHeight / 2) - base;
      const max = vp.clientHeight / 2 - base;
      setManual((m) => Math.max(min, Math.min(max, next(m))));
      setBrowsing(true);
      window.clearTimeout(idle.current);
      idle.current = window.setTimeout(follow, FOLLOW_AFTER_MS);
    },
    [base, follow],
  );
  useEffect(
    () => () => {
      window.clearTimeout(idle.current);
      window.clearTimeout(hoverIdle.current);
    },
    [],
  );
  // Warna hover hanya saat penunjuk benar-benar bergerak — baris yang lewat di bawah kursor diam tidak ikut menyala.
  const armHover = () => {
    root.current?.setAttribute('data-hover', '');
    window.clearTimeout(hoverIdle.current);
    hoverIdle.current = window.setTimeout(() => root.current?.removeAttribute('data-hover'), 1500);
  };
  // Lagu/lirik berganti → kembali mengikuti.
  useEffect(follow, [lines, follow]);

  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaY) < 1) return;
    browse((m) => m - e.deltaY);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = { y: e.clientY, start: manual, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') armHover();
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    browse(() => d.start + dy);
  };
  const onPointerUp = () => {
    suppressClick.current = !!drag.current?.moved;
    drag.current = null;
  };

  const y = base + manual;
  const dragging = !!drag.current?.moved;
  const slots: { i: number; text: string; time: number }[] = [
    { i: -1, text: '', time: 0 },
    ...lines.map((l, i) => ({ i, text: l.text.trim(), time: l.time_ms })),
  ];
  const current = active >= 0 ? lines[active]?.text.trim() : '';

  return (
    <div
      ref={root}
      className={`lyr ${className ?? ''}`}
      data-reduce={reduce || undefined}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div ref={viewport} className="lyr__vp">
      <div
        ref={track}
        className="lyr__track"
        style={{ transform: `translate3d(0, ${y}px, 0)`, transitionDuration: reduce ? '0ms' : dragging ? '0ms' : browsing ? '220ms' : undefined }}
      >
        {slots.map(({ i, text, time }) => {
          const d = i - active;
          const dist = Math.abs(d);
          const isActive = d === 0;
          const gap = !text;
          // Intro hanya tampil selama belum ada baris aktif.
          if (i === -1 && active >= 0) return <div key="intro" ref={(el) => void (el ? items.current.set(-1, el) : items.current.delete(-1))} className="lyr__intro" aria-hidden />;
          const far = dist > 7;
          // Baris aktif: penuh & mustard. Baris lain: lebih kecil + blur bertingkat menurut jarak (statis juga saat
          // gerak dikurangi — blur bukan gerakan, hanya transisinya yang dimatikan lewat CSS).
          const style: React.CSSProperties = {
            opacity: isActive ? 1 : far ? 0 : Math.max(0.16, 0.6 - dist * 0.08),
            transform: `scale(${isActive ? 1 : 0.72})`,
            filter: isActive || far ? 'none' : `blur(${Math.min(1.2 + (dist - 1) * 0.9, 4.5).toFixed(1)}px)`,
            transitionDelay: reduce ? undefined : `${Math.min(dist, 5) * 28}ms`,
          };
          return (
            <div
              key={i}
              ref={(el) => void (el ? items.current.set(i, el) : items.current.delete(i))}
              className={`lyr__line${isActive ? ' is-active' : ''}${gap ? ' is-gap' : ''}`}
              style={style}
              aria-current={isActive || undefined}
              aria-hidden={far || undefined}
            >
              {isActive ? (
                gap ? (
                  renderGap(i)
                ) : (
                  renderActive(i)
                )
              ) : gap ? (
                i >= 0 && <span className="lyr__note">♪</span>
              ) : (
                <button
                  type="button"
                  tabIndex={far ? -1 : 0}
                  className="lyr__seek"
                  onClick={() => {
                    if (suppressClick.current) return void (suppressClick.current = false);
                    onSeek(time);
                    follow();
                  }}
                >
                  {text}
                </button>
              )}
            </div>
          );
        })}
      </div>
      </div>
      <span className="sr-only" aria-live="polite">
        {current}
      </span>
      {browsing && (
        <button type="button" className="lyr__follow" onClick={follow}>
          {followLabel}
        </button>
      )}
    </div>
  );
}
