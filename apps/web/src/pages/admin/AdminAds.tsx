import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardCheck, FlaskConical, Lock, Megaphone, Pause, Pencil, Play, Plus, Send, ShieldCheck, Trash2, X } from 'lucide-react';
import { AD_CATEGORIES, AD_CATEGORY_KEYS, categoryViolation, type AdCategory, type AdCategoryTier } from '@rave/domain/ads';
import { SETTINGS, SETTINGS_BY_KEY } from '@rave/domain/settings';
import { serviceHref } from '@/lib/raveServices';
import { api, ApiError, fmt } from '@/lib/api';
import { dict, useDict } from '@/lib/i18n';
import type { AdsOverview, AdSimulateInput, AdSimulateResult, Campaign, CampaignInput, CampaignStatus, Me, SettingsResponse } from '@/lib/types';
import { isSuperAdmin, useAuth } from '@/stores/auth';
import { Badge, Button, Card, cx, Field, Input, Label, Modal, PageHeader, Select, Stat, Textarea, toast } from '@/components/ui';
import { CITIES, Empty, GENRES, QueryState, Table } from '@/components/b2b/common';
import { BarList, LineChart, SERIES } from '@/components/b2b/charts';
import { AdCard, type AdCardCreative } from '@/components/ads/AdCard';
import { pct, ReadOnlyNote, useIsSuperAdmin } from './Platform';
import { fmtSetting } from './PlatformSettings';

// Back Office → Iklan (docs/API.md §11): ringkasan penayangan, kampanye + peninjauan, dan konsol kebijakan
// (aturan tetap, nilai pengaturan grup `ads`, matriks kategori, simulator keputusan jeda).
// Semua admin boleh membaca & menyusun kampanye; peninjauan hanya Super Admin / Operasional / Content QC.

type Tone = 'neutral' | 'green' | 'blue' | 'amber' | 'red' | 'purple';

const STATUS_TONE: Record<CampaignStatus, Tone> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
  PAUSED: 'blue',
  ENDED: 'neutral',
};
const TIER_TONE: Record<AdCategoryTier, Tone> = {
  general: 'green',
  restricted: 'amber',
  prohibited: 'red',
};
const TIERS: AdCategoryTier[] = ['general', 'restricted', 'prohibited'];

const catDef = (c: string) => (AD_CATEGORIES as Record<string, { label: string; tier: AdCategoryTier; license?: string }>)[c];

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const labels: Record<string, string> = useDict('admin').ads.status;
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{labels[status] ?? status}</Badge>;
}

function CategoryCell({ category }: { category: string }) {
  const tiers = useDict('admin').ads.tier;
  const d = catDef(category);
  if (!d) return <span className="font-mono text-xs">{category}</span>;
  return (
    <div className="space-y-1">
      <p className="text-sm">{d.label}</p>
      <Badge tone={TIER_TONE[d.tier]}>{tiers[d.tier]}</Badge>
    </div>
  );
}

/** Peninjau iklan: Super Admin atau admin_role OPS / CONTENT_QC (sama dengan backend). */
export function canReviewAds(u: Me | null) {
  return isSuperAdmin(u) || ['OPS', 'CONTENT_QC'].includes(u?.admin_role ?? '');
}

/** Pengaturan grup `ads` (nilai server, fallback ke bawaan registri). */
function useAdSettings() {
  const q = useQuery({ queryKey: ['platform-settings'], queryFn: () => api<SettingsResponse>('/v1/admin/platform/settings') });
  const get = <T,>(key: string): T => (q.data?.values[key] ?? SETTINGS_BY_KEY[key]?.default) as T;
  return { q, get, loaded: !!q.data };
}

/** Kreatif seperti yang akan dilihat pendengar: label & aturan lewati mengikuti pengaturan saat ini. */
function toCreative(c: Pick<Campaign, 'type' | 'advertiser' | 'title' | 'body' | 'image_url' | 'click_url' | 'cta_label' | 'theme_color' | 'duration_s' | 'is_house'>, s: ReturnType<typeof useAdSettings>): AdCardCreative {
  const skipAfter = s.get<number>('ads.skip_after_seconds');
  const skippable = c.type === 'display' || s.get<boolean>('ads.audio_skippable');
  return {
    type: c.type,
    advertiser: c.advertiser,
    title: c.title,
    body: c.body,
    image_url: c.image_url,
    click_url: c.click_url,
    cta_label: c.cta_label,
    theme_color: c.theme_color,
    duration_s: c.duration_s,
    skippable_after_s: skippable ? Math.min(skipAfter, c.duration_s) : null,
    label: c.is_house ? 'Dari RAVE' : 'Iklan', // nilai API (AdCard memakainya untuk mendeteksi promosi internal)
  };
}

function Tabs<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="flex flex-wrap gap-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-none font-bold transition',
            size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-sm',
            value === o.value ? 'bg-b2b-ink text-b2b-on-ink' : 'text-b2b-muted hover:bg-b2b-ink/5 hover:text-b2b-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- /admin/ads ----------
type Tab = 'overview' | 'campaigns' | 'policy';
const TAB_KEYS: Tab[] = ['overview', 'campaigns', 'policy'];

export function AdminAds() {
  const t = useDict('admin').ads;
  const TABS: { value: Tab; label: string }[] = TAB_KEYS.map((value) => ({ value, label: t.tabs[value] }));
  const [params, setParams] = useSearchParams();
  const tab = (TAB_KEYS.some((v) => v === params.get('tab')) ? params.get('tab') : 'overview') as Tab;
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);
  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <Button variant="ink" size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            {t.newCampaign}
          </Button>
        }
      />
      <div className="mb-6 border-b border-b2b-line pb-3">
        <Tabs value={tab} options={TABS} onChange={(v) => setParams({ tab: v }, { replace: true })} />
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'campaigns' && <Campaigns onEdit={setEditing} />}
      {tab === 'policy' && <Policy />}
      {editing && <CampaignEditor campaign={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ---------- Ringkasan ----------
const DAY_SERIES = ['impressions', 'clicks', 'breaks'] as const;

function Overview() {
  const d = useDict('admin');
  const t = d.ads.overview;
  const [days, setDays] = useState<'7' | '30'>('7');
  const [series, setSeries] = useState<(typeof DAY_SERIES)[number]>('impressions');
  const q = useQuery({ queryKey: ['ads-overview', days], queryFn: () => api<AdsOverview>('/v1/admin/ads/overview', { query: { days } }) });
  const o = q.data;
  const k = o?.kpis;
  const idx = DAY_SERIES.indexOf(series);
  return (
    <QueryState q={q}>
      {o && k && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-b2b-muted">
              {t.breaksEvaluated(fmt.num(k.breaks), days)}
            </p>
            <Tabs
              size="sm"
              value={days}
              onChange={setDays}
              options={[
                { value: '7', label: t.days(7) },
                { value: '30', label: t.days(30) },
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <Stat label={t.series.impressions} value={fmt.compact(k.impressions)} hint={t.completes(fmt.num(k.completes))} />
            <Stat label={t.fillRate} value={pct(k.fill_rate)} hint={t.fillRateHint} />
            <Stat label={t.completion} value={pct(k.completion_rate)} hint={t.completionHint} />
            <Stat label="CTR" value={pct(k.ctr)} hint={t.clicks(fmt.num(k.clicks))} />
            <Link to="/admin/ads?tab=campaigns&status=APPROVED">
              <Stat label={t.activeCampaigns} value={fmt.num(k.active_campaigns)} />
            </Link>
            <Link to="/admin/ads?tab=campaigns&status=PENDING_REVIEW">
              <Stat label={d.ads.status.PENDING_REVIEW} value={<span className={k.pending_review ? 'text-amber-600' : undefined}>{fmt.num(k.pending_review)}</span>} />
            </Link>
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card
              className="lg:col-span-3"
              title={t.dailyTrend}
              action={<Tabs size="sm" value={series} onChange={setSeries} options={DAY_SERIES.map((s) => ({ value: s, label: t.series[s] }))} />}
            >
              <LineChart data={o.by_day.map((x) => ({ x: x.date, y: x[series] }))} label={t.series[series]} color={SERIES[idx]} />
            </Card>
            <Card className="lg:col-span-2" title={t.outcomes}>
              <p className="-mt-2 mb-4 text-xs text-b2b-muted">{t.outcomesBody}</p>
              <BarList data={o.outcomes.map((x) => ({ label: x.label, value: x.n }))} unit={t.breaksUnit} color={SERIES[2]} />
            </Card>
          </div>

          <div>
            <h2 className="mb-3 text-base font-bold text-b2b-ink">{t.topCampaigns}</h2>
            {o.top_campaigns.length ? (
              <Table head={[...t.topHead]}>
                {o.top_campaigns.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-3">
                      <CampaignName c={c} />
                    </td>
                    <td className="px-4 py-3">
                      <CategoryCell category={c.category} />
                    </td>
                    <td className="px-4 py-3">
                      <CampaignStatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3 tabular-nums">{fmt.num(c.stats.impressions)}</td>
                    <td className="px-4 py-3 tabular-nums">{pct(c.stats.ctr)}</td>
                    <td className="px-4 py-3 tabular-nums">{pct(c.stats.completion_rate)}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty title={t.noImpressions} body={t.noImpressionsBody} />
            )}
          </div>
        </div>
      )}
    </QueryState>
  );
}

function CampaignName({ c }: { c: Campaign }) {
  const t = useDict('admin').ads;
  return (
    <div className="min-w-[180px]">
      <p className="flex items-center gap-2 font-bold">
        {c.name}
        {c.is_house && <Badge tone="purple">{t.fromRave}</Badge>}
      </p>
      <p className="text-xs text-b2b-muted">{c.advertiser}</p>
    </div>
  );
}

// ---------- Kampanye ----------
const STATUS_FILTERS: ('' | CampaignStatus)[] = ['', 'PENDING_REVIEW', 'APPROVED', 'DRAFT', 'PAUSED', 'REJECTED', 'ENDED'];

function useInvalidateAds() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['ads-campaigns'] });
    qc.invalidateQueries({ queryKey: ['ads-overview'] });
  };
}

const flight = (c: Campaign) => `${fmt.date(c.start_at, { day: 'numeric', month: 'short' })} – ${c.end_at ? fmt.date(c.end_at, { day: 'numeric', month: 'short', year: 'numeric' }) : dict('admin').ads.noEnd}`;

function Campaigns({ onEdit }: { onEdit: (c: Campaign) => void }) {
  const ad = useDict('admin').ads;
  const t = ad.campaigns;
  const filters = STATUS_FILTERS.map((value) => ({ value, label: value ? ad.status[value] : t.all }));
  const [params, setParams] = useSearchParams();
  const status = (STATUS_FILTERS.some((f) => f === params.get('status')) ? params.get('status') : '') as '' | CampaignStatus;
  const q = useQuery({ queryKey: ['ads-campaigns', status], queryFn: () => api<{ data: Campaign[] }>('/v1/admin/ads/campaigns', { query: { status } }) });
  const user = useAuth((s) => s.user);
  const reviewer = canReviewAds(user);
  const invalidate = useInvalidateAds();
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<Campaign | null>(null);

  async function act(c: Campaign, action: 'submit' | 'pause' | 'resume' | 'delete') {
    if (action === 'delete' && !confirm(t.confirmDelete(c.name))) return;
    setBusy(c.id + action);
    try {
      if (action === 'delete') await api(`/v1/admin/ads/campaigns/${c.id}`, { method: 'DELETE' });
      else await api(`/v1/admin/ads/campaigns/${c.id}/${action}`, { method: 'POST' });
      toast.success(t.toast[action]);
      invalidate();
    } catch (e) {
      // 422 saat mengajukan = melanggar kebijakan → tampilkan pesan pertama; detail lengkap di form edit.
      toast.error(e instanceof ApiError && e.problem.errors?.length ? t.openEditForDetail(e.message) : e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs size="sm" value={status} onChange={(v) => setParams(v ? { tab: 'campaigns', status: v } : { tab: 'campaigns' }, { replace: true })} options={filters} />
        {!reviewer && <p className="text-xs text-b2b-muted">{t.reviewersNote}</p>}
      </div>
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title={t.emptyTitle} body={status ? t.emptyStatus : t.emptyFirst} /> : undefined}>
        <Table head={[...t.head]}>
          {q.data?.data.map((c) => {
            const btn = (key: string, label: string, icon: ReactNode, onClick: () => void, variant: 'outline-ink' | 'ink' | 'danger' = 'outline-ink') => (
              <Button key={key} size="sm" variant={variant} icon={icon} loading={busy === c.id + key} onClick={onClick} className="h-7 px-3 text-xs">
                {label}
              </Button>
            );
            return (
              <tr key={c.id} className="align-top">
                <td className="px-4 py-3">
                  <CampaignName c={c} />
                  {c.created_by_name && <p className="mt-0.5 text-[11px] text-b2b-muted">{t.by(c.created_by_name)}</p>}
                </td>
                <td className="px-4 py-3">
                  <CategoryCell category={c.category} />
                </td>
                <td className="px-4 py-3 text-sm">
                  {ad.type[c.type]}
                  <p className="text-xs text-b2b-muted">{ad.seconds(c.duration_s)}</p>
                </td>
                <td className="px-4 py-3 text-sm whitespace-nowrap">
                  {flight(c)}
                  {c.max_impressions != null && <p className="text-xs text-b2b-muted">{t.maxImpressions(fmt.compact(c.max_impressions))}</p>}
                </td>
                <td className="px-4 py-3 text-sm tabular-nums">{c.priority}</td>
                <td className="px-4 py-3">
                  <CampaignStatusBadge status={c.status} />
                  {c.review_note && (
                    <p className="mt-1 max-w-[200px] text-xs text-b2b-muted" title={c.review_note}>
                      “{c.review_note}”{c.reviewed_by_name && ` — ${c.reviewed_by_name}`}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-xs whitespace-nowrap text-b2b-muted tabular-nums">
                  <p>
                    <b className="text-sm text-b2b-ink">{fmt.compact(c.stats.impressions)}</b> {t.impressions}
                  </p>
                  <p>
                    CTR {pct(c.stats.ctr)} · {t.completed(pct(c.stats.completion_rate))}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {c.status === 'PENDING_REVIEW' &&
                      (reviewer ? (
                        btn('review', t.review, <ClipboardCheck className="size-3.5" />, () => setReview(c), 'ink')
                      ) : (
                        <span key="review" title={t.reviewersOnly} className="inline-flex cursor-not-allowed">
                          <Button size="sm" variant="ink" disabled icon={<ClipboardCheck className="size-3.5" />} className="h-7 px-3 text-xs">
                            {t.review}
                          </Button>
                        </span>
                      ))}
                    {(c.status === 'DRAFT' || c.status === 'REJECTED') && btn('submit', t.submit, <Send className="size-3.5" />, () => act(c, 'submit'))}
                    {c.status === 'APPROVED' && btn('pause', t.pause, <Pause className="size-3.5" />, () => act(c, 'pause'))}
                    {c.status === 'PAUSED' && btn('resume', t.resume, <Play className="size-3.5" />, () => act(c, 'resume'))}
                    {c.status !== 'ENDED' && btn('edit', t.edit, <Pencil className="size-3.5" />, () => onEdit(c))}
                    {(c.status === 'DRAFT' || c.status === 'REJECTED') && c.stats.impressions === 0 && btn('delete', t.delete, <Trash2 className="size-3.5" />, () => act(c, 'delete'), 'danger')}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      </QueryState>
      {review && <ReviewModal campaign={review} onClose={() => setReview(null)} onDone={invalidate} />}
    </div>
  );
}

function ReviewModal({ campaign: c, onClose, onDone }: { campaign: Campaign; onClose: () => void; onDone: () => void }) {
  const s = useAdSettings();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [errors, setErrors] = useState<{ path: string; message: string }[]>([]);
  const ad = useDict('admin');
  const t = ad.ads.review;
  const d = catDef(c.category);
  const blocked = s.get<string[]>('ads.blocked_categories') ?? [];
  const violation = c.is_house ? null : categoryViolation(c.category, blocked, c.license_ref);
  async function decide(approve: boolean) {
    setBusy(approve ? 'approve' : 'reject');
    setErrors([]);
    try {
      await api(`/v1/admin/ads/campaigns/${c.id}/review`, { body: { approve, note: note.trim() || undefined } });
      toast.success(approve ? t.toastApproved : t.toastRejected);
      onDone();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors?.length) setErrors(e.problem.errors);
      else toast.error(e);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Modal open onClose={onClose} title={t.title} wide>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="mb-2 text-xs font-bold tracking-wide text-b2b-muted uppercase">{t.playerPreview}</p>
          <div className="rounded-none bg-[#181818] p-4">
            <AdCard ad={toCreative(c, s)} elapsedMs={0} onCta={() => c.click_url && window.open(c.click_url, '_blank', 'noopener,noreferrer')} />
          </div>
          {c.type === 'audio' && c.audio_url && <audio controls src={c.audio_url} className="mt-3 w-full" aria-label={t.listenAudio} />}
        </div>
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-b2b-muted">{t.campaign}</dt>
            <dd className="font-bold">{c.name}</dd>
            <dt className="text-b2b-muted">{t.advertiser}</dt>
            <dd>{c.advertiser}</dd>
            <dt className="text-b2b-muted">{t.category}</dt>
            <dd>
              <CategoryCell category={c.category} />
            </dd>
            {d?.license && (
              <>
                <dt className="text-b2b-muted">{d.license}</dt>
                <dd className={cx('font-mono', !c.license_ref && 'text-red-600')}>{c.license_ref || t.notProvided}</dd>
              </>
            )}
            <dt className="text-b2b-muted">{t.type}</dt>
            <dd>
              {ad.ads.type[c.type]} · {ad.ads.seconds(c.duration_s)}
            </dd>
            <dt className="text-b2b-muted">{t.destination}</dt>
            <dd className="break-all">{c.click_url ?? '—'}</dd>
            <dt className="text-b2b-muted">{t.flight}</dt>
            <dd>{flight(c)}</dd>
            <dt className="text-b2b-muted">{t.target}</dt>
            <dd>
              {c.target_genres.length ? c.target_genres.join(', ') : t.allGenres} · {c.target_cities.length ? c.target_cities.join(', ') : t.allCities}
            </dd>
            <dt className="text-b2b-muted">{t.submitted}</dt>
            <dd>
              {c.created_by_name ?? '—'} · {fmt.dateTime(c.created_at)}
            </dd>
          </dl>
          {c.target_cities.length > 0 && <p className="text-xs text-b2b-muted">{t.cityConsentNote}</p>}
          {violation && (
            <p className="rounded-none border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-600">
              <b>{t.violates}</b> {violation}
            </p>
          )}
          {errors.length > 0 && (
            <ul className="space-y-1 rounded-none border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-600">
              {errors.map((e, i) => (
                <li key={i}>
                  <span className="font-mono text-xs">{e.path}</span>: {e.message}
                </li>
              ))}
            </ul>
          )}
          <Field label={t.note} hint={t.noteHint}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t.notePlaceholder} />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="danger" size="sm" icon={<X className="size-4" />} loading={busy === 'reject'} disabled={!note.trim() || !!busy} onClick={() => decide(false)}>
              {ad.common.reject}
            </Button>
            <Button variant="ink" size="sm" icon={<Check className="size-4" />} loading={busy === 'approve'} disabled={!!violation || !!busy} onClick={() => decide(true)}>
              {t.approveServe}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Form kampanye ----------
interface Draft {
  advertiser: string;
  name: string;
  category: string;
  license_ref: string;
  type: 'audio' | 'display';
  title: string;
  body: string;
  image_url: string;
  audio_url: string;
  click_url: string;
  cta_label: string;
  theme_color: string;
  use_color: boolean;
  duration_s: string;
  target_genres: string;
  target_cities: string;
  start_at: string;
  end_at: string;
  max_impressions: string;
  priority: string;
  is_house: boolean;
}

/** ISO → YYYY-MM-DD (WIB) untuk input tanggal. */
const toDateInput = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }) : '');
const todayWib = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function toDraft(c: Campaign | null): Draft {
  return {
    advertiser: c?.advertiser ?? '',
    name: c?.name ?? '',
    category: c?.category ?? 'music',
    license_ref: c?.license_ref ?? '',
    type: c?.type ?? 'display',
    title: c?.title ?? '',
    body: c?.body ?? '',
    image_url: c?.image_url ?? '',
    audio_url: c?.audio_url ?? '',
    click_url: c?.click_url ?? '',
    cta_label: c?.cta_label ?? '',
    theme_color: c?.theme_color ?? '#5B2A6E',
    use_color: c ? !!c.theme_color : true,
    duration_s: String(c?.duration_s ?? 10),
    target_genres: c?.target_genres.join(', ') ?? '',
    target_cities: c?.target_cities.join(', ') ?? '',
    start_at: toDateInput(c?.start_at) || todayWib(),
    end_at: toDateInput(c?.end_at),
    max_impressions: c?.max_impressions != null ? String(c.max_impressions) : '',
    priority: String(c?.priority ?? 5),
    is_house: c?.is_house ?? false,
  };
}

const nul = (s: string) => (s.trim() ? s.trim() : null);

function toBody(d: Draft): CampaignInput {
  return {
    advertiser: d.advertiser.trim(),
    name: d.name.trim(),
    category: d.category as AdCategory,
    license_ref: nul(d.license_ref),
    type: d.type,
    title: d.title.trim(),
    body: nul(d.body),
    image_url: nul(d.image_url),
    audio_url: d.type === 'audio' ? nul(d.audio_url) : null,
    click_url: nul(d.click_url),
    cta_label: nul(d.cta_label),
    theme_color: d.use_color ? d.theme_color : null,
    duration_s: Number(d.duration_s),
    target_genres: list(d.target_genres).map((g) => g.toLowerCase()),
    target_cities: list(d.target_cities),
    // Tanggal dipahami sebagai hari WIB: mulai 00:00, selesai 23:59:59.
    start_at: d.start_at ? new Date(`${d.start_at}T00:00:00+07:00`).toISOString() : null,
    end_at: d.end_at ? new Date(`${d.end_at}T23:59:59+07:00`).toISOString() : null,
    max_impressions: d.max_impressions.trim() ? Number(d.max_impressions) : null,
    priority: Number(d.priority),
    is_house: d.is_house,
  } as CampaignInput;
}

/**
 * Validasi klien — cermin aturan backend. Draf hanya dicek kelengkapan dasar + kategori;
 * pengajuan dicek penuh (izin, durasi, aset, HTTPS, masa tayang).
 */
function validate(d: Draft, submit: boolean, s: ReturnType<typeof useAdSettings>): Record<string, string> {
  const e: Record<string, string> = {};
  const t = dict('admin').ads.validation;
  if (d.advertiser.trim().length < 2) e.advertiser = t.minChars(2);
  if (d.name.trim().length < 3) e.name = t.minChars(3);
  if (d.title.trim().length < 3) e.title = t.minChars(3);
  const dur = Number(d.duration_s);
  if (!Number.isInteger(dur) || dur < 3) e.duration_s = t.minDuration;
  const pr = Number(d.priority);
  if (!Number.isInteger(pr) || pr < 1 || pr > 10) e.priority = t.priorityRange;
  if (d.max_impressions.trim() && !(Number.isInteger(Number(d.max_impressions)) && Number(d.max_impressions) > 0)) e.max_impressions = t.positiveInt;
  if (d.use_color && !/^#[0-9a-f]{6}$/i.test(d.theme_color)) e.theme_color = t.hexColor;
  if (!d.is_house) {
    const v = categoryViolation(d.category, s.get<string[]>('ads.blocked_categories') ?? [], d.license_ref);
    if (v && (submit || !v.includes('wajib'))) e[v.includes('wajib') ? 'license_ref' : 'category'] = v;
  }
  if (!submit) return e;
  const max = d.type === 'audio' ? s.get<number>('ads.max_audio_seconds') : s.get<number>('ads.max_display_seconds');
  if (!e.duration_s && dur > max) e.duration_s = t.maxDuration(max, d.type);
  if (d.type === 'audio' && !d.audio_url.trim()) e.audio_url = t.audioRequired;
  for (const k of ['image_url', 'audio_url', 'click_url'] as const) {
    const u = d[k].trim();
    if (k === 'audio_url' && d.type !== 'audio') continue;
    if (u && !u.startsWith('https://') && !(d.is_house && u.startsWith('/'))) e[k] = d.is_house ? t.httpsOrInternal : t.httpsRequired;
  }
  if (d.end_at && d.start_at && d.end_at < d.start_at) e.end_at = t.endAfterStart;
  return e;
}

/** Path galat server (`duration_s`, `/body/duration_s`, `body.duration_s`) → nama field. */
const errField = (path: string) => path.replace(/^\//, '').replace(/^body[./]/, '').split(/[./]/)[0];

function CampaignEditor({ campaign, onClose }: { campaign: Campaign | null; onClose: () => void }) {
  const s = useAdSettings();
  const invalidate = useInvalidateAds();
  const [d, setD] = useState<Draft>(() => toDraft(campaign));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [other, setOther] = useState<string[]>([]);
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const ad = useDict('admin');
  const t = ad.ads.editor;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setErrors((x) => (x[k as string] ? { ...x, [k]: '' } : x));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const blocked = s.get<string[]>('ads.blocked_categories') ?? [];
  const def = catDef(d.category);
  const maxDur = d.type === 'audio' ? s.get<number>('ads.max_audio_seconds') : s.get<number>('ads.max_display_seconds');
  const status = campaign?.status;
  // Edit kampanye yang sudah lolos tinjauan mengembalikannya ke antrean tinjauan (aturan backend).
  const reReview = status === 'APPROVED' || status === 'PAUSED';
  const canSubmit = !campaign || status === 'DRAFT' || status === 'REJECTED';

  const preview = toCreative(
        {
          type: d.type,
          advertiser: d.advertiser || t.advertiserFallback,
          title: d.title || t.titleFallback,
          body: nul(d.body),
          image_url: /^(https:\/\/|\/)/.test(d.image_url.trim()) ? d.image_url.trim() : null,
          click_url: nul(d.click_url),
          cta_label: nul(d.cta_label),
          theme_color: d.use_color ? d.theme_color : null,
          duration_s: Math.max(1, Number(d.duration_s) || 1),
          is_house: d.is_house,
        },
    s,
  );

  async function save(submit: boolean) {
    // Kampanye selain draf dicek penuh oleh backend saat PATCH → validasi penuh juga di klien.
    const v = validate(d, submit || (!!campaign && campaign.status !== 'DRAFT'), s);
    setOther([]);
    if (Object.values(v).some(Boolean)) {
      setErrors(v);
      toast.error(t.checkFields);
      return;
    }
    setErrors({});
    setBusy(submit ? 'submit' : 'draft');
    try {
      const body = toBody(d);
      if (!campaign) await api<Campaign>('/v1/admin/ads/campaigns', { body: { ...body, submit } });
      else {
        const saved = await api<Campaign>(`/v1/admin/ads/campaigns/${campaign.id}`, { method: 'PATCH', body });
        if (submit && (saved.status === 'DRAFT' || saved.status === 'REJECTED')) await api(`/v1/admin/ads/campaigns/${campaign.id}/submit`, { method: 'POST' });
      }
      toast.success(submit ? ad.ads.campaigns.toast.submit : reReview ? t.toastReReview : t.toastDraft);
      invalidate();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors?.length) {
        const fe: Record<string, string> = {};
        const rest: string[] = [];
        for (const er of e.problem.errors) {
          const f = errField(er.path);
          if (f in d) fe[f] = er.message;
          else rest.push(`${er.path}: ${er.message}`);
        }
        setErrors(fe);
        setOther(rest);
        toast.error(e.message);
      } else toast.error(e);
    } finally {
      setBusy(null);
    }
  }

  const err = (k: keyof Draft) => errors[k] || undefined;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose} role="dialog" aria-modal aria-label={campaign ? t.editTitle : ad.ads.newCampaign}>
      <div onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-5xl flex-col bg-b2b-bg text-b2b-ink shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-b2b-line bg-b2b-card px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold">
              <Megaphone className="size-5" /> {campaign ? t.editTitle : ad.ads.newCampaign}
              {status && <CampaignStatusBadge status={status} />}
            </h2>
            <p className="text-xs text-b2b-muted">{t.intro}</p>
          </div>
          <button onClick={onClose} aria-label={t.close} className="opacity-60 hover:opacity-100">
            <X className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <form className="space-y-5" onSubmit={(e) => e.preventDefault()} noValidate>
              {reReview && (
                <p className="rounded-none border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800">{t.reReviewNote}</p>
              )}
              {campaign?.status === 'REJECTED' && campaign.review_note && (
                <p className="rounded-none border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
                  <b>{t.rejected}</b> {campaign.review_note}
                </p>
              )}
              {other.length > 0 && (
                <ul className="rounded-none border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
                  {other.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}

              <FormSection title={t.secAdvertiser}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t.advertiser} error={err('advertiser')}>
                    <Input value={d.advertiser} onChange={(e) => set('advertiser', e.target.value)} maxLength={120} placeholder="PT Kopi Tepi Kota" />
                  </Field>
                  <Field label={t.name} hint={t.internal} error={err('name')}>
                    <Input value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={120} placeholder={t.namePlaceholder} />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t.category} error={err('category')}>
                    <Select value={d.category} onChange={(e) => set('category', e.target.value)}>
                      {TIERS.map((tier) => (
                        <optgroup key={tier} label={ad.ads.tier[tier]}>
                          {AD_CATEGORY_KEYS.filter((k) => AD_CATEGORIES[k].tier === tier).map((k) => {
                            const prohibited = tier === 'prohibited';
                            const isBlocked = !prohibited && blocked.includes(k);
                            return (
                              <option key={k} value={k} disabled={prohibited || isBlocked}>
                                {AD_CATEGORIES[k].label}
                                {prohibited ? t.optProhibited : isBlocked ? t.optBlocked : ''}
                              </option>
                            );
                          })}
                        </optgroup>
                      ))}
                    </Select>
                  </Field>
                  {def?.tier === 'restricted' && (
                    <Field label={def.license ?? t.licenseNo} hint={t.required} error={err('license_ref')}>
                      <Input value={d.license_ref} onChange={(e) => set('license_ref', e.target.value)} maxLength={120} placeholder={t.licensePlaceholder} />
                    </Field>
                  )}
                </div>
                <label className="flex items-start gap-3 rounded-none border border-b2b-line bg-b2b-card p-3 text-sm">
                  <input type="checkbox" checked={d.is_house} onChange={(e) => set('is_house', e.target.checked)} className="mt-0.5 size-4 accent-violet-600" />
                  <span>
                    <b>{t.houseTitle}</b>
                    <span className="block text-xs text-b2b-muted">{t.houseBody}</span>
                  </span>
                </label>
              </FormSection>

              <FormSection title={t.secCreative}>
                <div>
                  <Label>{t.format}</Label>
                  <Tabs
                    size="sm"
                    value={d.type}
                    onChange={(v) => set('type', v)}
                    options={[
                      { value: 'display', label: t.formatDisplay },
                      { value: 'audio', label: t.formatAudio },
                    ]}
                  />
                </div>
                <Field label={t.title} error={err('title')}>
                  <Input value={d.title} onChange={(e) => set('title', e.target.value)} maxLength={90} />
                </Field>
                <Field label={t.body} hint={t.bodyHint} error={err('body')}>
                  <Textarea value={d.body} onChange={(e) => set('body', e.target.value)} maxLength={240} className="min-h-20" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t.imageUrl} hint="HTTPS, 16:9" error={err('image_url')}>
                    <Input value={d.image_url} onChange={(e) => set('image_url', e.target.value)} placeholder="https://…" inputMode="url" />
                  </Field>
                  {d.type === 'audio' && (
                    <Field label={t.audioUrl} hint={t.audioHint} error={err('audio_url')}>
                      <Input value={d.audio_url} onChange={(e) => set('audio_url', e.target.value)} placeholder={t.audioPlaceholder} inputMode="url" />
                    </Field>
                  )}
                  <div>
                    <Label hint={t.bgColorHint}>{t.bgColor}</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={/^#[0-9a-f]{6}$/i.test(d.theme_color) ? d.theme_color : '#5B2A6E'}
                        onChange={(e) => {
                          set('theme_color', e.target.value);
                          set('use_color', true);
                        }}
                        aria-label={t.pickColor}
                        className="h-10 w-12 cursor-pointer rounded-none border border-b2b-line bg-b2b-card p-1"
                      />
                      <Input value={d.theme_color} onChange={(e) => set('theme_color', e.target.value)} disabled={!d.use_color} className="font-mono" maxLength={7} />
                      <label className="flex items-center gap-1.5 text-xs whitespace-nowrap text-b2b-muted">
                        <input type="checkbox" checked={!d.use_color} onChange={(e) => set('use_color', !e.target.checked)} /> {t.raveGradient}
                      </label>
                    </div>
                    {err('theme_color') && <span className="mt-1 block text-xs text-red-500">{err('theme_color')}</span>}
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                  <Field label={t.clickUrl} hint={d.is_house ? t.clickHintHouse : 'HTTPS'} error={err('click_url')}>
                    <Input value={d.click_url} onChange={(e) => set('click_url', e.target.value)} placeholder={d.is_house ? '/premium' : 'https://…'} inputMode="url" />
                  </Field>
                  <Field label={t.ctaLabel} hint={t.ctaHint} error={err('cta_label')}>
                    <Input value={d.cta_label} onChange={(e) => set('cta_label', e.target.value)} maxLength={30} placeholder={t.ctaPlaceholder} />
                  </Field>
                </div>
                <Field label={t.duration} hint={t.durationHint(maxDur, d.type)} error={err('duration_s')}>
                  <Input type="number" min={3} max={maxDur} value={d.duration_s} onChange={(e) => set('duration_s', e.target.value)} className="w-32" />
                </Field>
              </FormSection>

              <FormSection title={t.secTargeting}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t.genre} hint={t.genreHint} error={err('target_genres')}>
                    <Input value={d.target_genres} onChange={(e) => set('target_genres', e.target.value)} placeholder="indie-pop, folk" list="ad-genres" />
                  </Field>
                  <Field label={t.city} hint={t.cityHint} error={err('target_cities')}>
                    <Input value={d.target_cities} onChange={(e) => set('target_cities', e.target.value)} placeholder="Jakarta, Bandung" />
                  </Field>
                  <datalist id="ad-genres">
                    {GENRES.map((g) => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                  <Field label={t.start} hint="WIB" error={err('start_at')}>
                    <Input type="date" value={d.start_at} onChange={(e) => set('start_at', e.target.value)} />
                  </Field>
                  <Field label={t.end} hint={t.optional} error={err('end_at')}>
                    <Input type="date" value={d.end_at} min={d.start_at || undefined} onChange={(e) => set('end_at', e.target.value)} />
                  </Field>
                  <Field label={t.maxImpressions} hint={t.optional} error={err('max_impressions')}>
                    <Input type="number" min={1} value={d.max_impressions} onChange={(e) => set('max_impressions', e.target.value)} placeholder={ad.ads.noEnd} />
                  </Field>
                  <Field label={t.priority} hint={t.priorityHint} error={err('priority')}>
                    <div className="flex items-center gap-3">
                      <input type="range" min={1} max={10} value={d.priority} onChange={(e) => set('priority', e.target.value)} className="flex-1 accent-violet-600" aria-label={t.priority} />
                      <span className="w-6 text-right font-bold tabular-nums">{d.priority}</span>
                    </div>
                  </Field>
                </div>
              </FormSection>
            </form>

            <aside className="lg:sticky lg:top-0 lg:self-start">
              <p className="mb-2 text-xs font-bold tracking-wide text-b2b-muted uppercase">{t.livePreview}</p>
              <div className="rounded-none bg-[#181818] p-4">
                <AdCard ad={preview} elapsedMs={0} />
              </div>
              <ul className="mt-3 space-y-1 text-xs text-b2b-muted">
                <li>· {t.ruleBetween}</li>
                <li>· {preview.skippable_after_s == null ? t.ruleNotSkippable : t.ruleSkippable(preview.skippable_after_s)}</li>
                <li>· {t.ruleLabel(preview.label)}</li>
              </ul>
            </aside>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-b2b-line bg-b2b-card px-6 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} className="text-b2b-muted hover:text-b2b-ink">
            {ad.common.cancel}
          </Button>
          <Button variant="outline-ink" size="sm" loading={busy === 'draft'} disabled={!!busy || !s.loaded} onClick={() => save(false)}>
            {!campaign || status === 'DRAFT' || status === 'REJECTED' ? t.saveDraft : t.saveChanges}
          </Button>
          {canSubmit && (
            <Button variant="ink" size="sm" icon={<Send className="size-4" />} loading={busy === 'submit'} disabled={!!busy || !s.loaded} onClick={() => save(true)}>
              {t.saveSubmit}
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-none border border-b2b-line bg-b2b-card p-5">
      <h3 className="text-sm font-extrabold tracking-wide text-b2b-ink uppercase">{title}</h3>
      {children}
    </section>
  );
}

// ---------- Kebijakan ----------
function Policy() {
  const sup = useIsSuperAdmin();
  const nav = useNavigate();
  const s = useAdSettings();
  const ov = useQuery({ queryKey: ['ads-overview', '7'], queryFn: () => api<AdsOverview>('/v1/admin/ads/overview', { query: { days: '7' } }) });
  const policy = ov.data?.policy;
  const defs = SETTINGS.filter((x) => x.group === 'ads');
  const ad = useDict('admin');
  const t = ad.ads.policy;
  return (
    <div className="space-y-6">
      <ReadOnlyNote>{t.readOnly}</ReadOnlyNote>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title={
            <span className="flex items-center gap-2">
              <Lock className="size-4" /> {t.fixedRules}
            </span>
          }
          action={<Badge tone="neutral">{t.fixedBadge}</Badge>}
        >
          <QueryState q={ov}>
            <ol className="space-y-2.5">
              {policy?.fixed_rules.map((r, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-b2b-ink text-[11px] font-bold text-b2b-on-ink">{i + 1}</span>
                  <span>{r}</span>
                </li>
              ))}
            </ol>
          </QueryState>
        </Card>

        <Card
          title={
            <span className="flex items-center gap-2">
              <ShieldCheck className="size-4" /> {t.configurable}
            </span>
          }
          action={
            sup ? (
              <Button size="sm" variant="outline-ink" onClick={() => nav(serviceHref('ads'))} className="h-7 px-3 text-xs">
                {t.changeInSettings}
              </Button>
            ) : (
              <span title={ad.platform.superOnly} className="inline-flex cursor-not-allowed">
                <Button size="sm" variant="outline-ink" disabled className="h-7 px-3 text-xs">
                  {t.changeInSettings}
                </Button>
              </span>
            )
          }
        >
          <QueryState q={s.q}>
            <dl className="divide-y divide-b2b-line">
              {defs.map((def) => {
                const v = s.get<unknown>(def.key);
                const changed = JSON.stringify(v) !== JSON.stringify(def.default);
                return (
                  <div key={def.key} className="flex items-start justify-between gap-4 py-2 text-sm">
                    <dt className="min-w-0">
                      <p className="font-semibold">{def.label}</p>
                      <p className="font-mono text-[11px] text-b2b-muted">{def.key}</p>
                    </dt>
                    <dd className="text-right">
                      <p className="font-bold">{fmtSetting(v, def)}</p>
                      {changed && <p className="text-[11px] text-b2b-muted">{t.defaultValue(fmtSetting(def.default, def))}</p>}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </QueryState>
        </Card>
      </div>

      <Card title={t.matrix}>
        <p className="-mt-2 mb-4 text-sm text-b2b-muted">{t.matrixBody}</p>
        <QueryState q={ov}>
          <div className="grid gap-4 lg:grid-cols-3">
            {TIERS.map((tier) => (
              <div key={tier} className="rounded-none border border-b2b-line">
                <p className="flex items-center justify-between border-b border-b2b-line px-3 py-2 text-sm font-bold">
                  {ad.ads.tier[tier]}
                  <Badge tone={TIER_TONE[tier]}>{policy?.categories.filter((c) => c.tier === tier).length ?? 0}</Badge>
                </p>
                <ul className="divide-y divide-b2b-line">
                  {policy?.categories
                    .filter((c) => c.tier === tier)
                    .map((c) => (
                      <li key={c.key} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                        <span className="min-w-0">
                          <span className="block">{c.label}</span>
                          {c.license && <span className="block text-[11px] text-b2b-muted">{t.requires(c.license)}</span>}
                        </span>
                        {tier === 'prohibited' ? <Badge tone="red">{t.prohibited}</Badge> : c.blocked ? <Badge tone="amber">{t.blocked}</Badge> : <Badge tone="green">{t.allowed}</Badge>}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </QueryState>
      </Card>

      <Simulator />
    </div>
  );
}

// ---------- Simulator ----------
type SimForm = Required<Omit<AdSimulateInput, 'city' | 'genres' | 'minutes_since_break'>> & { minutes: number; noBreak: boolean; city: string; genres: string[] };

const SIM_PRESETS: { key: 'active' | 'morning' | 'justHadAd' | 'premium'; v: Partial<SimForm> }[] = [
  { key: 'active', v: { premium: false, anonymous: false, streams_today: 24, streams_since_break: 5, minutes: 32, noBreak: false, ads_last_hour: 2 } },
  { key: 'morning', v: { premium: false, anonymous: false, streams_today: 2, streams_since_break: 2, noBreak: true, ads_last_hour: 0 } },
  { key: 'justHadAd', v: { premium: false, anonymous: false, streams_today: 30, streams_since_break: 1, minutes: 4, noBreak: false, ads_last_hour: 2 } },
  { key: 'premium', v: { premium: true, anonymous: false } },
];

const SIM_INIT: SimForm = {
  premium: false,
  anonymous: false,
  consent: true,
  placement: 'between_tracks',
  premium_content: false,
  content_warning: false,
  streams_today: 12,
  streams_since_break: 4,
  minutes: 20,
  noBreak: false,
  ads_last_hour: 0,
  city: '',
  genres: ['indie-pop'],
};

function Simulator() {
  const [f, setF] = useState<SimForm>(SIM_INIT);
  const [res, setRes] = useState<AdSimulateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SimForm>(k: K, v: SimForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));
  const ad = useDict('admin').ads;
  const t = ad.sim;
  async function run() {
    setBusy(true);
    try {
      const body: AdSimulateInput = {
        premium: f.premium,
        anonymous: f.anonymous,
        consent: f.consent,
        placement: f.placement,
        premium_content: f.premium_content,
        content_warning: f.content_warning,
        streams_today: f.streams_today,
        streams_since_break: f.streams_since_break,
        minutes_since_break: f.noBreak ? null : f.minutes,
        ads_last_hour: f.ads_last_hour,
        city: f.city || undefined,
        genres: f.genres,
      };
      setRes(await api<AdSimulateResult>('/v1/admin/ads/simulate', { body }));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  const flags: [keyof SimForm, string, string][] = [
    ['anonymous', t.flags.anonymous, t.flags.anonymousHint],
    ['premium', t.flags.premium, t.flags.premiumHint],
    ['consent', t.flags.consent, t.flags.consentHint],
    ['premium_content', t.flags.premiumContent, t.flags.premiumContentHint],
    ['content_warning', t.flags.contentWarning, t.flags.contentWarningHint],
  ];
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <FlaskConical className="size-4" /> {t.title}
        </span>
      }
      action={<span className="text-xs text-b2b-muted">{t.usesCurrent}</span>}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {SIM_PRESETS.map((p) => (
          <button key={p.key} type="button" onClick={() => setF({ ...SIM_INIT, ...p.v })} className="rounded-none border border-b2b-line px-3 py-1 text-xs font-bold text-b2b-ink transition hover:border-b2b-ink">
            {t.presets[p.key]}
          </button>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {flags.map(([k, l, h]) => (
              <label key={k} className={cx('flex cursor-pointer items-start gap-2.5 rounded-none border p-2.5 text-sm transition', f[k] ? 'border-b2b-ink' : 'border-b2b-line')}>
                <input type="checkbox" checked={!!f[k]} onChange={(e) => set(k, e.target.checked as never)} className="mt-0.5 size-4 accent-violet-600" />
                <span>
                  <b className="block">{l}</b>
                  <span className="text-xs text-b2b-muted">{h}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.placement}>
              <Select value={f.placement} onChange={(e) => set('placement', e.target.value as SimForm['placement'])}>
                <option value="between_tracks">{t.betweenTracks}</option>
                <option value="podcast_preroll">{t.podcastPreroll}</option>
              </Select>
            </Field>
            <Field label={t.city} hint={t.optional}>
              <Select value={f.city} onChange={(e) => set('city', e.target.value)}>
                <option value="">—</option>
                {CITIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label={t.streamsToday} hint={t.streamsTodayHint}>
              <Input type="number" min={0} value={f.streams_today} onChange={(e) => set('streams_today', num(e.target.value))} />
            </Field>
            <Field label={t.tracksSinceBreak}>
              <Input type="number" min={0} value={f.streams_since_break} onChange={(e) => set('streams_since_break', num(e.target.value))} />
            </Field>
            <div>
              <Label hint={t.minutes}>{t.sinceBreak}</Label>
              <div className="flex items-center gap-3">
                <Input type="number" min={0} value={f.noBreak ? '' : f.minutes} disabled={f.noBreak} onChange={(e) => set('minutes', num(e.target.value))} placeholder="—" />
                <label className="flex items-center gap-1.5 text-xs whitespace-nowrap text-b2b-muted">
                  <input type="checkbox" checked={f.noBreak} onChange={(e) => set('noBreak', e.target.checked)} /> {t.noneYet}
                </label>
              </div>
            </div>
            <Field label={t.adsLastHour}>
              <Input type="number" min={0} value={f.ads_last_hour} onChange={(e) => set('ads_last_hour', num(e.target.value))} />
            </Field>
          </div>
          <div>
            <Label hint={t.genreHint}>{t.genre}</Label>
            <div className="flex flex-wrap gap-1.5">
              {GENRES.map((g) => {
                const on = f.genres.includes(g);
                return (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set('genres', on ? f.genres.filter((x) => x !== g) : [...f.genres, g])}
                    className={cx('rounded-none border px-2.5 py-0.5 text-xs font-semibold transition', on ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted hover:border-b2b-ink')}
                  >
                    {g}
                  </button>
                );
              })}
            </div>
          </div>
          <Button type="submit" variant="ink" size="sm" loading={busy} icon={<Play className="size-4" />}>
            {t.run}
          </Button>
        </form>

        <div aria-live="polite">
          {!res ? (
            <div className="grid h-full min-h-48 place-items-center rounded-none border border-dashed border-b2b-line p-6 text-center text-sm text-b2b-muted">
              {t.emptyState}
            </div>
          ) : (
            <div className="space-y-4">
              <div className={cx('flex items-center justify-between gap-3 rounded-none border p-4', res.outcome === 'serve' ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10')}>
                <div>
                  <p className="text-xs font-bold tracking-wide text-b2b-muted uppercase">{t.decision}</p>
                  <p className="text-lg font-extrabold">{res.label}</p>
                </div>
                <div className="text-right">
                  <Badge tone={res.outcome === 'serve' ? 'green' : 'amber'}>{res.outcome}</Badge>
                  <p className="mt-1 text-xs text-b2b-muted">{t.slots(res.slots)}</p>
                </div>
              </div>
              <ol className="relative space-y-0">
                {res.trace.map((tr, i) => (
                  <li key={i} className="flex gap-3 pb-3 last:pb-0">
                    <span className={cx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-white', tr.pass ? 'bg-emerald-500' : 'bg-red-500')} aria-label={tr.pass ? t.pass : t.fail}>
                      {tr.pass ? <Check className="size-3" /> : <X className="size-3" />}
                    </span>
                    <span className="text-sm">
                      <b>{tr.rule}</b>
                      <span className="block text-xs text-b2b-muted">{tr.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div>
                <p className="mb-2 text-xs font-bold tracking-wide text-b2b-muted uppercase">{t.campaignsEligible(res.eligible_campaigns.filter((c) => !c.reason).length)}</p>
                {res.eligible_campaigns.length ? (
                  <ul className="divide-y divide-b2b-line rounded-none border border-b2b-line">
                    {res.eligible_campaigns.map((c) => (
                      <li key={c.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                        <span className="min-w-0">
                          <span className="flex items-center gap-2 font-semibold">
                            {c.name}
                            {c.is_house && <Badge tone="purple">{ad.fromRave}</Badge>}
                          </span>
                          <span className="block text-xs text-b2b-muted">{c.advertiser}</span>
                        </span>
                        {c.reason ? <span className="max-w-[55%] text-right text-xs text-b2b-muted">{c.reason}</span> : <Badge tone="green">{t.eligible}</Badge>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-b2b-muted">{t.noApproved}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
