import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Crown, Download, Lock } from 'lucide-react';
import { api, ApiError, fmt } from '@/lib/api';
import type { OrgClaim, ProInsights as Insights } from '@/lib/types';
import { Button, Card, cx, PageHeader, Stat, toast } from '@/components/ui';
import { categoryLabel, downloadText, QueryState, Table, useCurrentPromotor } from '@/components/b2b/common';
import { BarList, LineChart, SERIES } from '@/components/b2b/charts';
import { useDict } from '@/lib/i18n';
import { ProBadge } from '@/components/b2b/ProBadge';
import { ProOrgPicker, useStudioProOrg } from './RavePro';

export function StudioInsights() {
  const [org, options, pick] = useStudioProOrg();
  return org ? <ProInsights key={org.id} org={org} base="/studio" picker={<ProOrgPicker org={org} options={options} onChange={pick} />} /> : null;
}
export function PromotorInsights() {
  const org = useCurrentPromotor();
  return org ? <ProInsights org={org} base="/promotor" /> : null;
}

const RANGES = [30, 90, 180, 365, 730];

function ProInsights({ org, base, picker }: { org: OrgClaim; base: string; picker?: ReactNode }) {
  const d = useDict('b2b').pro;
  const t = d.insights;
  const [days, setDays] = useState(90);
  const entitled = !!org.pro;
  const q = useQuery({
    queryKey: ['pro-insights', org.id, days],
    queryFn: () => api<Insights>('/v1/booking/pro/insights', { query: { org_id: org.id, days } }),
    enabled: entitled,
    retry: (n, e) => !(e instanceof ApiError && e.status === 402) && n < 2,
  });
  const locked = !entitled || (q.error instanceof ApiError && q.error.status === 402);
  const a = q.data;

  async function exportCsv() {
    try {
      const res = await api<Response>('/v1/booking/pro/insights.csv', { query: { org_id: org.id, days: a?.days ?? days }, raw: true });
      if (!res.ok) throw new Error(t.csvLocked);
      downloadText(`insight-pro-${org.name}-${a?.days ?? days}h.csv`, await res.text());
    } catch (e) {
      toast.error(e);
    }
  }

  if (locked)
    return (
      <div>
        <PageHeader title={t.title} subtitle={t.subtitle} />
        {picker}
        <section className="relative overflow-hidden border-2 border-b2b-ink bg-b2b-card p-8 text-center">
          <div className="mx-auto grid size-14 place-items-center border-2 border-b2b-ink bg-rave-mustard text-rave-ink">
            <Lock className="size-6" />
          </div>
          <h2 className="mt-4 text-xl font-extrabold text-b2b-ink">{t.locked}</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-b2b-muted">{t.lockedBody}</p>
          <Link to={`${base}/pro`} className="mt-6 inline-block">
            <Button variant="ink" icon={<Crown className="size-4" />}>
              {t.seePlans}
            </Button>
          </Link>
        </section>
      </div>
    );

  const k = a?.kpis;
  const maxDays = a?.max_days ?? 90;
  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <>
            <div className="flex rounded-none border border-b2b-line bg-b2b-card p-0.5" role="radiogroup" aria-label={t.range}>
              {RANGES.filter((r) => r <= Math.max(maxDays, 90)).map((r) => (
                <button key={r} role="radio" aria-checked={days === r} onClick={() => setDays(r)} className={cx('rounded-none px-3 py-1.5 text-xs font-bold', days === r ? 'bg-b2b-ink text-b2b-on-ink' : 'text-b2b-muted')}>
                  {t.days(r)}
                </button>
              ))}
            </div>
            <Button variant="outline-ink" size="sm" icon={<Download className="size-4" />} onClick={exportCsv} disabled={!a?.features.csv_export} title={a?.features.csv_export ? undefined : t.csvLocked}>
              {t.csv}
            </Button>
          </>
        }
      />
      {picker}
      {a && (
        <p className="-mt-4 mb-6 flex items-center gap-2 text-xs text-b2b-muted">
          <ProBadge /> {t.planLimit(a.org.plan_label, a.max_days)}
        </p>
      )}
      <QueryState q={q}>
        {a && k && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              <Stat label={t.inquiries} value={fmt.num(k.inquiries)} hint={`${t.won} ${k.won} · ${t.lost} ${k.lost} · ${t.open} ${k.open}`} />
              <Stat label={t.winRate} value={k.win_rate_pct == null ? '—' : `${k.win_rate_pct}%`} hint={`${t.cancelled} ${k.cancelled} · ${t.disputed} ${k.disputed}`} />
              <Stat label={t.gmv} value={fmt.idrShort(k.gmv)} hint={`${t.avgFee} ${fmt.idrShort(k.avg_fee)}`} />
              <Stat label={t.pipeline} value={fmt.idrShort(k.pipeline)} />
              <Stat label={t.daysToSign} value={k.median_days_to_sign == null ? '—' : `${k.median_days_to_sign} ${t.daysUnit}`} />
              <Stat label={t.saved} value={fmt.idrShort(k.take_rate_saved)} />
            </div>

            {!k.inquiries ? (
              <Card>
                <p className="text-sm text-b2b-muted">{t.empty}</p>
              </Card>
            ) : (
              <>
                <div className="grid gap-6 lg:grid-cols-2">
                  <Card title={t.gmvSeries}>
                    <LineChart data={a.monthly.map((m) => ({ x: m.month, y: m.gmv }))} label={t.gmvSeries} format={fmt.idrShort} color={SERIES[0]} />
                  </Card>
                  <Card title={t.inquirySeries}>
                    <LineChart data={a.monthly.map((m) => ({ x: m.month, y: m.inquiries }))} label={t.inquirySeries} color={SERIES[1]} />
                  </Card>
                </div>
                <div className="grid gap-6 lg:grid-cols-2">
                  <Card title={t.byCity}>
                    <BarList data={a.by_city.map((c) => ({ label: c.city, value: c.inquiries }))} max={8} />
                  </Card>
                  <Card title={t.byCategory}>
                    <Table head={[t.category, t.inquiries, t.won, t.avgFee]}>
                      {a.by_category.map((c) => (
                        <tr key={c.category}>
                          <td className="font-semibold">{categoryLabel(c.category)}</td>
                          <td className="tabular-nums">{fmt.num(c.inquiries)}</td>
                          <td className="tabular-nums">{fmt.num(c.won)}</td>
                          <td className="tabular-nums">{fmt.idrShort(c.avg_fee)}</td>
                        </tr>
                      ))}
                    </Table>
                  </Card>
                </div>
                <Card title={t.roster[a.side]}>
                  <Table head={[t.artist, t.inquiries, t.won, t.winRate, t.gmv, t.avgFee]}>
                    {a.roster.map((r) => (
                      <tr key={r.artist_id}>
                        <td className="font-semibold">{r.name}</td>
                        <td className="tabular-nums">{fmt.num(r.inquiries)}</td>
                        <td className="tabular-nums">{fmt.num(r.won)}</td>
                        <td className="tabular-nums">{r.win_rate_pct == null ? '—' : `${r.win_rate_pct}%`}</td>
                        <td className="tabular-nums">{fmt.idr(r.gmv)}</td>
                        <td className="tabular-nums">{fmt.idr(r.avg_fee)}</td>
                      </tr>
                    ))}
                  </Table>
                </Card>
                {a.partners && (
                  <Card title={t.partners}>
                    <Table head={[t.partner, t.inquiries, t.won, t.gmv, t.cancelRate]}>
                      {a.partners.map((p) => (
                        <tr key={p.org_id ?? p.name}>
                          <td className="font-semibold">{p.name}</td>
                          <td className="tabular-nums">{fmt.num(p.inquiries)}</td>
                          <td className="tabular-nums">{fmt.num(p.won)}</td>
                          <td className="tabular-nums">{fmt.idr(p.gmv)}</td>
                          <td className="tabular-nums">{fmt.num(p.cancelled)}</td>
                        </tr>
                      ))}
                    </Table>
                  </Card>
                )}
              </>
            )}
          </div>
        )}
      </QueryState>
    </div>
  );
}
