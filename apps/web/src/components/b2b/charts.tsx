import { useId, useMemo, useRef, useState } from 'react';
import { fmt } from '@/lib/api';
import { cx } from '@/components/ui';

// Palet referensi dataviz (slot kategori tervalidasi, mode terang). Teks tetap memakai token tinta, bukan warna seri.
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];

/**
 * Line/area chart satu seri (satu sumbu — jangan dual-axis). Crosshair snap ke tanggal terdekat + tooltip;
 * keyboard: fokus lalu ←/→. Nilai juga tersedia lewat tabel (prop `table`).
 */
export function LineChart({
  data,
  color = SERIES[0],
  label,
  height = 220,
  format = fmt.num,
}: {
  data: { x: string; y: number }[];
  color?: string;
  label: string;
  height?: number;
  format?: (n: number) => string;
}) {
  const W = 720;
  const H = height;
  const pad = { l: 48, r: 12, t: 12, b: 26 };
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, '');
  const { max, pts, ticks } = useMemo(() => {
    const raw = Math.max(1, ...data.map((d) => d.y));
    const step = niceStep(raw / 4);
    const max = Math.ceil(raw / step) * step;
    const pts = data.map((d, i) => ({
      x: pad.l + (data.length <= 1 ? 0 : (i / (data.length - 1)) * (W - pad.l - pad.r)),
      y: pad.t + (1 - d.y / max) * (H - pad.t - pad.b),
    }));
    const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
    return { max, pts, ticks };
  }, [data, H]);
  if (!data.length) return <p className="py-10 text-center text-sm text-b2b-muted">Belum ada data.</p>;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
  const area = `${line}L${pts[pts.length - 1].x},${H - pad.b}L${pts[0].x},${H - pad.b}Z`;
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach((p, i) => Math.abs(p.x - x) < Math.abs(pts[best].x - x) && (best = i));
    setHover(best);
  };
  const labelEvery = Math.max(1, Math.ceil(data.length / 7));
  const h = hover != null ? pts[hover] : null;
  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none outline-none"
        role="img"
        aria-label={`${label}: ${data.length} titik, maksimum ${format(Math.max(...data.map((d) => d.y)))}`}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setHover((v) => Math.min(data.length - 1, (v ?? -1) + 1));
          if (e.key === 'ArrowLeft') setHover((v) => Math.max(0, (v ?? data.length) - 1));
        }}
        onBlur={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`g${gid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.18" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => {
          const y = pad.t + (1 - t / max) * (H - pad.t - pad.b);
          return (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="var(--color-b2b-line)" strokeWidth="1" />
              <text x={pad.l - 8} y={y + 4} textAnchor="end" fontSize="11" fill="var(--color-b2b-muted)">
                {fmt.compact(t)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={d.x} x={pts[i].x} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--color-b2b-muted)">
              {fmt.date(d.x, { day: 'numeric', month: 'short' })}
            </text>
          ) : null,
        )}
        <path d={area} fill={`url(#g${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {h && (
          <>
            <line x1={h.x} x2={h.x} y1={pad.t} y2={H - pad.b} stroke="var(--color-b2b-ink)" strokeOpacity="0.25" strokeWidth="1" />
            <circle cx={h.x} cy={h.y} r="5" fill={color} stroke="var(--color-b2b-card)" strokeWidth="2" />
          </>
        )}
      </svg>
      {h && hover != null && (
        <div
          className="pointer-events-none absolute top-0 rounded-lg border border-b2b-line bg-b2b-card px-3 py-2 text-xs shadow-lg"
          style={{ left: `${(h.x / W) * 100}%`, transform: `translateX(${h.x > W * 0.7 ? '-105%' : '8px'})` }}
        >
          <p className="text-sm font-extrabold text-b2b-ink">{format(data[hover].y)}</p>
          <p className="flex items-center gap-1.5 text-b2b-muted">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: color }} />
            {label} · {fmt.date(data[hover].x)}
          </p>
        </div>
      )}
    </div>
  );
}

/** Bar horizontal berlabel langsung (kategori panjang, mis. kota). Nilai juga di label → tidak bergantung warna/hover. */
export function BarList({ data, color = SERIES[0], format = fmt.num, unit }: { data: { label: string; value: number }[]; color?: string; format?: (n: number) => string; unit?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="py-6 text-center text-sm text-b2b-muted">Belum ada data.</p>;
  return (
    <ul className="space-y-2.5">
      {data.map((d) => (
        <li key={d.label} tabIndex={0} title={`${d.label}: ${format(d.value)}${unit ? ' ' + unit : ''}`} className="group rounded outline-none">
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-semibold text-b2b-ink">{d.label}</span>
            <span className="text-b2b-muted tabular-nums">
              {format(d.value)}
              {unit ? ` ${unit}` : ''}
            </span>
          </div>
          <div className="h-2 rounded-full bg-b2b-bg">
            <div className="h-2 rounded-r-[4px] rounded-l-full transition-opacity group-hover:opacity-80 group-focus:opacity-80" style={{ width: `${(d.value / max) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Sparkline kecil untuk stat tile (tanpa sumbu). */
export function Sparkline({ values, color = SERIES[0], className }: { values: number[]; color?: string; className?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * 100).toFixed(1)},${(30 - (v / max) * 28).toFixed(1)}`).join('');
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={cx('h-8 w-full', className)} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
