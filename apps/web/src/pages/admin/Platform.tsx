import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, CircleAlert, Database, HardDrive, Info, RefreshCw, Server, Trash2, UserPlus, Workflow } from 'lucide-react';
import { ADMIN_ROLES, ADMIN_ROLE_LABEL, type AdminRole } from '@gema/domain/settings';
import { api, ApiError, fmt } from '@/lib/api';
import type { AdminUser, BusOverview, DeadLetter, Me, PlatformOverview } from '@/lib/types';
import { isSuperAdmin, useAuth } from '@/stores/auth';
import { Badge, Button, Card, cx, Field, Input, Modal, PageHeader, Select, Stat, Textarea, toast, type ButtonProps } from '@/components/ui';
import { Empty, QueryState, Table } from '@/components/b2b/common';

// Super Admin (docs/API.md §9): dasbor platform, event bus, tim admin. Pengaturan & storage di file terpisah.
// Semua admin boleh membaca; aksi tulis hanya Super Admin (tombol dinonaktifkan + catatan untuk admin lain).

// ---------- Helper bersama halaman platform ----------
export function fmtBytes(n: number | null | undefined, digits = 1) {
  if (n == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString('id-ID', { maximumFractionDigits: i === 0 ? 0 : digits })} ${units[i]}`;
}

export function fmtUptime(s: number | null | undefined) {
  if (s == null) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d} hr ${h} j` : h ? `${h} j ${m} mnt` : `${m} mnt`;
}

export const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`);

export function useIsSuperAdmin() {
  return isSuperAdmin(useAuth((s) => s.user));
}

/** Bar pemakaian; kuning mendekati ambang, merah di atas ambang. */
export function UsageBar({ value, warn = 85, label, critical }: { value: number | null | undefined; warn?: number; label?: string; critical?: boolean }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const over = critical ?? v >= warn;
  const tone = over ? 'bg-red-500' : v >= warn - 10 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div>
      {label && (
        <div className="mb-1 flex justify-between text-xs">
          <span className="font-semibold text-b2b-muted">{label}</span>
          <span className={cx('font-bold tabular-nums', over ? 'text-red-600' : 'text-b2b-ink')}>{pct(value)}</span>
        </div>
      )}
      <div className="relative h-2.5 rounded-full bg-b2b-bg" role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? 'Pemakaian'}>
        <div className={cx('h-2.5 rounded-full transition-all', tone)} style={{ width: `${Math.max(1, v)}%` }} />
        <span className="absolute -top-0.5 h-3.5 w-0.5 rounded bg-b2b-ink/40" style={{ left: `${warn}%` }} title={`Ambang ${warn}%`} />
      </div>
    </div>
  );
}

/** Tombol aksi tulis: untuk admin non-Super Admin dirender nonaktif dengan tooltip. */
export function WriteButton(props: ButtonProps) {
  const sup = useIsSuperAdmin();
  if (sup) return <Button {...props} />;
  return (
    <span title="Hanya Super Admin" className="inline-flex cursor-not-allowed">
      <Button {...props} onClick={undefined} disabled />
    </span>
  );
}

export function ReadOnlyNote({ children }: { children?: ReactNode }) {
  const sup = useIsSuperAdmin();
  if (sup) return null;
  return (
    <p className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800">
      <Info className="size-4 shrink-0" />
      {children ?? 'Mode baca. Hanya Super Admin yang dapat melakukan perubahan di halaman ini.'}
    </p>
  );
}

/** Unduh file berotorisasi (Bearer) lewat fetch → blob → object URL. */
export async function downloadAuthed(path: string, filename?: string) {
  const res = await api<Response>(path, { raw: true });
  if (!res.ok) {
    const text = await res.text();
    let problem: Record<string, unknown>;
    try {
      problem = JSON.parse(text);
    } catch {
      problem = { detail: text || res.statusText };
    }
    throw new ApiError(res.status, problem);
  }
  const cd = res.headers.get('content-disposition') ?? '';
  const fromHeader = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1];
  const name = filename ?? (fromHeader ? decodeURIComponent(fromHeader) : path.split('/').filter(Boolean).slice(-2, -1)[0] ?? 'unduhan');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ALERT_TONE = {
  info: 'border-blue-500/30 bg-blue-500/10 text-blue-800',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-800',
  critical: 'border-red-500/30 bg-red-500/10 text-red-700',
} as const;

function AlertLink({ href, children, className }: { href: string | null; children: ReactNode; className: string }) {
  if (!href) return <div className={className}>{children}</div>;
  if (href.startsWith('/'))
    return (
      <Link to={href} className={className}>
        {children}
      </Link>
    );
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}

// ---------- /admin/platform ----------
export function PlatformDashboard() {
  const q = useQuery({ queryKey: ['platform-overview'], queryFn: () => api<PlatformOverview>('/v1/admin/platform/overview'), refetchInterval: 15_000 });
  const o = q.data;
  const k = o?.kpis;
  return (
    <div>
      <PageHeader
        title="Dasbor Platform"
        subtitle={o ? `Ringkasan seluruh layanan GEMA · diperbarui ${fmt.dateTime(o.generated_at)} (otomatis tiap 15 detik)` : 'Ringkasan seluruh layanan GEMA.'}
        actions={
          o && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={o.maintenance ? 'amber' : 'green'}>{o.maintenance ? 'Mode pemeliharaan AKTIF' : 'Operasional normal'}</Badge>
              <Link to="/admin/platform/settings">
                <Badge tone="neutral">Pengaturan v{o.settings_version}</Badge>
              </Link>
            </div>
          )
        }
      />
      <QueryState q={q}>
        {o && k && (
          <>
            {o.alerts.length > 0 && (
              <ul className="mb-6 space-y-2">
                {o.alerts.map((a, i) => (
                  <li key={i}>
                    <AlertLink href={a.href} className={cx('flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm font-semibold', ALERT_TONE[a.level] ?? ALERT_TONE.info, a.href && 'hover:opacity-80')}>
                      {a.level === 'info' ? <Info className="size-4 shrink-0" /> : a.level === 'warning' ? <AlertTriangle className="size-4 shrink-0" /> : <CircleAlert className="size-4 shrink-0" />}
                      <span className="flex-1">{a.message}</span>
                      {a.href && <span className="text-xs font-bold underline">Lihat</span>}
                    </AlertLink>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="Pengguna" value={fmt.num(k.users_total)} hint={`+${fmt.num(k.users_7d)} dalam 7 hari`} />
              <Stat label="Artis" value={fmt.num(k.artists)} hint={`${fmt.num(k.orgs)} organisasi`} />
              <Stat label="Lagu live" value={fmt.num(k.tracks_live)} />
              <Link to="/admin/qc">
                <Stat label="Rilis menunggu QC" value={fmt.num(k.releases_in_review)} />
              </Link>
              <Stat label="Stream hari ini" value={fmt.compact(k.streams_today)} hint={`${fmt.compact(k.streams_28d)} dalam 28 hari`} />
              <Stat label="Booking aktif" value={fmt.num(k.bookings_active)} hint={`${fmt.num(k.bookings_settled)} settled`} />
              <Stat label="GMV off-air" value={fmt.idrShort(k.gmv_offair)} />
              <Stat label="Escrow ditahan" value={fmt.idrShort(k.escrow_held)} />
              <Stat label="Tiket terjual" value={fmt.num(k.tickets_sold)} />
              <Stat label="GMV tiket" value={fmt.idrShort(k.ticket_gmv)} />
              <Link to="/admin/kyc">
                <Stat label="KYC menunggu" value={fmt.num(k.kyc_pending)} />
              </Link>
              <Link to="/admin/disputes">
                <Stat label="Dispute terbuka" value={<span className={k.disputes_open ? 'text-red-600' : undefined}>{fmt.num(k.disputes_open)}</span>} />
              </Link>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <Card
                title={<span className="flex items-center gap-2"><HardDrive className="size-4" /> Storage</span>}
                action={<Link to="/admin/platform/storage" className="text-xs font-bold underline">Kelola</Link>}
              >
                <UsageBar value={o.storage.disk_used_pct} label={`Disk · sisa ${fmtBytes(o.storage.disk_free_bytes)}`} critical={o.storage.warning} />
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <MiniStat label="Database" value={fmtBytes(o.storage.db_bytes)} />
                  <MiniStat label="Uploads" value={fmtBytes(o.storage.uploads_bytes)} />
                  <MiniStat label="Backups" value={fmtBytes(o.storage.backups_bytes)} />
                  <MiniStat
                    label="Backup terakhir"
                    value={<Link to="/admin/platform/backups" className="hover:underline">{o.storage.last_backup_at ? fmt.dateTime(o.storage.last_backup_at) : 'Belum ada'}</Link>}
                  />
                </dl>
                {o.storage.warning && <p className="mt-3 text-xs font-semibold text-red-600">Pemakaian disk melewati ambang peringatan.</p>}
              </Card>
              <Card
                title={<span className="flex items-center gap-2"><Workflow className="size-4" /> Event bus</span>}
                action={<Link to="/admin/platform/bus" className="text-xs font-bold underline">Detail</Link>}
              >
                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <MiniStat label="Total event" value={fmt.num(o.bus.events_total)} />
                  <MiniStat label="Lag maks" value={<span className={o.bus.max_lag > 0 ? 'text-amber-700' : undefined}>{fmt.num(o.bus.max_lag)}</span>} />
                  <MiniStat label="Dead letter" value={<span className={o.bus.dead_letters > 0 ? 'text-red-600' : undefined}>{fmt.num(o.bus.dead_letters)}</span>} />
                </dl>
              </Card>
            </div>

            <h2 className="mt-8 mb-3 flex items-center gap-2 text-base font-bold">
              <Server className="size-4" /> Kesehatan layanan
              <Badge tone={o.services.every((s) => s.ok) ? 'green' : 'red'}>{o.services.filter((s) => s.ok).length}/{o.services.length} sehat</Badge>
            </h2>
            <Table head={['Layanan', 'Status', 'Latensi', 'Uptime', 'Memori', 'Pengaturan dimuat', 'Metrik']}>
              {o.services.map((s) => (
                <tr key={s.name} className="align-top">
                  <td className="px-4 py-3 font-bold">{s.name}</td>
                  <td className="px-4 py-3">
                    <span className={cx('flex items-center gap-1.5 text-xs font-semibold', s.ok ? 'text-emerald-700' : 'text-red-600')}>
                      <span className={cx('size-2 rounded-full', s.ok ? 'bg-emerald-500' : 'bg-red-500')} />
                      {s.ok ? 'OK' : 'Down'}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{s.latency_ms != null ? `${s.latency_ms} ms` : '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{fmtUptime(s.uptime_s)}</td>
                  <td className="px-4 py-3 tabular-nums">{s.memory_mb != null ? `${fmt.num(Math.round(s.memory_mb))} MB` : '—'}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">{fmt.dateTime(s.settings_loaded_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex max-w-md flex-wrap gap-1">
                      {Object.entries(s.metrics ?? {}).map(([key, v]) => (
                        <span key={key} className="rounded border border-b2b-line bg-b2b-bg px-1.5 py-0.5 font-mono text-[11px]">
                          {key}: <strong>{typeof v === 'number' ? fmt.num(v) : v}</strong>
                        </span>
                      ))}
                      {!Object.keys(s.metrics ?? {}).length && <span className="text-xs text-b2b-muted">—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </QueryState>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-wide text-b2b-muted uppercase">{label}</dt>
      <dd className="mt-0.5 font-extrabold text-b2b-ink">{value}</dd>
    </div>
  );
}

// ---------- /admin/platform/bus ----------
export function PlatformBus() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform-bus'], queryFn: () => api<BusOverview>('/v1/admin/platform/bus'), refetchInterval: 10_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const keyOf = (d: DeadLetter) => `${d.group}:${d.event_id}`;
  async function run<T>(id: string, fn: () => Promise<T>, ok: string | ((r: T) => string)) {
    setBusy(id);
    try {
      const r = await fn();
      toast.success(typeof ok === 'string' ? ok : ok(r));
      qc.invalidateQueries({ queryKey: ['platform-bus'] });
      qc.invalidateQueries({ queryKey: ['platform-overview'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }
  const retry = (d: DeadLetter) =>
    run(keyOf(d), () => api('/v1/admin/platform/bus/dead-letters/retry', { body: { group: d.group, event_id: d.event_id } }), 'Retry diminta — diproses ulang oleh service pemilik group');
  const retryAll = () =>
    run('all', () => api<{ requested: number }>('/v1/admin/platform/bus/dead-letters/retry', { body: { all: true } }), (r) => `${r.requested} dead letter dijadwalkan ulang`);
  const remove = (d: DeadLetter) => {
    if (!confirm(`Hapus dead letter ${d.event_id.slice(0, 8)}… (${d.group})? Event ini tidak akan diproses ulang.`)) return;
    void run(keyOf(d), () => api('/v1/admin/platform/bus/dead-letters', { method: 'DELETE', body: { group: d.group, event_id: d.event_id } }), 'Dead letter dihapus');
  };
  const d = q.data;
  return (
    <div>
      <PageHeader title="Event Bus" subtitle="Topik, consumer group & lag, serta dead letter (event yang gagal diproses setelah retry)." />
      <ReadOnlyNote />
      <QueryState q={q}>
        {d && (
          <div className="space-y-8">
            <div className="grid gap-6 lg:grid-cols-2">
              <section>
                <h2 className="mb-3 text-base font-bold">Topik</h2>
                {d.topics.length ? (
                  <Table head={['Topik', 'Event', 'Terakhir']}>
                    {d.topics.map((t) => (
                      <tr key={t.topic}>
                        <td className="px-4 py-2.5 font-mono text-xs">{t.topic}</td>
                        <td className="px-4 py-2.5 tabular-nums">{fmt.num(t.events)}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">{fmt.dateTime(t.last_at)}</td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <Empty title="Belum ada event" />
                )}
              </section>
              <section>
                <h2 className="mb-3 text-base font-bold">Consumer group</h2>
                {d.consumers.length ? (
                  <Table head={['Group', 'Topik', 'Posisi', 'Head', 'Lag']}>
                    {d.consumers.map((c) => (
                      <tr key={`${c.group}:${c.topic}`} className={c.lag > 0 ? 'bg-amber-500/5' : undefined}>
                        <td className="px-4 py-2.5 font-bold">{c.group}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{c.topic}</td>
                        <td className="px-4 py-2.5 tabular-nums">{fmt.num(c.last_seq)}</td>
                        <td className="px-4 py-2.5 tabular-nums">{fmt.num(c.head_seq)}</td>
                        <td className="px-4 py-2.5">{c.lag > 0 ? <Badge tone={c.lag > 100 ? 'red' : 'amber'}>{fmt.num(c.lag)}</Badge> : <span className="text-emerald-700">0</span>}</td>
                      </tr>
                    ))}
                  </Table>
                ) : (
                  <Empty title="Belum ada consumer" />
                )}
              </section>
            </div>

            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-base font-bold">
                  Dead letter <Badge tone={d.dead_letters.length ? 'red' : 'green'}>{d.dead_letters.length}</Badge>
                </h2>
                {d.dead_letters.length > 0 && (
                  <WriteButton variant="ink" size="sm" icon={<RefreshCw className="size-4" />} loading={busy === 'all'} onClick={retryAll}>
                    Retry semua
                  </WriteButton>
                )}
              </div>
              {d.dead_letters.length ? (
                <Table head={['Group', 'Topik', 'Event', 'Percobaan', 'Gagal', 'Error', 'Retry diminta', '']}>
                  {d.dead_letters.map((x) => (
                    <tr key={keyOf(x)} className="align-top">
                      <td className="px-4 py-2.5 font-bold">{x.group}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{x.topic}</td>
                      <td className="px-4 py-2.5 font-mono text-xs" title={x.event_id}>
                        {x.event_id.slice(0, 8)}…
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{x.attempts}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{fmt.dateTime(x.failed_at)}</td>
                      <td className="max-w-sm px-4 py-2.5">
                        <details>
                          <summary className="cursor-pointer truncate text-xs text-red-600">{x.error.split('\n')[0]}</summary>
                          <pre className="mt-2 max-h-60 overflow-auto rounded bg-b2b-bg p-2 font-mono text-[11px] whitespace-pre-wrap">{x.error}</pre>
                        </details>
                      </td>
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap">{x.retry_requested_at ? <Badge tone="blue">{fmt.dateTime(x.retry_requested_at)}</Badge> : '—'}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className="flex justify-end gap-2">
                          <WriteButton size="sm" variant="ink" loading={busy === keyOf(x)} onClick={() => retry(x)}>
                            Retry
                          </WriteButton>
                          <WriteButton size="sm" variant="outline-ink" aria-label="Hapus dead letter" disabled={busy === keyOf(x)} onClick={() => remove(x)}>
                            <Trash2 className="size-4" />
                          </WriteButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty title="Tidak ada dead letter" body="Semua event berhasil diproses consumer." />
              )}
            </section>
          </div>
        )}
      </QueryState>
    </div>
  );
}

// ---------- /admin/platform/admins ----------
type PendingPatch = { user: Pick<Me, 'id' | 'display_name' | 'email'>; patch: { admin_role?: AdminRole | null; suspended?: boolean }; label: string };

const roleLabel = (r: string | null | undefined) => (r ? (ADMIN_ROLE_LABEL[r as AdminRole] ?? r) : '—');

function RoleSelect({ value, onChange, disabled, allowNone = true }: { value: string; onChange: (v: AdminRole | null) => void; disabled?: boolean; allowNone?: boolean }) {
  return (
    <Select value={value} disabled={disabled} onChange={(e) => onChange((e.target.value || null) as AdminRole | null)} className="py-1.5 text-sm">
      {!value && !allowNone && <option value="">Pilih peran…</option>}
      {ADMIN_ROLES.map((r) => (
        <option key={r} value={r}>
          {ADMIN_ROLE_LABEL[r]}
        </option>
      ))}
      {allowNone && <option value="">— cabut akses admin —</option>}
    </Select>
  );
}

export function PlatformAdmins() {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const sup = isSuperAdmin(me);
  const q = useQuery({ queryKey: ['platform-admins'], queryFn: () => api<{ data: AdminUser[] }>('/v1/admin/iam/admins') });
  const [pending, setPending] = useState<PendingPatch | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  async function submit() {
    if (!pending) return;
    setSaving(true);
    try {
      await api(`/v1/admin/iam/users/${pending.user.id}`, { method: 'PATCH', body: { ...pending.patch, reason: reason.trim() } });
      toast.success(`${pending.user.display_name}: ${pending.label}`);
      setPending(null);
      setReason('');
      setAdding(false);
      qc.invalidateQueries({ queryKey: ['platform-admins'] });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Tim Admin"
        subtitle="Peran internal back office (REQ-ADM-01). Setiap perubahan peran & penangguhan tercatat di audit log."
        actions={
          <WriteButton variant="ink" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
            Tambah admin
          </WriteButton>
        }
      />
      <ReadOnlyNote />
      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title="Belum ada admin" /> : undefined}>
        <Table head={['Nama', 'Email', 'Peran admin', 'Status', sup ? 'Ubah peran' : '', '']}>
          {q.data?.data.map((u) => {
            const self = u.id === me?.id;
            return (
              <tr key={u.id}>
                <td className="px-4 py-3 font-bold">
                  {u.display_name}
                  {self && <span className="ml-2 text-xs font-normal text-b2b-muted">(kamu)</span>}
                </td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3">
                  <Badge tone={u.admin_role === 'SUPER_ADMIN' ? 'purple' : 'neutral'}>{roleLabel(u.admin_role)}</Badge>
                </td>
                <td className="px-4 py-3">
                  {u.suspended_at ? <Badge tone="red">Ditangguhkan · {fmt.date(u.suspended_at)}</Badge> : <Badge tone="green">Aktif</Badge>}
                </td>
                <td className="w-56 px-4 py-3">
                  {sup && (
                    <RoleSelect
                      value={u.admin_role ?? ''}
                      onChange={(r) => setPending({ user: u, patch: { admin_role: r }, label: r ? `peran diubah menjadi ${roleLabel(r)}` : 'akses admin dicabut' })}
                    />
                  )}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {self ? (
                    <span className="text-xs text-b2b-muted">—</span>
                  ) : (
                    <WriteButton
                      size="sm"
                      variant={u.suspended_at ? 'outline-ink' : 'danger'}
                      icon={u.suspended_at ? undefined : <Ban className="size-4" />}
                      onClick={() => setPending({ user: u, patch: { suspended: !u.suspended_at }, label: u.suspended_at ? 'penangguhan dicabut' : 'akun ditangguhkan' })}
                    >
                      {u.suspended_at ? 'Aktifkan' : 'Tangguhkan'}
                    </WriteButton>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      </QueryState>

      <AddAdminModal
        open={adding && !pending}
        onClose={() => setAdding(false)}
        onPick={(user, role) => setPending({ user, patch: { admin_role: role }, label: `ditambahkan sebagai ${roleLabel(role)}` })}
      />

      <Modal open={!!pending} onClose={() => setPending(null)} title="Konfirmasi perubahan admin">
        {pending && (
          <>
            <p className="text-sm">
              <strong>{pending.user.display_name}</strong> <span className="text-b2b-muted">({pending.user.email})</span> — {pending.label}.
            </p>
            {pending.patch.suspended && <p className="mt-2 text-sm text-red-600">Pengguna yang ditangguhkan tidak bisa login (OTP & refresh ditolak).</p>}
            <div className="mt-4">
              <Field label="Alasan" hint="min. 5 karakter, tercatat di audit log">
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. Rotasi tim Finance Q4" />
              </Field>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline-ink" onClick={() => setPending(null)}>
                Batal
              </Button>
              <Button variant={pending.patch.suspended || pending.patch.admin_role === null ? 'danger' : 'ink'} loading={saving} disabled={reason.trim().length < 5} onClick={submit}>
                Simpan
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function AddAdminModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (u: Me, role: AdminRole) => void }) {
  const [qstr, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [sel, setSel] = useState<Me | null>(null);
  const [role, setRole] = useState<AdminRole | null>(null);
  const q = useQuery({
    queryKey: ['admin-users', applied],
    queryFn: () => api<{ data: Me[] }>('/v1/admin/iam/users', { query: { q: applied } }),
    enabled: open && applied.length > 1,
  });
  return (
    <Modal open={open} onClose={onClose} title="Tambah admin" wide>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(qstr.trim());
          setSel(null);
        }}
      >
        <Input value={qstr} onChange={(e) => setQ(e.target.value)} placeholder="Cari email / nama pengguna" autoFocus />
        <Button variant="ink" type="submit">
          Cari
        </Button>
      </form>
      {applied.length > 1 && (
        <div className="mt-4">
          <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title="Tidak ditemukan" /> : undefined}>
            <ul className="max-h-72 divide-y divide-b2b-line overflow-y-auto rounded-lg border border-b2b-line">
              {q.data?.data.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setSel(u)}
                    className={cx('flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-b2b-bg', sel?.id === u.id && 'bg-b2b-bg')}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-bold">{u.display_name}</span>
                      <span className="block truncate text-xs text-b2b-muted">{u.email}</span>
                    </span>
                    <span className="flex shrink-0 gap-1">
                      {u.admin_role && <Badge tone="purple">{roleLabel(u.admin_role)}</Badge>}
                      {u.roles.map((r) => (
                        <Badge key={r}>{r}</Badge>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </QueryState>
        </div>
      )}
      {sel && (
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-b2b-line bg-b2b-bg p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">{sel.display_name}</p>
            <p className="text-xs text-b2b-muted">{sel.email}</p>
          </div>
          <div className="w-56">
            <RoleSelect value={role ?? ''} onChange={setRole} allowNone={false} />
          </div>
          <Button variant="ink" disabled={!role} onClick={() => role && onPick(sel, role)}>
            Lanjut
          </Button>
        </div>
      )}
      <p className="mt-4 flex items-center gap-1.5 text-xs text-b2b-muted">
        <Database className="size-3.5" /> Peran admin memberi akses Back Office; hanya Super Admin yang dapat mengubah pengaturan platform.
      </p>
    </Modal>
  );
}
