import { useId, useMemo, useRef, useState } from 'react';
import { fmt } from '@/lib/api';
import { cx } from '@/components/ui';
import { useDict } from '@/lib/i18n';

// Palet kategori RAVE (token --chart-1..4 per tema, tervalidasi CVD & kontras). Urutan tetap — jangan diputar.
// Teks (nilai, label, legenda) tetap memakai token tinta, bukan warna seri.
export const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
/** Warna default grafik satu seri: ungu RAVE (slot pertama palet). */
export const BRAND_LINE = 'var(--chart-1)';
const TICK = { fontSize: 9, fontFamily: 'var(--font-label)', fill: 'var(--color-b2b-muted)', letterSpacing: '0.04em' } as const;

/**
 * Line/area chart satu seri (satu sumbu — jangan dual-axis). Crosshair snap ke tanggal terdekat + tooltip;
 * keyboard: fokus lalu ←/→. Nilai juga tersedia lewat tabel (prop `table`).
 */
export function LineChart({
  data,
  color = BRAND_LINE,
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
  const d = useDict('b2b');
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
  if (!data.length) return <p className="py-10 text-center text-sm text-b2b-muted">{d.common.noData}</p>;
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
        aria-label={d.charts.aria(label, data.length, format(Math.max(...data.map((p) => p.y))))}
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
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="var(--color-b2b-line)" strokeWidth="1" strokeDasharray={t === 0 ? undefined : '2 4'} />
              <text x={pad.l - 8} y={y + 4} textAnchor="end" {...TICK}>
                {fmt.compact(t)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={d.x} x={pts[i].x} y={H - 8} textAnchor="middle" {...TICK}>
              {fmt.date(d.x, { day: 'numeric', month: 'short' })}
            </text>
          ) : null,
        )}
        <path d={area} fill={`url(#g${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* titik akhir: nilai terkini (mustard bertepi seri) */}
        {!h && <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="4.5" fill="#F4C21F" stroke={color} strokeWidth="2" />}
        {h && (
          <>
            <line x1={h.x} x2={h.x} y1={pad.t} y2={H - pad.b} stroke="var(--color-b2b-ink)" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={h.x} cy={h.y} r="5" fill={color} stroke="var(--color-b2b-card)" strokeWidth="2" />
          </>
        )}
      </svg>
      {h && hover != null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-none border-2 border-[var(--b2b-card-border)] bg-b2b-card px-3 py-2 text-xs shadow-[3px_3px_0_var(--b2b-card-border)]"
          style={{ left: `${(h.x / W) * 100}%`, transform: `translateX(${h.x > W * 0.7 ? '-105%' : '8px'})` }}
        >
          <p className="text-base leading-none font-extrabold text-b2b-ink tabular-nums">{format(data[hover].y)}</p>
          <p className="mt-1.5 flex items-center gap-1.5 font-label text-[10px] tracking-[0.06em] text-b2b-muted uppercase">
            <span className="inline-block h-[3px] w-3" style={{ background: color }} />
            {label} · {fmt.date(data[hover].x)}
          </p>
        </div>
      )}
    </div>
  );
}

/** Bar horizontal berlabel langsung (kategori panjang, mis. kota). Nilai juga di label → tidak bergantung warna/hover. */
export function BarList({ data, color = BRAND_LINE, format = fmt.num, unit }: { data: { label: string; value: number }[]; color?: string; format?: (n: number) => string; unit?: string }) {
  const t = useDict('b2b');
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!data.length) return <p className="py-6 text-center text-sm text-b2b-muted">{t.common.noData}</p>;
  return (
    <ul className="space-y-3">
      {data.map((d, i) => (
        <li
          key={d.label}
          tabIndex={0}
          title={`${d.label}: ${format(d.value)}${unit ? ' ' + unit : ''}`}
          className="group outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-rave-mustard)]"
        >
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 items-center gap-2 font-bold text-b2b-ink">
              <span className="w-5 shrink-0 font-label text-[10px] text-b2b-muted tabular-nums">{String(i + 1).padStart(2, '0')}</span>
              <span className="truncate">{d.label}</span>
            </span>
            <span className="shrink-0 font-bold text-b2b-ink tabular-nums">
              {format(d.value)}
              {unit ? <span className="ml-1 font-normal text-b2b-muted">{unit}</span> : null}
              {total > 0 && <span className="ml-2 font-label text-[10px] font-normal text-b2b-muted">{Math.round((d.value / total) * 100)}%</span>}
            </span>
          </div>
          {/* trek garis tinta tipis; batang persegi warna seri, highlight mustard saat hover */}
          <div className="h-2.5 border border-b2b-line bg-b2b-bg">
            <div
              className="h-full transition-[filter,box-shadow] duration-150 group-hover:shadow-[inset_0_-3px_0_var(--color-rave-mustard)] group-focus-visible:shadow-[inset_0_-3px_0_var(--color-rave-mustard)]"
              style={{ width: `${Math.max(1.5, (d.value / max) * 100)}%`, background: color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Sparkline kecil untuk stat tile (tanpa sumbu). */
export function Sparkline({ values, color = BRAND_LINE, className }: { values: number[]; color?: string; className?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 30 - (v / max) * 26] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={cx('h-9 w-full overflow-visible', className)} aria-hidden>
      {/* area tipis di bawah garis */}
      <path d={`${line}L100,32L0,32Z`} fill={color} opacity="0.1" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill="#F4C21F" stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
