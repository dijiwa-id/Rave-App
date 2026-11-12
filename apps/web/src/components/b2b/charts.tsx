import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fmt } from '@/lib/api';
import { cx } from '@/components/ui';
import { useDict } from '@/lib/i18n';

/*
 * Komponen grafik RAVE (dasbor B2B). Prinsip (skill dataviz):
 * - Palet kategori tetap & tervalidasi (token --chart-1..4 per tema; urutan tidak diputar, warna mengikuti entitas).
 * - Satu sumbu (tanpa dual-axis), garis 2px, grid & sumbu resesif, label langsung selektif (nilai terkini saja).
 * - Teks (angka, label, legenda) memakai token tinta, bukan warna seri; mustard RAVE hanya sorotan interaksi.
 * - Dirender pada lebar piksel sebenarnya (ResizeObserver) → teks sumbu tetap 11px tajam di layar sempit,
 *   titik tidak terdistorsi; tooltip crosshair + keyboard (←/→); tampilan tabel untuk aksesibilitas.
 */
export const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
/** Warna default grafik satu seri: ungu RAVE (slot pertama palet). */
export const BRAND_LINE = 'var(--chart-1)';
const HIGHLIGHT = 'var(--chart-highlight)';
const TICK = { fontSize: 11, fontFamily: 'var(--font-label)', fill: 'var(--color-b2b-muted)', letterSpacing: '0.02em' } as const;

/** Lebar elemen dalam piksel (dibulatkan), diperbarui saat ukuran berubah. */
function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setW(Math.max(160, Math.round(el.getBoundingClientRect().width)));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Langkah sumbu "rapi" (1/2/2,5/5 × 10^n) agar label bulat. */
export function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Skala sumbu Y: 0 → maks bulat, 3–5 garis bantu. */
export function yScale(maxValue: number, targetTicks = 4) {
  const raw = Math.max(maxValue, 1);
  const step = niceStep(raw / targetTicks);
  const max = Math.ceil(raw / step) * step;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => +(i * step).toFixed(6));
  return { max, ticks };
}

/**
 * Line/area chart satu seri (satu sumbu — jangan dual-axis). Crosshair snap ke titik terdekat + tooltip;
 * keyboard: fokus lalu ←/→ (Home/End). Tombol "Lihat tabel" menampilkan semua nilai.
 */
export function LineChart({
  data,
  color = BRAND_LINE,
  label,
  height = 240,
  format = fmt.num,
}: {
  data: { x: string; y: number }[];
  color?: string;
  label: string;
  height?: number;
  format?: (n: number) => string;
}) {
  const d = useDict('b2b');
  const [box, W] = useWidth<HTMLDivElement>();
  const H = height;
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const gid = useId().replace(/:/g, '');
  const { max, ticks } = useMemo(() => yScale(Math.max(0, ...data.map((p) => p.y))), [data]);
  // Margin kiri mengikuti label sumbu terpanjang (tidak terpotong, tidak terlalu lebar).
  const padL = Math.max(36, Math.max(...ticks.map((t) => fmt.compact(t).length)) * 7 + 14);
  const pad = { l: padL, r: 16, t: 16, b: 30 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const pts = useMemo(
    () => data.map((p, i) => ({ x: pad.l + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW), y: pad.t + (1 - p.y / max) * innerH })),
    [data, pad.l, innerW, innerH, max, pad.t],
  );
  if (!data.length) return <p className="py-10 text-center text-sm text-b2b-muted">{d.common.noData}</p>;

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
  const base = pad.t + innerH;
  const area = `${line}L${pts[pts.length - 1]!.x.toFixed(1)},${base}L${pts[0]!.x.toFixed(1)},${base}Z`;
  // Label tanggal: jarak minimum ~72px agar tidak bertabrakan; selalu tampilkan titik pertama & terakhir.
  const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(innerW / 72))));
  const showX = (i: number) => i === 0 || i === data.length - 1 || (i % every === 0 && data.length - 1 - i >= every / 2);
  const last = data.length - 1;
  const first = data[0]!.y;
  const change = first > 0 ? (data[last]!.y - first) / first : null;
  const h = hover != null ? pts[hover]! : null;
  const xLabel = (x: string) => (/^\d{4}-\d{2}-\d{2}/.test(x) ? fmt.date(x, { day: 'numeric', month: 'short' }) : x);

  const pick = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const x = clientX - r.left;
    let best = 0;
    pts.forEach((p, i) => Math.abs(p.x - x) < Math.abs(pts[best]!.x - x) && (best = i));
    setHover(best);
  };

  return (
    <div>
      {/* Ringkasan: nilai terkini + perubahan (label langsung selektif) + toggle tabel */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <p className="flex items-baseline gap-2">
          <span className="font-label text-[10px] font-bold tracking-[0.12em] text-b2b-muted uppercase">{d.charts.latest}</span>
          <span className="text-lg leading-none font-extrabold text-b2b-ink tabular-nums">{format(data[last]!.y)}</span>
          {change != null && (
            <span className={cx('text-xs font-bold tabular-nums', change >= 0 ? 'text-emerald-600' : 'text-red-500')}>
              {change >= 0 ? '▲' : '▼'} {d.charts.change(`${Math.abs(change * 100).toFixed(change !== 0 && Math.abs(change) < 0.1 ? 1 : 0)}%`)}
            </span>
          )}
        </p>
        <button type="button" onClick={() => setTable((v) => !v)} className="font-label text-[10px] font-bold tracking-[0.1em] text-b2b-muted uppercase underline-offset-4 hover:text-b2b-ink hover:underline">
          {table ? d.charts.viewChart : d.charts.viewTable}
        </button>
      </div>

      {table ? (
        <div className="max-h-72 overflow-auto border border-b2b-line">
          <table className="w-full text-sm">
            <caption className="sr-only">{label}</caption>
            <thead className="sticky top-0 bg-b2b-card">
              <tr className="font-label text-[10px] tracking-[0.1em] text-b2b-muted uppercase">
                <th className="px-3 py-2 text-left font-bold">{d.charts.colDate}</th>
                <th className="px-3 py-2 text-right font-bold">{label}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.x} className="border-t border-b2b-line">
                  <td className="px-3 py-1.5 text-b2b-muted">{/^\d{4}-\d{2}-\d{2}/.test(p.x) ? fmt.date(p.x) : p.x}</td>
                  <td className="px-3 py-1.5 text-right font-bold text-b2b-ink tabular-nums">{format(p.y)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={box} className="relative">
          <svg
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            className="block touch-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--chart-highlight)]"
            role="img"
            aria-label={d.charts.aria(label, data.length, format(Math.max(...data.map((p) => p.y))))}
            tabIndex={0}
            onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
            onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
            onPointerLeave={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') setHover((v) => Math.min(last, (v ?? -1) + 1));
              else if (e.key === 'ArrowLeft') setHover((v) => Math.max(0, (v ?? data.length) - 1));
              else if (e.key === 'Home') setHover(0);
              else if (e.key === 'End') setHover(last);
              else return;
              e.preventDefault();
            }}
            onBlur={() => setHover(null)}
          >
            <defs>
              <linearGradient id={`g${gid}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={color} stopOpacity="0.16" />
                <stop offset="1" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* grid resesif + label sumbu Y */}
            {ticks.map((t) => {
              const y = Math.round(pad.t + (1 - t / max) * innerH) + 0.5;
              return (
                <g key={t}>
                  <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke={t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'} strokeWidth="1" />
                  <text x={pad.l - 10} y={y + 4} textAnchor="end" {...TICK}>
                    {fmt.compact(t)}
                  </text>
                </g>
              );
            })}
            {/* label sumbu X tanpa tabrakan */}
            {data.map((p, i) =>
              showX(i) ? (
                <text key={p.x} x={pts[i]!.x} y={H - 9} textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'} {...TICK}>
                  {xLabel(p.x)}
                </text>
              ) : null,
            )}
            <path d={area} fill={`url(#g${gid})`} />
            <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {/* titik terkini: penanda 8px bercincin permukaan */}
            {!h && <circle cx={pts[last]!.x} cy={pts[last]!.y} r="4.5" fill={color} stroke="var(--color-b2b-card)" strokeWidth="2" />}
            {h && (
              <>
                <line x1={h.x} x2={h.x} y1={pad.t} y2={base} stroke="var(--chart-axis)" strokeWidth="1" />
                <circle cx={h.x} cy={h.y} r="5.5" fill={color} stroke={HIGHLIGHT} strokeWidth="2.5" />
              </>
            )}
            {/* area target sentuh lebih besar dari tanda */}
            <rect x={pad.l} y={pad.t} width={innerW} height={innerH} fill="transparent" />
          </svg>
          {h && hover != null && (
            <div
              role="status"
              className="pointer-events-none absolute z-10 min-w-28 border-2 border-[var(--b2b-card-border)] bg-b2b-card px-3 py-2 text-xs shadow-[3px_3px_0_var(--b2b-card-border)]"
              style={{ left: h.x, top: Math.max(0, h.y - 64), transform: `translateX(${h.x > W - 150 ? 'calc(-100% - 10px)' : '10px'})` }}
            >
              <p className="font-label text-[10px] tracking-[0.08em] text-b2b-muted uppercase">{/^\d{4}-\d{2}-\d{2}/.test(data[hover]!.x) ? fmt.date(data[hover]!.x) : data[hover]!.x}</p>
              <p className="mt-1 text-base leading-none font-extrabold text-b2b-ink tabular-nums">{format(data[hover]!.y)}</p>
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-b2b-muted">
                <span className="inline-block h-[3px] w-3" style={{ background: color }} aria-hidden />
                {label}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Bar horizontal berlabel langsung (kategori panjang, mis. kota/lagu). Nilai & porsi tertulis di label → tidak bergantung
 * warna/hover. Batang persegi (bahasa visual RAVE), jejak resesif, sorotan mustard saat hover/fokus.
 */
export function BarList({
  data,
  color = BRAND_LINE,
  format = fmt.num,
  unit,
  max: maxItems,
}: {
  data: { label: string; value: number }[];
  color?: string;
  format?: (n: number) => string;
  unit?: string;
  /** Batasi jumlah baris; sisanya digabung ke "Lainnya" (warna tidak diputar untuk kategori ke-n). */
  max?: number;
}) {
  const t = useDict('b2b');
  const rows = useMemo(() => {
    const sorted = [...data];
    if (!maxItems || sorted.length <= maxItems) return sorted;
    const head = sorted.slice(0, maxItems - 1);
    const rest = sorted.slice(maxItems - 1).reduce((a, x) => a + x.value, 0);
    return [...head, { label: t.common.others, value: rest }];
  }, [data, maxItems, t.common.others]);
  const top = Math.max(1, ...rows.map((d) => d.value));
  const total = rows.reduce((a, d) => a + d.value, 0);
  if (!rows.length) return <p className="py-6 text-center text-sm text-b2b-muted">{t.common.noData}</p>;
  return (
    <ul className="space-y-3.5" role="list">
      {rows.map((d, i) => {
        const share = total > 0 ? (d.value / total) * 100 : 0;
        return (
          <li
            key={d.label}
            tabIndex={0}
            aria-label={`${d.label}: ${format(d.value)}${unit ? ' ' + unit : ''}${total > 0 ? ` (${share.toFixed(share < 10 ? 1 : 0)}%)` : ''}`}
            className="group outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--chart-highlight)]"
          >
            <div className="mb-1.5 grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-baseline gap-2 text-[13px]">
              <span className="font-label text-[10px] text-b2b-muted tabular-nums">{String(i + 1).padStart(2, '0')}</span>
              <span className="truncate font-bold text-b2b-ink" title={d.label}>
                {d.label}
              </span>
              <span className="text-right font-bold whitespace-nowrap text-b2b-ink tabular-nums">
                {format(d.value)}
                {unit ? <span className="ml-1 font-normal text-b2b-muted">{unit}</span> : null}
                {total > 0 && <span className="ml-2 inline-block w-11 text-right font-label text-[10px] font-normal text-b2b-muted">{share.toFixed(share < 10 ? 1 : 0)}%</span>}
              </span>
            </div>
            <div className="ml-8 h-2 bg-[var(--chart-grid)]">
              <div
                className="h-full transition-[box-shadow,width] duration-200 group-hover:shadow-[inset_0_-3px_0_var(--chart-highlight)] group-focus-visible:shadow-[inset_0_-3px_0_var(--chart-highlight)] motion-reduce:transition-none"
                style={{ width: `${Math.max(d.value > 0 ? 1.5 : 0, (d.value / top) * 100)}%`, background: color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Sparkline untuk stat tile (tanpa sumbu). Lebar piksel sebenarnya → titik akhir bulat, garis tidak terdistorsi. */
export function Sparkline({ values, color = BRAND_LINE, className }: { values: number[]; color?: string; className?: string }) {
  const [box, W] = useWidth<HTMLDivElement>(200);
  const gid = useId().replace(/:/g, '');
  const H = 36;
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.max(hi, 1);
  const pts = values.map((v, i) => [3 + (i / (values.length - 1)) * (W - 6), 4 + (1 - (v - lo) / span) * (H - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const last = pts[pts.length - 1]!;
  return (
    <div ref={box} className={cx('h-9 w-full', className)} aria-hidden>
      {(
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block overflow-visible">
          <defs>
            <linearGradient id={`s${gid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.18" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line}L${last[0].toFixed(1)},${H}L${pts[0]![0].toFixed(1)},${H}Z`} fill={`url(#s${gid})`} />
          <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={last[0]} cy={last[1]} r="3.5" fill={color} stroke="var(--color-b2b-card)" strokeWidth="1.5" />
        </svg>
      )}
    </div>
  );
}
