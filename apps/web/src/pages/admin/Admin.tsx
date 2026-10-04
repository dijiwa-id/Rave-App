import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Disc3, FileClock, Gavel, IdCard, LayoutDashboard, Scale, Users } from 'lucide-react';
import { B2BLayout, type B2BNavItem } from '@/layouts/B2BLayout';
import { api, fmt } from '@/lib/api';
import type { Dispute, Me, Release } from '@/lib/types';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Stat, Textarea, toast } from '@/components/ui';
import { Empty, QueryState, Table } from '@/components/b2b/common';
import { ReleaseStatusBadge } from '../studio/Releases';

const NAV: B2BNavItem[] = [
  { to: '/admin', label: 'Dasbor', icon: LayoutDashboard, end: true },
  { to: '/admin/qc', label: 'Antrean QC', icon: Disc3 },
  { to: '/admin/kyc', label: 'KYC', icon: IdCard },
  { to: '/admin/disputes', label: 'Dispute', icon: Gavel },
  { to: '/admin/finance', label: 'Finance & Rekonsiliasi', icon: Scale },
  { to: '/admin/users', label: 'Pengguna & Org', icon: Users },
  { to: '/admin/audit', label: 'Audit Log', icon: FileClock },
];

export function AdminLayout() {
  return <B2BLayout product="Back Office" accent="#7c3aed" nav={NAV} />;
}

export function AdminDashboard() {
  const status = useQuery({ queryKey: ['status'], queryFn: () => api<{ ok: boolean; services: { service: string; ok: boolean; ms: number }[] }>('/v1/status'), refetchInterval: 10_000 });
  const qc = useQuery({ queryKey: ['qc', 'IN_REVIEW'], queryFn: () => api<{ data: Release[] }>('/v1/admin/qc/releases', { query: { status: 'IN_REVIEW' } }) });
  const kyc = useQuery({ queryKey: ['admin-kyc', 'PENDING'], queryFn: () => api<{ data: any[] }>('/v1/admin/iam/kyc', { query: { status: 'PENDING' } }) });
  const disputes = useQuery({ queryKey: ['admin-disputes'], queryFn: () => api<{ data: Dispute[] }>('/v1/admin/disputes') });
  const recon = useQuery({ queryKey: ['recon'], queryFn: () => api<{ balanced: boolean }>('/v1/admin/finance/reconciliation') });
  return (
    <div>
      <PageHeader title="Back Office" subtitle="Operasional GEMA: moderasi, KYC, dispute, dan rekonsiliasi." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Link to="/admin/qc">
          <Stat label="Rilis menunggu QC" value={qc.data?.data.length ?? '—'} />
        </Link>
        <Link to="/admin/kyc">
          <Stat label="KYC menunggu" value={kyc.data?.data.length ?? '—'} />
        </Link>
        <Link to="/admin/disputes">
          <Stat label="Dispute terbuka" value={disputes.data?.data.filter((d) => d.status === 'OPEN').length ?? '—'} />
        </Link>
        <Link to="/admin/finance">
          <Stat label="Ledger" value={recon.data ? (recon.data.balanced ? 'Seimbang' : 'SELISIH') : '—'} />
        </Link>
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

export function AdminQc() {
  const [status, setStatus] = useState('IN_REVIEW');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['qc', status], queryFn: () => api<{ data: Release[] }>('/v1/admin/qc/releases', { query: { status } }) });
  const [reject, setReject] = useState<Release | null>(null);
  const [reason, setReason] = useState('');
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
            {['IN_REVIEW', 'SCHEDULED', 'LIVE', 'REJECTED'].map((s) => (
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
