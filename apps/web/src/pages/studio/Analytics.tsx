import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Table2 } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { ArtistAnalytics } from '@/lib/types';
import { Button, Card, cx, PageHeader, Stat, toast } from '@/components/ui';
import { downloadText, QueryState, Table, useCurrentArtist } from '@/components/b2b/common';
import { BarList, LineChart, SERIES } from '@/components/b2b/charts';
import { useDict } from '@/lib/i18n';

const pct = (n: number) => `${Math.round(n * (n <= 1 ? 100 : 1))}%`;

export default function Analytics() {
  const artist = useCurrentArtist()!;
  const aid = artist.artist_id!;
  const [days, setDays] = useState(28);
  const [metric, setMetric] = useState<'streams' | 'listeners'>('streams');
  const [showTable, setShowTable] = useState(false);
  const q = useQuery({ queryKey: ['analytics', aid, days], queryFn: () => api<ArtistAnalytics>(`/v1/analytics/artists/${aid}/summary`, { query: { days } }) });
  const a = q.data;
  const t = useDict('b2b').studio.analytics;

  async function exportCsv() {
    try {
      const res = await api<Response>(`/v1/analytics/artists/${aid}/export.csv`, { query: { days }, raw: true });
      if (!res.ok) throw new Error(t.exportFailed(res.status));
      downloadText(`analitik-${artist.name}-${days}h.csv`, await res.text());
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <>
            <div className="flex rounded-none border border-b2b-line bg-b2b-card p-0.5" role="radiogroup" aria-label={t.rangeAria}>
              {[7, 28, 90].map((d) => (
                <button key={d} role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={cx('rounded-none px-3 py-1.5 text-xs font-bold', days === d ? 'bg-b2b-ink text-b2b-on-ink' : 'text-b2b-muted')}>
                  {t.days(d)}
                </button>
              ))}
            </div>
            <Button variant="outline-ink" size="sm" icon={<Download className="size-4" />} onClick={exportCsv}>
              CSV
            </Button>
          </>
        }
      />
      <QueryState q={q}>
        {a && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <Stat label={t.streams} value={fmt.num(a.streams)} />
              <Stat label={t.uniqueListeners} value={fmt.num(a.listeners)} />
              <Stat label={t.newFollowers} value={fmt.num(a.followers_gained)} />
              <Stat label={t.saveRate} value={pct(a.save_rate)} />
              <Stat label={t.skipRate} value={pct(a.skip_rate)} />
            </div>

            <Card
              title={metric === 'streams' ? t.dailyStreams : t.dailyListeners}
              action={
                <div className="flex items-center gap-2">
                  <div className="flex rounded-none border border-b2b-line p-0.5">
                    {(['streams', 'listeners'] as const).map((m) => (
                      <button key={m} onClick={() => setMetric(m)} aria-pressed={metric === m} className={cx('rounded-none px-3 py-1 text-xs font-bold', metric === m ? 'bg-b2b-ink text-b2b-on-ink' : 'text-b2b-muted')}>
                        {m === 'streams' ? t.streams : t.listeners}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setShowTable(!showTable)} aria-pressed={showTable} aria-label={t.tableView} className="rounded-none border border-b2b-line p-1.5 text-b2b-muted hover:text-b2b-ink">
                    <Table2 className="size-4" />
                  </button>
                </div>
              }
            >
              {showTable ? (
                <Table head={[t.date, t.streams, t.listeners]} className="max-h-72 overflow-y-auto">
                  {a.daily.map((d) => (
                    <tr key={d.date}>
                      <td className="px-4 py-2">{fmt.date(d.date)}</td>
                      <td className="px-4 py-2 tabular-nums">{fmt.num(d.streams)}</td>
                      <td className="px-4 py-2 tabular-nums">{fmt.num(d.listeners)}</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <LineChart
                  data={a.daily.map((d) => ({ x: d.date, y: metric === 'streams' ? d.streams : d.listeners }))}
                  label={metric === 'streams' ? t.streams : t.listeners}
                  color={metric === 'streams' ? SERIES[0] : SERIES[1]}
                />
              )}
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card title={t.topCities}>
                <BarList data={a.top_cities.map((c) => ({ label: c.city, value: c.listeners }))} unit={t.listenersUnit} />
              </Card>
              <Card title={t.topTracks}>
                <BarList data={a.top_tracks.map((tr) => ({ label: tr.title, value: tr.streams }))} unit={t.streamUnit} />
              </Card>
              <Card title={t.ageGroups}>
                <BarList data={a.age_groups.map((g) => ({ label: g.group, value: g.pct }))} format={(n) => pct(n)} />
              </Card>
              <Card title={t.sources}>
                <BarList data={a.sources.map((s) => ({ label: s.source, value: s.pct }))} format={(n) => pct(n)} />
              </Card>
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}
