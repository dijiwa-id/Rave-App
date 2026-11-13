import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowRight, Images, Shapes, PlugZap, Radio, DatabaseBackup, Disc3, FileClock, Gauge, Gavel, HardDrive, IdCard, KeyRound, LayoutDashboard, Megaphone, Scale, ShieldCheck, PanelsTopLeft, SlidersHorizontal, Users, Workflow } from 'lucide-react';
import { ADMIN_PERMISSIONS, ADMIN_ROLE_LABEL, type AdminPermission, type AdminRole } from '@rave/domain/settings';
import { can, isSuperAdmin, useAuth } from '@/stores/auth';
import { B2BLayout, type B2BNavItem } from '@/layouts/B2BLayout';
import { api, fmt } from '@/lib/api';
import { WEB_VERSION } from '@/lib/version';
import { RAVE_SERVICES, SERVICE_TYPES, serviceHref } from '@/lib/raveServices';
import { useDict } from '@/lib/i18n';
import type { AdminPayoutRow, AdminRefundRow, Dispute, Me, MemberType, PayoutStatus, Release, TicketRefundReason } from '@/lib/types';
import { Badge, Button, Card, cx, Field, Input, Modal, PageHeader, Select, Stat, Textarea, toast } from '@/components/ui';
import { Empty, QueryState, Table } from '@/components/b2b/common';
import { ReleaseStatusBadge } from '../studio/Releases';

type AdminNavItem = B2BNavItem & { perms?: AdminPermission[]; superOnly?: boolean };

/** Saring menu sesuai izin; judul seksi pindah ke item pertama yang tersisa (seksi kosong hilang). */
function visibleNav(items: AdminNavItem[], allowed: (n: AdminNavItem) => boolean): AdminNavItem[] {
  const out: AdminNavItem[] = [];
  let pending: string | undefined;
  for (const it of items) {
    if (it.section) pending = it.section;
    if (!allowed(it)) continue;
    out.push({ ...it, section: pending });
    pending = undefined;
  }
  return out;
}

export function AdminLayout() {
  const user = useAuth((s) => s.user);
  const n = useDict('admin').nav;
  const cmsTitle = useDict('cms').title;
  const svc = useDict('admin').services;
  // Menu mengikuti izin peran ("Peran & Akses"); halaman & API menegakkan hal yang sama.
  // Seksi sidebar = area izin di "Peran & Akses" (ADMIN_PERMISSIONS[*].area): menu & seksi mengikuti izin peran,
  // seksi tanpa item yang boleh dibuka otomatis tersembunyi. Platform & pengaturan layanan khusus Super Admin.
  const area = (p: AdminPermission) => n.areas[ADMIN_PERMISSIONS[p].area as keyof typeof n.areas] ?? ADMIN_PERMISSIONS[p].area;
  const NAV: AdminNavItem[] = [
    { to: '/admin', label: n.dashboard, icon: LayoutDashboard, end: true, section: n.overviewSection },
    // Seksi Konten
    { to: '/admin/qc', label: n.qc, icon: Disc3, perms: ['qc.review'], section: area('qc.review') },
    { to: '/admin/categories', label: n.categories, icon: Shapes, perms: ['catalog.curate'] },
    { to: '/admin/artwork', label: n.artwork, icon: Images, perms: ['catalog.curate'] },
    { to: '/admin/live', label: n.live, icon: Radio, perms: ['live.moderate'] },
    // Seksi Iklan
    { to: '/admin/ads', label: n.ads, icon: Megaphone, perms: ['ads.manage', 'ads.review'], section: area('ads.manage') },
    // Seksi Kepercayaan
    { to: '/admin/kyc', label: n.kyc, icon: IdCard, perms: ['kyc.review'], section: area('kyc.review') },
    { to: '/admin/disputes', label: n.disputes, icon: Gavel, perms: ['dispute.resolve'] },
    // Seksi Keuangan
    { to: '/admin/finance', label: n.finance, icon: Scale, perms: ['finance.view', 'finance.refund', 'finance.payout'], section: area('finance.view') },
    // Seksi Pengguna
    { to: '/admin/users', label: n.users, icon: Users, perms: ['users.view'], section: area('users.view') },
    { to: '/admin/audit', label: n.audit, icon: FileClock, perms: ['audit.view'] },
    // Platform — tata kelola (khusus Super Admin, tidak dapat didelegasikan).
    { to: '/admin/platform', label: n.platformDashboard, icon: Gauge, end: true, section: n.platformSection, superOnly: true },
    { to: '/admin/platform/settings', label: n.settings, icon: SlidersHorizontal, superOnly: true },
    { to: '/admin/platform/roles', label: n.roles, icon: KeyRound, superOnly: true },
    { to: '/admin/platform/admins', label: n.admins, icon: ShieldCheck, superOnly: true },
    { to: '/admin/platform/landing', label: cmsTitle, icon: PanelsTopLeft, superOnly: true },
    // Pengaturan layanan per jenis: siap → grup pengaturannya; belum siap → halaman "Dalam pengembangan" (badge Segera).
    ...SERVICE_TYPES.flatMap((type) =>
      RAVE_SERVICES.filter((s) => s.type === type && s.nav !== false).map((s, i) => ({
        to: serviceHref(s),
        label: svc.items[s.id as keyof typeof svc.items].name,
        icon: s.icon,
        section: i === 0 ? n.serviceTypes[type] : undefined,
        badge: s.status === 'soon' ? svc.soonBadge : undefined,
        superOnly: true,
      })),
    ),
    { to: '/admin/platform/storage', label: n.storage, icon: HardDrive, section: n.infraSection, superOnly: true },
    { to: '/admin/platform/backups', label: n.backups, icon: DatabaseBackup, superOnly: true },
    { to: '/admin/platform/integrations', label: n.integrations, icon: PlugZap, superOnly: true },
    { to: '/admin/platform/bus', label: n.bus, icon: Workflow, superOnly: true },
  ];
  const sup = isSuperAdmin(user);
  const role = user?.admin_role as AdminRole | null | undefined;
  return (
    <B2BLayout
      product={sup ? 'Super Admin' : 'Back Office'}
      accent="#1F5C52"
      nav={visibleNav(NAV, (n) => (n.superOnly ? sup : !n.perms || can(user, ...n.perms)))}
      roleLabel={(role && ADMIN_ROLE_LABEL[role]) ?? (sup ? 'Super Admin' : 'Admin')}
    />
  );
}

export function AdminDashboard() {
  const user = useAuth((s) => s.user);
  const d = useDict('admin');
  const t = d.dashboard;
  const sup = isSuperAdmin(user);
  // Kartu hanya untuk area yang boleh dibuka peran ini (tanpa memanggil API yang pasti ditolak).
  const show = { qc: can(user, 'qc.review'), kyc: can(user, 'kyc.review'), disputes: can(user, 'dispute.resolve'), finance: can(user, 'finance.view') };
  const status = useQuery({ queryKey: ['status'], queryFn: () => api<{ ok: boolean; version?: string; version_drift?: string[]; services: { service: string; ok: boolean; ms: number; version?: string | null }[] }>('/v1/status'), refetchInterval: 10_000 });
  const qc = useQuery({ queryKey: ['qc', 'IN_REVIEW'], enabled: show.qc, queryFn: () => api<{ data: Release[] }>('/v1/admin/qc/releases', { query: { status: 'IN_REVIEW' } }) });
  const kyc = useQuery({ queryKey: ['admin-kyc', 'PENDING'], enabled: show.kyc, queryFn: () => api<{ data: any[] }>('/v1/admin/iam/kyc', { query: { status: 'PENDING' } }) });
  const disputes = useQuery({ queryKey: ['admin-disputes'], enabled: show.disputes, queryFn: () => api<{ data: Dispute[] }>('/v1/admin/disputes') });
  const recon = useQuery({ queryKey: ['recon'], enabled: show.finance, queryFn: () => api<{ balanced: boolean }>('/v1/admin/finance/reconciliation') });
  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          sup && (
          <Link to="/admin/platform" className="inline-flex h-8 items-center gap-2 rounded-none border border-b2b-line bg-b2b-card px-4 text-sm font-bold text-b2b-ink transition hover:border-b2b-ink">
            <Gauge className="size-4" /> {d.nav.platformDashboard} <ArrowRight className="size-4" />
          </Link>
          )
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {show.qc && (
          <Link to="/admin/qc">
            <Stat label={t.qcPending} value={qc.data?.data.length ?? '—'} />
          </Link>
        )}
        {show.kyc && (
          <Link to="/admin/kyc">
            <Stat label={t.kycPending} value={kyc.data?.data.length ?? '—'} />
          </Link>
        )}
        {show.disputes && (
          <Link to="/admin/disputes">
            <Stat label={t.disputesOpen} value={disputes.data?.data.filter((x) => x.status === 'OPEN').length ?? '—'} />
          </Link>
        )}
        {show.finance && (
          <Link to="/admin/finance">
            <Stat label={t.ledger} value={recon.data ? (recon.data.balanced ? t.balanced : t.mismatch) : '—'} />
          </Link>
        )}
      </div>
      <Card className="mt-6" title={<span className="flex items-center gap-2"><Activity className="size-4" /> {t.health}</span>} action={status.data && <Badge tone={status.data.ok ? 'green' : 'red'}>{status.data.ok ? t.allNormal : t.degraded}</Badge>}>
        <QueryState q={status}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {status.data?.services.map((s) => (
              <div key={s.service} className="flex items-center justify-between rounded-none border border-b2b-line p-3">
                <span className="text-sm font-bold">{s.service}</span>
                <span className={`flex items-center gap-1.5 text-xs font-semibold ${s.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                  <span className={`size-2 rounded-full ${s.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  {s.ok ? `${s.ms} ms` : t.down}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-b2b-muted tabular-nums">
            {t.versionLine(WEB_VERSION, status.data?.version ?? '—')}
            {!!status.data?.version_drift?.length && <span className="ml-2 font-semibold text-red-600">{t.versionDrift(status.data.version_drift.join(', '))}</span>}
          </p>
        </QueryState>
      </Card>
    </div>
  );
}

type QcSignal = { title: string; isrc: string | null; duplicate_release_id: string; duplicate_title: string };

/** Pengajuan ganti sampul untuk rilis yang sudah tayang — bandingkan sampul lama & baru. */
function CoverQueue() {
  const d = useDict('admin');
  const t = d.qc;
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['qc-covers'],
    queryFn: () => api<{ data: { id: string; title: string; status: string; artist_name: string; current_cover: string | null; pending_cover: string; submitted_at: string }[] }>('/v1/admin/qc/covers'),
  });
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  async function decide(id: string, approve: boolean) {
    try {
      await api(`/v1/admin/qc/covers/${id}/decision`, { body: approve ? { approve } : { approve, reason: why } });
      toast.success(approve ? t.coverApproved : t.coverRejectedToast);
      setRejecting(null);
      setWhy('');
      qc.invalidateQueries({ queryKey: ['qc-covers'] });
    } catch (e) {
      toast.error(e);
    }
  }
  if (!q.data?.data.length) return null;
  return (
    <Card title={t.coverQueue(q.data.data.length)} className="mb-6">
      <ul className="divide-y divide-b2b-line">
        {q.data.data.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-4 py-3">
            <div className="flex items-center gap-2">
              <figure className="text-center">
                {c.current_cover ? <img src={c.current_cover} alt="" className="size-20 object-cover opacity-70" /> : <div className="size-20 bg-b2b-bg" />}
                <figcaption className="mt-1 text-[10px] font-bold text-b2b-muted uppercase">{t.coverCurrent}</figcaption>
              </figure>
              <span className="text-b2b-muted">→</span>
              <figure className="text-center">
                <img src={c.pending_cover} alt="" className="size-20 object-cover ring-2 ring-amber-400" />
                <figcaption className="mt-1 text-[10px] font-bold text-amber-700 uppercase">{t.coverNew}</figcaption>
              </figure>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold">{c.title}</p>
              <p className="text-xs text-b2b-muted">
                {c.artist_name} · {c.status} · {fmt.dateTime(c.submitted_at)}
              </p>
            </div>
            {rejecting === c.id ? (
              <div className="flex w-full flex-wrap items-end gap-2 md:w-auto">
                <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t.coverRejectReason} className="w-64" />
                <Button size="sm" variant="danger" disabled={why.trim().length < 5} onClick={() => decide(c.id, false)}>
                  {d.common.reject}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>
                  {d.common.cancel}
                </Button>
              </div>
            ) : (
              <span className="inline-flex gap-2">
                <Button size="sm" variant="outline-ink" onClick={() => setRejecting(c.id)}>
                  {d.common.reject}
                </Button>
                <Button size="sm" variant="ink" onClick={() => decide(c.id, true)}>
                  {d.common.approve}
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

type ChangeRow = {
  id: string;
  title: string;
  status: string;
  artist_name: string;
  cover_url: string | null;
  submitted_at: string;
  current: { title: string; genre: string | null; label: string | null; explicit: boolean; release_date: string; tracks: { id: string; title: string; explicit: boolean; track_number: number }[] };
  changes: { release: Record<string, unknown>; tracks: Record<string, Record<string, unknown>>; note: string | null };
};

/** Antrean pengajuan perubahan metadata rilis LIVE/SCHEDULED: tampilkan beda lama → baru, setujui / tolak beralasan. */
function ChangesQueue() {
  const d = useDict('admin');
  const t = d.qc;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['qc-changes'], queryFn: () => api<{ data: ChangeRow[] }>('/v1/admin/qc/changes') });
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const show = (v: unknown) => (typeof v === 'boolean' ? (v ? t.yes : t.no) : v == null || v === '' ? '—' : String(v));
  async function decide(id: string, approve: boolean) {
    try {
      await api(`/v1/admin/qc/changes/${id}/decision`, { body: approve ? { approve } : { approve, reason: why } });
      toast.success(approve ? t.changesApproved : t.changesRejectedToast);
      setRejecting(null);
      setWhy('');
      qc.invalidateQueries({ queryKey: ['qc-changes'] });
      qc.invalidateQueries({ queryKey: ['qc'] });
    } catch (e) {
      toast.error(e);
    }
  }
  if (!q.data?.data.length) return null;
  return (
    <Card title={t.changesQueue(q.data.data.length)} className="mb-6">
      <ul className="divide-y divide-b2b-line">
        {q.data.data.map((c) => {
          const cur = c.current as unknown as Record<string, unknown>;
          return (
            <li key={c.id} className="flex flex-wrap gap-4 py-3">
              {c.cover_url ? <img src={c.cover_url} alt="" className="size-16 object-cover" /> : <div className="size-16 bg-b2b-bg" />}
              <div className="min-w-0 flex-1">
                <p className="font-bold">{c.title}</p>
                <p className="text-xs text-b2b-muted">
                  {c.artist_name} · {c.status} · {fmt.dateTime(c.submitted_at)}
                </p>
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                  {Object.entries(c.changes.release ?? {}).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="font-semibold text-b2b-muted">{t.changesFields[k] ?? k}</dt>
                      <dd>
                        <span className="line-through opacity-60">{show(cur[k])}</span> → <strong>{show(v)}</strong>
                      </dd>
                    </div>
                  ))}
                  {Object.entries(c.changes.tracks ?? {}).map(([tid, ch]) => {
                    const tr = c.current.tracks.find((x) => x.id === tid);
                    return Object.entries(ch).map(([k, v]) => (
                      <div key={tid + k} className="contents">
                        <dt className="font-semibold text-b2b-muted">
                          {t.changesTrack(tr?.track_number ?? 0)} · {t.changesFields[k] ?? k}
                        </dt>
                        <dd>
                          <span className="line-through opacity-60">{show(tr ? (tr as unknown as Record<string, unknown>)[k] : null)}</span> → <strong>{show(v)}</strong>
                        </dd>
                      </div>
                    ));
                  })}
                </dl>
                {c.changes.note && <p className="mt-2 text-xs text-b2b-muted italic">{t.changesNote(c.changes.note)}</p>}
              </div>
              {rejecting === c.id ? (
                <div className="flex w-full flex-wrap items-end gap-2 md:w-auto">
                  <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t.changesRejectReason} className="w-64" />
                  <Button size="sm" variant="danger" disabled={why.trim().length < 5} onClick={() => decide(c.id, false)}>
                    {d.common.reject}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>
                    {d.common.cancel}
                  </Button>
                </div>
              ) : (
                <span className="inline-flex items-start gap-2">
                  <Button size="sm" variant="outline-ink" onClick={() => setRejecting(c.id)}>
                    {d.common.reject}
                  </Button>
                  <Button size="sm" variant="ink" onClick={() => decide(c.id, true)}>
                    {d.common.approve}
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function AdminQc() {
  const d = useDict('admin');
  const t = d.qc;
  const [status, setStatus] = useState('IN_REVIEW');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['qc', status], queryFn: () => api<{ data: Release[] }>('/v1/admin/qc/releases', { query: { status } }) });
  const [reject, setReject] = useState<Release | null>(null);
  const [takedown, setTakedown] = useState<Release | null>(null);
  const [reason, setReason] = useState('');
  async function takeDown(id: string, why: string) {
    try {
      await api(`/v1/admin/qc/releases/${id}/takedown`, { body: { reason: why } });
      toast.success(t.toastTakenDown);
      setTakedown(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['qc'] });
    } catch (e) {
      toast.error(e);
    }
  }
  async function decide(id: string, approve: boolean, why?: string) {
    try {
      await api(`/v1/admin/qc/releases/${id}/decision`, { body: { approve, reason: why } });
      toast.success(approve ? t.toastApproved : t.toastRejected);
      setReject(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['qc'] });
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
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
            {['IN_REVIEW', 'SCHEDULED', 'LIVE', 'REJECTED', 'TAKEN_DOWN'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        }
      />
      <CoverQueue />
      <ChangesQueue />
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title={t.empty} /> : undefined}>
        <div className="space-y-4">
          {q.data?.data.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap gap-5">
                {r.cover_url ? <img src={r.cover_url} alt="" className="size-28 rounded-none object-cover" /> : <div className="size-28 rounded-none bg-b2b-bg" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-extrabold">{r.title}</p>
                    <ReleaseStatusBadge status={r.status} />
                    {r.explicit && <Badge>E</Badge>}
                  </div>
                  <p className="text-sm text-b2b-muted">
                    {r.artist.name} · {r.type} · {r.genre} · {r.label ?? t.independent} · {t.releasedOn(fmt.date(r.release_date))}
                  </p>
                  <ol className="mt-2 space-y-1 text-sm">
                    {r.tracks.map((t) => (
                      <li key={t.id} className="flex gap-2">
                        <span className="w-5 text-b2b-muted">{t.track_number}</span>
                        <span className="font-semibold">{t.title}</span>
                        <span className="text-b2b-muted">{fmt.duration(t.duration_ms)}</span>
                        {t.isrc && <span className="font-mono text-xs text-b2b-muted">{t.isrc}</span>}
                      </li>
                    ))}
                  </ol>
                  {r.qc_reason && <p className="mt-2 text-sm text-red-600">{r.qc_reason}</p>}
                  {(r as Release & { qc_warnings?: string[] }).qc_warnings?.map((w) => (
                    <p key={w} className="mt-1 text-xs font-semibold text-amber-700">⚠ {w}</p>
                  ))}
                  {!!(r as Release & { qc_signals?: QcSignal[] }).qc_signals?.length && (
                    <div className="mt-2 rounded-none border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                      <p className="font-bold">{t.dupSignals}</p>
                      {(r as Release & { qc_signals: QcSignal[] }).qc_signals.map((x, i) => (
                        <p key={i}>{t.similarTo(x.title, x.isrc ? ` (${x.isrc})` : '', x.duplicate_title)}</p>
                      ))}
                    </div>
                  )}
                </div>
                {r.status === 'IN_REVIEW' && (
                  <div className="flex flex-col gap-2">
                    <Button variant="ink" size="sm" onClick={() => decide(r.id, true)}>
                      {d.common.approve}
                    </Button>
                    <Button variant="outline-ink" size="sm" onClick={() => setReject(r)}>
                      {d.common.reject}
                    </Button>
                  </div>
                )}
                {(r.status === 'LIVE' || r.status === 'SCHEDULED') && (
                  <div>
                    <Button variant="outline-ink" size="sm" onClick={() => setTakedown(r)}>
                      {t.takedown}
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      </QueryState>
      <Modal open={!!reject} onClose={() => setReject(null)} title={t.rejectTitle(reject?.title)}>
        <Field label={t.reasonToArtist}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.rejectPlaceholder} />
        </Field>
        <Button variant="danger" className="mt-3" disabled={!reason.trim()} onClick={() => decide(reject!.id, false, reason)}>
          {t.rejectRelease}
        </Button>
      </Modal>
      <Modal open={!!takedown} onClose={() => setTakedown(null)} title={t.takedownTitle(takedown?.title)}>
        <p className="mb-3 text-sm text-b2b-muted">{t.takedownBody}</p>
        <Field label={t.takedownReason}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.takedownPlaceholder} />
        </Field>
        <Button variant="danger" className="mt-3" disabled={reason.trim().length < 3} onClick={() => takeDown(takedown!.id, reason.trim())}>
          {t.takedownRelease}
        </Button>
      </Modal>
    </div>
  );
}

export function AdminKyc() {
  const d = useDict('admin');
  const t = d.kyc;
  const [status, setStatus] = useState('PENDING');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-kyc', status], queryFn: () => api<{ data: any[] }>('/v1/admin/iam/kyc', { query: { status } }) });
  async function decide(id: string, approve: boolean) {
    const reason = approve ? undefined : prompt(t.rejectPrompt) ?? undefined;
    if (!approve && !reason) return;
    try {
      await api(`/v1/admin/iam/kyc/${id}/decision`, { body: { approve, reason } });
      toast.success(approve ? t.approved : t.rejected);
      qc.invalidateQueries({ queryKey: ['admin-kyc'] });
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
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            {['PENDING', 'VERIFIED', 'REJECTED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        }
      />
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title={t.empty} /> : undefined}>
        <Table head={[...t.head]}>
          {q.data?.data.map((k) => (
            <tr key={k.id}>
              <td className="px-4 py-3 font-bold">{k.full_name}</td>
              <td className="px-4 py-3">{k.level}</td>
              <td className="px-4 py-3 font-mono text-xs">{k.id_number_masked}</td>
              <td className="px-4 py-3">{k.business_name ?? '—'}</td>
              <td className="px-4 py-3">{fmt.dateTime(k.created_at)}</td>
              <td className="px-4 py-3">
                <Badge tone={k.status === 'VERIFIED' ? 'green' : k.status === 'REJECTED' ? 'red' : 'amber'}>{k.status}</Badge>
                {k.reason && <p className="mt-1 text-xs text-b2b-muted">{k.reason}</p>}
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                {k.status === 'PENDING' && (
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ink" onClick={() => decide(k.id, true)}>
                      {d.common.approve}
                    </Button>
                    <Button size="sm" variant="outline-ink" onClick={() => decide(k.id, false)}>
                      {d.common.reject}
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </QueryState>
    </div>
  );
}

export function AdminDisputes() {
  const dd = useDict('admin');
  const t = dd.disputes;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-disputes'], queryFn: () => api<{ data: Dispute[] }>('/v1/admin/disputes') });
  const [sel, setSel] = useState<Dispute | null>(null);
  const [outcome, setOutcome] = useState<'RELEASE_TO_ARTIST' | 'REFUND_PROMOTOR' | 'FORCE_MAJEURE'>('RELEASE_TO_ARTIST');
  const [award, setAward] = useState(0);
  const [note, setNote] = useState('');
  async function resolve() {
    try {
      await api(`/v1/admin/disputes/${sel!.id}/resolve`, { body: outcome === 'FORCE_MAJEURE' ? { outcome, note, awarded_costs: award } : { outcome, note } });
      toast.success(t.resolved);
      setSel(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['admin-disputes'] });
    } catch (e) {
      toast.error(e);
    }
  }
  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title={t.empty} /> : undefined}>
        <Table head={[...t.head]}>
          {q.data?.data.map((d) => (
            <tr key={d.id}>
              <td className="px-4 py-3 whitespace-nowrap">{fmt.dateTime(d.created_at)}</td>
              <td className="px-4 py-3 font-mono text-xs">{d.booking_id.slice(0, 8)}…</td>
              <td className="px-4 py-3">{d.by_party}</td>
              <td className="max-w-sm px-4 py-3">
                {d.kind === 'FORCE_MAJEURE' && <Badge tone="amber">{t.fmBadge}</Badge>} {d.reason}
              </td>
              <td className="px-4 py-3">
                <Badge tone={d.status === 'OPEN' ? 'red' : 'neutral'}>{d.status}</Badge>
                {d.outcome && <p className="mt-1 text-xs text-b2b-muted">{d.outcome}</p>}
              </td>
              <td className="px-4 py-3 text-right">
                {d.status === 'OPEN' && (
                  <Button size="sm" variant="ink" onClick={() => setSel(d)}>
                    {dd.common.decide}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </QueryState>
      <Modal open={!!sel} onClose={() => setSel(null)} title={t.modalTitle}>
        <p className="mb-3 text-sm text-b2b-muted">{sel?.reason}</p>
        {sel?.kind === 'FORCE_MAJEURE' && (
          <div className="mb-3 space-y-1 border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <p className="font-bold">{t.fmEvidence}</p>
            <p className="break-words whitespace-pre-wrap">{sel.evidence}</p>
            {sel.claimed_costs != null && <p className="text-b2b-muted">{t.fmClaimed(fmt.idr(sel.claimed_costs))}</p>}
          </div>
        )}
        <Field label={t.decision}>
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
            <option value="RELEASE_TO_ARTIST">{t.releaseToArtist}</option>
            <option value="REFUND_PROMOTOR">{t.refundPromotor}</option>
            {sel?.kind === 'FORCE_MAJEURE' && <option value="FORCE_MAJEURE">{t.fmOutcome}</option>}
          </Select>
        </Field>
        {outcome === 'FORCE_MAJEURE' && (
          <div className="mt-3">
            <Field label={t.fmAward} hint={t.fmAwardHint}>
              <Input type="number" min={0} value={award || ''} onChange={(e) => setAward(Math.max(0, Number(e.target.value) || 0))} />
            </Field>
          </div>
        )}
        <div className="mt-3">
          <Field label={t.note}>
            <Textarea required value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <Button variant="ink" className="mt-3" disabled={!note.trim()} onClick={resolve}>
          {t.save}
        </Button>
      </Modal>
    </div>
  );
}

const REFUND_STATUS_TONE: Record<AdminRefundRow['refund']['status'], 'amber' | 'red' | 'blue' | 'green'> = {
  REVIEW: 'amber',
  FAILED: 'red',
  PENDING: 'blue',
  COMPLETED: 'green',
};

/** Antrean refund tiket: pembayaran terlambat yang menunggu keputusan (REVIEW) & refund gagal di atas. */
function RefundQueue() {
  const d = useDict('admin');
  const t = d.refunds;
  const REFUND_REASON: Record<TicketRefundReason, string> = t.reason;
  const qc = useQueryClient();
  // Melihat antrean: finance.view; memutuskan / mengirim ulang / menyelesaikan: finance.refund.
  const canRefund = can(useAuth((s) => s.user), 'finance.refund');
  const [filter, setFilter] = useState<'' | AdminRefundRow['refund']['status']>('');
  const [deciding, setDeciding] = useState<AdminRefundRow | null>(null);
  const [form, setForm] = useState({ pct: 100, refund_fee: true, note: '' });
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<AdminRefundRow | null>(null);
  const [mform, setMform] = useState({ transfer_ref: '', note: '' });
  async function retry(r: AdminRefundRow) {
    try {
      await api(`/v1/admin/finance/refunds/${r.order_id}/retry`, { body: {} });
      toast.success(t.toastRetried);
      qc.invalidateQueries({ queryKey: ['admin-refunds'] });
    } catch (e) {
      toast.error(e);
    }
  }
  async function completeManual() {
    if (!manual) return;
    setBusy(true);
    try {
      await api(`/v1/admin/finance/refunds/${manual.order_id}/complete-manual`, { body: mform });
      toast.success(t.toastManualDone);
      qc.invalidateQueries({ queryKey: ['admin-refunds'] });
      setManual(null);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  const q = useQuery({
    queryKey: ['admin-refunds', filter],
    queryFn: () => api<{ data: AdminRefundRow[]; counts: Record<string, number> }>('/v1/admin/ticketing/refunds', { query: { status: filter || undefined } }),
  });
  async function decide() {
    if (!deciding) return;
    setBusy(true);
    try {
      await api(`/v1/admin/ticketing/orders/${deciding.order_id}/refund`, { body: form });
      toast.success(t.toastSubmitted);
      qc.invalidateQueries({ queryKey: ['admin-refunds'] });
      setDeciding(null);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  const counts = q.data?.counts ?? {};
  const urgent = (counts.REVIEW ?? 0) + (counts.FAILED ?? 0);
  return (
    <Card title={t.title} className="mt-6">
      <div className="mb-4 flex flex-wrap gap-2">
        {([['', t.all], ['REVIEW', t.status.REVIEW], ['FAILED', t.status.FAILED], ['PENDING', t.status.PENDING], ['COMPLETED', t.status.COMPLETED]] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={`rounded-none border px-3 py-1.5 text-xs font-bold ${filter === v ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted'}`}
          >
            {label}
            {v && counts[v] ? ` · ${counts[v]}` : ''}
          </button>
        ))}
        {urgent > 0 && <span className="self-center text-xs font-bold text-red-600">{t.needAction(urgent)}</span>}
      </div>
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title={t.emptyTitle} body={t.emptyBody} /> : undefined}>
        <Table head={[...t.head]}>
          {q.data?.data.map((r) => (
            <tr key={r.order_id}>
              <td className="px-4 py-3">
                <p className="font-bold">{r.holder_name}</p>
                <p className="text-xs text-b2b-muted">{r.event.title}</p>
                {r.note && <p className="mt-1 text-xs text-b2b-muted italic">{r.note}</p>}
              </td>
              <td className="px-4 py-3 text-sm">{REFUND_REASON[r.refund.reason] ?? r.refund.reason}</td>
              <td className="px-4 py-3 tabular-nums">
                {r.refund.amount !== null ? fmt.idr(r.refund.amount) : '—'}
                <span className="block text-xs text-b2b-muted">{t.ofTotal(fmt.idr(r.total))}</span>
              </td>
              <td className="px-4 py-3">
                <Badge tone={REFUND_STATUS_TONE[r.refund.status]}>{t.status[r.refund.status]}</Badge>
              </td>
              <td className="px-4 py-3 text-xs whitespace-nowrap">{r.refund.requested_at ? fmt.dateTime(r.refund.requested_at) : '—'}</td>
              <td className="px-4 py-3 text-right">
                {canRefund && r.refund.status === 'FAILED' && (
                  <span className="inline-flex gap-2">
                    <Button size="sm" variant="outline-ink" onClick={() => retry(r)}>
                      {t.resend}
                    </Button>
                    <Button
                      size="sm"
                      variant="ink"
                      onClick={() => {
                        setMform({ transfer_ref: '', note: '' });
                        setManual(r);
                      }}
                    >
                      {t.completeManual}
                    </Button>
                  </span>
                )}
                {canRefund && r.refund.status === 'REVIEW' && (
                  <Button
                    size="sm"
                    variant="ink"
                    onClick={() => {
                      setForm({ pct: 100, refund_fee: true, note: '' });
                      setDeciding(r);
                    }}
                  >
                    {d.common.decide}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </QueryState>
      {manual && (
        <Modal open onClose={() => setManual(null)} title={t.manualTitle}>
          <div className="space-y-4 text-sm">
            <p>
              {t.manualBodyA(manual.refund.amount !== null ? fmt.idr(manual.refund.amount) : t.funds)}{' '}
              <strong>{manual.holder_name}</strong> {t.manualBodyB}
            </p>
            {manual.note && <p className="rounded-none border border-red-500/30 bg-red-500/5 p-3 text-xs">{t.failCause(manual.note)}</p>}
            <Field label={t.transferRef}>
              <Input value={mform.transfer_ref} onChange={(e) => setMform({ ...mform, transfer_ref: e.target.value })} placeholder={t.transferPlaceholder} />
            </Field>
            <Field label={t.note} hint={d.common.auditHint}>
              <Textarea value={mform.note} onChange={(e) => setMform({ ...mform, note: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline-ink" onClick={() => setManual(null)}>
                {d.common.cancel}
              </Button>
              <Button variant="ink" loading={busy} disabled={mform.transfer_ref.trim().length < 4 || mform.note.trim().length < 5} onClick={completeManual}>
                {t.markDone}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {deciding && (
        <Modal open onClose={() => setDeciding(null)} title={t.decideTitle}>
          <div className="space-y-4 text-sm">
            <p>
              <strong>{deciding.holder_name}</strong>
              {t.decidePaid(fmt.idr(deciding.total))}
              <strong>{deciding.event.title}</strong>
              {t.decideNotIssued(REFUND_REASON[deciding.refund.reason])}
            </p>
            <Field label={t.pct}>
              <Input type="number" min={0} max={100} value={form.pct} onChange={(e) => setForm({ ...form, pct: Math.max(0, Math.min(100, Number(e.target.value))) })} />
            </Field>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.refund_fee} onChange={(e) => setForm({ ...form, refund_fee: e.target.checked })} /> {t.refundFee}
            </label>
            <Field label={t.decisionNote} hint={d.common.auditHint}>
              <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline-ink" onClick={() => setDeciding(null)}>
                {d.common.cancel}
              </Button>
              <Button variant="ink" loading={busy} disabled={form.note.trim().length < 5} onClick={decide}>
                {t.refundBtn(fmt.idr(Math.floor((deciding.total * form.pct) / 100)))}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}

const PAYOUT_STATUS_TONE: Record<PayoutStatus, 'amber' | 'blue' | 'green' | 'red'> = {
  PENDING_APPROVAL: 'amber',
  REQUESTED: 'blue',
  PROCESSING: 'blue',
  COMPLETED: 'green',
  FAILED: 'red',
  REJECTED: 'red',
};

/** Antrean persetujuan payout (dual control §11.5): setujui / tolak oleh admin selain pemohon. */
function PayoutQueue() {
  const d = useDict('admin');
  const t = d.payouts;
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const canDecide = can(me, 'finance.payout');
  const [filter, setFilter] = useState<'' | PayoutStatus>('PENDING_APPROVAL');
  const [acting, setActing] = useState<{ row: AdminPayoutRow; kind: 'approve' | 'reject' | 'complete' } | null>(null);
  const [account, setAccount] = useState<{ id: string; bank: string; holder: string; number: string } | null>(null);
  async function reveal(r: AdminPayoutRow) {
    try {
      const a = await api<{ bank: string; holder: string; number: string }>(`/v1/admin/finance/payouts/${r.id}/reveal`, { body: {} });
      setAccount({ id: r.id, ...a });
    } catch (e) {
      toast.error(e);
    }
  }
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['admin-payouts', filter],
    queryFn: () => api<{ data: AdminPayoutRow[]; counts: Record<string, number>; threshold_idr: number; cooldown_hours: number; auto_complete: boolean }>('/v1/admin/finance/payouts', { query: { status: filter || undefined } }),
  });
  const mine = (r: AdminPayoutRow) => !!me && (r.requested_by === me.id || r.party_id === me.id || me.orgs.some((o) => o.id === r.party_id));
  async function submit() {
    if (!acting) return;
    setBusy(true);
    try {
      if (acting.kind === 'approve') await api(`/v1/admin/finance/payouts/${acting.row.id}/approve`, { body: { note: text.trim() || undefined } });
      else if (acting.kind === 'complete') await api(`/v1/admin/finance/payouts/${acting.row.id}/complete`, { body: { transfer_ref: text.trim() } });
      else await api(`/v1/admin/finance/payouts/${acting.row.id}/reject`, { body: { reason: text.trim() } });
      toast.success(acting.kind === 'approve' ? t.toastApproved : acting.kind === 'complete' ? t.toastCompleted : t.toastRejected);
      setAccount(null);
      qc.invalidateQueries({ queryKey: ['admin-payouts'] });
      qc.invalidateQueries({ queryKey: ['recon'] });
      setActing(null);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  const counts = q.data?.counts ?? {};
  const pending = counts.PENDING_APPROVAL ?? 0;
  return (
    <Card title={t.title} className="mt-6">
      {q.data && <p className="-mt-1 mb-4 text-sm text-b2b-muted">{t.rules(fmt.idr(q.data.threshold_idr), q.data.cooldown_hours)}</p>}
      <div className="mb-4 flex flex-wrap gap-2">
        {([['PENDING_APPROVAL', t.status.PENDING_APPROVAL], ['REQUESTED', t.status.REQUESTED], ['COMPLETED', t.status.COMPLETED], ['REJECTED', t.status.REJECTED], ['', t.all]] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={`rounded-none border px-3 py-1.5 text-xs font-bold ${filter === v ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted'}`}
          >
            {label}
            {v && counts[v] ? ` · ${counts[v]}` : ''}
          </button>
        ))}
        {pending > 0 && <span className="self-center text-xs font-bold text-amber-700">{t.needAction(pending)}</span>}
      </div>
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title={t.emptyTitle} body={t.emptyBody} /> : undefined}>
        <Table head={[...t.head]}>
          {q.data?.data.map((r) => {
            const held = r.status === 'REQUESTED' && r.hold_until && new Date(r.hold_until).getTime() > Date.now();
            const decidable = r.status === 'PENDING_APPROVAL' || r.status === 'REQUESTED';
            return (
              <tr key={r.id}>
                <td className="px-4 py-3">
                  <p className="font-bold">{r.bank.holder}</p>
                  <p className="text-xs text-b2b-muted">
                    {r.bank.bank} {r.bank.number} · <span className="font-mono">{r.party_id.slice(0, 8)}</span>
                  </p>
                  {r.bank_changed_at && <p className="mt-1 text-xs font-semibold text-amber-700">{t.bankChanged(fmt.dateTime(r.bank_changed_at))}</p>}
                  {r.decision_note && <p className="mt-1 text-xs text-b2b-muted italic">{r.decision_note}</p>}
                </td>
                <td className="px-4 py-3 font-bold tabular-nums">{fmt.idr(r.amount)}</td>
                <td className="px-4 py-3">
                  <Badge tone={PAYOUT_STATUS_TONE[r.status]}>{t.status[r.status]}</Badge>
                  {held && <span className="mt-1 block text-xs text-b2b-muted">{t.heldUntil(fmt.dateTime(r.hold_until!))}</span>}
                </td>
                <td className="px-4 py-3 text-xs whitespace-nowrap">{fmt.dateTime(r.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  {canDecide && decidable && (mine(r) ? (
                    <span className="text-xs text-b2b-muted">{t.selfNote}</span>
                  ) : (
                    <span className="inline-flex gap-2">
                      <Button size="sm" variant="outline-ink" onClick={() => { setText(''); setActing({ row: r, kind: 'reject' }); }}>
                        {d.common.reject}
                      </Button>
                      {r.status === 'PENDING_APPROVAL' && (
                        <Button size="sm" variant="ink" onClick={() => { setText(''); setActing({ row: r, kind: 'approve' }); }}>
                          {d.common.approve}
                        </Button>
                      )}
                      {r.status === 'REQUESTED' && !held && q.data && !q.data.auto_complete && (
                        <Button size="sm" variant="ink" onClick={() => { setText(''); setAccount(null); setActing({ row: r, kind: 'complete' }); }}>
                          {t.markTransferred}
                        </Button>
                      )}
                    </span>
                  ))}
                </td>
              </tr>
            );
          })}
        </Table>
      </QueryState>
      {acting && (
        <Modal open onClose={() => setActing(null)} title={acting.kind === 'approve' ? t.approveTitle : acting.kind === 'complete' ? t.completeTitle : t.rejectTitle}>
          <div className="space-y-4 text-sm">
            <p>
              <strong>{acting.row.bank.holder}</strong> — {t.confirmBody(fmt.idr(acting.row.amount), `${acting.row.bank.bank} ${acting.row.bank.number}`)}
            </p>
            {acting.kind === 'reject' && <p className="text-b2b-muted">{t.rejectBody}</p>}
            {acting.kind === 'complete' && (
              <div className="space-y-2 border border-b2b-line bg-b2b-bg p-3">
                <p className="text-b2b-muted">{t.completeBody}</p>
                {account?.id === acting.row.id ? (
                  <p className="font-mono text-base font-bold">
                    {account.bank} · {account.number} · {account.holder}
                  </p>
                ) : (
                  <Button size="sm" variant="outline-ink" onClick={() => reveal(acting.row)}>
                    {t.revealAccount}
                  </Button>
                )}
              </div>
            )}
            <Field label={acting.kind === 'approve' ? t.note : acting.kind === 'complete' ? t.transferRef : t.reason} hint={d.common.auditHint}>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline-ink" onClick={() => setActing(null)}>
                {d.common.cancel}
              </Button>
              <Button variant={acting.kind === 'reject' ? 'danger' : 'ink'} loading={busy} disabled={(acting.kind === 'reject' && text.trim().length < 5) || (acting.kind === 'complete' && text.trim().length < 4)} onClick={submit}>
                {acting.kind === 'approve' ? d.common.approve : acting.kind === 'complete' ? t.markTransferred : d.common.reject}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}

export function AdminFinance() {
  const t = useDict('admin').finance;
  const recon = useQuery({
    queryKey: ['recon'],
    queryFn: () => api<{ balanced: boolean; total_debit: number; total_credit: number; accounts: { account: string; balance: number }[]; last_run_at: string }>('/v1/admin/finance/reconciliation'),
  });
  const [account, setAccount] = useState('');
  const ledger = useQuery({ queryKey: ['ledger', account], queryFn: () => api<{ data: any[] }>('/v1/admin/finance/ledger', { query: { account: account || undefined } }) });
  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <QueryState q={recon}>
        {recon.data && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label={t.status} value={<span className={recon.data.balanced ? 'text-emerald-700' : 'text-red-600'}>{recon.data.balanced ? t.balanced : t.mismatch}</span>} hint={t.lastRun(fmt.dateTime(recon.data.last_run_at))} />
            <Stat label={t.totalDebit} value={fmt.idrShort(recon.data.total_debit)} />
            <Stat label={t.totalCredit} value={fmt.idrShort(recon.data.total_credit)} />
            <Stat label={t.accounts} value={recon.data.accounts.length} />
          </div>
        )}
      </QueryState>
      <PayoutQueue />
      <RefundQueue />
      <div className="mt-6 grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card title={t.balances}>
          <ul className="max-h-[520px] divide-y divide-b2b-line overflow-y-auto text-sm">
            {recon.data?.accounts.map((a) => (
              <li key={a.account}>
                <button onClick={() => setAccount(a.account === account ? '' : a.account)} className={`flex w-full justify-between gap-3 py-2 text-left hover:opacity-70 ${a.account === account ? 'font-extrabold' : ''}`}>
                  <span className="truncate font-mono text-xs">{a.account}</span>
                  <span className="shrink-0 tabular-nums">{fmt.idr(a.balance)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={account ? t.ledgerFor(account) : t.recentLedger}>
          <QueryState q={ledger} empty={ledger.data && !ledger.data.data.length ? <Empty title={t.noTx} /> : undefined}>
            <div className="space-y-3">
              {ledger.data?.data.map((tx: any) => (
                <div key={tx.id ?? tx.transaction_id} className="rounded-none border border-b2b-line p-3">
                  <div className="flex justify-between text-xs text-b2b-muted">
                    <span className="font-bold text-b2b-ink">{tx.kind ?? tx.type ?? tx.description}</span>
                    <span>{fmt.dateTime(tx.created_at)}</span>
                  </div>
                  {tx.reference_id && <p className="font-mono text-[11px] text-b2b-muted">{t.ref(tx.reference_id)}</p>}
                  <table className="mt-2 w-full text-xs">
                    <tbody>
                      {(tx.entries ?? tx.lines ?? []).map((e: any, i: number) => (
                        <tr key={i}>
                          <td className="py-0.5 font-mono">{e.account}</td>
                          <td className="w-28 text-right tabular-nums">{e.side === 'DEBIT' ? fmt.idr(e.amount) : ''}</td>
                          <td className="w-28 text-right tabular-nums">{e.side === 'CREDIT' ? fmt.idr(e.amount) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </QueryState>
        </Card>
      </div>
    </div>
  );
}

const MEMBER_TYPES: MemberType[] = ['FREE', 'INDIVIDUAL', 'STUDENT', 'DUO'];
const memberTone = (m: MemberType): 'neutral' | 'blue' | 'amber' | 'purple' => (m === 'FREE' ? 'neutral' : m === 'DUO' ? 'blue' : m === 'STUDENT' ? 'amber' : 'purple');

/** Badge jenis member (+ masa berlaku). Paket berbayar yang sudah lewat tanggalnya = efektif Free. */
function MemberBadge({ u }: { u: Me }) {
  const t = useDict('admin').users;
  const m = u.member_type ?? (u.premium ? 'INDIVIDUAL' : 'FREE');
  const expired = m !== 'FREE' && !!u.member_until && new Date(u.member_until).getTime() <= Date.now();
  return (
    <div className="flex flex-col items-start gap-0.5">
      <Badge tone={expired ? 'neutral' : memberTone(m)}>{t.member[m]}</Badge>
      {m !== 'FREE' && u.member_until && <span className={cx('text-[11px]', expired ? 'text-red-600' : 'text-b2b-muted')}>{expired ? t.expired : t.until(fmt.date(u.member_until))}</span>}
    </div>
  );
}

/** Super Admin: ubah jenis member (Free/Individu/Pelajar/Duo) + masa berlaku opsional; alasan wajib (audit). */
function MemberModal({ user, onClose }: { user: Me | null; onClose: () => void }) {
  const t = useDict('admin').users;
  const qc = useQueryClient();
  const [type, setType] = useState<MemberType>('FREE');
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  // Isi ulang form setiap kali modal dibuka untuk pengguna lain.
  if (user && opened !== user.id) {
    setOpened(user.id);
    setType(user.member_type ?? (user.premium ? 'INDIVIDUAL' : 'FREE'));
    setUntil(user.member_until ? user.member_until.slice(0, 10) : '');
    setReason('');
  }
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  async function save() {
    if (!user) return;
    setSaving(true);
    try {
      // Tanggal = akhir hari itu (WIB) agar "berlaku sampai 31 Des" mencakup seluruh tanggal tersebut.
      const member_until = type === 'FREE' || !until ? null : `${until}T23:59:59+07:00`;
      await api(`/v1/admin/iam/users/${user.id}`, { method: 'PATCH', body: { member_type: type, member_until, reason: reason.trim() } });
      toast.success(t.saved(user.display_name, t.member[type]));
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      setOpened(null);
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal open={!!user} onClose={() => { setOpened(null); onClose(); }} title={t.memberTitle}>
      {user && (
        <div className="space-y-4">
          <p className="text-sm">
            <strong>{user.display_name}</strong> <span className="text-b2b-muted">({user.email})</span>
          </p>
          <Field label={t.memberType}>
            <div role="radiogroup" aria-label={t.memberType} className="grid grid-cols-2 gap-2">
              {MEMBER_TYPES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={type === m}
                  onClick={() => setType(m)}
                  className={cx(
                    'border px-3 py-2.5 text-left text-sm font-bold transition',
                    type === m ? 'border-b2b-ink bg-b2b-ink text-white' : 'border-b2b-line bg-white hover:border-b2b-ink',
                  )}
                >
                  {t.member[m]}
                </button>
              ))}
            </div>
          </Field>
          {type !== 'FREE' && (
            <Field label={t.memberUntil} hint={t.memberUntilHint}>
              <Input type="date" min={tomorrow} value={until} onChange={(e) => setUntil(e.target.value)} className="max-w-xs" />
            </Field>
          )}
          <Field label={t.reason} hint={t.reasonHint}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.reasonPlaceholder} />
          </Field>
          <p className="text-xs text-b2b-muted">{t.memberNote}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline-ink" onClick={() => { setOpened(null); onClose(); }}>
              {t.cancel}
            </Button>
            <Button variant="ink" loading={saving} disabled={reason.trim().length < 5} onClick={save}>
              {t.save}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function AdminUsers() {
  const t = useDict('admin').users;
  const sup = isSuperAdmin(useAuth((s) => s.user));
  const [qstr, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [editing, setEditing] = useState<Me | null>(null);
  const q = useQuery({ queryKey: ['admin-users', applied], queryFn: () => api<{ data: Me[] }>('/v1/admin/iam/users', { query: { q: applied || undefined } }) });
  return (
    <div>
      <PageHeader title={t.title} />
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(qstr);
        }}
      >
        <Input value={qstr} onChange={(e) => setQ(e.target.value)} placeholder={t.searchPlaceholder} className="max-w-sm" />
        <Button variant="ink" type="submit">
          {t.search}
        </Button>
      </form>
      <QueryState q={q}>
        <Table head={sup ? [...t.head] : t.head.slice(0, -1)}>
          {q.data?.data.map((u) => (
            <tr key={u.id}>
              <td className="px-4 py-3 font-bold">{u.display_name}</td>
              <td className="px-4 py-3">{u.email}</td>
              <td className="px-4 py-3">
                <MemberBadge u={u} />
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {u.roles.map((r) => (
                    <Badge key={r}>{r}</Badge>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3 text-xs">{u.orgs?.map((o) => `${o.name} (${o.role})`).join(', ') || '—'}</td>
              <td className="px-4 py-3">
                <Badge tone={u.kyc_status === 'VERIFIED' ? 'green' : u.kyc_status === 'PENDING' ? 'amber' : 'neutral'}>{u.kyc_status}</Badge>
              </td>
              <td className="px-4 py-3">{fmt.date(u.created_at)}</td>
              {sup && (
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <Button size="sm" variant="outline-ink" onClick={() => setEditing(u)}>
                    {t.editMember}
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </Table>
      </QueryState>
      <MemberModal user={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

export function AdminAudit() {
  const t = useDict('admin').audit;
  const q = useQuery({ queryKey: ['audit'], queryFn: () => api<{ data: any[] }>('/v1/admin/iam/audit-logs') });
  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title={t.empty} /> : undefined}>
        <Table head={[...t.head]}>
          {q.data?.data.map((l) => (
            <tr key={l.id} className="align-top">
              <td className="px-4 py-2.5 whitespace-nowrap">{fmt.dateTime(l.created_at)}</td>
              <td className="px-4 py-2.5 font-mono text-xs">{l.actor_id ? String(l.actor_id).slice(0, 8) + '…' : 'system'}</td>
              <td className="px-4 py-2.5 font-semibold">{l.action}</td>
              <td className="px-4 py-2.5 text-xs">
                {l.entity}
                {l.entity_id && <span className="block font-mono text-b2b-muted">{String(l.entity_id).slice(0, 13)}</span>}
              </td>
              <td className="max-w-md truncate px-4 py-2.5 font-mono text-[11px] text-b2b-muted" title={l.data ? JSON.stringify(l.data) : ''}>
                {l.data ? JSON.stringify(l.data) : '—'}
              </td>
            </tr>
          ))}
        </Table>
      </QueryState>
    </div>
  );
}
