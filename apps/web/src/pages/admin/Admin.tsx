import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowRight, Radio, DatabaseBackup, Disc3, FileClock, Gauge, Gavel, HardDrive, IdCard, KeyRound, LayoutDashboard, Megaphone, Scale, ShieldCheck, SlidersHorizontal, Users, Workflow } from 'lucide-react';
import { ADMIN_ROLE_LABEL, type AdminPermission, type AdminRole } from '@gema/domain/settings';
import { can, isSuperAdmin, useAuth } from '@/stores/auth';
import { B2BLayout, type B2BNavItem } from '@/layouts/B2BLayout';
import { api, fmt } from '@/lib/api';
import type { AdminRefundRow, Dispute, Me, Release, TicketRefundReason } from '@/lib/types';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Stat, Textarea, toast } from '@/components/ui';
import { Empty, QueryState, Table } from '@/components/b2b/common';
import { ReleaseStatusBadge } from '../studio/Releases';

type AdminNavItem = B2BNavItem & { perms?: AdminPermission[]; superOnly?: boolean };

// Menu mengikuti izin peran ("Peran & Akses"); halaman & API menegakkan hal yang sama.
const NAV: AdminNavItem[] = [
  { to: '/admin', label: 'Dasbor', icon: LayoutDashboard, end: true },
  { to: '/admin/qc', label: 'Antrean QC', icon: Disc3, perms: ['qc.review'] },
  { to: '/admin/kyc', label: 'KYC', icon: IdCard, perms: ['kyc.review'] },
  { to: '/admin/disputes', label: 'Dispute', icon: Gavel, perms: ['dispute.resolve'] },
  { to: '/admin/live', label: 'Live Streaming', icon: Radio, perms: ['live.moderate'] },
  { to: '/admin/finance', label: 'Finance & Rekonsiliasi', icon: Scale, perms: ['finance.view', 'finance.refund'] },
  { to: '/admin/users', label: 'Pengguna & Org', icon: Users, perms: ['users.view'] },
  { to: '/admin/audit', label: 'Audit Log', icon: FileClock, perms: ['audit.view'] },
  { to: '/admin/ads', label: 'Iklan', icon: Megaphone, perms: ['ads.manage', 'ads.review'] },
  // Platform (docs/API.md §9) — khusus Super Admin, termasuk membaca.
  { to: '/admin/platform', label: 'Dasbor Platform', icon: Gauge, end: true, section: 'Platform', superOnly: true },
  { to: '/admin/platform/settings', label: 'Pengaturan', icon: SlidersHorizontal, superOnly: true },
  { to: '/admin/platform/roles', label: 'Peran & Akses', icon: KeyRound, superOnly: true },
  { to: '/admin/platform/admins', label: 'Tim Admin', icon: ShieldCheck, superOnly: true },
  { to: '/admin/platform/storage', label: 'Storage', icon: HardDrive, superOnly: true },
  { to: '/admin/platform/backups', label: 'Backup', icon: DatabaseBackup, superOnly: true },
  { to: '/admin/platform/bus', label: 'Event Bus', icon: Workflow, superOnly: true },
];

export function AdminLayout() {
  const user = useAuth((s) => s.user);
  const sup = isSuperAdmin(user);
  const role = user?.admin_role as AdminRole | null | undefined;
  return (
    <B2BLayout
      product={sup ? 'Super Admin' : 'Back Office'}
      accent="#7c3aed"
      nav={NAV.filter((n) => (n.superOnly ? sup : !n.perms || can(user, ...n.perms)))}
      roleLabel={(role && ADMIN_ROLE_LABEL[role]) ?? (sup ? 'Super Admin' : 'Admin')}
    />
  );
}

export function AdminDashboard() {
  const user = useAuth((s) => s.user);
  const sup = isSuperAdmin(user);
  // Kartu hanya untuk area yang boleh dibuka peran ini (tanpa memanggil API yang pasti ditolak).
  const show = { qc: can(user, 'qc.review'), kyc: can(user, 'kyc.review'), disputes: can(user, 'dispute.resolve'), finance: can(user, 'finance.view') };
  const status = useQuery({ queryKey: ['status'], queryFn: () => api<{ ok: boolean; services: { service: string; ok: boolean; ms: number }[] }>('/v1/status'), refetchInterval: 10_000 });
  const qc = useQuery({ queryKey: ['qc', 'IN_REVIEW'], enabled: show.qc, queryFn: () => api<{ data: Release[] }>('/v1/admin/qc/releases', { query: { status: 'IN_REVIEW' } }) });
  const kyc = useQuery({ queryKey: ['admin-kyc', 'PENDING'], enabled: show.kyc, queryFn: () => api<{ data: any[] }>('/v1/admin/iam/kyc', { query: { status: 'PENDING' } }) });
  const disputes = useQuery({ queryKey: ['admin-disputes'], enabled: show.disputes, queryFn: () => api<{ data: Dispute[] }>('/v1/admin/disputes') });
  const recon = useQuery({ queryKey: ['recon'], enabled: show.finance, queryFn: () => api<{ balanced: boolean }>('/v1/admin/finance/reconciliation') });
  return (
    <div>
      <PageHeader
        title="Back Office"
        subtitle="Operasional GEMA: moderasi, KYC, dispute, dan rekonsiliasi."
        actions={
          sup && (
          <Link to="/admin/platform" className="inline-flex h-8 items-center gap-2 rounded-full border border-b2b-line bg-b2b-card px-4 text-sm font-bold text-b2b-ink transition hover:border-b2b-ink">
            <Gauge className="size-4" /> Dasbor Platform <ArrowRight className="size-4" />
          </Link>
          )
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {show.qc && (
          <Link to="/admin/qc">
            <Stat label="Rilis menunggu QC" value={qc.data?.data.length ?? '—'} />
          </Link>
        )}
        {show.kyc && (
          <Link to="/admin/kyc">
            <Stat label="KYC menunggu" value={kyc.data?.data.length ?? '—'} />
          </Link>
        )}
        {show.disputes && (
          <Link to="/admin/disputes">
            <Stat label="Dispute terbuka" value={disputes.data?.data.filter((d) => d.status === 'OPEN').length ?? '—'} />
          </Link>
        )}
        {show.finance && (
          <Link to="/admin/finance">
            <Stat label="Ledger" value={recon.data ? (recon.data.balanced ? 'Seimbang' : 'SELISIH') : '—'} />
          </Link>
        )}
      </div>
      <Card className="mt-6" title={<span className="flex items-center gap-2"><Activity className="size-4" /> Kesehatan layanan</span>} action={status.data && <Badge tone={status.data.ok ? 'green' : 'red'}>{status.data.ok ? 'Semua normal' : 'Ada gangguan'}</Badge>}>
        <QueryState q={status}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {status.data?.services.map((s) => (
              <div key={s.service} className="flex items-center justify-between rounded-lg border border-b2b-line p-3">
                <span className="text-sm font-bold">{s.service}</span>
                <span className={`flex items-center gap-1.5 text-xs font-semibold ${s.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                  <span className={`size-2 rounded-full ${s.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  {s.ok ? `${s.ms} ms` : 'down'}
                </span>
              </div>
            ))}
          </div>
        </QueryState>
      </Card>
    </div>
  );
}

type QcSignal = { title: string; isrc: string | null; duplicate_release_id: string; duplicate_title: string };

export function AdminQc() {
  const [status, setStatus] = useState('IN_REVIEW');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['qc', status], queryFn: () => api<{ data: Release[] }>('/v1/admin/qc/releases', { query: { status } }) });
  const [reject, setReject] = useState<Release | null>(null);
  const [takedown, setTakedown] = useState<Release | null>(null);
  const [reason, setReason] = useState('');
  async function takeDown(id: string, why: string) {
    try {
      await api(`/v1/admin/qc/releases/${id}/takedown`, { body: { reason: why } });
      toast.success('Rilis diturunkan dari katalog');
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
      toast.success(approve ? 'Rilis disetujui' : 'Rilis ditolak');
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
        title="Antrean QC Rilis"
        subtitle="Periksa duplikasi/pelanggaran hak (fingerprint), artwork tidak layak, dan metadata menyesatkan."
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
            {['IN_REVIEW', 'SCHEDULED', 'LIVE', 'REJECTED', 'TAKEN_DOWN'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        }
      />
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title="Antrean kosong" /> : undefined}>
        <div className="space-y-4">
          {q.data?.data.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap gap-5">
                {r.cover_url ? <img src={r.cover_url} alt="" className="size-28 rounded-lg object-cover" /> : <div className="size-28 rounded-lg bg-b2b-bg" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-extrabold">{r.title}</p>
                    <ReleaseStatusBadge status={r.status} />
                    {r.explicit && <Badge>E</Badge>}
                  </div>
                  <p className="text-sm text-b2b-muted">
                    {r.artist.name} · {r.type} · {r.genre} · {r.label ?? 'Mandiri'} · rilis {fmt.date(r.release_date)}
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
                  {!!(r as Release & { qc_signals?: QcSignal[] }).qc_signals?.length && (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                      <p className="font-bold">Sinyal duplikasi:</p>
                      {(r as Release & { qc_signals: QcSignal[] }).qc_signals.map((x, i) => (
                        <p key={i}>
                          “{x.title}”{x.isrc ? ` (${x.isrc})` : ''} mirip dengan rilis “{x.duplicate_title}”
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                {r.status === 'IN_REVIEW' && (
                  <div className="flex flex-col gap-2">
                    <Button variant="ink" size="sm" onClick={() => decide(r.id, true)}>
                      Setujui
                    </Button>
                    <Button variant="outline-ink" size="sm" onClick={() => setReject(r)}>
                      Tolak
                    </Button>
                  </div>
                )}
                {(r.status === 'LIVE' || r.status === 'SCHEDULED') && (
                  <div>
                    <Button variant="outline-ink" size="sm" onClick={() => setTakedown(r)}>
                      Turunkan (takedown)
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      </QueryState>
      <Modal open={!!reject} onClose={() => setReject(null)} title={`Tolak “${reject?.title}”`}>
        <Field label="Alasan (dikirim ke artis)">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. Artwork memuat logo pihak ketiga tanpa izin" />
        </Field>
        <Button variant="danger" className="mt-3" disabled={!reason.trim()} onClick={() => decide(reject!.id, false, reason)}>
          Tolak rilis
        </Button>
      </Modal>
      <Modal open={!!takedown} onClose={() => setTakedown(null)} title={`Turunkan “${takedown?.title}”`}>
        <p className="mb-3 text-sm text-b2b-muted">Rilis langsung hilang dari katalog & pencarian. Tindakan tercatat di audit log.</p>
        <Field label="Alasan takedown (min. 3 karakter, dikirim ke artis)">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. Klaim hak cipta dari pemegang master" />
        </Field>
        <Button variant="danger" className="mt-3" disabled={reason.trim().length < 3} onClick={() => takeDown(takedown!.id, reason.trim())}>
          Turunkan rilis
        </Button>
      </Modal>
    </div>
  );
}

export function AdminKyc() {
  const [status, setStatus] = useState('PENDING');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-kyc', status], queryFn: () => api<{ data: any[] }>('/v1/admin/iam/kyc', { query: { status } }) });
  async function decide(id: string, approve: boolean) {
    const reason = approve ? undefined : prompt('Alasan penolakan?') ?? undefined;
    if (!approve && !reason) return;
    try {
      await api(`/v1/admin/iam/kyc/${id}/decision`, { body: { approve, reason } });
      toast.success(approve ? 'KYC disetujui' : 'KYC ditolak');
      qc.invalidateQueries({ queryKey: ['admin-kyc'] });
    } catch (e) {
      toast.error(e);
    }
  }
  return (
    <div>
      <PageHeader
        title="Verifikasi KYC/KYB"
        subtitle="Wajib sebelum menerima pembayaran atau mengirim offer. Data identitas dimasking; akses tercatat di audit log."
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            {['PENDING', 'VERIFIED', 'REJECTED'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        }
      />
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title="Tidak ada pengajuan" /> : undefined}>
        <Table head={['Nama', 'Level', 'NIK', 'Badan usaha', 'Diajukan', 'Status', '']}>
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
                      Setujui
                    </Button>
                    <Button size="sm" variant="outline-ink" onClick={() => decide(k.id, false)}>
                      Tolak
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
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-disputes'], queryFn: () => api<{ data: Dispute[] }>('/v1/admin/disputes') });
  const [sel, setSel] = useState<Dispute | null>(null);
  const [outcome, setOutcome] = useState<'RELEASE_TO_ARTIST' | 'REFUND_PROMOTOR'>('RELEASE_TO_ARTIST');
  const [note, setNote] = useState('');
  async function resolve() {
    try {
      await api(`/v1/admin/disputes/${sel!.id}/resolve`, { body: { outcome, note } });
      toast.success('Keputusan mediasi tersimpan');
      setSel(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['admin-disputes'] });
    } catch (e) {
      toast.error(e);
    }
  }
  return (
    <div>
      <PageHeader title="Dispute Center" subtitle="Dana dibekukan selama mediasi. SLA keputusan maksimal 14 hari kerja." />
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title="Tidak ada dispute" /> : undefined}>
        <Table head={['Diajukan', 'Booking', 'Oleh', 'Alasan', 'Status', '']}>
          {q.data?.data.map((d) => (
            <tr key={d.id}>
              <td className="px-4 py-3 whitespace-nowrap">{fmt.dateTime(d.created_at)}</td>
              <td className="px-4 py-3 font-mono text-xs">{d.booking_id.slice(0, 8)}…</td>
              <td className="px-4 py-3">{d.by_party}</td>
              <td className="max-w-sm px-4 py-3">{d.reason}</td>
              <td className="px-4 py-3">
                <Badge tone={d.status === 'OPEN' ? 'red' : 'neutral'}>{d.status}</Badge>
                {d.outcome && <p className="mt-1 text-xs text-b2b-muted">{d.outcome}</p>}
              </td>
              <td className="px-4 py-3 text-right">
                {d.status === 'OPEN' && (
                  <Button size="sm" variant="ink" onClick={() => setSel(d)}>
                    Putuskan
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </QueryState>
      <Modal open={!!sel} onClose={() => setSel(null)} title="Keputusan mediasi">
        <p className="mb-3 text-sm text-b2b-muted">{sel?.reason}</p>
        <Field label="Keputusan">
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
            <option value="RELEASE_TO_ARTIST">Cairkan dana ke artis</option>
            <option value="REFUND_PROMOTOR">Refund ke promotor</option>
          </Select>
        </Field>
        <div className="mt-3">
          <Field label="Catatan keputusan">
            <Textarea required value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <Button variant="ink" className="mt-3" disabled={!note.trim()} onClick={resolve}>
          Simpan keputusan
        </Button>
      </Modal>
    </div>
  );
}

const REFUND_REASON: Record<TicketRefundReason, string> = {
  event_cancelled: 'Event dibatalkan',
  rescheduled: 'Jadwal berubah',
  buyer_request: 'Permintaan pembeli',
  late_payment: 'Bayar terlambat',
  admin: 'Keputusan admin',
};
const REFUND_STATUS: Record<AdminRefundRow['refund']['status'], { label: string; tone: 'amber' | 'red' | 'blue' | 'green' }> = {
  REVIEW: { label: 'Perlu keputusan', tone: 'amber' },
  FAILED: { label: 'Gagal', tone: 'red' },
  PENDING: { label: 'Diproses', tone: 'blue' },
  COMPLETED: { label: 'Selesai', tone: 'green' },
};

/** Antrean refund tiket: pembayaran terlambat yang menunggu keputusan (REVIEW) & refund gagal di atas. */
function RefundQueue() {
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
      toast.success('Refund dikirim ulang ke penyedia pembayaran');
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
      toast.success('Refund ditandai selesai (transfer manual)');
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
      toast.success('Refund diajukan ke finance');
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
    <Card title="Refund tiket" className="mt-6">
      <div className="mb-4 flex flex-wrap gap-2">
        {([['', 'Semua'], ['REVIEW', 'Perlu keputusan'], ['FAILED', 'Gagal'], ['PENDING', 'Diproses'], ['COMPLETED', 'Selesai']] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${filter === v ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted'}`}
          >
            {label}
            {v && counts[v] ? ` · ${counts[v]}` : ''}
          </button>
        ))}
        {urgent > 0 && <span className="self-center text-xs font-bold text-red-600">{urgent} butuh tindakan</span>}
      </div>
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title="Tidak ada refund" body="Refund dari pembatalan event, perubahan jadwal, permintaan pembeli, dan pembayaran terlambat muncul di sini." /> : undefined}>
        <Table head={['Pembeli & event', 'Alasan', 'Nominal', 'Status', 'Diajukan', '']}>
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
                <span className="block text-xs text-b2b-muted">dari {fmt.idr(r.total)}</span>
              </td>
              <td className="px-4 py-3">
                <Badge tone={REFUND_STATUS[r.refund.status].tone}>{REFUND_STATUS[r.refund.status].label}</Badge>
              </td>
              <td className="px-4 py-3 text-xs whitespace-nowrap">{r.refund.requested_at ? fmt.dateTime(r.refund.requested_at) : '—'}</td>
              <td className="px-4 py-3 text-right">
                {canRefund && r.refund.status === 'FAILED' && (
                  <span className="inline-flex gap-2">
                    <Button size="sm" variant="outline-ink" onClick={() => retry(r)}>
                      Kirim ulang
                    </Button>
                    <Button
                      size="sm"
                      variant="ink"
                      onClick={() => {
                        setMform({ transfer_ref: '', note: '' });
                        setManual(r);
                      }}
                    >
                      Selesaikan manual
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
                    Putuskan
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </QueryState>
      {manual && (
        <Modal open onClose={() => setManual(null)} title="Selesaikan refund manual">
          <div className="space-y-4 text-sm">
            <p>
              Gunakan bila penyedia pembayaran tidak dapat mengembalikan dana ke metode asal. Transfer {manual.refund.amount !== null ? fmt.idr(manual.refund.amount) : 'dana'} ke rekening{' '}
              <strong>{manual.holder_name}</strong> terlebih dahulu, lalu catat buktinya di sini.
            </p>
            {manual.note && <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs">Penyebab gagal: {manual.note}</p>}
            <Field label="Nomor / bukti transfer">
              <Input value={mform.transfer_ref} onChange={(e) => setMform({ ...mform, transfer_ref: e.target.value })} placeholder="Mis. BCA 2026100512345" />
            </Field>
            <Field label="Catatan" hint="Tercatat di audit log">
              <Textarea value={mform.note} onChange={(e) => setMform({ ...mform, note: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline-ink" onClick={() => setManual(null)}>
                Batal
              </Button>
              <Button variant="ink" loading={busy} disabled={mform.transfer_ref.trim().length < 4 || mform.note.trim().length < 5} onClick={completeManual}>
                Tandai selesai
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {deciding && (
        <Modal open onClose={() => setDeciding(null)} title="Putuskan refund">
          <div className="space-y-4 text-sm">
            <p>
              <strong>{deciding.holder_name}</strong> membayar {fmt.idr(deciding.total)} untuk <strong>{deciding.event.title}</strong>, tetapi tiket tidak dapat diterbitkan ({REFUND_REASON[deciding.refund.reason]}).
            </p>
            <Field label="Persentase dikembalikan (%)">
              <Input type="number" min={0} max={100} value={form.pct} onChange={(e) => setForm({ ...form, pct: Math.max(0, Math.min(100, Number(e.target.value))) })} />
            </Field>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.refund_fee} onChange={(e) => setForm({ ...form, refund_fee: e.target.checked })} /> Kembalikan biaya layanan
            </label>
            <Field label="Catatan keputusan" hint="Tercatat di audit log">
              <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline-ink" onClick={() => setDeciding(null)}>
                Batal
              </Button>
              <Button variant="ink" loading={busy} disabled={form.note.trim().length < 5} onClick={decide}>
                Refund {fmt.idr(Math.floor((deciding.total * form.pct) / 100))}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}

export function AdminFinance() {
  const recon = useQuery({
    queryKey: ['recon'],
    queryFn: () => api<{ balanced: boolean; total_debit: number; total_credit: number; accounts: { account: string; balance: number }[]; last_run_at: string }>('/v1/admin/finance/reconciliation'),
  });
  const [account, setAccount] = useState('');
  const ledger = useQuery({ queryKey: ['ledger', account], queryFn: () => api<{ data: any[] }>('/v1/admin/finance/ledger', { query: { account: account || undefined } }) });
  return (
    <div>
      <PageHeader title="Finance & Rekonsiliasi" subtitle="Ledger double-entry append-only. Selisih dengan laporan PG/mutasi bank memicu alert ke Finance." />
      <QueryState q={recon}>
        {recon.data && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Status" value={<span className={recon.data.balanced ? 'text-emerald-700' : 'text-red-600'}>{recon.data.balanced ? 'Seimbang' : 'Selisih'}</span>} hint={`run ${fmt.dateTime(recon.data.last_run_at)}`} />
            <Stat label="Total debit" value={fmt.idrShort(recon.data.total_debit)} />
            <Stat label="Total kredit" value={fmt.idrShort(recon.data.total_credit)} />
            <Stat label="Akun" value={recon.data.accounts.length} />
          </div>
        )}
      </QueryState>
      <RefundQueue />
      <div className="mt-6 grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card title="Saldo per akun">
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
        <Card title={account ? `Ledger · ${account}` : 'Transaksi ledger terbaru'}>
          <QueryState q={ledger} empty={ledger.data && !ledger.data.data.length ? <Empty title="Belum ada transaksi" /> : undefined}>
            <div className="space-y-3">
              {ledger.data?.data.map((t: any) => (
                <div key={t.id ?? t.transaction_id} className="rounded-lg border border-b2b-line p-3">
                  <div className="flex justify-between text-xs text-b2b-muted">
                    <span className="font-bold text-b2b-ink">{t.kind ?? t.type ?? t.description}</span>
                    <span>{fmt.dateTime(t.created_at)}</span>
                  </div>
                  {t.reference_id && <p className="font-mono text-[11px] text-b2b-muted">ref {t.reference_id}</p>}
                  <table className="mt-2 w-full text-xs">
                    <tbody>
                      {(t.entries ?? t.lines ?? []).map((e: any, i: number) => (
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

export function AdminUsers() {
  const [qstr, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const q = useQuery({ queryKey: ['admin-users', applied], queryFn: () => api<{ data: Me[] }>('/v1/admin/iam/users', { query: { q: applied || undefined } }) });
  return (
    <div>
      <PageHeader title="Pengguna & Organisasi" />
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(qstr);
        }}
      >
        <Input value={qstr} onChange={(e) => setQ(e.target.value)} placeholder="Cari email / nama" className="max-w-sm" />
        <Button variant="ink" type="submit">
          Cari
        </Button>
      </form>
      <QueryState q={q}>
        <Table head={['Nama', 'Email', 'Peran', 'Organisasi', 'KYC', 'Bergabung']}>
          {q.data?.data.map((u) => (
            <tr key={u.id}>
              <td className="px-4 py-3 font-bold">{u.display_name}</td>
              <td className="px-4 py-3">{u.email}</td>
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
            </tr>
          ))}
        </Table>
      </QueryState>
    </div>
  );
}

export function AdminAudit() {
  const q = useQuery({ queryKey: ['audit'], queryFn: () => api<{ data: any[] }>('/v1/admin/iam/audit-logs') });
  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Append-only; tidak dapat diubah. Produksi: dikirim ke storage WORM, retensi ≥ 10 tahun." />
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title="Belum ada log" /> : undefined}>
        <Table head={['Waktu', 'Aktor', 'Aksi', 'Entitas', 'Data']}>
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
