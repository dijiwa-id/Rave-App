import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, Database, DatabaseBackup, Download, HardDrive, Play, Plus, Search, Trash2, Workflow, Wrench, Palette } from 'lucide-react';
import { api, ApiError, fmt } from '@/lib/api';
import type { Backup, BackupsResponse, BucketName, StorageOverview, StoredFile, StoredFilePage } from '@/lib/types';
import { Badge, Button, Card, cx, Field, Input, Modal, PageHeader, Select, Stat, Textarea, toast } from '@/components/ui';
import { Empty, QueryState, Table } from '@/components/b2b/common';
import { BarList, LineChart, SERIES } from '@/components/b2b/charts';
import { downloadAuthed, fmtBytes, ReadOnlyNote, UsageBar, useIsSuperAdmin, WriteButton } from './Platform';

// Storage server & backup (docs/API.md §9, BRD §9 durabilitas). Kunci file di-encode (bisa memuat '/', spasi, dll).

const fileUrl = (bucket: string, key: string) => `/v1/admin/platform/storage/buckets/${bucket}/files/${encodeURIComponent(key)}`;

// ---------- /admin/platform/storage ----------
export function PlatformStorage() {
  const q = useQuery({ queryKey: ['platform-storage'], queryFn: () => api<StorageOverview>('/v1/admin/platform/storage'), refetchInterval: 30_000 });
  const s = q.data;
  return (
    <div>
      <PageHeader title="Storage Server" subtitle="Disk, bucket file, database per service, log event bus, dan perawatan berkala." />
      <ReadOnlyNote />
      <QueryState q={q}>
        {s && (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card title={<span className="flex items-center gap-2"><HardDrive className="size-4" /> Disk</span>} className="xl:col-span-2">
                <UsageBar value={s.disk.used_pct} warn={s.disk.warn_pct} label={`Terpakai (ambang ${s.disk.warn_pct}%)`} />
                <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <Mini label="Total" value={fmtBytes(s.disk.total_bytes)} />
                  <Mini label="Terpakai" value={fmtBytes(s.disk.used_bytes)} />
                  <Mini label="Bebas" value={fmtBytes(s.disk.free_bytes)} />
                </dl>
                <p className="mt-3 truncate font-mono text-[11px] text-b2b-muted">{s.disk.path}</p>
              </Card>
              <Stat label="Database" value={fmtBytes(s.database.total_bytes)} hint={`${s.database.schemas.length} schema · ${s.database.schemas.reduce((a, x) => a + x.tables, 0)} tabel`} />
              <Card title={<span className="flex items-center gap-2"><Workflow className="size-4" /> Log event bus</span>}>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <Mini label="Event" value={fmt.num(s.bus.events)} />
                  <Mini label="Ukuran" value={fmtBytes(s.bus.bytes)} />
                  <Mini label="Tertua" value={fmt.date(s.bus.oldest_at)} />
                  <Mini label="Bisa dipangkas" value={<span className={s.bus.prunable ? 'text-amber-700' : undefined}>{fmt.num(s.bus.prunable)}</span>} />
                </dl>
                <p className="mt-3 text-xs text-b2b-muted">
                  Retensi: bus {s.retention.bus_days} hari · idempotency {s.retention.idempotency_days} hari ·{' '}
                  <Link to="/admin/platform/settings?group=storage" className="font-bold underline">
                    ubah
                  </Link>
                </p>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {s.buckets.map((b) => (
                <Card key={b.name} title={<span className="flex items-center gap-2">{b.name === 'backups' ? <DatabaseBackup className="size-4" /> : b.name === 'branding' ? <Palette className="size-4" /> : <HardDrive className="size-4" />} Bucket {b.name}</span>} action={<Badge>{fmt.num(b.files)} file</Badge>}>
                  <p className="-mt-2 mb-3 text-sm text-b2b-muted">{b.description}</p>
                  {b.quota_bytes ? (
                    <UsageBar value={b.used_pct} warn={90} label={`${fmtBytes(b.bytes)} dari kuota ${fmtBytes(b.quota_bytes)}`} />
                  ) : (
                    <p className="text-sm">
                      <strong>{fmtBytes(b.bytes)}</strong> <span className="text-b2b-muted">· tanpa kuota</span>
                    </p>
                  )}
                  <div className="mt-4">
                    <BarList data={b.by_type.map((t) => ({ label: `${t.type} · ${fmt.num(t.files)} file`, value: t.bytes }))} format={(n) => fmtBytes(n)} color={b.name === 'backups' ? SERIES[1] : b.name === 'branding' ? SERIES[2] : SERIES[0]} />
                  </div>
                  <p className="mt-3 truncate font-mono text-[11px] text-b2b-muted">{b.path}</p>
                </Card>
              ))}
            </div>

            <TrendCard trend={s.trend} />

            <div className="grid gap-6 lg:grid-cols-2">
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-base font-bold">
                  <Database className="size-4" /> Database per schema
                </h2>
                <Table head={['Schema', 'Service', 'Ukuran', 'Tabel', 'Baris (est.)']}>
                  {[...s.database.schemas]
                    .sort((a, b) => b.bytes - a.bytes)
                    .map((x) => (
                      <tr key={x.schema}>
                        <td className="px-4 py-2.5 font-mono text-xs">{x.schema}</td>
                        <td className="px-4 py-2.5">{x.service}</td>
                        <td className="px-4 py-2.5 tabular-nums">{fmtBytes(x.bytes)}</td>
                        <td className="px-4 py-2.5 tabular-nums">{x.tables}</td>
                        <td className="px-4 py-2.5 tabular-nums">{fmt.compact(x.rows_est)}</td>
                      </tr>
                    ))}
                </Table>
              </section>
              <section>
                <h2 className="mb-3 text-base font-bold">Tabel terbesar</h2>
                <Table head={['Tabel', 'Ukuran', 'Baris (est.)']}>
                  {s.database.largest_tables.map((t) => (
                    <tr key={`${t.schema}.${t.table}`}>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        <span className="text-b2b-muted">{t.schema}.</span>
                        {t.table}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{fmtBytes(t.bytes)}</td>
                      <td className="px-4 py-2.5 tabular-nums">{fmt.compact(t.rows_est)}</td>
                    </tr>
                  ))}
                </Table>
              </section>
            </div>

            <FileBrowser buckets={s.buckets.map((b) => b.name)} />
            <Orphans />
            <Maintenance schemas={s.database.schemas.map((x) => x.schema)} prunable={s.bus.prunable} retention={s.retention} />
          </div>
        )}
      </QueryState>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-wide text-b2b-muted uppercase">{label}</dt>
      <dd className="mt-0.5 font-extrabold text-b2b-ink">{value}</dd>
    </div>
  );
}

const TREND_SERIES = [
  { key: 'disk_used_bytes', label: 'Disk terpakai' },
  { key: 'db_bytes', label: 'Database' },
  { key: 'uploads_bytes', label: 'Uploads' },
  { key: 'backups_bytes', label: 'Backups' },
] as const;

function TrendCard({ trend }: { trend: StorageOverview['trend'] }) {
  const [series, setSeries] = useState<(typeof TREND_SERIES)[number]['key']>('disk_used_bytes');
  const idx = TREND_SERIES.findIndex((t) => t.key === series);
  const max = Math.max(0, ...trend.map((t) => t[series]));
  // Sumbu chart memakai angka ringkas → skalakan ke MB/GB agar label sumbu bermakna.
  const unit = max >= 1024 ** 3 ? { div: 1024 ** 3, name: 'GB' } : { div: 1024 ** 2, name: 'MB' };
  return (
    <Card
      title="Tren pemakaian"
      action={
        <div className="flex flex-wrap gap-1" role="tablist">
          {TREND_SERIES.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={series === t.key}
              onClick={() => setSeries(t.key)}
              className={cx('rounded-full px-3 py-1 text-xs font-bold transition', series === t.key ? 'bg-b2b-ink text-b2b-on-ink' : 'text-b2b-muted hover:bg-b2b-ink/5')}
            >
              {t.label}
            </button>
          ))}
        </div>
      }
    >
      <LineChart
        data={trend.map((t) => ({ x: t.at, y: t[series] / unit.div }))}
        label={`${TREND_SERIES[idx].label} (${unit.name})`}
        color={SERIES[idx]}
        format={(n) => `${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })} ${unit.name}`}
      />
    </Card>
  );
}

// ---------- Browser file ----------
function FileBrowser({ buckets }: { buckets: BucketName[] }) {
  const qc = useQueryClient();
  const [bucket, setBucket] = useState<BucketName>(buckets[0] ?? 'uploads');
  const [qstr, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [sort, setSort] = useState<'date' | 'size' | 'name'>('date');
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const [del, setDel] = useState<{ file: StoredFile; force: boolean; conflict?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const files = useInfiniteQuery({
    queryKey: ['platform-files', bucket, applied, sort, order],
    queryFn: ({ pageParam }) =>
      api<StoredFilePage>(`/v1/admin/platform/storage/buckets/${bucket}/files`, { query: { q: applied || undefined, sort, order, cursor: pageParam ?? undefined, limit: 50 } }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const rows = files.data?.pages.flatMap((p) => p.data) ?? [];
  const head = files.data?.pages[0];

  async function download(f: StoredFile) {
    try {
      await downloadAuthed(`${fileUrl(f.bucket, f.key)}/download`, f.key.split('/').pop());
    } catch (e) {
      toast.error(e);
    }
  }
  async function confirmDelete() {
    if (!del) return;
    setDeleting(true);
    try {
      await api(fileUrl(del.file.bucket, del.file.key), { method: 'DELETE', query: { force: del.force ? 'true' : undefined } });
      toast.success(`${del.file.key} dihapus`);
      setDel(null);
      qc.invalidateQueries({ queryKey: ['platform-files'] });
      qc.invalidateQueries({ queryKey: ['platform-storage'] });
    } catch (e) {
      // 409 = masih direferensikan katalog → minta konfirmasi paksa.
      if (e instanceof ApiError && e.status === 409) setDel({ ...del, force: true, conflict: e.message });
      else toast.error(e);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold">Browser file</h2>
        <div className="flex gap-1" role="tablist">
          {buckets.map((b) => (
            <button
              key={b}
              role="tab"
              aria-selected={bucket === b}
              onClick={() => setBucket(b)}
              className={cx('rounded-full px-3 py-1 text-xs font-bold transition', bucket === b ? 'bg-b2b-ink text-b2b-on-ink' : 'border border-b2b-line bg-b2b-card text-b2b-muted hover:text-b2b-ink')}
            >
              {b}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(qstr.trim());
          }}
        >
          <Input value={qstr} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama file" className="max-w-sm py-2" />
          <Button variant="ink" type="submit" icon={<Search className="size-4" />}>
            Cari
          </Button>
        </form>
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="w-40 py-2" aria-label="Urutkan">
          <option value="date">Tanggal</option>
          <option value="size">Ukuran</option>
          <option value="name">Nama</option>
        </Select>
        <Button variant="outline-ink" icon={<ArrowUpDown className="size-4" />} onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')}>
          {order === 'desc' ? 'Menurun' : 'Menaik'}
        </Button>
      </div>
      {head && (
        <p className="mb-2 text-xs text-b2b-muted">
          {fmt.num(head.total_files)} file · {fmtBytes(head.total_bytes)}
          {applied && ` · cocok dengan “${applied}”`}
        </p>
      )}
      <QueryState q={files} empty={files.data && !rows.length ? <Empty title="Tidak ada file" /> : undefined}>
        <Table head={['Kunci', 'Ukuran', 'Tipe', 'Diubah', 'Referensi', '']}>
          {rows.map((f) => (
            <tr key={f.key}>
              <td className="max-w-md px-4 py-2.5 font-mono text-xs break-all">{f.key}</td>
              <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{fmtBytes(f.size)}</td>
              <td className="px-4 py-2.5 text-xs">{f.content_type ?? '—'}</td>
              <td className="px-4 py-2.5 whitespace-nowrap">{fmt.dateTime(f.modified_at)}</td>
              <td className="px-4 py-2.5">{f.referenced === true ? <Badge tone="green">Dipakai</Badge> : f.referenced === false ? <Badge tone="amber">Yatim</Badge> : <span className="text-b2b-muted">—</span>}</td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline-ink" aria-label={`Unduh ${f.key}`} onClick={() => download(f)}>
                    <Download className="size-4" />
                  </Button>
                  <WriteButton size="sm" variant="outline-ink" aria-label={`Hapus ${f.key}`} onClick={() => setDel({ file: f, force: f.referenced === true })}>
                    <Trash2 className="size-4" />
                  </WriteButton>
                </div>
              </td>
            </tr>
          ))}
        </Table>
        {files.hasNextPage && (
          <div className="mt-3 text-center">
            <Button variant="outline-ink" loading={files.isFetchingNextPage} onClick={() => files.fetchNextPage()}>
              Muat lagi
            </Button>
          </div>
        )}
      </QueryState>

      <Modal open={!!del} onClose={() => setDel(null)} title="Hapus file">
        {del && (
          <>
            <p className="font-mono text-sm break-all">
              {del.file.bucket}/{del.file.key}
            </p>
            <p className="mt-1 text-sm text-b2b-muted">{fmtBytes(del.file.size)} · tidak dapat dibatalkan.</p>
            {del.force && (
              <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700">
                {del.conflict ?? 'File ini masih direferensikan katalog.'} Menghapusnya akan membuat audio/artwork terkait tidak bisa diputar atau ditampilkan.
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline-ink" onClick={() => setDel(null)}>
                Batal
              </Button>
              <Button variant="danger" loading={deleting} onClick={confirmDelete}>
                {del.force ? 'Tetap hapus (paksa)' : 'Hapus'}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}

// ---------- File yatim (bucket uploads) ----------
function Orphans() {
  const qc = useQueryClient();
  const [scan, setScan] = useState<{ orphans: StoredFile[]; bytes: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'scan' | 'clean' | null>(null);
  async function doScan() {
    setBusy('scan');
    try {
      const r = await api<{ orphans: StoredFile[]; bytes: number }>('/v1/admin/platform/storage/buckets/uploads/orphans/scan', { method: 'POST' });
      setScan(r);
      setSelected(new Set(r.orphans.map((f) => f.key)));
      if (!r.orphans.length) toast.success('Tidak ada file yatim');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }
  async function cleanup() {
    const keys = [...selected];
    if (!keys.length || !confirm(`Hapus ${keys.length} file yatim secara permanen?`)) return;
    setBusy('clean');
    try {
      const r = await api<{ deleted: number; bytes_freed: number }>('/v1/admin/platform/storage/buckets/uploads/orphans/cleanup', { body: { keys }, idempotencyKey: true });
      toast.success(`${r.deleted} file dihapus · ${fmtBytes(r.bytes_freed)} dibebaskan`);
      setScan(null);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['platform-files'] });
      qc.invalidateQueries({ queryKey: ['platform-storage'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }
  const selBytes = scan?.orphans.filter((f) => selected.has(f.key)).reduce((a, f) => a + f.size, 0) ?? 0;
  const toggle = (k: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <Card
      title="File yatim (uploads)"
      action={
        <Button variant="outline-ink" size="sm" icon={<Search className="size-4" />} loading={busy === 'scan'} onClick={doScan}>
          Pindai file yatim
        </Button>
      }
    >
      <p className="-mt-2 mb-3 text-sm text-b2b-muted">File di bucket uploads yang tidak lagi direferensikan katalog (mis. upload batal, rilis dihapus).</p>
      {scan && scan.orphans.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              <strong>{scan.orphans.length}</strong> file yatim · {fmtBytes(scan.bytes)} · dipilih {selected.size} ({fmtBytes(selBytes)})
            </span>
            <WriteButton variant="danger" size="sm" icon={<Trash2 className="size-4" />} loading={busy === 'clean'} disabled={!selected.size} onClick={cleanup}>
              Bersihkan
            </WriteButton>
          </div>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-b2b-line">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-b2b-bg text-xs font-bold text-b2b-muted uppercase">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Pilih semua"
                      checked={selected.size === scan.orphans.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(scan.orphans.map((f) => f.key)) : new Set())}
                    />
                  </th>
                  <th className="px-3 py-2">Kunci</th>
                  <th className="px-3 py-2">Ukuran</th>
                  <th className="px-3 py-2">Diubah</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-b2b-line">
                {scan.orphans.map((f) => (
                  <tr key={f.key}>
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Pilih ${f.key}`} checked={selected.has(f.key)} onChange={() => toggle(f.key)} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs break-all">{f.key}</td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmtBytes(f.size)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmt.dateTime(f.modified_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {scan && !scan.orphans.length && <p className="text-sm text-emerald-700">Tidak ada file yatim. Bucket bersih.</p>}
    </Card>
  );
}

// ---------- Perawatan ----------
type MaintenanceAction = 'prune_bus' | 'prune_idempotency' | 'vacuum_analyze' | 'snapshot';

function Maintenance({ schemas, prunable, retention }: { schemas: string[]; prunable: number; retention: StorageOverview['retention'] }) {
  const qc = useQueryClient();
  const [schema, setSchema] = useState('');
  const [busy, setBusy] = useState<MaintenanceAction | null>(null);
  const [last, setLast] = useState<{ action: string; result: unknown; duration_ms: number } | null>(null);
  const actions: { action: MaintenanceAction; title: string; body: string; confirm?: string }[] = [
    { action: 'prune_bus', title: 'Pangkas log event bus', body: `Hapus event yang sudah dikonsumsi semua group & lebih tua dari ${retention.bus_days} hari (${fmt.num(prunable)} event).`, confirm: 'Pangkas log event bus sekarang?' },
    { action: 'prune_idempotency', title: 'Pangkas idempotency key', body: `Hapus Idempotency-Key lebih tua dari ${retention.idempotency_days} hari di semua service.`, confirm: 'Pangkas idempotency key sekarang?' },
    { action: 'vacuum_analyze', title: 'VACUUM ANALYZE', body: 'Klaim ulang ruang & perbarui statistik planner Postgres. Bisa dibatasi ke satu schema.' },
    { action: 'snapshot', title: 'Snapshot pemakaian', body: 'Catat pemakaian storage saat ini sebagai titik baru di grafik tren.' },
  ];
  async function run(a: (typeof actions)[number]) {
    if (a.confirm && !confirm(a.confirm)) return;
    setBusy(a.action);
    try {
      const r = await api<{ action: string; result: unknown; duration_ms: number }>('/v1/admin/platform/storage/maintenance', {
        body: { action: a.action, schema: a.action === 'vacuum_analyze' && schema ? schema : undefined },
      });
      setLast(r);
      toast.success(`${a.title} selesai dalam ${fmt.num(r.duration_ms)} ms`);
      qc.invalidateQueries({ queryKey: ['platform-storage'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card title={<span className="flex items-center gap-2"><Wrench className="size-4" /> Perawatan</span>}>
      <div className="grid gap-3 md:grid-cols-2">
        {actions.map((a) => (
          <div key={a.action} className="flex flex-col justify-between gap-3 rounded-lg border border-b2b-line p-4">
            <div>
              <p className="font-bold">{a.title}</p>
              <p className="mt-1 text-sm text-b2b-muted">{a.body}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {a.action === 'vacuum_analyze' && (
                <Select value={schema} onChange={(e) => setSchema(e.target.value)} className="w-44 py-1.5 text-sm" aria-label="Schema">
                  <option value="">Semua schema</option>
                  {schemas.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </Select>
              )}
              <WriteButton size="sm" variant="ink" icon={<Play className="size-4" />} loading={busy === a.action} disabled={!!busy && busy !== a.action} onClick={() => run(a)}>
                Jalankan
              </WriteButton>
            </div>
          </div>
        ))}
      </div>
      {last && (
        <div className="mt-4 rounded-lg border border-b2b-line bg-b2b-bg p-3">
          <p className="mb-2 text-xs font-bold text-b2b-muted">
            Hasil <span className="font-mono text-b2b-ink">{last.action}</span> · {fmt.num(last.duration_ms)} ms
          </p>
          <pre className="max-h-64 overflow-auto font-mono text-[11px] whitespace-pre-wrap">{JSON.stringify(last.result, null, 2)}</pre>
        </div>
      )}
    </Card>
  );
}

// ---------- /admin/platform/backups ----------
const BACKUP_TONE = { RUNNING: 'blue', COMPLETED: 'green', FAILED: 'red' } as const;
const BACKUP_LABEL = { RUNNING: 'Berjalan', COMPLETED: 'Selesai', FAILED: 'Gagal' } as const;

export function PlatformBackups() {
  const qc = useQueryClient();
  const sup = useIsSuperAdmin();
  const q = useQuery({
    queryKey: ['platform-backups'],
    queryFn: () => api<BackupsResponse>('/v1/admin/platform/backups'),
    // Poll cepat selama ada backup yang sedang berjalan.
    refetchInterval: (query) => (query.state.data?.data.some((b) => b.status === 'RUNNING') ? 2000 : false),
  });
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function create() {
    setBusy('create');
    try {
      await api<Backup>('/v1/admin/platform/backups', { body: { note: note.trim() || undefined }, idempotencyKey: true });
      toast.success('Backup dimulai');
      setCreating(false);
      setNote('');
      qc.invalidateQueries({ queryKey: ['platform-backups'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }
  async function download(b: Backup) {
    setBusy(b.id);
    try {
      await downloadAuthed(`/v1/admin/platform/backups/${b.id}/download`, b.filename);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }
  async function remove(b: Backup) {
    if (!confirm(`Hapus backup ${b.filename}? File tidak dapat dipulihkan.`)) return;
    setBusy(b.id);
    try {
      await api(`/v1/admin/platform/backups/${b.id}`, { method: 'DELETE' });
      toast.success('Backup dihapus');
      qc.invalidateQueries({ queryKey: ['platform-backups'] });
      qc.invalidateQueries({ queryKey: ['platform-storage'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }

  const sched = q.data?.schedule;
  const running = q.data?.data.some((b) => b.status === 'RUNNING');
  return (
    <div>
      <PageHeader
        title="Backup Database"
        subtitle="pg_dump seluruh schema ke bucket backups (BRD §9 durabilitas). Unduh & simpan salinan di luar server secara berkala."
        actions={
          <WriteButton variant="ink" icon={<Plus className="size-4" />} disabled={running} onClick={() => setCreating(true)}>
            Buat backup sekarang
          </WriteButton>
        }
      />
      <ReadOnlyNote>Mode baca. Hanya Super Admin yang dapat membuat, mengunduh, atau menghapus backup.</ReadOnlyNote>
      <QueryState q={q}>
        {sched && (
          <Card
            className="mb-6"
            title="Jadwal otomatis"
            action={
              <Link to="/admin/platform/settings?group=storage" className="text-xs font-bold underline">
                Ubah di Pengaturan
              </Link>
            }
          >
            <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <Mini label="Status" value={<Badge tone={sched.enabled ? 'green' : 'neutral'}>{sched.enabled ? 'Aktif' : 'Nonaktif'}</Badge>} />
              <Mini label="Interval" value={`${sched.interval_hours} jam`} />
              <Mini label="Disimpan" value={`${sched.keep} file terakhir`} />
              <Mini label="Berikutnya" value={sched.enabled ? fmt.dateTime(sched.next_run_at) : '—'} />
            </dl>
          </Card>
        )}
        {q.data && !q.data.data.length ? (
          <Empty title="Belum ada backup" body="Buat backup pertama atau aktifkan jadwal otomatis." />
        ) : (
          <Table head={['Dibuat', 'Status', 'Ukuran', 'SHA-256', 'Pemicu', 'Catatan', 'Oleh', 'Selesai', '']}>
            {q.data?.data.map((b) => (
              <tr key={b.id} className="align-top">
                <td className="px-4 py-2.5 whitespace-nowrap">
                  {fmt.dateTime(b.started_at)}
                  <span className="block font-mono text-[11px] text-b2b-muted">{b.filename}</span>
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={BACKUP_TONE[b.status]}>{BACKUP_LABEL[b.status] ?? b.status}</Badge>
                  {b.error && <p className="mt-1 max-w-xs text-xs text-red-600">{b.error}</p>}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{fmtBytes(b.size_bytes)}</td>
                <td className="px-4 py-2.5 font-mono text-xs" title={b.sha256 ?? ''}>
                  {b.sha256 ? `${b.sha256.slice(0, 12)}…` : '—'}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={b.trigger === 'manual' ? 'purple' : 'neutral'}>{b.trigger === 'manual' ? 'Manual' : 'Terjadwal'}</Badge>
                </td>
                <td className="max-w-xs px-4 py-2.5 text-xs">{b.note ?? '—'}</td>
                <td className="px-4 py-2.5 text-xs">{b.created_by ?? 'sistem'}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">{fmt.dateTime(b.finished_at)}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <div className="flex justify-end gap-2">
                    {b.status === 'COMPLETED' && (
                      <WriteButton size="sm" variant="outline-ink" aria-label={`Unduh ${b.filename}`} loading={busy === b.id} onClick={() => download(b)}>
                        <Download className="size-4" />
                      </WriteButton>
                    )}
                    {b.status !== 'RUNNING' && (
                      <WriteButton size="sm" variant="outline-ink" aria-label={`Hapus ${b.filename}`} disabled={busy === b.id} onClick={() => remove(b)}>
                        <Trash2 className="size-4" />
                      </WriteButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </QueryState>

      <Modal open={creating && sup} onClose={() => setCreating(false)} title="Buat backup sekarang">
        <p className="mb-3 text-sm text-b2b-muted">Backup berjalan di latar belakang; status diperbarui otomatis.</p>
        <Field label="Catatan" hint="opsional">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. Sebelum migrasi skema finance" className="min-h-20" />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline-ink" onClick={() => setCreating(false)}>
            Batal
          </Button>
          <Button variant="ink" loading={busy === 'create'} onClick={create}>
            Mulai backup
          </Button>
        </div>
      </Modal>
    </div>
  );
}
