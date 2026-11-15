import { useRef, useState } from 'react';
import { cx } from '@/components/ui';
import { useDict } from '@/lib/i18n';
import { EQ_BANDS, EQ_RANGE } from '@/stores/prefs';

const hzLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}KHz` : `${hz}Hz`);
const fmtDb = (v: number) => `${v > 0 ? '+' : ''}${v} dB`;

/** Path kurva halus (Catmull-Rom → Bézier) melalui titik-titik dalam koordinat viewBox 0..100. */
function curvePath(pts: [number, number][]) {
  const all: [number, number][] = [[0, pts[0][1]], ...pts, [100, pts[pts.length - 1][1]]];
  let d = `M ${all[0][0]} ${all[0][1]}`;
  for (let i = 0; i < all.length - 1; i++) {
    const p0 = all[i - 1] ?? all[i];
    const p1 = all[i];
    const p2 = all[i + 1];
    const p3 = all[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/**
 * Equalizer 6 pita bergaya RAVE: kurva mustard + isian gradien, titik kotak bertepi ink yang bisa diseret
 * (klik di mana saja pada kolom juga memindahkan titik). Aksesibel: tiap titik role="slider" — ↑/↓ ±1 dB,
 * PgUp/PgDn ±3 dB, Home = 0 dB.
 */
export function Equalizer({ values, onChange, disabled }: { values: number[]; onChange: (i: number, db: number) => void; disabled?: boolean }) {
  const d = useDict('fan').settings;
  const area = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const xOf = (i: number) => ((i + 0.5) / EQ_BANDS.length) * 100;
  const yOf = (db: number) => (1 - (db + EQ_RANGE) / (2 * EQ_RANGE)) * 100;
  const dbAt = (clientY: number) => {
    const r = area.current!.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    return Math.round((1 - t) * 2 * EQ_RANGE - EQ_RANGE);
  };
  const pts = values.map((v, i) => [xOf(i), yOf(v)] as [number, number]);
  const line = curvePath(pts);

  return (
    <div className={cx('eq-panel select-none', disabled && 'eq-panel--off')} aria-disabled={disabled || undefined}>
      <div className="flex">
        {/* skala dB */}
        <div className="flex w-12 shrink-0 flex-col justify-between py-1 pr-2 text-right font-label text-[10px] text-rave-muted">
          <span>+{EQ_RANGE}dB</span>
          <span>0</span>
          <span>-{EQ_RANGE}dB</span>
        </div>
        <div
          ref={area}
          className="relative h-48 flex-1 sm:h-56"
          onPointerDown={(e) => {
            if (disabled) return;
            const r = area.current!.getBoundingClientRect();
            const i = Math.min(EQ_BANDS.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * EQ_BANDS.length)));
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            setDrag(i);
            onChange(i, dbAt(e.clientY));
          }}
          onPointerMove={(e) => drag != null && onChange(drag, dbAt(e.clientY))}
          onPointerUp={() => setDrag(null)}
          onPointerCancel={() => setDrag(null)}
          style={{ touchAction: 'none' }}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
            <defs>
              <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#F4C21F" stopOpacity="0.42" />
                <stop offset="100%" stopColor="#F4C21F" stopOpacity="0" />
              </linearGradient>
            </defs>
            {EQ_BANDS.map((_, i) => (
              <line key={i} x1={xOf(i)} x2={xOf(i)} y1="0" y2="100" stroke="rgb(255 255 255 / 0.08)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            <line x1="0" x2="100" y1="50" y2="50" stroke="rgb(255 255 255 / 0.18)" strokeDasharray="3 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <path d={`${line} L 100 100 L 0 100 Z`} fill="url(#eq-fill)" />
            <path d={line} fill="none" stroke="#F4C21F" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          </svg>
          {values.map((v, i) => (
            <button
              key={EQ_BANDS[i]}
              type="button"
              role="slider"
              aria-label={d.eqBand(hzLabel(EQ_BANDS[i]))}
              aria-valuemin={-EQ_RANGE}
              aria-valuemax={EQ_RANGE}
              aria-valuenow={v}
              aria-valuetext={fmtDb(v)}
              disabled={disabled}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (disabled) return;
                area.current!.setPointerCapture(e.pointerId);
                setDrag(i);
              }}
              onKeyDown={(e) => {
                const step = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : e.key === 'PageUp' ? 3 : e.key === 'PageDown' ? -3 : null;
                if (step != null) onChange(i, v + step);
                else if (e.key === 'Home') onChange(i, 0);
                else return;
                e.preventDefault();
              }}
              className={cx('eq-knob', drag === i && 'eq-knob--on')}
              style={{ left: `${xOf(i)}%`, top: `${yOf(v)}%` }}
            >
              <span className="eq-knob__tip">{fmtDb(v)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex pl-12">
        {EQ_BANDS.map((hz) => (
          <span key={hz} className="flex-1 text-center font-label text-[10.5px] font-bold text-rave-muted">
            {hzLabel(hz)}
          </span>
        ))}
      </div>
    </div>
  );
}
