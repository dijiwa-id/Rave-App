import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Crown, Gift, Search, Settings2 } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { AdminProRow, AdminProSummary, OrgType, ProOrgState, ProPlan } from '@/lib/types';
import { can, isSuperAdmin, useAuth } from '@/stores/auth';
import { Badge, Button, Card, cx, Field, Input, Modal, PageHeader, Select, Stat, Textarea, toast } from '@/components/ui';
import { QueryState, Table } from '@/components/b2b/common';
import { ChoiceCards, CopyText, DetailHeader, DetailNotice, DetailSection, MiniStat, ModalActions, ReasonDialog, StatStrip } from '@/components/b2b/AdminDetail';
import { serviceHref } from '@/lib/raveServices';
import { useDict } from '@/lib/i18n';

type Status = 'ALL' | 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELLED';
const TONE = { ACTIVE: 'green', PAST_DUE: 'amber', EXPIRED: 'neutral', CANCELLED: 'red' } as const;

/** Back Office → RAVE Pro: langganan organisasi, MRR, paket komplimen & pencabutan (izin finance.view / billing.manage). */
export function AdminPro() {
  const t = useDict('admin').pro;
  const orgTypes = useDict('admin').users.orgTypes;
  const user = useAuth((s) => s.user);
  const manage = can(user, 'billing.manage');
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('ALL');
  const [search, setSearch] = useState('');
  const [grantOpen, setGrantOpen] = useState(false);
  const [detail, setDetail] = useState<AdminProRow | null>(null);
  const q = useQuery({
    queryKey: ['admin-pro', status, search],
    queryFn: () => api<{ summary: AdminProSummary; data: AdminProRow[] }>('/v1/admin/pro/subscriptions', { query: { status, q: search } }),
  });
  const s = q.data?.summary;
  const reload = () => qc.invalidateQueries({ queryKey: ['admin-pro'] });

  const [revoking, setRevoking] = useState<AdminProRow | null>(null);

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <>
            {isSuperAdmin(user) && (
              <Link to={serviceHref('pro')}>
                <Button variant="outline-ink" size="sm" icon={<Settings2 className="size-4" />}>
                  {t.settings}
                </Button>
              </Link>
            )}
            {manage && (
              <Button variant="ink" size="sm" icon={<Gift className="size-4" />} onClick={() => setGrantOpen(true)}>
                {t.grant}
              </Button>
            )}
          </>
        }
      />
      {!manage && <p className="mb-4 text-xs text-b2b-muted">{t.noPerm}</p>}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Stat label={t.mrr} value={s ? fmt.idrShort(s.mrr) : '—'} hint={s ? t.byPlan(s.by_plan.STARTER, s.by_plan.PRO, s.by_plan.LABEL) : undefined} />
        <Stat label={t.active} value={s ? fmt.num(s.active) : '—'} hint={s ? `${t.complimentary} ${s.complimentary}` : undefined} />
        <Stat label={t.pastDue} value={s ? fmt.num(s.past_due) : '—'} />
        <Stat label={t.endingSoon} value={s ? fmt.num(s.ending_soon) : '—'} />
        <Stat label={t.churn} value={s ? fmt.num(s.churn_30d) : '—'} />
        <Stat label={t.revenue30} value={s ? fmt.idrShort(s.revenue_30d) : '—'} />
      </div>
      <Card
        title={
          <span className="flex items-center gap-2">
            <Crown className="size-4" /> {t.title}
          </span>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-b2b-muted" />
              <Input className="h-8 w-48 pl-7 text-xs" placeholder={t.search} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select className="h-8 w-40 text-xs" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {(['ALL', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED'] as const).map((k) => (
                <option key={k} value={k}>
                  {t.status[k]}
                </option>
              ))}
            </Select>
          </div>
        }
      >
        <QueryState q={q}>
          {!q.data?.data.length ? (
            <p className="text-sm text-b2b-muted">{t.empty}</p>
          ) : (
            <Table head={[t.col.org, t.col.plan, t.col.status, t.col.period, t.col.renew, t.col.ltv, t.col.actions]}>
              {q.data.data.map((r) => (
                <tr key={r.org_id}>
                  <td>
                    <span className="font-semibold">{r.org_name}</span>
                    <span className="block text-xs text-b2b-muted">{orgTypes[r.org_type] ?? r.org_type}</span>
                  </td>
                  <td>
                    <span className="font-semibold">{r.plan_label}</span>
                    <span className="block text-xs text-b2b-muted">{r.source === 'COMPLIMENTARY' ? t.source.COMPLIMENTARY : t.cycle[r.cycle]}</span>
                  </td>
                  <td>
                    <Badge tone={TONE[r.status]}>{t.status[r.status]}</Badge>
                    {r.status === 'PAST_DUE' && r.grace_until && <span className="block text-xs text-amber-700">→ {fmt.date(r.grace_until)}</span>}
                  </td>
                  <td className="whitespace-nowrap tabular-nums">{fmt.date(r.current_period_end)}</td>
                  <td>{r.entitled && r.auto_renew ? t.autoRenew : t.noRenew}</td>
                  <td className="whitespace-nowrap tabular-nums">{fmt.idr(r.lifetime_value)}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="text-xs font-bold underline" onClick={() => setDetail(r)}>
                      {t.detail}
                    </button>
                    {manage && r.entitled && (
                      <button className="ml-3 text-xs font-bold text-red-600 underline" onClick={() => setRevoking(r)}>
                        {t.revoke}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </QueryState>
      </Card>
      {grantOpen && <GrantModal onClose={() => setGrantOpen(false)} onDone={reload} />}
      {detail && <DetailModal row={detail} manage={manage} onClose={() => setDetail(null)} onRevoke={() => { setRevoking(detail); setDetail(null); }} />}
      {revoking && <RevokeModal row={revoking} onClose={() => setRevoking(null)} onDone={reload} />}
    </div>
  );
}

const ELIGIBLE: OrgType[] = ['ARTIST', 'MANAGEMENT', 'LABEL', 'PROMOTOR', 'VENUE'];
const PLAN_LABEL: Record<ProPlan, string> = { STARTER: 'Starter', PRO: 'Pro', LABEL: 'Label' };

function GrantModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const d = useDict('admin');
  const t = d.pro;
  const [term, setTerm] = useState('');
  const [org, setOrg] = useState<{ id: string; name: string; type: OrgType; city: string | null } | null>(null);
  const [plan, setPlan] = useState<ProPlan>('PRO');
  const [months, setMonths] = useState(3);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const orgs = useQuery({
    queryKey: ['admin-orgs', term],
    queryFn: () => api<{ data: { id: string; name: string; type: OrgType; city: string | null; pro: unknown }[] }>('/v1/admin/iam/orgs', { query: { q: term } }),
    enabled: term.trim().length >= 2,
  });
  const plans: ProPlan[] = org && (org.type === 'MANAGEMENT' || org.type === 'LABEL') ? ['STARTER', 'PRO', 'LABEL'] : ['STARTER', 'PRO'];
  const results = (orgs.data?.data ?? []).filter((o) => ELIGIBLE.includes(o.type));
  async function submit() {
    if (!org) return;
    setBusy(true);
    try {
      await api(`/v1/admin/pro/orgs/${org.id}/grant`, { body: { plan, months, reason: reason.trim() } });
      toast.success(t.granted);
      onDone();
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={t.grantTitle} wide>
      <div className="space-y-4">
        <p className="text-sm text-b2b-muted">{t.grantBody}</p>
        <DetailSection title={t.sections.org}>
          {org ? (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="font-bold">{org.name}</span>
                <span className="block text-xs text-b2b-muted">
                  {d.users.orgTypes[org.type] ?? org.type}
                  {org.city ? ` · ${org.city}` : ''}
                </span>
              </span>
              <Button size="sm" variant="outline-ink" onClick={() => setOrg(null)}>
                {t.changeOrg}
              </Button>
            </div>
          ) : (
            <>
              <Field label={t.orgSearch}>
                <Input value={term} onChange={(e) => setTerm(e.target.value)} autoFocus />
              </Field>
              {term.trim().length >= 2 && (
                <ul className="mt-2 max-h-48 divide-y divide-b2b-line overflow-y-auto border-2 border-b2b-line">
                  {results.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setOrg(o);
                          if (!(o.type === 'MANAGEMENT' || o.type === 'LABEL') && plan === 'LABEL') setPlan('PRO');
                        }}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-b2b-bg"
                      >
                        <span className="font-semibold">{o.name}</span>
                        <span className="flex items-center gap-1.5 text-xs text-b2b-muted">
                          {d.users.orgTypes[o.type] ?? o.type}
                          {o.city ? ` · ${o.city}` : ''}
                          {!!o.pro && <Badge tone="purple">PRO</Badge>}
                        </span>
                      </button>
                    </li>
                  ))}
                  {orgs.isSuccess && !results.length && <li className="px-3 py-2 text-sm text-b2b-muted">{t.noOrg}</li>}
                </ul>
              )}
            </>
          )}
        </DetailSection>
        <DetailSection title={t.sections.plan}>
          <div className="space-y-4">
            <ChoiceCards label={t.plan} value={plan} onChange={setPlan} cols={plans.length === 3 ? 3 : 2} options={plans.map((p) => ({ value: p, title: PLAN_LABEL[p], hint: t.planHints[p] }))} />
            <Field label={t.months}>
              <Input type="number" min={1} max={24} value={months} onChange={(e) => setMonths(Math.min(24, Math.max(1, Number(e.target.value) || 1)))} className="max-w-[10rem]" />
            </Field>
          </div>
        </DetailSection>
        <Field label={t.reason} hint={d.users.reasonHint}>
          <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={d.users.reasonPlaceholderAction} />
        </Field>
        <ModalActions onCancel={onClose} cancelLabel={d.users.cancel}>
          <Button variant="ink" icon={<Gift className="size-4" />} loading={busy} disabled={!org || reason.trim().length < 5} onClick={submit}>
            {org ? `${t.grant} · ${org.name}` : t.pickOrg}
          </Button>
        </ModalActions>
      </div>
    </Modal>
  );
}

function DetailModal({ row, manage, onClose, onRevoke }: { row: AdminProRow; manage: boolean; onClose: () => void; onRevoke: () => void }) {
  const d = useDict('admin');
  const t = d.pro;
  const q = useQuery({ queryKey: ['admin-pro-org', row.org_id], queryFn: () => api<Omit<ProOrgState, 'catalog' | 'eligible' | 'can_manage'>>(`/v1/admin/pro/orgs/${row.org_id}`) });
  const orders = q.data?.orders ?? [];
  return (
    <Modal open onClose={onClose} title={t.detailTitle} wide="xl">
      <div className="space-y-4">
        <DetailHeader
          avatar={<Building2 className="size-7 text-rave-primary" />}
          title={row.org_name}
          badges={
            <>
              <Badge tone={TONE[row.status]}>{t.status[row.status]}</Badge>
              {row.source === 'COMPLIMENTARY' && <Badge tone="purple">{t.source.COMPLIMENTARY}</Badge>}
            </>
          }
          meta={
            <>
              <span>
                {d.users.orgTypes[row.org_type] ?? row.org_type} · {t.since(fmt.date(row.started_at))}
              </span>
              <CopyText value={row.org_id} label={t.orgId} mono className="text-[11px]" />
            </>
          }
          actions={
            manage && row.entitled ? (
              <Button size="sm" variant="outline-ink" className="!border-red-500/60 !text-red-700" onClick={onRevoke}>
                {t.revoke}
              </Button>
            ) : undefined
          }
        />
        {row.status === 'PAST_DUE' && row.grace_until && <DetailNotice tone="warn">{t.graceNotice(fmt.date(row.grace_until))}</DetailNotice>}
        {row.entitled && row.cancel_at_period_end && <DetailNotice tone="warn">{t.cancelAtEnd(fmt.date(row.current_period_end))}</DetailNotice>}
        <StatStrip>
          <MiniStat label={t.plan} value={row.plan_label} />
          <MiniStat label={t.cycleLabel} value={row.source === 'COMPLIMENTARY' ? t.source.COMPLIMENTARY : t.cycle[row.cycle]} />
          <MiniStat label={t.periodLabel} value={`${fmt.date(row.current_period_start)} – ${fmt.date(row.current_period_end)}`} />
          <MiniStat label={t.col.renew} value={row.entitled && row.auto_renew ? t.autoRenew : t.noRenew} />
          <MiniStat label={t.paidOrders} value={fmt.num(row.paid_orders)} />
          <MiniStat label={t.col.ltv} value={fmt.idr(row.lifetime_value)} />
        </StatStrip>
        {(row.next_plan || row.cancel_reason) && (
          <div className="grid gap-4 md:grid-cols-2">
            {row.next_plan && (
              <DetailSection title={t.sections.next}>
                <p className="text-sm">{t.nextPlan(PLAN_LABEL[row.next_plan], row.next_cycle ? t.cycle[row.next_cycle] : '')}</p>
              </DetailSection>
            )}
            {row.cancel_reason && (
              <DetailSection title={t.cancelReason}>
                <p className="text-sm">“{row.cancel_reason}”</p>
              </DetailSection>
            )}
          </div>
        )}
        <DetailSection title={t.history}>
          <QueryState q={q}>
            {orders.length ? (
              <Table head={[t.col.date, t.plan, t.col.status, t.col.total]}>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="whitespace-nowrap tabular-nums">
                      {fmt.date(o.created_at)}
                      <span className="block text-xs text-b2b-muted">{t.kind[o.kind]}</span>
                    </td>
                    <td>
                      {PLAN_LABEL[o.plan as ProPlan] ?? o.plan} · {t.cycle[o.cycle]}
                      {o.note && <span className="block text-xs text-b2b-muted">{o.note}</span>}
                    </td>
                    <td>
                      <Badge tone={o.status === 'PAID' ? 'green' : o.status === 'PENDING' ? 'amber' : 'neutral'}>{t.orderStatus[o.status]}</Badge>
                    </td>
                    <td className="whitespace-nowrap tabular-nums">
                      {fmt.idr(o.total)}
                      {o.ppn > 0 && <span className="block text-[11px] text-b2b-muted">PPN {fmt.idr(o.ppn)}</span>}
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <p className="text-sm text-b2b-muted">{d.users.empty}</p>
            )}
          </QueryState>
        </DetailSection>
      </div>
    </Modal>
  );
}

function RevokeModal({ row, onClose, onDone }: { row: AdminProRow; onClose: () => void; onDone: () => void }) {
  const t = useDict('admin').pro;
  const [busy, setBusy] = useState(false);
  async function submit(reason: string) {
    setBusy(true);
    try {
      await api(`/v1/admin/pro/orgs/${row.org_id}/revoke`, { body: { reason } });
      toast.success(t.revoked);
      onDone();
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  return <ReasonDialog open title={t.revokeTitle(row.org_name)} body={t.revokeBody} confirmLabel={t.revoke} danger busy={busy} onClose={onClose} onSubmit={submit} />;
}
