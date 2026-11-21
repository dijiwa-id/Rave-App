import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CalendarClock, Check, ChevronDown, Minus, Receipt, Sparkles, TrendingDown } from 'lucide-react';
import { api, fmt, forceRefresh } from '@/lib/api';
import type { BillingCycle, Me, OrgClaim, ProCatalog, ProOrgState, ProPlan, ProQuote, ProSubscription } from '@/lib/types';
import { useAuth } from '@/stores/auth';
import { Badge, Button, Card, cx, Dialog, DialogButton, Field, Input, PageHeader, Textarea, toast } from '@/components/ui';
import { QueryState, Table, useCurrentArtist, useCurrentPromotor } from '@/components/b2b/common';
import { PayInvoice } from '@/components/b2b/PayInvoice';
import { ProBadge } from '@/components/b2b/ProBadge';
import { useDict } from '@/lib/i18n';

type Dict = ReturnType<typeof useDict<'b2b'>>['pro'];
const RANK: Record<ProPlan, number> = { STARTER: 1, PRO: 2, LABEL: 3 };

async function refreshMe() {
  await forceRefresh();
  useAuth.getState().setUser(await api<Me>('/v1/me'));
}

/**
 * Org yang dapat berlangganan dari Artist Studio: org artis terpilih + org MANAGEMENT/LABEL langsung milik pengguna
 * (manajemen/label berlangganan atas namanya sendiri untuk multi-roster & paket Label). Default: manajemen/label.
 */
export function useStudioProOrg(): [OrgClaim | null, OrgClaim[], (id: string) => void] {
  const artist = useCurrentArtist();
  const user = useAuth((s) => s.user);
  const mgmt = (user?.orgs ?? []).filter((o) => (o.type === 'MANAGEMENT' || o.type === 'LABEL') && !o.artist_id);
  const options = [...mgmt, ...(artist ? [artist] : [])];
  const [picked, setPicked] = useState<string | null>(null);
  const org = options.find((o) => o.id === picked) ?? options[0] ?? null;
  return [org, options, setPicked];
}

export function ProOrgPicker({ org, options, onChange }: { org: OrgClaim; options: OrgClaim[]; onChange: (id: string) => void }) {
  const d = useDict('b2b').pro;
  if (options.length < 2) return null;
  return (
    <div className="-mt-3 mb-6 flex flex-wrap items-center gap-2 text-sm" role="radiogroup" aria-label={d.subscribeAs}>
      <span className="text-xs font-bold tracking-wide text-b2b-muted uppercase">{d.subscribeAs}</span>
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={o.id === org.id}
          onClick={() => onChange(o.id)}
          className={cx('border px-3 py-1 text-xs font-bold transition', o.id === org.id ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted hover:text-b2b-ink')}
        >
          {o.name} · {d.orgType[o.type as keyof typeof d.orgType] ?? o.type}
          {o.pro && ' · PRO'}
        </button>
      ))}
    </div>
  );
}

export function StudioPro() {
  const [org, options, pick] = useStudioProOrg();
  return org ? <RavePro key={org.id} org={org} picker={<ProOrgPicker org={org} options={options} onChange={pick} />} /> : null;
}
export function PromotorPro() {
  const org = useCurrentPromotor();
  return org ? <RavePro org={org} /> : null;
}

type Action = { plan: ProPlan; cycle: BillingCycle } | null;

function RavePro({ org, picker }: { org: OrgClaim; picker?: ReactNode }) {
  const d = useDict('b2b').pro;
  const qc = useQueryClient();
  const key = ['pro', org.id];
  const q = useQuery({ queryKey: key, queryFn: () => api<ProOrgState>(`/v1/pro/orgs/${org.id}`) });
  const [cycle, setCycle] = useState<BillingCycle>('YEARLY');
  const [action, setAction] = useState<Action>(null);
  const reload = async () => {
    await qc.invalidateQueries({ queryKey: key });
    await refreshMe().catch(() => undefined);
  };
  const st = q.data;
  const sub = st?.subscription?.entitled ? st.subscription : null;
  const cat = st?.catalog;
  const side: 'promotor' | 'artist' = org.type === 'PROMOTOR' || org.type === 'VENUE' ? 'promotor' : 'artist';

  return (
    <div>
      <PageHeader title={d.title} subtitle={d.subtitle} actions={sub ? <ProBadge className="text-xs" /> : undefined} />
      {picker}
      <QueryState q={q}>
        {st && cat && (
          <div className="space-y-6">
            <Hero cat={cat} d={d} />
            {!st.eligible && <Notice tone="amber">{d.notEligible}</Notice>}
            {st.eligible && !cat.enabled && !sub && <Notice tone="amber">{d.salesClosed}</Notice>}
            {st.eligible && !st.can_manage && <Notice>{d.readOnly}</Notice>}

            <StatusCard st={st} sub={sub} d={d} onChanged={reload} />

            {st.pending_order?.invoice && (
              <Card title={<span className="flex items-center gap-2"><Receipt className="size-4" /> {st.pending_order.kind === 'RENEWAL' ? d.pending.renewal : d.pending.title}</span>}>
                <p className="mb-3 text-sm text-b2b-muted">{d.pending.body}</p>
                <PayInvoice
                  invoice={st.pending_order.invoice}
                  onPaid={async () => {
                    toast.success(d.checkout.paid);
                    // Aktivasi lewat event; tunggu sebentar agar status & profil terbaru terbaca.
                    for (let i = 0; i < 8; i++) {
                      await new Promise((r) => setTimeout(r, 750));
                      const s = await api<ProOrgState>(`/v1/pro/orgs/${org.id}`);
                      if (!s.pending_order) break;
                    }
                    await reload();
                  }}
                />
              </Card>
            )}

            {st.eligible && (
              <section aria-labelledby="pro-plans">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <h2 id="pro-plans" className="text-xl font-extrabold text-b2b-ink">{d.choosePlan}</h2>
                  <CycleToggle value={cycle} onChange={setCycle} discount={cat.yearly_discount_pct} d={d} />
                </div>
                <div className={cx('grid gap-4', cat.plans.length === 3 ? 'lg:grid-cols-3' : 'md:grid-cols-2')}>
                  {cat.plans.map((p) => (
                    <PlanCard
                      key={p.plan}
                      p={p}
                      cat={cat}
                      cycle={cycle}
                      sub={sub}
                      featured={p.plan === 'PRO'}
                      disabled={!st.can_manage || (!cat.enabled && !sub)}
                      onSelect={() => setAction({ plan: p.plan, cycle })}
                      d={d}
                    />
                  ))}
                </div>
              </section>
            )}

            <div className="grid gap-6 lg:grid-cols-5">
              <div className="lg:col-span-3">
                <Calculator cat={cat} side={side} d={d} />
              </div>
              <div className="lg:col-span-2">
                <Faq d={d} />
              </div>
            </div>

            <CompareTable cat={cat} d={d} />
            <History st={st} d={d} />
          </div>
        )}
      </QueryState>
      {action && st && (
        <CheckoutDialog
          org={org}
          action={action}
          sub={sub}
          renewalDays={st.catalog.renewal_invoice_days}
          onClose={() => setAction(null)}
          onDone={async () => {
            setAction(null);
            await reload();
          }}
          d={d}
        />
      )}
    </div>
  );
}

function Notice({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'amber' }) {
  return (
    <p className={cx('rounded-none border p-3 text-sm', tone === 'amber' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-b2b-line bg-b2b-card text-b2b-muted')}>{children}</p>
  );
}

function Hero({ cat, d }: { cat: ProCatalog; d: Dict }) {
  const std = cat.take_rate.standard;
  const pro = cat.take_rate.pro;
  return (
    <section className="relative overflow-hidden border-2 border-b2b-ink bg-b2b-ink p-6 text-b2b-on-ink sm:p-8">
      <div className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-rave-mustard/20 blur-2xl" aria-hidden />
      <p className="rave-label flex items-center gap-2 !text-[11px] text-rave-mustard">
        <Sparkles className="size-3.5" /> {d.heroKicker}
      </p>
      <h2 className="mt-3 max-w-2xl text-[clamp(1.4rem,3vw,2rem)] leading-tight font-extrabold text-balance">{d.heroTitle}</h2>
      <p className="mt-3 max-w-2xl text-sm opacity-80">{d.heroBody(pro.promotor_service_fee_pct, pro.artist_commission_pct)}</p>
      <dl className="mt-6 grid max-w-xl grid-cols-2 gap-3">
        {[
          [d.heroPromotor, std.promotor_service_fee_pct, pro.promotor_service_fee_pct],
          [d.heroArtist, std.artist_commission_pct, pro.artist_commission_pct],
        ].map(([k, a, b]) => (
          <div key={k as string} className="border border-white/25 p-3">
            <dt className="text-[11px] font-bold tracking-wide uppercase opacity-70">{k}</dt>
            <dd className="mt-1 flex items-baseline gap-2 tabular-nums">
              <span className="text-sm line-through opacity-50">{a}%</span>
              <span className="text-3xl font-extrabold text-rave-mustard">{b}%</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function StatusCard({ st, sub, d, onChanged }: { st: ProOrgState; sub: ProSubscription | null; d: Dict; onChanged: () => Promise<void> }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const common = useDict('b2b').common;
  const last = st.subscription;
  const planLabel = (p: ProPlan) => st.catalog.plans.find((x) => x.plan === p)?.label ?? p;
  const cyc = (c: BillingCycle) => (c === 'YEARLY' ? d.yearly : d.monthly);
  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await onChanged();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  if (!sub)
    return (
      <Card title={d.status.title}>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="neutral">{last && !last.entitled ? d.status[last.status] : d.status.none}</Badge>
          <p className="text-sm text-b2b-muted">{last && !last.entitled ? d.status.expiredBody : d.status.noneBody}</p>
        </div>
      </Card>
    );
  const tone = sub.status === 'PAST_DUE' ? 'amber' : 'green';
  return (
    <Card
      title={<span className="flex items-center gap-2"><BadgeCheck className="size-4" /> {d.status.title}</span>}
      action={
        st.can_manage && sub.source === 'PAID' ? (
          sub.auto_renew ? (
            <Button variant="outline-ink" size="sm" disabled={busy} onClick={() => setCancelOpen(true)}>
              {d.status.cancel}
            </Button>
          ) : sub.status === 'ACTIVE' ? (
            <Button variant="ink" size="sm" loading={busy} onClick={() => run(() => api(`/v1/pro/orgs/${st.org_id}/resume`, { method: 'POST' }), d.status.resumed)}>
              {d.status.resume}
            </Button>
          ) : null
        ) : null
      }
    >
      <dl className="grid gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-b2b-muted">{d.status.plan}</dt>
          <dd className="mt-1 flex items-center gap-2 text-lg font-extrabold">
            {sub.plan_label} <ProBadge />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-b2b-muted">{d.status.cycle}</dt>
          <dd className="mt-1 font-semibold">{sub.source === 'COMPLIMENTARY' ? d.status.complimentary : cyc(sub.cycle)}</dd>
        </div>
        <div>
          <dt className="text-xs text-b2b-muted">{d.status.period}</dt>
          <dd className="mt-1 font-semibold tabular-nums">
            {fmt.date(sub.current_period_start)} – {fmt.date(sub.current_period_end)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-b2b-muted">Status</dt>
          <dd className="mt-1">
            <Badge tone={tone}>{d.status[sub.status]}</Badge>
          </dd>
        </div>
      </dl>
      <div className="mt-4 space-y-2 text-sm">
        {sub.status === 'PAST_DUE' && sub.grace_until && <Notice tone="amber">{d.status.graceUntil(fmt.date(sub.grace_until))}</Notice>}
        {sub.status === 'ACTIVE' && (
          <p className="flex items-center gap-2 text-b2b-muted">
            <CalendarClock className="size-4" /> {sub.auto_renew ? d.status.renews(fmt.date(sub.current_period_end)) : d.status.ends(fmt.date(sub.current_period_end))}
          </p>
        )}
        {sub.next_plan && (
          <p className="flex flex-wrap items-center gap-3 text-b2b-muted">
            {d.status.scheduled(planLabel(sub.next_plan), cyc(sub.next_cycle ?? sub.cycle))}
            {st.can_manage && (
              <button className="text-xs font-bold underline" disabled={busy} onClick={() => run(() => api(`/v1/pro/orgs/${st.org_id}/scheduled-change`, { method: 'DELETE' }), d.status.undoSchedule)}>
                {d.status.undoSchedule}
              </button>
            )}
          </p>
        )}
      </div>
      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={d.status.cancelTitle}
        tone="danger"
        alert
        footer={
          <>
            <DialogButton onClick={() => setCancelOpen(false)}>{common.cancel}</DialogButton>
            <DialogButton
              variant="danger"
              disabled={busy}
              onClick={async () => {
                setCancelOpen(false);
                await run(() => api(`/v1/pro/orgs/${st.org_id}/cancel`, { body: { reason: reason.trim() || undefined } }), d.status.cancelled);
              }}
            >
              {d.status.cancel}
            </DialogButton>
          </>
        }
      >
        <p className="text-sm">{d.status.cancelBody(fmt.date(sub.current_period_end))}</p>
        <div className="mt-4">
          <Field label={d.status.cancelReason}>
            <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </Card>
  );
}

function CycleToggle({ value, onChange, discount, d }: { value: BillingCycle; onChange: (c: BillingCycle) => void; discount: number; d: Dict }) {
  return (
    <div className="flex border-2 border-b2b-ink bg-b2b-card p-0.5" role="radiogroup" aria-label={d.compare.title}>
      {(['MONTHLY', 'YEARLY'] as const).map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={value === c}
          onClick={() => onChange(c)}
          className={cx('flex items-center gap-2 px-3 py-1.5 text-xs font-bold transition', value === c ? 'bg-b2b-ink text-b2b-on-ink' : 'text-b2b-muted hover:text-b2b-ink')}
        >
          {c === 'MONTHLY' ? d.monthly : d.yearly}
          {c === 'YEARLY' && discount > 0 && <span className={cx('px-1 text-[10px]', value === c ? 'bg-rave-mustard text-rave-ink' : 'bg-rave-mustard/30 text-b2b-ink')}>{d.save(discount)}</span>}
        </button>
      ))}
    </div>
  );
}

type PlanInfo = ProCatalog['plans'][number];

function planFeatures(p: PlanInfo, cat: ProCatalog, d: Dict): string[] {
  const f = p.features;
  return [
    d.feature.takeRate(cat.take_rate.pro.promotor_service_fee_pct, cat.take_rate.pro.artist_commission_pct),
    d.feature.insights(f.insightsMaxDays),
    d.feature.roster(p.roster_limit),
    ...(f.csvExport ? [d.feature.csv] : []),
    ...(f.counterpartBreakdown ? [d.feature.partners] : []),
    d.feature.badge,
    ...(f.prioritySupport ? [d.feature.support] : []),
    ...(f.dedicatedManager ? [d.feature.manager] : []),
  ];
}

function ctaFor(sub: ProSubscription | null, plan: ProPlan, cycle: BillingCycle, d: Dict): { label: string; current: boolean } {
  if (!sub || sub.source === 'COMPLIMENTARY' || sub.status === 'PAST_DUE') return { label: d.choose, current: false };
  if (sub.plan === plan && sub.cycle === cycle) return { label: d.current, current: true };
  if (RANK[plan] > RANK[sub.plan]) return { label: d.upgrade, current: false };
  if (plan === sub.plan && cycle === 'YEARLY') return { label: d.switchCycle, current: false };
  return { label: d.schedule, current: false };
}

function PlanCard({ p, cat, cycle, sub, featured, disabled, onSelect, d }: { p: PlanInfo; cat: ProCatalog; cycle: BillingCycle; sub: ProSubscription | null; featured: boolean; disabled: boolean; onSelect: () => void; d: Dict }) {
  const cta = ctaFor(sub, p.plan, cycle, d);
  const perMonth = cycle === 'YEARLY' ? Math.round(p.yearly / 12) : p.monthly;
  const isMine = sub?.plan === p.plan;
  return (
    <article
      className={cx(
        'relative flex flex-col border-2 bg-b2b-card p-5 transition',
        featured ? 'border-b2b-ink shadow-[6px_6px_0_var(--color-rave-mustard)]' : 'border-b2b-line',
        isMine && 'ring-2 ring-emerald-500 ring-offset-2 ring-offset-b2b-bg',
      )}
    >
      {featured && <span className="absolute -top-3 left-5 bg-rave-mustard px-2 py-0.5 text-[10px] font-extrabold tracking-wider text-rave-ink uppercase">{d.recommended}</span>}
      <h3 className="text-lg font-extrabold text-b2b-ink">{p.label}</h3>
      <p className="mt-1 min-h-10 text-sm text-b2b-muted">{d.planTagline[p.plan]}</p>
      <p className="mt-4 flex items-baseline gap-1">
        <span className="text-3xl font-extrabold tracking-tight text-b2b-ink tabular-nums">{fmt.idr(perMonth)}</span>
        <span className="text-sm text-b2b-muted">{d.perMonth}</span>
      </p>
      <p className="mt-1 text-xs text-b2b-muted">
        {cycle === 'YEARLY' ? d.billedYearly(fmt.idr(p.yearly)) : ' '} · {d.exclVat(cat.ppn_pct)}
      </p>
      <ul className="mt-5 flex-1 space-y-2 text-sm">
        {planFeatures(p, cat, d).map((f) => (
          <li key={f} className="flex gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden /> <span>{f}</span>
          </li>
        ))}
      </ul>
      <Button className="mt-6 w-full" variant={featured ? 'ink' : 'outline-ink'} disabled={disabled || cta.current} onClick={onSelect}>
        {cta.label}
      </Button>
    </article>
  );
}

function CheckoutDialog({ org, action, sub, renewalDays, onClose, onDone, d }: { org: OrgClaim; action: NonNullable<Action>; sub: ProSubscription | null; renewalDays: number; onClose: () => void; onDone: () => Promise<void>; d: Dict }) {
  const quote = useQuery({ queryKey: ['pro-quote', org.id, action.plan, action.cycle], queryFn: () => api<ProQuote>(`/v1/pro/orgs/${org.id}/quote`, { body: action }) });
  const [busy, setBusy] = useState(false);
  const common = useDict('b2b').common;
  const q = quote.data;
  const label = { STARTER: 'Starter', PRO: 'Pro', LABEL: 'Label' }[action.plan];
  const schedule = q?.mode === 'SCHEDULE';
  const title = schedule ? d.checkout.scheduleTitle(label) : q?.mode === 'UPGRADE' ? d.checkout.upgradeTitle(label) : d.checkout.title(label);
  async function confirm() {
    setBusy(true);
    try {
      const r = await api<{ scheduled: boolean }>(`/v1/pro/orgs/${org.id}/checkout`, { body: action });
      toast.success(r.scheduled ? d.checkout.scheduledToast : d.checkout.created);
      await onDone();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      kicker="RAVE Pro"
      title={title}
      footer={
        <>
          <DialogButton onClick={onClose}>{common.cancel}</DialogButton>
          <DialogButton variant="primary" disabled={busy || !q} onClick={confirm}>
            {schedule ? d.checkout.confirmSchedule : d.checkout.confirm}
          </DialogButton>
        </>
      }
    >
      {!q ? (
        <p className="text-sm opacity-70">{common.loading}</p>
      ) : schedule ? (
        <p className="text-sm">{d.checkout.scheduleBody(fmt.date(sub?.current_period_end))}</p>
      ) : (
        <div className="space-y-4">
          <dl className="space-y-2 text-sm">
            <Line k={`${d.checkout.subtotal} · ${action.cycle === 'YEARLY' ? d.yearly : d.monthly}`} v={fmt.idr(q.subtotal)} />
            {q.credit > 0 && <Line k={d.checkout.credit} v={`− ${fmt.idr(q.credit)}`} />}
            <Line k={d.checkout.vat(q.ppn_pct)} v={fmt.idr(q.ppn)} />
            <div className="border-t border-dashed border-current/30 pt-2">
              <Line k={d.checkout.total} v={fmt.idr(q.total)} strong />
            </div>
          </dl>
          <p className="text-xs opacity-70">{d.checkout.terms(renewalDays)}</p>
        </div>
      )}
    </Dialog>
  );
}

function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? 'font-bold' : 'opacity-80'}>{k}</dt>
      <dd className={cx('tabular-nums', strong ? 'text-lg font-extrabold' : 'font-semibold')}>{v}</dd>
    </div>
  );
}

function Calculator({ cat, side, d }: { cat: ProCatalog; side: 'promotor' | 'artist'; d: Dict }) {
  const [gmv, setGmv] = useState(600_000_000);
  // Paket termurah sebagai pembanding (manfaat take rate sama di semua paket).
  const plan = [...cat.plans].sort((a, b) => a.yearly - b.yearly)[0];
  const diff = side === 'promotor' ? cat.take_rate.standard.promotor_service_fee_pct - cat.take_rate.pro.promotor_service_fee_pct : cat.take_rate.standard.artist_commission_pct - cat.take_rate.pro.artist_commission_pct;
  const saving = Math.max(0, Math.round((gmv * diff) / 100));
  const net = saving - plan.yearly;
  const breakEven = diff > 0 ? Math.ceil((plan.yearly * 100) / diff / 1_000_000) * 1_000_000 : null;
  return (
    <Card title={<span className="flex items-center gap-2"><TrendingDown className="size-4" /> {d.calc.title}</span>}>
      <p className="text-sm text-b2b-muted">
        {d.calc.body} <span className="font-semibold text-b2b-ink">({d.calc.side[side]})</span>
      </p>
      <div className="mt-4">
        <Field label={d.calc.gmv}>
          <Input type="number" min={0} step={10_000_000} value={gmv} onChange={(e) => setGmv(Math.max(0, Number(e.target.value) || 0))} />
        </Field>
        <input type="range" min={0} max={2_000_000_000} step={10_000_000} value={Math.min(gmv, 2_000_000_000)} onChange={(e) => setGmv(Number(e.target.value))} className="mt-3 w-full accent-[var(--color-rave-purple)]" aria-label={d.calc.gmv} />
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <Cell k={`${d.calc.saving} (${diff}%)`} v={fmt.idr(saving)} />
        <Cell k={d.calc.cost(plan.label)} v={fmt.idr(plan.yearly)} />
        <Cell k={d.calc.net} v={fmt.idr(net)} tone={net >= 0 ? 'good' : 'bad'} />
      </dl>
      {breakEven != null && <p className="mt-3 text-sm font-semibold text-b2b-ink">{d.calc.breakEven(fmt.idrShort(breakEven))}</p>}
      <p className="mt-1 text-xs text-b2b-muted">{d.calc.note}</p>
    </Card>
  );
}

function Cell({ k, v, tone }: { k: string; v: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="border border-b2b-line p-3">
      <dt className="text-[11px] font-bold tracking-wide text-b2b-muted uppercase">{k}</dt>
      <dd className={cx('mt-1 text-lg font-extrabold tabular-nums', tone === 'good' && 'text-emerald-600', tone === 'bad' && 'text-red-600')}>{v}</dd>
    </div>
  );
}

function Faq({ d }: { d: Dict }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Card title={d.faq.title}>
      <ul className="divide-y divide-b2b-line">
        {d.faq.items.map(([qq, a], i) => (
          <li key={qq}>
            <button className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm font-bold" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
              {qq}
              <ChevronDown className={cx('size-4 shrink-0 transition', open === i && 'rotate-180')} aria-hidden />
            </button>
            {open === i && <p className="pb-3 text-sm text-b2b-muted">{a}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CompareTable({ cat, d }: { cat: ProCatalog; d: Dict }) {
  const c = d.compare;
  const yes = <Check className="mx-auto size-4 text-emerald-600" aria-label="✓" />;
  const no = <Minus className="mx-auto size-4 text-b2b-muted" aria-label="—" />;
  const rows: [string, ReactNode, ...ReactNode[]][] = useMemo(
    () => [
      [c.takeRate, `${cat.take_rate.standard.promotor_service_fee_pct}% · ${cat.take_rate.standard.artist_commission_pct}%`, ...cat.plans.map(() => `${cat.take_rate.pro.promotor_service_fee_pct}% · ${cat.take_rate.pro.artist_commission_pct}%`)],
      [c.insights, no, ...cat.plans.map((p) => c.days(p.features.insightsMaxDays))],
      [c.csv, no, ...cat.plans.map((p) => (p.features.csvExport ? yes : no))],
      [c.partners, no, ...cat.plans.map((p) => (p.features.counterpartBreakdown ? yes : no))],
      [c.roster, String(cat.free_roster), ...cat.plans.map((p) => (p.roster_limit === 0 ? c.unlimited : String(p.roster_limit)))],
      [c.support, no, ...cat.plans.map((p) => (p.features.prioritySupport ? yes : no))],
      [c.manager, no, ...cat.plans.map((p) => (p.features.dedicatedManager ? yes : no))],
    ],
    [cat, c],
  );
  return (
    <Card title={c.title}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-b2b-line text-left">
              <th className="py-2 pr-3 font-semibold text-b2b-muted" />
              <th className="px-3 py-2 text-center font-bold">{c.free}</th>
              {cat.plans.map((p) => (
                <th key={p.plan} className="px-3 py-2 text-center font-bold">
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, ...cells]) => (
              <tr key={k} className="border-b border-dashed border-b2b-line last:border-0">
                <th scope="row" className="py-2.5 pr-3 text-left font-semibold">
                  {k}
                </th>
                {cells.map((v, i) => (
                  <td key={i} className="px-3 py-2.5 text-center tabular-nums">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function History({ st, d }: { st: ProOrgState; d: Dict }) {
  const h = d.history;
  const tone = { PENDING: 'amber', PAID: 'green', EXPIRED: 'neutral', VOID: 'neutral' } as const;
  return (
    <Card title={h.title}>
      {!st.orders.length ? (
        <p className="text-sm text-b2b-muted">{h.empty}</p>
      ) : (
        <Table head={[h.date, h.item, h.period, h.total, h.status]}>
          {st.orders.map((o) => (
            <tr key={o.id}>
              <td className="whitespace-nowrap tabular-nums">{fmt.date(o.created_at)}</td>
              <td>
                <span className="font-semibold">{h.kind[o.kind]}</span> · {st.catalog.plans.find((p) => p.plan === o.plan)?.label ?? o.plan} · {o.cycle === 'YEARLY' ? d.yearly : d.monthly}
                {o.note && o.kind === 'COMPLIMENTARY' && <span className="block text-xs text-b2b-muted">{o.note}</span>}
              </td>
              <td className="whitespace-nowrap tabular-nums">{o.period_start ? `${fmt.date(o.period_start)} – ${fmt.date(o.period_end)}` : '—'}</td>
              <td className="whitespace-nowrap tabular-nums">
                {fmt.idr(o.total)}
                {o.ppn > 0 && <span className="block text-[11px] text-b2b-muted">{d.checkout.vat(o.ppn_pct)}: {fmt.idr(o.ppn)}</span>}
              </td>
              <td>
                <Badge tone={tone[o.status]}>{h.orderStatus[o.status]}</Badge>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
