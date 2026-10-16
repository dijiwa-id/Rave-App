import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardCheck, FlaskConical, Lock, Megaphone, Pause, Pencil, Play, Plus, Send, ShieldCheck, Trash2, X } from 'lucide-react';
import { AD_CATEGORIES, AD_CATEGORY_KEYS, categoryViolation, type AdCategory, type AdCategoryTier } from '@gema/domain/ads';
import { SETTINGS, SETTINGS_BY_KEY } from '@gema/domain/settings';
import { api, ApiError, fmt } from '@/lib/api';
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

const STATUS_META: Record<CampaignStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draf', tone: 'neutral' },
  PENDING_REVIEW: { label: 'Menunggu tinjauan', tone: 'amber' },
  APPROVED: { label: 'Disetujui', tone: 'green' },
  REJECTED: { label: 'Ditolak', tone: 'red' },
  PAUSED: { label: 'Dijeda', tone: 'blue' },
  ENDED: { label: 'Selesai', tone: 'neutral' },
};
const TIER_META: Record<AdCategoryTier, { label: string; tone: Tone }> = {
  general: { label: 'Umum', tone: 'green' },
  restricted: { label: 'Terbatas', tone: 'amber' },
  prohibited: { label: 'Terlarang', tone: 'red' },
};
const TIERS: AdCategoryTier[] = ['general', 'restricted', 'prohibited'];
const TYPE_LABEL = { audio: 'Audio', display: 'Display' } as const;

const catDef = (c: string) => (AD_CATEGORIES as Record<string, { label: string; tier: AdCategoryTier; license?: string }>)[c];

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const m = STATUS_META[status] ?? { label: status, tone: 'neutral' as Tone };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

function CategoryCell({ category }: { category: string }) {
  const d = catDef(category);
  if (!d) return <span className="font-mono text-xs">{category}</span>;
  return (
    <div className="space-y-1">
      <p className="text-sm">{d.label}</p>
      <Badge tone={TIER_META[d.tier].tone}>{TIER_META[d.tier].label}</Badge>
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
    label: c.is_house ? 'Dari GEMA' : 'Iklan',
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
            'rounded-full font-bold transition',
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
const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Ringkasan' },
  { value: 'campaigns', label: 'Kampanye' },
  { value: 'policy', label: 'Kebijakan' },
];

export function AdminAds() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'overview') as Tab;
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);
  return (
    <div>
      <PageHeader
        title="Iklan"
        subtitle="Kebijakan penayangan iklan tier Gratis — jeda di antara lagu, ad load terbatas, dan setiap kampanye ditinjau. Premium selalu bebas iklan."
        actions={
          <Button variant="ink" size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Kampanye baru
          </Button>
        }
      />
      <div className="mb-6 border-b border-b2b-line pb-3">
        <Tabs value={tab} options={TABS} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'campaigns' && <Campaigns onEdit={setEditing} />}
      {tab === 'policy' && <Policy />}
      {editing && <CampaignEditor campaign={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ---------- Ringkasan ----------
const DAY_SERIES = [
  { key: 'impressions', label: 'Impresi' },
  { key: 'clicks', label: 'Klik' },
  { key: 'breaks', label: 'Jeda dievaluasi' },
] as const;

function Overview() {
  const [days, setDays] = useState<'7' | '30'>('7');
  const [series, setSeries] = useState<(typeof DAY_SERIES)[number]['key']>('impressions');
  const q = useQuery({ queryKey: ['ads-overview', days], queryFn: () => api<AdsOverview>('/v1/admin/ads/overview', { query: { days } }) });
  const o = q.data;
  const k = o?.kpis;
  const idx = DAY_SERIES.findIndex((s) => s.key === series);
  return (
    <QueryState q={q}>
      {o && k && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-b2b-muted">
              {fmt.num(k.breaks)} jeda iklan dievaluasi dalam {days} hari terakhir.
            </p>
            <Tabs
              size="sm"
              value={days}
              onChange={setDays}
              options={[
                { value: '7', label: '7 hari' },
                { value: '30', label: '30 hari' },
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Impresi" value={fmt.compact(k.impressions)} hint={`${fmt.num(k.completes)} diputar tuntas`} />
            <Stat label="Fill rate" value={pct(k.fill_rate)} hint="Jeda lolos kebijakan yang terisi" />
            <Stat label="Completion" value={pct(k.completion_rate)} hint="Impresi diputar sampai habis" />
            <Stat label="CTR" value={pct(k.ctr)} hint={`${fmt.num(k.clicks)} klik`} />
            <Link to="/admin/ads?tab=campaigns&status=APPROVED">
              <Stat label="Kampanye aktif" value={fmt.num(k.active_campaigns)} />
            </Link>
            <Link to="/admin/ads?tab=campaigns&status=PENDING_REVIEW">
              <Stat label="Menunggu tinjauan" value={<span className={k.pending_review ? 'text-amber-600' : undefined}>{fmt.num(k.pending_review)}</span>} />
            </Link>
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card
              className="lg:col-span-3"
              title="Tren harian"
              action={<Tabs size="sm" value={series} onChange={setSeries} options={DAY_SERIES.map((s) => ({ value: s.key, label: s.label }))} />}
            >
              <LineChart data={o.by_day.map((d) => ({ x: d.date, y: d[series] }))} label={DAY_SERIES[idx].label} color={SERIES[idx]} />
            </Card>
            <Card className="lg:col-span-2" title="Hasil keputusan jeda">
              <p className="-mt-2 mb-4 text-xs text-b2b-muted">Mengapa jeda iklan ditayangkan atau tidak — aturan pertama yang gagal menentukan hasil.</p>
              <BarList data={o.outcomes.map((x) => ({ label: x.label, value: x.n }))} unit="jeda" color={SERIES[2]} />
            </Card>
          </div>

          <div>
            <h2 className="mb-3 text-base font-bold text-b2b-ink">Kampanye teratas</h2>
            {o.top_campaigns.length ? (
              <Table head={['Kampanye', 'Kategori', 'Status', 'Impresi', 'CTR', 'Completion']}>
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
              <Empty title="Belum ada impresi" body="Kampanye yang disetujui akan muncul di sini setelah ditayangkan ke pendengar Gratis." />
            )}
          </div>
        </div>
      )}
    </QueryState>
  );
}

function CampaignName({ c }: { c: Campaign }) {
  return (
    <div className="min-w-[180px]">
      <p className="flex items-center gap-2 font-bold">
        {c.name}
        {c.is_house && <Badge tone="purple">Dari GEMA</Badge>}
      </p>
      <p className="text-xs text-b2b-muted">{c.advertiser}</p>
    </div>
  );
}

// ---------- Kampanye ----------
const STATUS_FILTERS: { value: '' | CampaignStatus; label: string }[] = [
  { value: '', label: 'Semua' },
  { value: 'PENDING_REVIEW', label: 'Menunggu tinjauan' },
  { value: 'APPROVED', label: 'Disetujui' },
  { value: 'DRAFT', label: 'Draf' },
  { value: 'PAUSED', label: 'Dijeda' },
  { value: 'REJECTED', label: 'Ditolak' },
  { value: 'ENDED', label: 'Selesai' },
];

function useInvalidateAds() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['ads-campaigns'] });
    qc.invalidateQueries({ queryKey: ['ads-overview'] });
  };
}

const flight = (c: Campaign) => `${fmt.date(c.start_at, { day: 'numeric', month: 'short' })} – ${c.end_at ? fmt.date(c.end_at, { day: 'numeric', month: 'short', year: 'numeric' }) : 'tanpa batas'}`;

function Campaigns({ onEdit }: { onEdit: (c: Campaign) => void }) {
  const [params, setParams] = useSearchParams();
  const status = (STATUS_FILTERS.some((f) => f.value === params.get('status')) ? params.get('status') : '') as '' | CampaignStatus;
  const q = useQuery({ queryKey: ['ads-campaigns', status], queryFn: () => api<{ data: Campaign[] }>('/v1/admin/ads/campaigns', { query: { status } }) });
  const user = useAuth((s) => s.user);
  const reviewer = canReviewAds(user);
  const invalidate = useInvalidateAds();
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<Campaign | null>(null);

  async function act(c: Campaign, action: 'submit' | 'pause' | 'resume' | 'delete') {
    if (action === 'delete' && !confirm(`Hapus kampanye "${c.name}"? Tindakan ini tidak dapat dibatalkan.`)) return;
    setBusy(c.id + action);
    try {
      if (action === 'delete') await api(`/v1/admin/ads/campaigns/${c.id}`, { method: 'DELETE' });
      else await api(`/v1/admin/ads/campaigns/${c.id}/${action}`, { method: 'POST' });
      toast.success({ submit: 'Kampanye diajukan untuk ditinjau', pause: 'Kampanye dijeda', resume: 'Kampanye dilanjutkan', delete: 'Kampanye dihapus' }[action]);
      invalidate();
    } catch (e) {
      // 422 saat mengajukan = melanggar kebijakan → tampilkan pesan pertama; detail lengkap di form edit.
      toast.error(e instanceof ApiError && e.problem.errors?.length ? `${e.message} — buka Edit untuk detail` : e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs size="sm" value={status} onChange={(v) => setParams(v ? { tab: 'campaigns', status: v } : { tab: 'campaigns' }, { replace: true })} options={STATUS_FILTERS} />
        {!reviewer && <p className="text-xs text-b2b-muted">Peninjauan: Super Admin, Operasional, atau Content QC.</p>}
      </div>
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title="Tidak ada kampanye" body={status ? 'Tidak ada kampanye dengan status ini.' : 'Buat kampanye pertama lewat tombol "Kampanye baru".'} /> : undefined}>
        <Table head={['Kampanye', 'Kategori', 'Tipe', 'Masa tayang', 'Prioritas', 'Status', 'Kinerja', '']}>
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
                  {c.created_by_name && <p className="mt-0.5 text-[11px] text-b2b-muted">oleh {c.created_by_name}</p>}
                </td>
                <td className="px-4 py-3">
                  <CategoryCell category={c.category} />
                </td>
                <td className="px-4 py-3 text-sm">
                  {TYPE_LABEL[c.type]}
                  <p className="text-xs text-b2b-muted">{c.duration_s} dtk</p>
                </td>
                <td className="px-4 py-3 text-sm whitespace-nowrap">
                  {flight(c)}
                  {c.max_impressions != null && <p className="text-xs text-b2b-muted">maks {fmt.compact(c.max_impressions)} impresi</p>}
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
                    <b className="text-sm text-b2b-ink">{fmt.compact(c.stats.impressions)}</b> impresi
                  </p>
                  <p>
                    CTR {pct(c.stats.ctr)} · tuntas {pct(c.stats.completion_rate)}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {c.status === 'PENDING_REVIEW' &&
                      (reviewer ? (
                        btn('review', 'Tinjau', <ClipboardCheck className="size-3.5" />, () => setReview(c), 'ink')
                      ) : (
                        <span key="review" title="Hanya Super Admin, Operasional, atau Content QC" className="inline-flex cursor-not-allowed">
                          <Button size="sm" variant="ink" disabled icon={<ClipboardCheck className="size-3.5" />} className="h-7 px-3 text-xs">
                            Tinjau
                          </Button>
                        </span>
                      ))}
                    {(c.status === 'DRAFT' || c.status === 'REJECTED') && btn('submit', 'Ajukan', <Send className="size-3.5" />, () => act(c, 'submit'))}
                    {c.status === 'APPROVED' && btn('pause', 'Jeda', <Pause className="size-3.5" />, () => act(c, 'pause'))}
                    {c.status === 'PAUSED' && btn('resume', 'Lanjutkan', <Play className="size-3.5" />, () => act(c, 'resume'))}
                    {c.status !== 'ENDED' && btn('edit', 'Edit', <Pencil className="size-3.5" />, () => onEdit(c))}
                    {(c.status === 'DRAFT' || c.status === 'REJECTED') && c.stats.impressions === 0 && btn('delete', 'Hapus', <Trash2 className="size-3.5" />, () => act(c, 'delete'), 'danger')}
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
  const d = catDef(c.category);
  const blocked = s.get<string[]>('ads.blocked_categories') ?? [];
  const violation = c.is_house ? null : categoryViolation(c.category, blocked, c.license_ref);
  async function decide(approve: boolean) {
    setBusy(approve ? 'approve' : 'reject');
    setErrors([]);
    try {
      await api(`/v1/admin/ads/campaigns/${c.id}/review`, { body: { approve, note: note.trim() || undefined } });
      toast.success(approve ? 'Kampanye disetujui dan siap tayang' : 'Kampanye ditolak');
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
    <Modal open onClose={onClose} title="Tinjau kampanye" wide>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <p className="mb-2 text-xs font-bold tracking-wide text-b2b-muted uppercase">Pratinjau di pemutar</p>
          <div className="rounded-xl bg-[#121212] p-4">
            <AdCard ad={toCreative(c, s)} elapsedMs={0} onCta={() => c.click_url && window.open(c.click_url, '_blank', 'noopener,noreferrer')} />
          </div>
          {c.type === 'audio' && c.audio_url && <audio controls src={c.audio_url} className="mt-3 w-full" aria-label="Dengarkan iklan audio" />}
        </div>
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-b2b-muted">Kampanye</dt>
            <dd className="font-bold">{c.name}</dd>
            <dt className="text-b2b-muted">Pengiklan</dt>
            <dd>{c.advertiser}</dd>
            <dt className="text-b2b-muted">Kategori</dt>
            <dd>
              <CategoryCell category={c.category} />
            </dd>
            {d?.license && (
              <>
                <dt className="text-b2b-muted">{d.license}</dt>
                <dd className={cx('font-mono', !c.license_ref && 'text-red-600')}>{c.license_ref || 'tidak dicantumkan'}</dd>
              </>
            )}
            <dt className="text-b2b-muted">Tipe</dt>
            <dd>
              {TYPE_LABEL[c.type]} · {c.duration_s} dtk
            </dd>
            <dt className="text-b2b-muted">Tujuan</dt>
            <dd className="break-all">{c.click_url ?? '—'}</dd>
            <dt className="text-b2b-muted">Masa tayang</dt>
            <dd>{flight(c)}</dd>
            <dt className="text-b2b-muted">Target</dt>
            <dd>
              {c.target_genres.length ? c.target_genres.join(', ') : 'Semua genre'} · {c.target_cities.length ? c.target_cities.join(', ') : 'semua kota'}
            </dd>
            <dt className="text-b2b-muted">Diajukan</dt>
            <dd>
              {c.created_by_name ?? '—'} · {fmt.dateTime(c.created_at)}
            </dd>
          </dl>
          {c.target_cities.length > 0 && <p className="text-xs text-b2b-muted">Penargetan kota hanya berlaku untuk pendengar yang memberi persetujuan iklan (UU PDP).</p>}
          {violation && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-600">
              <b>Melanggar kebijakan:</b> {violation}
            </p>
          )}
          {errors.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-600">
              {errors.map((e, i) => (
                <li key={i}>
                  <span className="font-mono text-xs">{e.path}</span>: {e.message}
                </li>
              ))}
            </ul>
          )}
          <Field label="Catatan peninjau" hint="wajib bila menolak">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="mis. Klaim “paling murah” tanpa bukti melanggar EPI" />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="danger" size="sm" icon={<X className="size-4" />} loading={busy === 'reject'} disabled={!note.trim() || !!busy} onClick={() => decide(false)}>
              Tolak
            </Button>
            <Button variant="ink" size="sm" icon={<Check className="size-4" />} loading={busy === 'approve'} disabled={!!violation || !!busy} onClick={() => decide(true)}>
              Setujui & tayangkan
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
    theme_color: c?.theme_color ?? '#7c3aed',
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
  if (d.advertiser.trim().length < 2) e.advertiser = 'Minimal 2 karakter';
  if (d.name.trim().length < 3) e.name = 'Minimal 3 karakter';
  if (d.title.trim().length < 3) e.title = 'Minimal 3 karakter';
  const dur = Number(d.duration_s);
  if (!Number.isInteger(dur) || dur < 3) e.duration_s = 'Bilangan bulat, minimal 3 detik';
  const pr = Number(d.priority);
  if (!Number.isInteger(pr) || pr < 1 || pr > 10) e.priority = 'Antara 1 dan 10';
  if (d.max_impressions.trim() && !(Number.isInteger(Number(d.max_impressions)) && Number(d.max_impressions) > 0)) e.max_impressions = 'Bilangan bulat positif';
  if (d.use_color && !/^#[0-9a-f]{6}$/i.test(d.theme_color)) e.theme_color = 'Warna hex, mis. #7c3aed';
  if (!d.is_house) {
    const v = categoryViolation(d.category, s.get<string[]>('ads.blocked_categories') ?? [], d.license_ref);
    if (v && (submit || !v.includes('wajib'))) e[v.includes('wajib') ? 'license_ref' : 'category'] = v;
  }
  if (!submit) return e;
  const max = d.type === 'audio' ? s.get<number>('ads.max_audio_seconds') : s.get<number>('ads.max_display_seconds');
  if (!e.duration_s && dur > max) e.duration_s = `Maksimal ${max} detik untuk iklan ${d.type}`;
  if (d.type === 'audio' && !d.audio_url.trim()) e.audio_url = 'Iklan audio wajib berkas audio';
  for (const k of ['image_url', 'audio_url', 'click_url'] as const) {
    const u = d[k].trim();
    if (k === 'audio_url' && d.type !== 'audio') continue;
    if (u && !u.startsWith('https://') && !(d.is_house && u.startsWith('/'))) e[k] = d.is_house ? 'Wajib URL HTTPS atau tautan internal (/premium)' : 'Wajib URL HTTPS';
  }
  if (d.end_at && d.start_at && d.end_at < d.start_at) e.end_at = 'Harus setelah tanggal mulai';
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
          advertiser: d.advertiser || 'Nama pengiklan',
          title: d.title || 'Judul iklan',
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
      toast.error('Periksa kembali isian yang ditandai');
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
      toast.success(submit ? 'Kampanye diajukan untuk ditinjau' : reReview ? 'Disimpan — kampanye kembali menunggu tinjauan' : 'Draf disimpan');
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
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose} role="dialog" aria-modal aria-label={campaign ? 'Edit kampanye' : 'Kampanye baru'}>
      <div onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-5xl flex-col bg-b2b-bg text-b2b-ink shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-b2b-line bg-b2b-card px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold">
              <Megaphone className="size-5" /> {campaign ? 'Edit kampanye' : 'Kampanye baru'}
              {status && <CampaignStatusBadge status={status} />}
            </h2>
            <p className="text-xs text-b2b-muted">Setiap kampanye ditinjau admin sebelum tayang. Kategori terlarang selalu ditolak.</p>
          </div>
          <button onClick={onClose} aria-label="Tutup" className="opacity-60 hover:opacity-100">
            <X className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <form className="space-y-5" onSubmit={(e) => e.preventDefault()} noValidate>
              {reReview && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800">Kampanye ini sedang/pernah tayang. Menyimpan perubahan mengembalikannya ke antrean tinjauan.</p>
              )}
              {campaign?.status === 'REJECTED' && campaign.review_note && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
                  <b>Ditolak:</b> {campaign.review_note}
                </p>
              )}
              {other.length > 0 && (
                <ul className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
                  {other.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}

              <FormSection title="Pengiklan & kategori">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Pengiklan" error={err('advertiser')}>
                    <Input value={d.advertiser} onChange={(e) => set('advertiser', e.target.value)} maxLength={120} placeholder="PT Kopi Tepi Kota" />
                  </Field>
                  <Field label="Nama kampanye" hint="internal" error={err('name')}>
                    <Input value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={120} placeholder="Promo musim hujan" />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Kategori" error={err('category')}>
                    <Select value={d.category} onChange={(e) => set('category', e.target.value)}>
                      {TIERS.map((t) => (
                        <optgroup key={t} label={TIER_META[t].label}>
                          {AD_CATEGORY_KEYS.filter((k) => AD_CATEGORIES[k].tier === t).map((k) => {
                            const prohibited = t === 'prohibited';
                            const isBlocked = !prohibited && blocked.includes(k);
                            return (
                              <option key={k} value={k} disabled={prohibited || isBlocked}>
                                {AD_CATEGORIES[k].label}
                                {prohibited ? ' — dilarang' : isBlocked ? ' — diblokir kebijakan' : ''}
                              </option>
                            );
                          })}
                        </optgroup>
                      ))}
                    </Select>
                  </Field>
                  {def?.tier === 'restricted' && (
                    <Field label={def.license ?? 'Nomor izin'} hint="wajib" error={err('license_ref')}>
                      <Input value={d.license_ref} onChange={(e) => set('license_ref', e.target.value)} maxLength={120} placeholder="mis. KEP-123/D.05/2024" />
                    </Field>
                  )}
                </div>
                <label className="flex items-start gap-3 rounded-lg border border-b2b-line bg-b2b-card p-3 text-sm">
                  <input type="checkbox" checked={d.is_house} onChange={(e) => set('is_house', e.target.checked)} className="mt-0.5 size-4 accent-violet-600" />
                  <span>
                    <b>Promosi internal GEMA</b>
                    <span className="block text-xs text-b2b-muted">Berlabel “Dari GEMA”, mengisi slot kosong, dan boleh memakai tautan internal (mis. /premium).</span>
                  </span>
                </label>
              </FormSection>

              <FormSection title="Kreatif">
                <div>
                  <Label>Format</Label>
                  <Tabs
                    size="sm"
                    value={d.type}
                    onChange={(v) => set('type', v)}
                    options={[
                      { value: 'display', label: 'Display (kartu bergambar)' },
                      { value: 'audio', label: 'Audio + kartu' },
                    ]}
                  />
                </div>
                <Field label="Judul" error={err('title')}>
                  <Input value={d.title} onChange={(e) => set('title', e.target.value)} maxLength={90} />
                </Field>
                <Field label="Teks" hint="opsional, maks 240" error={err('body')}>
                  <Textarea value={d.body} onChange={(e) => set('body', e.target.value)} maxLength={240} className="min-h-20" />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="URL gambar" hint="HTTPS, 16:9" error={err('image_url')}>
                    <Input value={d.image_url} onChange={(e) => set('image_url', e.target.value)} placeholder="https://…" inputMode="url" />
                  </Field>
                  {d.type === 'audio' && (
                    <Field label="URL audio" hint="wajib · MP3/AAC" error={err('audio_url')}>
                      <Input value={d.audio_url} onChange={(e) => set('audio_url', e.target.value)} placeholder="https://…/iklan.mp3" inputMode="url" />
                    </Field>
                  )}
                  <div>
                    <Label hint="bila tanpa gambar">Warna latar</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={/^#[0-9a-f]{6}$/i.test(d.theme_color) ? d.theme_color : '#7c3aed'}
                        onChange={(e) => {
                          set('theme_color', e.target.value);
                          set('use_color', true);
                        }}
                        aria-label="Pilih warna"
                        className="h-10 w-12 cursor-pointer rounded-lg border border-b2b-line bg-b2b-card p-1"
                      />
                      <Input value={d.theme_color} onChange={(e) => set('theme_color', e.target.value)} disabled={!d.use_color} className="font-mono" maxLength={7} />
                      <label className="flex items-center gap-1.5 text-xs whitespace-nowrap text-b2b-muted">
                        <input type="checkbox" checked={!d.use_color} onChange={(e) => set('use_color', !e.target.checked)} /> gradien GEMA
                      </label>
                    </div>
                    {err('theme_color') && <span className="mt-1 block text-xs text-red-500">{err('theme_color')}</span>}
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
                  <Field label="URL tujuan" hint={d.is_house ? 'HTTPS atau /internal' : 'HTTPS'} error={err('click_url')}>
                    <Input value={d.click_url} onChange={(e) => set('click_url', e.target.value)} placeholder={d.is_house ? '/premium' : 'https://…'} inputMode="url" />
                  </Field>
                  <Field label="Label tombol" hint="maks 30" error={err('cta_label')}>
                    <Input value={d.cta_label} onChange={(e) => set('cta_label', e.target.value)} maxLength={30} placeholder="Lihat promo" />
                  </Field>
                </div>
                <Field label="Durasi" hint={`detik · maks ${maxDur} untuk ${d.type} (pengaturan)`} error={err('duration_s')}>
                  <Input type="number" min={3} max={maxDur} value={d.duration_s} onChange={(e) => set('duration_s', e.target.value)} className="w-32" />
                </Field>
              </FormSection>

              <FormSection title="Penargetan & masa tayang">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Genre" hint="pisahkan koma; kosong = semua" error={err('target_genres')}>
                    <Input value={d.target_genres} onChange={(e) => set('target_genres', e.target.value)} placeholder="indie-pop, folk" list="ad-genres" />
                  </Field>
                  <Field label="Kota" hint="hanya pendengar ber-consent" error={err('target_cities')}>
                    <Input value={d.target_cities} onChange={(e) => set('target_cities', e.target.value)} placeholder="Jakarta, Bandung" />
                  </Field>
                  <datalist id="ad-genres">
                    {GENRES.map((g) => (
                      <option key={g} value={g} />
                    ))}
                  </datalist>
                  <Field label="Mulai" hint="WIB" error={err('start_at')}>
                    <Input type="date" value={d.start_at} onChange={(e) => set('start_at', e.target.value)} />
                  </Field>
                  <Field label="Selesai" hint="opsional" error={err('end_at')}>
                    <Input type="date" value={d.end_at} min={d.start_at || undefined} onChange={(e) => set('end_at', e.target.value)} />
                  </Field>
                  <Field label="Maks impresi" hint="opsional" error={err('max_impressions')}>
                    <Input type="number" min={1} value={d.max_impressions} onChange={(e) => set('max_impressions', e.target.value)} placeholder="tanpa batas" />
                  </Field>
                  <Field label="Prioritas" hint="1 rendah – 10 tinggi" error={err('priority')}>
                    <div className="flex items-center gap-3">
                      <input type="range" min={1} max={10} value={d.priority} onChange={(e) => set('priority', e.target.value)} className="flex-1 accent-violet-600" aria-label="Prioritas" />
                      <span className="w-6 text-right font-bold tabular-nums">{d.priority}</span>
                    </div>
                  </Field>
                </div>
              </FormSection>
            </form>

            <aside className="lg:sticky lg:top-0 lg:self-start">
              <p className="mb-2 text-xs font-bold tracking-wide text-b2b-muted uppercase">Pratinjau langsung</p>
              <div className="rounded-xl bg-[#121212] p-4">
                <AdCard ad={preview} elapsedMs={0} />
              </div>
              <ul className="mt-3 space-y-1 text-xs text-b2b-muted">
                <li>· Tampil di antara lagu, tidak pernah memotong lagu.</li>
                <li>· {preview.skippable_after_s == null ? 'Tidak dapat dilewati (iklan audio).' : `Dapat dilewati setelah ${preview.skippable_after_s} detik.`}</li>
                <li>· Label “{preview.label}” wajib (EPI) dan tidak bisa diubah.</li>
              </ul>
            </aside>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-b2b-line bg-b2b-card px-6 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} className="text-b2b-muted hover:text-b2b-ink">
            Batal
          </Button>
          <Button variant="outline-ink" size="sm" loading={busy === 'draft'} disabled={!!busy || !s.loaded} onClick={() => save(false)}>
            {!campaign || status === 'DRAFT' || status === 'REJECTED' ? 'Simpan draf' : 'Simpan perubahan'}
          </Button>
          {canSubmit && (
            <Button variant="ink" size="sm" icon={<Send className="size-4" />} loading={busy === 'submit'} disabled={!!busy || !s.loaded} onClick={() => save(true)}>
              Simpan & ajukan
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-b2b-line bg-b2b-card p-5">
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
  return (
    <div className="space-y-6">
      <ReadOnlyNote>Mode baca. Nilai kebijakan hanya dapat diubah Super Admin di Pengaturan → Iklan.</ReadOnlyNote>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title={
            <span className="flex items-center gap-2">
              <Lock className="size-4" /> Aturan tetap
            </span>
          }
          action={<Badge tone="neutral">Tidak dapat diubah — kepatuhan</Badge>}
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
              <ShieldCheck className="size-4" /> Nilai yang dapat diatur
            </span>
          }
          action={
            sup ? (
              <Button size="sm" variant="outline-ink" onClick={() => nav('/admin/platform/settings?group=ads')} className="h-7 px-3 text-xs">
                Ubah di Pengaturan
              </Button>
            ) : (
              <span title="Hanya Super Admin" className="inline-flex cursor-not-allowed">
                <Button size="sm" variant="outline-ink" disabled className="h-7 px-3 text-xs">
                  Ubah di Pengaturan
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
                      {changed && <p className="text-[11px] text-b2b-muted">bawaan: {fmtSetting(def.default, def)}</p>}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </QueryState>
        </Card>
      </div>

      <Card title="Matriks kategori">
        <p className="-mt-2 mb-4 text-sm text-b2b-muted">Kategori terlarang selalu ditolak. Kategori terbatas wajib mencantumkan nomor izin dan dapat diblokir Super Admin (ads.blocked_categories).</p>
        <QueryState q={ov}>
          <div className="grid gap-4 lg:grid-cols-3">
            {TIERS.map((t) => (
              <div key={t} className="rounded-lg border border-b2b-line">
                <p className="flex items-center justify-between border-b border-b2b-line px-3 py-2 text-sm font-bold">
                  {TIER_META[t].label}
                  <Badge tone={TIER_META[t].tone}>{policy?.categories.filter((c) => c.tier === t).length ?? 0}</Badge>
                </p>
                <ul className="divide-y divide-b2b-line">
                  {policy?.categories
                    .filter((c) => c.tier === t)
                    .map((c) => (
                      <li key={c.key} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                        <span className="min-w-0">
                          <span className="block">{c.label}</span>
                          {c.license && <span className="block text-[11px] text-b2b-muted">Wajib: {c.license}</span>}
                        </span>
                        {t === 'prohibited' ? <Badge tone="red">Dilarang</Badge> : c.blocked ? <Badge tone="amber">Diblokir</Badge> : <Badge tone="green">Diizinkan</Badge>}
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

const SIM_PRESETS: { label: string; v: Partial<SimForm> }[] = [
  { label: 'Pendengar aktif', v: { premium: false, anonymous: false, streams_today: 24, streams_since_break: 5, minutes: 32, noBreak: false, ads_last_hour: 2 } },
  { label: 'Pagi hari (masa bebas iklan)', v: { premium: false, anonymous: false, streams_today: 2, streams_since_break: 2, noBreak: true, ads_last_hour: 0 } },
  { label: 'Baru saja ada iklan', v: { premium: false, anonymous: false, streams_today: 30, streams_since_break: 1, minutes: 4, noBreak: false, ads_last_hour: 2 } },
  { label: 'Pelanggan Premium', v: { premium: true, anonymous: false } },
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
    ['anonymous', 'Anonim', 'Pratinjau 30 detik tanpa login'],
    ['premium', 'Premium', 'Pelanggan berbayar'],
    ['consent', 'Persetujuan iklan', 'Izinkan penargetan kota (UU PDP)'],
    ['premium_content', 'Konten berikutnya Premium', 'mis. episode khusus Premium'],
    ['content_warning', 'Konten berperingatan', 'Horor/dewasa → hanya promosi GEMA'],
  ];
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <FlaskConical className="size-4" /> Simulator keputusan jeda
        </span>
      }
      action={<span className="text-xs text-b2b-muted">Memakai pengaturan & kampanye saat ini</span>}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {SIM_PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => setF({ ...SIM_INIT, ...p.v })} className="rounded-full border border-b2b-line px-3 py-1 text-xs font-bold text-b2b-ink transition hover:border-b2b-ink">
            {p.label}
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
              <label key={k} className={cx('flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm transition', f[k] ? 'border-b2b-ink' : 'border-b2b-line')}>
                <input type="checkbox" checked={!!f[k]} onChange={(e) => set(k, e.target.checked as never)} className="mt-0.5 size-4 accent-violet-600" />
                <span>
                  <b className="block">{l}</b>
                  <span className="text-xs text-b2b-muted">{h}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Penempatan">
              <Select value={f.placement} onChange={(e) => set('placement', e.target.value as SimForm['placement'])}>
                <option value="between_tracks">Di antara lagu</option>
                <option value="podcast_preroll">Pre-roll podcast</option>
              </Select>
            </Field>
            <Field label="Kota" hint="opsional">
              <Select value={f.city} onChange={(e) => set('city', e.target.value)}>
                <option value="">—</option>
                {CITIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Putaran hari ini" hint="stream ≥ 30 dtk">
              <Input type="number" min={0} value={f.streams_today} onChange={(e) => set('streams_today', num(e.target.value))} />
            </Field>
            <Field label="Lagu sejak jeda terakhir">
              <Input type="number" min={0} value={f.streams_since_break} onChange={(e) => set('streams_since_break', num(e.target.value))} />
            </Field>
            <div>
              <Label hint="menit">Sejak jeda terakhir</Label>
              <div className="flex items-center gap-3">
                <Input type="number" min={0} value={f.noBreak ? '' : f.minutes} disabled={f.noBreak} onChange={(e) => set('minutes', num(e.target.value))} placeholder="—" />
                <label className="flex items-center gap-1.5 text-xs whitespace-nowrap text-b2b-muted">
                  <input type="checkbox" checked={f.noBreak} onChange={(e) => set('noBreak', e.target.checked)} /> belum ada
                </label>
              </div>
            </div>
            <Field label="Iklan dalam 60 menit terakhir">
              <Input type="number" min={0} value={f.ads_last_hour} onChange={(e) => set('ads_last_hour', num(e.target.value))} />
            </Field>
          </div>
          <div>
            <Label hint="konteks yang diputar">Genre</Label>
            <div className="flex flex-wrap gap-1.5">
              {GENRES.map((g) => {
                const on = f.genres.includes(g);
                return (
                  <button
                    key={g}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set('genres', on ? f.genres.filter((x) => x !== g) : [...f.genres, g])}
                    className={cx('rounded-full border px-2.5 py-0.5 text-xs font-semibold transition', on ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted hover:border-b2b-ink')}
                  >
                    {g}
                  </button>
                );
              })}
            </div>
          </div>
          <Button type="submit" variant="ink" size="sm" loading={busy} icon={<Play className="size-4" />}>
            Jalankan simulasi
          </Button>
        </form>

        <div aria-live="polite">
          {!res ? (
            <div className="grid h-full min-h-48 place-items-center rounded-lg border border-dashed border-b2b-line p-6 text-center text-sm text-b2b-muted">
              Atur keadaan pendengar lalu jalankan simulasi untuk melihat setiap aturan yang dievaluasi.
            </div>
          ) : (
            <div className="space-y-4">
              <div className={cx('flex items-center justify-between gap-3 rounded-lg border p-4', res.outcome === 'serve' ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10')}>
                <div>
                  <p className="text-xs font-bold tracking-wide text-b2b-muted uppercase">Keputusan</p>
                  <p className="text-lg font-extrabold">{res.label}</p>
                </div>
                <div className="text-right">
                  <Badge tone={res.outcome === 'serve' ? 'green' : 'amber'}>{res.outcome}</Badge>
                  <p className="mt-1 text-xs text-b2b-muted">{res.slots} slot iklan</p>
                </div>
              </div>
              <ol className="relative space-y-0">
                {res.trace.map((t, i) => (
                  <li key={i} className="flex gap-3 pb-3 last:pb-0">
                    <span className={cx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-white', t.pass ? 'bg-emerald-500' : 'bg-red-500')} aria-label={t.pass ? 'Lolos' : 'Gagal'}>
                      {t.pass ? <Check className="size-3" /> : <X className="size-3" />}
                    </span>
                    <span className="text-sm">
                      <b>{t.rule}</b>
                      <span className="block text-xs text-b2b-muted">{t.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div>
                <p className="mb-2 text-xs font-bold tracking-wide text-b2b-muted uppercase">Kampanye ({res.eligible_campaigns.filter((c) => !c.reason).length} memenuhi syarat)</p>
                {res.eligible_campaigns.length ? (
                  <ul className="divide-y divide-b2b-line rounded-lg border border-b2b-line">
                    {res.eligible_campaigns.map((c) => (
                      <li key={c.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                        <span className="min-w-0">
                          <span className="flex items-center gap-2 font-semibold">
                            {c.name}
                            {c.is_house && <Badge tone="purple">Dari GEMA</Badge>}
                          </span>
                          <span className="block text-xs text-b2b-muted">{c.advertiser}</span>
                        </span>
                        {c.reason ? <span className="max-w-[55%] text-right text-xs text-b2b-muted">{c.reason}</span> : <Badge tone="green">Memenuhi syarat</Badge>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-b2b-muted">Tidak ada kampanye disetujui.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
