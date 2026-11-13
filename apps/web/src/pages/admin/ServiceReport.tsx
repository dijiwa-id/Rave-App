import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, RefreshCcw } from 'lucide-react';
import type { L10n, ReportColumn, ReportFormat, ReportKpi, ServiceReport as Report } from '@rave/domain/reports';
import { api, fmt } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import { Badge, Button, cx } from '@/components/ui';
import { Empty, QueryState, Table } from '@/components/b2b/common';
import { fmtBytes } from './Platform';

/**
 * Dasbor laporan satu sub-layanan (KPI, tren 14 hari, tabel) — data dari `GET /v1/admin/reports/<id>` di service
 * pemilik datanya. Satu komponen untuk semua layanan; label dua bahasa dikirim server.
 */

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'neutral'> = {
  LIVE: 'red', INTERRUPTED: 'amber', SCHEDULED: 'blue', ENDED: 'neutral',
  PUBLISHED: 'green', CANCELLED: 'red', COMPLETED: 'green', SETTLED: 'green', SIGNED: 'green', REJECTED: 'red', REQUESTED: 'amber', APPROVED: 'blue',
  PROCESSING: 'blue', PENDING: 'amber', FAILED: 'red', DONE: 'green', READY: 'green', UPLOADING: 'amber', SKIPPED: 'neutral', NONE: 'neutral',
  INQUIRY: 'blue', NEGOTIATING: 'amber', YES: 'green', NO: 'neutral', INDIVIDUAL: 'purple', STUDENT: 'amber', DUO: 'blue', TICKET: 'purple', PUBLIC: 'neutral',
};

function useTx() {
  const en = useLocale((s) => s.locale) === 'en';
  return (l: L10n | undefined) => (l ? (en ? l.en : l.id) : '');
}

/** Tanggal saja (YYYY-MM-DD) = tanggal WIB — jangan diurai sebagai tengah malam UTC (bergeser sehari di zona barat). */
const asWib = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00+07:00` : v);

function format(v: unknown, f: ReportFormat | undefined): React.ReactNode {
  if (v == null || v === '') return '—';
  switch (f) {
    case 'num':
      return fmt.num(Number(v));
    case 'idr':
      return fmt.idr(Number(v));
    case 'pct':
      return `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    case 'bytes':
      return fmtBytes(Number(v));
    case 'date':
      return fmt.date(asWib(String(v)), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });
    case 'datetime':
      return fmt.dateTime(String(v));
    case 'status':
      return <Badge tone={STATUS_TONE[String(v).toUpperCase()] ?? 'neutral'}>{String(v)}</Badge>;
    default:
      return String(v);
  }
}

function Kpi({ k }: { k: ReportKpi }) {
  const tx = useTx();
  const tone = { good: 'border-t-emerald-500', warn: 'border-t-amber-500', bad: 'border-t-red-500', neutral: 'border-t-b2b-line' }[k.tone ?? 'neutral'];
  return (
    <div className={cx('b2b-surface min-w-0 border border-t-4 border-b2b-line p-4', tone)}>
      <p className="rave-label truncate !text-[10.5px] text-b2b-muted" title={tx(k.label)}>
        {tx(k.label)}
      </p>
      <p className="mt-2 truncate text-[clamp(1.3rem,2.4vw,1.75rem)] leading-none font-extrabold tracking-tight tabular-nums" title={k.format === 'idr' ? fmt.idr(k.value) : undefined}>
        {k.format === 'idr' ? fmt.idrShort(k.value) : format(k.value, k.format ?? 'num')}
      </p>
      {k.hint && <p className="mt-1 truncate text-xs text-b2b-muted">{tx(k.hint)}</p>}
    </div>
  );
}

/** Batang harian sederhana (tanpa pustaka grafik) dengan nilai di tooltip. */
function Trend({ s }: { s: NonNullable<Report['series']> }) {
  const tx = useTx();
  const max = Math.max(1, ...s.points.map((p) => p.value));
  const total = s.points.reduce((a, p) => a + p.value, 0);
  return (
    <div className="b2b-surface border border-b2b-line p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="text-sm font-bold">{tx(s.label)}</p>
        <p className="text-xs text-b2b-muted tabular-nums">Σ {format(total, s.format ?? 'num')}</p>
      </div>
      <div className="flex h-28 items-end gap-1" role="img" aria-label={tx(s.label)}>
        {s.points.map((p) => (
          <div key={p.date} className="group relative flex h-full flex-1 items-end" title={`${fmt.date(asWib(p.date), { day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' })}: ${p.value.toLocaleString()}`}>
            <div className={cx('w-full transition-colors', p.value ? 'bg-b2b-ink group-hover:bg-rave-primary' : 'bg-b2b-line')} style={{ height: `${Math.max(p.value ? 6 : 2, (p.value / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-b2b-muted">
        <span>{s.points[0] && fmt.date(asWib(s.points[0].date), { day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' })}</span>
        <span>{s.points.length > 0 && fmt.date(asWib(s.points[s.points.length - 1]!.date), { day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' })}</span>
      </div>
    </div>
  );
}

export function ServiceReport({ id }: { id: string }) {
  const tx = useTx();
  const q = useQuery({ queryKey: ['service-report', id], queryFn: () => api<Report>(`/v1/admin/reports/${id}`), refetchInterval: 5 * 60_000 });
  const r = q.data;
  return (
    <QueryState q={q}>
      {r && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {r.kpis.map((k) => (
              <Kpi key={k.label.id} k={k} />
            ))}
          </div>
          {r.series && <Trend s={r.series} />}
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold">{tx(r.table.title)}</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-b2b-muted">{fmt.dateTime(r.generated_at)}</span>
                <Button size="sm" variant="outline-ink" icon={<RefreshCcw className="size-3.5" />} loading={q.isFetching} onClick={() => q.refetch()} className="h-7 px-2.5 text-xs">
                  {tx({ id: 'Muat ulang', en: 'Refresh' })}
                </Button>
                {r.table.link && (
                  <Link to={r.table.link.href} className="inline-flex h-7 items-center gap-1 border border-b2b-ink px-2.5 text-xs font-bold hover:bg-b2b-ink hover:text-white">
                    {tx(r.table.link.label)} <ArrowRight className="size-3.5" />
                  </Link>
                )}
              </div>
            </div>
            {r.table.rows.length ? (
              <Table head={r.table.columns.map((c: ReportColumn) => tx(c.label))}>
                {r.table.rows.map((row, i) => (
                  <tr key={i}>
                    {r.table.columns.map((c, j) => (
                      <td key={c.key} className={cx('px-4 py-2.5 text-sm', j === 0 && 'font-bold', (c.format === 'num' || c.format === 'idr' || c.format === 'pct' || c.format === 'bytes') && 'tabular-nums whitespace-nowrap')}>
                        {format(row[c.key], c.format)}
                      </td>
                    ))}
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty title={tx(r.table.empty) || '—'} />
            )}
          </section>
        </div>
      )}
    </QueryState>
  );
}
