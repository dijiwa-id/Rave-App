import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, Gift, Search, Settings2 } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { AdminProRow, AdminProSummary, OrgType, ProOrgState, ProPlan } from '@/lib/types';
import { can, isSuperAdmin, useAuth } from '@/stores/auth';
import { Badge, Button, Card, cx, Field, Input, Modal, PageHeader, Select, Stat, Textarea, toast } from '@/components/ui';
import { QueryState, Table } from '@/components/b2b/common';
import { serviceHref } from '@/lib/raveServices';
import { useDict } from '@/lib/i18n';

type Status = 'ALL' | 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELLED';
const TONE = { ACTIVE: 'green', PAST_DUE: 'amber', EXPIRED: 'neutral', CANCELLED: 'red' } as const;

/** Back Office → RAVE Pro: langganan organisasi, MRR, paket komplimen & pencabutan (izin finance.view / billing.manage). */
export function AdminPro() {
  const t = useDict('admin').pro;
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
                    <span className="block text-xs text-b2b-muted">{r.org_type}</span>
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
      {detail && <DetailModal row={detail} onClose={() => setDetail(null)} />}
      {revoking && <RevokeModal row={revoking} onClose={() => setRevoking(null)} onDone={reload} />}
    </div>
  );
}

const ELIGIBLE: OrgType[] = ['ARTIST', 'MANAGEMENT', 'LABEL', 'PROMOTOR', 'VENUE'];

function GrantModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useDict('admin').pro;
  const [term, setTerm] = useState('');
  const [org, setOrg] = useState<{ id: string; name: string; type: OrgType } | null>(null);
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
    <Modal open onClose={onClose} title={t.grantTitle}>
      <p className="mb-4 text-sm text-b2b-muted">{t.grantBody}</p>
      <div className="space-y-4">
        <Field label={t.orgSearch}>
          <Input value={term} onChange={(e) => setTerm(e.target.value)} autoFocus />
        </Field>
        {term.trim().length >= 2 && (
          <ul className="max-h-48 divide-y divide-b2b-line overflow-y-auto border border-b2b-line">
            {(orgs.data?.data ?? [])
              .filter((o) => ELIGIBLE.includes(o.type))
              .map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOrg(o);
                      if (!(o.type === 'MANAGEMENT' || o.type === 'LABEL') && plan === 'LABEL') setPlan('PRO');
                    }}
                    className={cx('flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm', org?.id === o.id ? 'bg-b2b-ink text-b2b-on-ink' : 'hover:bg-b2b-bg')}
                  >
                    <span className="font-semibold">{o.name}</span>
                    <span className="text-xs opacity-70">
                      {o.type}
                      {o.city ? ` · ${o.city}` : ''}
                      {o.pro ? ' · PRO' : ''}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t.plan}>
            <Select value={plan} onChange={(e) => setPlan(e.target.value as ProPlan)}>
              {plans.map((p) => (
                <option key={p} value={p}>
                  {p === 'STARTER' ? 'Starter' : p === 'PRO' ? 'Pro' : 'Label'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t.months}>
            <Input type="number" min={1} max={24} value={months} onChange={(e) => setMonths(Math.min(24, Math.max(1, Number(e.target.value) || 1)))} />
          </Field>
        </div>
        <Field label={t.reason}>
          <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Button variant="ink" className="w-full" loading={busy} disabled={!org || reason.trim().length < 5} onClick={submit}>
          {org ? `${t.grant} · ${org.name}` : t.pickOrg}
        </Button>
      </div>
    </Modal>
  );
}

function DetailModal({ row, onClose }: { row: AdminProRow; onClose: () => void }) {
  const t = useDict('admin').pro;
  const q = useQuery({ queryKey: ['admin-pro-org', row.org_id], queryFn: () => api<Omit<ProOrgState, 'catalog' | 'eligible' | 'can_manage'>>(`/v1/admin/pro/orgs/${row.org_id}`) });
  return (
    <Modal open onClose={onClose} title={row.org_name} wide>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={TONE[row.status]}>{t.status[row.status]}</Badge>
        <span className="font-semibold">{row.plan_label}</span>
        <span className="text-b2b-muted">· {row.source === 'COMPLIMENTARY' ? t.source.COMPLIMENTARY : t.cycle[row.cycle]}</span>
        <span className="text-b2b-muted tabular-nums">
          · {fmt.date(row.current_period_start)} – {fmt.date(row.current_period_end)}
        </span>
      </div>
      {row.cancel_reason && (
        <p className="mb-4 border border-b2b-line p-3 text-sm">
          <span className="font-semibold">{t.cancelReason}:</span> {row.cancel_reason}
        </p>
      )}
      <h3 className="mb-2 text-sm font-bold">{t.history}</h3>
      <QueryState q={q}>
        <Table head={[t.col.period, t.plan, t.col.status, t.col.ltv]}>
          {(q.data?.orders ?? []).map((o) => (
            <tr key={o.id}>
              <td className="whitespace-nowrap tabular-nums">
                {fmt.date(o.created_at)}
                <span className="block text-xs text-b2b-muted">{t.kind[o.kind]}</span>
              </td>
              <td>
                {o.plan} · {t.cycle[o.cycle]}
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
      </QueryState>
    </Modal>
  );
}

function RevokeModal({ row, onClose, onDone }: { row: AdminProRow; onClose: () => void; onDone: () => void }) {
  const t = useDict('admin').pro;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api(`/v1/admin/pro/orgs/${row.org_id}/revoke`, { body: { reason: reason.trim() } });
      toast.success(t.revoked);
      onDone();
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={t.revokeTitle(row.org_name)}>
      <p className="mb-4 text-sm text-b2b-muted">{t.revokeBody}</p>
      <Field label={t.reason}>
        <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      <Button variant="danger" className="mt-4 w-full" loading={busy} disabled={reason.trim().length < 5} onClick={submit}>
        {t.revoke}
      </Button>
    </Modal>
  );
}
