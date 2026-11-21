import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Calculator, CheckCircle2, Download, Info, Lock, Send, Settings2, Undo2 } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { RoyaltyPeriod, RoyaltyPeriodDetail } from '@/lib/types';
import { can, isSuperAdmin, useAuth } from '@/stores/auth';
import { Badge, Button, Card, confirmDialog, cx, Field, Input, PageHeader, Stat, Textarea, toast } from '@/components/ui';
import { QueryState, Table } from '@/components/b2b/common';
import { serviceHref } from '@/lib/raveServices';
import { useDict } from '@/lib/i18n';

type Dict = ReturnType<typeof useDict<'admin'>>['royalty'];
const TONE = { DRAFT: 'amber', APPROVED: 'blue', PUBLISHED: 'green' } as const;
const STEP = { DRAFT: 1, APPROVED: 2, PUBLISHED: 3 } as const;
const monthLabel = (p: string) => fmt.date(`${p}-15T00:00:00Z`, { month: 'long', year: 'numeric' });

/** Back Office → Royalti: meja kerja periode bulanan (BRD §7.5). Izin royalty.manage (ubah) / finance.view (lihat). */
export function AdminRoyalty() {
  const t = useDict('admin').royalty;
  const user = useAuth((s) => s.user);
  const manage = can(user, 'royalty.manage');
  const list = useQuery({
    queryKey: ['admin-royalty'],
    queryFn: () => api<{ data: RoyaltyPeriod[]; next: { period: string; exists: boolean; compute_day: number; statement_day: number }; allow_open_period: string | null }>('/v1/admin/royalty/periods'),
  });
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    if (!sel && list.data?.data[0]) setSel(list.data.data[0].period);
  }, [list.data, sel]);
  const L = list.data;
  const candidates = L ? [...(L.next.exists ? [] : [L.next.period]), ...(L.allow_open_period && !L.data.some((p) => p.period === L.allow_open_period) ? [L.allow_open_period] : [])] : [];

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          isSuperAdmin(user) && (
            <Link to={serviceHref('royalty')}>
              <Button variant="outline-ink" size="sm" icon={<Settings2 className="size-4" />}>
                {t.settings}
              </Button>
            </Link>
          )
        }
      />
      {!manage && <p className="mb-4 text-xs text-b2b-muted">{t.noPerm}</p>}
      <QueryState q={list}>
        {L && (
          <div className="grid gap-6 xl:grid-cols-[260px_1fr]">
            <Card title={t.periods}>
              <ul className="space-y-1">
                {L.data.map((p) => (
                  <li key={p.period}>
                    <button
                      onClick={() => setSel(p.period)}
                      className={cx('flex w-full items-center justify-between gap-2 border px-3 py-2 text-left text-sm transition', sel === p.period ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-transparent hover:border-b2b-line')}
                    >
                      <span className="font-semibold">{monthLabel(p.period)}</span>
                      <Badge tone={TONE[p.status]}>{t.status[p.status]}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
              {!L.data.length && <p className="text-sm text-b2b-muted">{t.empty}</p>}
              {manage &&
                candidates.map((c) => (
                  <NewPeriod key={c} period={c} label={c === L.allow_open_period ? t.openPeriod(monthLabel(c)) : t.newPeriod(monthLabel(c))} onDone={(p) => setSel(p)} />
                ))}
              <p className="mt-4 text-xs text-b2b-muted">{t.autoNote(L.next.compute_day, L.next.statement_day)}</p>
            </Card>
            {sel ? <Workspace period={sel} manage={manage} t={t} /> : <Card><p className="text-sm text-b2b-muted">{t.empty}</p></Card>}
          </div>
        )}
      </QueryState>
    </div>
  );
}

function NewPeriod({ period, label, onDone }: { period: string; label: string; onDone: (p: string) => void }) {
  const qc = useQueryClient();
  const t = useDict('admin').royalty;
  const [busy, setBusy] = useState(false);
  return (
    <Button
      className="mt-3 h-auto w-full py-2 whitespace-normal"
      variant="ink"
      size="sm"
      icon={<Calculator className="size-4" />}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/v1/admin/royalty/periods/${period}/compute`, { body: { ad_revenue_idr: 0 } });
          toast.success(t.computed);
          await qc.invalidateQueries({ queryKey: ['admin-royalty'] });
          onDone(period);
        } catch (e) {
          toast.error(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}

function Workspace({ period, manage, t }: { period: string; manage: boolean; t: Dict }) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const q = useQuery({ queryKey: ['admin-royalty', period], queryFn: () => api<RoyaltyPeriodDetail>(`/v1/admin/royalty/periods/${period}`) });
  const p = q.data;
  const [ads, setAds] = useState(0);
  const [override, setOverride] = useState(false);
  const [premium, setPremium] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const selfComputed = !!p?.computed?.by_id && p.computed.by_id === user?.id && !isSuperAdmin(user);
  useEffect(() => {
    if (!p) return;
    setAds(p.revenue.ads);
    setOverride(p.revenue.premium_override);
    setPremium(p.revenue.premium);
    setNote(p.note ?? '');
  }, [p?.period, p?.computed?.at]);

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: ['admin-royalty'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }
  async function exp(kind: 'lines' | 'usage' | 'lmkn') {
    try {
      const file = kind === 'lmkn' ? 'lmkn.xlsx' : `${kind}.csv`;
      const res = await api<Response>(`/v1/admin/royalty/periods/${period}/${file}`, { raw: true });
      if (!res.ok) throw new Error(String(res.status));
      const name = kind === 'lmkn' ? `Laporan_Penggunaan_Musik_LMKN_RAVE_${period}.xlsx` : kind === 'usage' ? `SILM_Log_Pemakaian_Musik_RAVE_${period}.csv` : `rave-royalti-rincian-${period}.csv`;
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <QueryState q={q}>
      {p && (
        <div className="min-w-0 space-y-6">
          {/* Langkah */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold tracking-wide text-b2b-muted uppercase">{t.model[p.model]}</p>
                <h2 className="text-2xl font-extrabold">{monthLabel(p.period)}</h2>
                <p className="mt-1 text-xs text-b2b-muted">{t.params(p.params.rightsholder_share_pct, p.params.publishing_share_pct, p.params.reserve_pct, p.params.withholding_pct)}</p>
              </div>
              <ol className="flex flex-wrap items-center gap-2 text-xs font-bold">
                {t.steps.map((s, i) => {
                  const done = i < STEP[p.status] || p.status === 'PUBLISHED';
                  const now = i === STEP[p.status];
                  return (
                    <li key={s} className={cx('flex items-center gap-1.5 border px-2.5 py-1', done ? 'border-emerald-500 text-emerald-700' : now ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted')}>
                      {done ? <CheckCircle2 className="size-3.5" /> : <span className="tabular-nums">{i + 1}</span>} {s}
                    </li>
                  );
                })}
              </ol>
            </div>
            <dl className="mt-4 grid gap-2 text-xs text-b2b-muted sm:grid-cols-3">
              {p.computed && <div><dt className="font-bold text-b2b-ink">{t.computedBy}</dt><dd>{t.by(p.computed.by, fmt.dateTime(p.computed.at))}</dd></div>}
              {p.approved && <div><dt className="font-bold text-b2b-ink">{t.approvedBy}</dt><dd>{t.by(p.approved.by, fmt.dateTime(p.approved.at))}</dd></div>}
              {p.published_at && <div><dt className="font-bold text-b2b-ink">{t.publishedAt}</dt><dd>{fmt.dateTime(p.published_at)}</dd></div>}
            </dl>
          </Card>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label={t.kpi.revenue} value={fmt.idrShort(p.revenue.attributed)} hint={`Premium ${fmt.idrShort(p.revenue.premium)} · Iklan ${fmt.idrShort(p.revenue.ads)}`} />
            <Stat label={t.kpi.pool(p.params.rightsholder_share_pct)} value={fmt.idrShort(p.rightsholder_pool)} />
            <Stat label={t.kpi.distributed} value={fmt.idrShort(p.distributed)} hint={`${p.parties} pihak · ${p.tracks} lagu`} />
            <Stat label={t.kpi.held} value={fmt.idrShort(p.held + p.unclaimed)} hint={`${t.kpi.unclaimed} ${fmt.idrShort(p.unclaimed)}`} />
            <Stat label={t.kpi.streams} value={fmt.num(p.streams)} />
            <Stat label={t.kpi.listeners} value={fmt.num(p.listeners.total)} hint={t.listenersHint(p.listeners.direct, p.listeners.pooled, p.listeners.premium)} />
            <Stat label={t.kpi.excluded} value={fmt.num(p.excluded.streams)} hint={`${p.excluded.listeners} pendengar`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Input & aksi */}
            <Card title={t.inputs}>
              <div className="space-y-4">
                <p className="text-xs text-b2b-muted">{t.premiumAuto(fmt.idr(p.revenue.premium_auto))}</p>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={override} disabled={p.status !== 'DRAFT' || !manage} onChange={(e) => setOverride(e.target.checked)} /> {t.premiumOverride}
                </label>
                {override && (
                  <Field label={t.premium}>
                    <Input type="number" min={0} step={1000} value={premium} disabled={p.status !== 'DRAFT' || !manage} onChange={(e) => setPremium(Math.max(0, Number(e.target.value) || 0))} />
                  </Field>
                )}
                <Field label={t.ads} hint={t.adsHint}>
                  <Input type="number" min={0} step={10000} value={ads} disabled={p.status !== 'DRAFT' || !manage} onChange={(e) => setAds(Math.max(0, Number(e.target.value) || 0))} />
                </Field>
                <Field label={t.note}>
                  <Textarea rows={2} maxLength={1000} value={note} disabled={p.status !== 'DRAFT' || !manage} onChange={(e) => setNote(e.target.value)} />
                </Field>
                {manage && (
                  <div className="flex flex-wrap gap-2">
                    {p.status === 'DRAFT' && (
                      <>
                        <Button
                          variant="outline-ink"
                          size="sm"
                          icon={<Calculator className="size-4" />}
                          loading={busy === 'compute'}
                          onClick={() => act('compute', () => api(`/v1/admin/royalty/periods/${period}/compute`, { body: { ad_revenue_idr: ads, premium_revenue_idr: override ? premium : null, note: note || undefined } }), t.computed)}
                        >
                          {t.compute}
                        </Button>
                        <Button
                          variant="ink"
                          size="sm"
                          icon={<Lock className="size-4" />}
                          loading={busy === 'approve'}
                          disabled={selfComputed}
                          onClick={async () => {
                            if (!(await confirmDialog({ title: t.approveTitle(monthLabel(period)), body: t.approveBody, confirmLabel: t.approve }))) return;
                            await act('approve', () => api(`/v1/admin/royalty/periods/${period}/approve`, { body: {} }), t.approved);
                          }}
                        >
                          {t.approve}
                        </Button>
                      </>
                    )}
                    {p.status === 'APPROVED' && (
                      <>
                        <Button variant="outline-ink" size="sm" icon={<Undo2 className="size-4" />} loading={busy === 'reopen'} onClick={() => act('reopen', () => api(`/v1/admin/royalty/periods/${period}/reopen`, { body: {} }), t.reopened)}>
                          {t.reopen}
                        </Button>
                        <Button
                          variant="ink"
                          size="sm"
                          icon={<Send className="size-4" />}
                          loading={busy === 'publish'}
                          onClick={async () => {
                            if (!(await confirmDialog({ title: t.publishTitle(monthLabel(period)), body: t.publishBody(p.statements.length, fmt.idr(p.statements.reduce((a, s) => a + s.payable, 0))), confirmLabel: t.publish, danger: true }))) return;
                            await act('publish', () => api(`/v1/admin/royalty/periods/${period}/publish`, { body: {} }), t.published);
                          }}
                        >
                          {t.publish}
                        </Button>
                      </>
                    )}
                  </div>
                )}
                {p.status === 'DRAFT' && selfComputed && <p className="text-xs text-amber-500">{t.selfApprove}</p>}
                {p.lmkn_missing.length > 0 && (
                  <p className="border border-amber-500/70 bg-amber-500/10 p-2 text-xs text-b2b-ink">
                    {t.lmknMissing(p.lmkn_missing.join(', '))}{' '}
                    {isSuperAdmin(user) && (
                      <Link className="font-bold underline" to={serviceHref('royalty')}>
                        {t.settings}
                      </Link>
                    )}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 border-t border-dashed border-b2b-line pt-3">
                  <span className="text-xs font-bold text-b2b-muted uppercase">{t.exports}</span>
                  <button className="inline-flex items-center gap-1 text-xs font-bold underline" onClick={() => exp('lines')}>
                    <Download className="size-3.5" /> {t.exportLines}
                  </button>
                  <button className="inline-flex items-center gap-1 text-xs font-bold underline" onClick={() => exp('lmkn')}>
                    <Download className="size-3.5" /> {t.exportLmkn}
                  </button>
                  <button className="inline-flex items-center gap-1 text-xs font-bold underline" onClick={() => exp('usage')}>
                    <Download className="size-3.5" /> {t.exportUsage}
                  </button>
                </div>
              </div>
            </Card>

            <Card title={t.anomalies}>
              {!p.anomalies.length ? (
                <p className="text-sm text-b2b-muted">{t.noAnomalies}</p>
              ) : (
                <ul className="space-y-2">
                  {p.anomalies.map((a, i) => (
                    <li key={i} className={cx('flex gap-2 border p-2.5 text-sm', a.severity === 'warn' ? 'border-amber-500/70 bg-amber-500/10 text-b2b-ink' : 'border-b2b-line text-b2b-ink')}>
                      {a.severity === 'warn' ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" /> : <Info className="mt-0.5 size-4 shrink-0" />}
                      <span>
                        {a.message}
                        {a.ref && <span className="block text-xs opacity-70">{p.top_tracks.find((x) => x.track_id === a.ref)?.title ?? ''}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title={t.topTracks}>
            <Table head={[t.col.track, t.col.streams, t.col.listeners, t.col.perStream, t.col.total, t.col.held]}>
              {p.top_tracks.slice(0, 25).map((r) => (
                <tr key={r.track_id}>
                  <td>
                    <span className="font-semibold">{r.title}</span>
                    <span className="block text-xs text-b2b-muted">
                      {r.artist_name}
                      {r.isrc ? ` · ${r.isrc}` : ''}
                    </span>
                  </td>
                  <td className="tabular-nums">{fmt.num(r.streams)}</td>
                  <td className="tabular-nums">{fmt.num(r.listeners)}</td>
                  <td className="tabular-nums">{r.per_stream == null ? '—' : fmt.idr(r.per_stream)}</td>
                  <td className="font-semibold tabular-nums">{fmt.idr(r.total)}</td>
                  <td>{r.held_reason ? <Badge tone="amber">{t.heldBadge}</Badge> : <Badge tone="green">OK</Badge>}</td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title={t.statements(p.statements.length)}>
            <Table head={[t.col.party, t.col.tracks, t.col.gross, t.col.reserve, t.col.tax, t.col.payable, t.col.carry]}>
              {p.statements.map((s) => (
                <tr key={s.party_key}>
                  <td>
                    <span className="font-semibold">{s.party_name}</span>
                    <span className="block text-xs text-b2b-muted">{s.party_type === 'org' ? 'Org' : 'Akun'}</span>
                  </td>
                  <td className="tabular-nums">{s.tracks}</td>
                  <td className="tabular-nums">{fmt.idr(s.gross)}</td>
                  <td className="tabular-nums text-b2b-muted">{fmt.idr(s.reserve)}</td>
                  <td className="tabular-nums text-b2b-muted">{fmt.idr(s.withholding)}</td>
                  <td className="font-bold tabular-nums">{fmt.idr(s.payable)}</td>
                  <td className="tabular-nums text-b2b-muted">{s.carry_out ? fmt.idr(s.carry_out) : '—'}</td>
                </tr>
              ))}
            </Table>
          </Card>

          {p.unclaimed_parties.length > 0 && (
            <Card title={t.unclaimed}>
              <p className="mb-3 text-xs text-b2b-muted">{t.unclaimedHint}</p>
              <Table head={[t.col.party, t.col.email, t.col.tracks, t.col.total]}>
                {p.unclaimed_parties.map((u) => (
                  <tr key={u.party_email}>
                    <td className="font-semibold">{u.party_name}</td>
                    <td>{u.party_email}</td>
                    <td className="tabular-nums">{u.tracks}</td>
                    <td className="tabular-nums">{fmt.idr(u.total)}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
      )}
    </QueryState>
  );
}
