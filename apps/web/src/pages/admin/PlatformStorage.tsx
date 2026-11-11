import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, Database, DatabaseBackup, Download, HardDrive, Play, Plus, Search, Trash2, Workflow, Wrench, Palette } from 'lucide-react';
import { api, ApiError, fmt } from '@/lib/api';
import { localeTag, useDict } from '@/lib/i18n';
import type { Backup, BackupsResponse, BucketName, StorageOverview, StoredFile, StoredFilePage } from '@/lib/types';
import { Badge, Button, Card, cx, Field, Input, Modal, PageHeader, Select, Stat, Textarea, toast } from '@/components/ui';
import { Empty, QueryState, Table } from '@/components/b2b/common';
import { BarList, LineChart, SERIES } from '@/components/b2b/charts';
import { downloadAuthed, fmtBytes, ReadOnlyNote, UsageBar, useIsSuperAdmin, WriteButton } from './Platform';

// Storage server & backup (docs/API.md §9, BRD §9 durabilitas). Kunci file di-encode (bisa memuat '/', spasi, dll).

const fileUrl = (bucket: string, key: string) => `/v1/admin/platform/storage/buckets/${bucket}/files/${encodeURIComponent(key)}`;

// ---------- /admin/platform/storage ----------
export function PlatformStorage() {
  const t = useDict('admin').storage;
  const q = useQuery({ queryKey: ['platform-storage'], queryFn: () => api<StorageOverview>('/v1/admin/platform/storage'), refetchInterval: 30_000 });
  const s = q.data;
  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <ReadOnlyNote />
      <QueryState q={q}>
        {s && (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card title={<span className="flex items-center gap-2"><HardDrive className="size-4" /> {t.disk}</span>} className="xl:col-span-2">
                <UsageBar value={s.disk.used_pct} warn={s.disk.warn_pct} label={t.usedThreshold(s.disk.warn_pct)} />
                <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <Mini label={t.total} value={fmtBytes(s.disk.total_bytes)} />
                  <Mini label={t.used} value={fmtBytes(s.disk.used_bytes)} />
                  <Mini label={t.free} value={fmtBytes(s.disk.free_bytes)} />
                </dl>
                <p className="mt-3 truncate font-mono text-[11px] text-b2b-muted">{s.disk.path}</p>
              </Card>
              <Stat label={t.database} value={fmtBytes(s.database.total_bytes)} hint={t.schemaTables(s.database.schemas.length, s.database.schemas.reduce((a, x) => a + x.tables, 0))} />
              <Card title={<span className="flex items-center gap-2"><Workflow className="size-4" /> {t.busLog}</span>}>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <Mini label={t.events} value={fmt.num(s.bus.events)} />
                  <Mini label={t.size} value={fmtBytes(s.bus.bytes)} />
                  <Mini label={t.oldest} value={fmt.date(s.bus.oldest_at)} />
                  <Mini label={t.prunable} value={<span className={s.bus.prunable ? 'text-amber-700' : undefined}>{fmt.num(s.bus.prunable)}</span>} />
                </dl>
                <p className="mt-3 text-xs text-b2b-muted">
                  {t.retention(s.retention.bus_days, s.retention.idempotency_days)}{' '}
                  <Link to="/admin/platform/settings?group=storage" className="font-bold underline">
                    {t.change}
                  </Link>
                </p>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {s.buckets.map((b) => (
                <Card key={b.name} title={<span className="flex items-center gap-2">{b.name === 'backups' ? <DatabaseBackup className="size-4" /> : b.name === 'branding' ? <Palette className="size-4" /> : <HardDrive className="size-4" />} {t.bucket(b.name)}</span>} action={<Badge>{t.files(fmt.num(b.files))}</Badge>}>
                  <p className="-mt-2 mb-3 text-sm text-b2b-muted">{b.description}</p>
                  {b.quota_bytes ? (
                    <UsageBar value={b.used_pct} warn={90} label={t.ofQuota(fmtBytes(b.bytes), fmtBytes(b.quota_bytes))} />
                  ) : (
                    <p className="text-sm">
                      <strong>{fmtBytes(b.bytes)}</strong> <span className="text-b2b-muted">· {t.noQuota}</span>
                    </p>
                  )}
                  <div className="mt-4">
                    <BarList data={b.by_type.map((x) => ({ label: `${x.type} · ${t.files(fmt.num(x.files))}`, value: x.bytes }))} format={(n) => fmtBytes(n)} color={b.name === 'backups' ? SERIES[1] : b.name === 'branding' ? SERIES[2] : SERIES[0]} />
                  </div>
                  <p className="mt-3 truncate font-mono text-[11px] text-b2b-muted">{b.path}</p>
                </Card>
              ))}
            </div>

            <TrendCard trend={s.trend} />

            <div className="grid gap-6 lg:grid-cols-2">
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-base font-bold">
                  <Database className="size-4" /> {t.dbPerSchema}
                </h2>
                <Table head={[...t.schemaHead]}>
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
                <h2 className="mb-3 text-base font-bold">{t.largestTables}</h2>
                <Table head={[...t.tablesHead]}>
                  {s.database.largest_tables.map((x) => (
                    <tr key={`${x.schema}.${x.table}`}>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        <span className="text-b2b-muted">{x.schema}.</span>
                        {x.table}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{fmtBytes(x.bytes)}</td>
                      <td className="px-4 py-2.5 tabular-nums">{fmt.compact(x.rows_est)}</td>
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

const TREND_SERIES = ['disk_used_bytes', 'db_bytes', 'uploads_bytes', 'backups_bytes'] as const;

function TrendCard({ trend }: { trend: StorageOverview['trend'] }) {
  const d = useDict('admin').storage;
  const [series, setSeries] = useState<(typeof TREND_SERIES)[number]>('disk_used_bytes');
  const idx = TREND_SERIES.indexOf(series);
  const max = Math.max(0, ...trend.map((t) => t[series]));
  // Sumbu chart memakai angka ringkas → skalakan ke MB/GB agar label sumbu bermakna.
  const unit = max >= 1024 ** 3 ? { div: 1024 ** 3, name: 'GB' } : { div: 1024 ** 2, name: 'MB' };
  return (
    <Card
      title={d.trendTitle}
      action={
        <div className="flex flex-wrap gap-1" role="tablist">
          {TREND_SERIES.map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={series === k}
              onClick={() => setSeries(k)}
              className={cx('rounded-none px-3 py-1 text-xs font-bold transition', series === k ? 'bg-b2b-ink text-b2b-on-ink' : 'text-b2b-muted hover:bg-b2b-ink/5')}
            >
              {d.trendSeries[k]}
            </button>
          ))}
        </div>
      }
    >
      <LineChart
        data={trend.map((t) => ({ x: t.at, y: t[series] / unit.div }))}
        label={`${d.trendSeries[series]} (${unit.name})`}
        color={SERIES[idx]}
        format={(n) => `${n.toLocaleString(localeTag(), { maximumFractionDigits: 2 })} ${unit.name}`}
      />
    </Card>
  );
}

// ---------- Browser file ----------
function FileBrowser({ buckets }: { buckets: BucketName[] }) {
  const d = useDict('admin');
  const t = d.storage;
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
      toast.success(t.toastFileDeleted(del.file.key));
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
        <h2 className="text-base font-bold">{t.fileBrowser}</h2>
        <div className="flex gap-1" role="tablist">
          {buckets.map((b) => (
            <button
              key={b}
              role="tab"
              aria-selected={bucket === b}
              onClick={() => setBucket(b)}
              className={cx('rounded-none px-3 py-1 text-xs font-bold transition', bucket === b ? 'bg-b2b-ink text-b2b-on-ink' : 'border border-b2b-line bg-b2b-card text-b2b-muted hover:text-b2b-ink')}
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
          <Input value={qstr} onChange={(e) => setQ(e.target.value)} placeholder={t.searchPlaceholder} className="max-w-sm py-2" />
          <Button variant="ink" type="submit" icon={<Search className="size-4" />}>
            {t.search}
          </Button>
        </form>
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="w-40 py-2" aria-label={t.sortBy}>
          <option value="date">{t.sortDate}</option>
          <option value="size">{t.sortSize}</option>
          <option value="name">{t.sortName}</option>
        </Select>
        <Button variant="outline-ink" icon={<ArrowUpDown className="size-4" />} onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')}>
          {order === 'desc' ? t.desc : t.asc}
        </Button>
      </div>
      {head && (
        <p className="mb-2 text-xs text-b2b-muted">
          {t.files(fmt.num(head.total_files))} · {fmtBytes(head.total_bytes)}
          {applied && ` · ${t.matching(applied)}`}
        </p>
      )}
      <QueryState q={files} empty={files.data && !rows.length ? <Empty title={t.noFiles} /> : undefined}>
        <Table head={[...t.filesHead]}>
          {rows.map((f) => (
            <tr key={f.key}>
              <td className="max-w-md px-4 py-2.5 font-mono text-xs break-all">{f.key}</td>
              <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{fmtBytes(f.size)}</td>
              <td className="px-4 py-2.5 text-xs">{f.content_type ?? '—'}</td>
              <td className="px-4 py-2.5 whitespace-nowrap">{fmt.dateTime(f.modified_at)}</td>
              <td className="px-4 py-2.5">{f.referenced === true ? <Badge tone="green">{t.inUse}</Badge> : f.referenced === false ? <Badge tone="amber">{t.orphan}</Badge> : <span className="text-b2b-muted">—</span>}</td>
              <td className="px-4 py-2.5 text-right whitespace-nowrap">
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline-ink" aria-label={t.downloadAria(f.key)} onClick={() => download(f)}>
                    <Download className="size-4" />
                  </Button>
                  <WriteButton size="sm" variant="outline-ink" aria-label={t.deleteAria(f.key)} onClick={() => setDel({ file: f, force: f.referenced === true })}>
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
              {t.loadMore}
            </Button>
          </div>
        )}
      </QueryState>

      <Modal open={!!del} onClose={() => setDel(null)} title={t.deleteFileTitle}>
        {del && (
          <>
            <p className="font-mono text-sm break-all">
              {del.file.bucket}/{del.file.key}
            </p>
            <p className="mt-1 text-sm text-b2b-muted">{fmtBytes(del.file.size)} · {t.irreversible}</p>
            {del.force && (
              <p className="mt-3 rounded-none border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700">
                {del.conflict ?? t.stillReferenced} {t.forceWarning}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline-ink" onClick={() => setDel(null)}>
                {d.common.cancel}
              </Button>
              <Button variant="danger" loading={deleting} onClick={confirmDelete}>
                {del.force ? t.forceDelete : t.delete}
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
  const t = useDict('admin').storage;
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
      if (!r.orphans.length) toast.success(t.noOrphansToast);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }
  async function cleanup() {
    const keys = [...selected];
    if (!keys.length || !confirm(t.confirmCleanup(keys.length))) return;
    setBusy('clean');
    try {
      const r = await api<{ deleted: number; bytes_freed: number }>('/v1/admin/platform/storage/buckets/uploads/orphans/cleanup', { body: { keys }, idempotencyKey: true });
      toast.success(t.toastCleaned(r.deleted, fmtBytes(r.bytes_freed)));
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
      title={t.orphansTitle}
      action={
        <Button variant="outline-ink" size="sm" icon={<Search className="size-4" />} loading={busy === 'scan'} onClick={doScan}>
          {t.scan}
        </Button>
      }
    >
      <p className="-mt-2 mb-3 text-sm text-b2b-muted">{t.orphansBody}</p>
      {scan && scan.orphans.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              <strong>{scan.orphans.length}</strong> {t.orphanSummary(fmtBytes(scan.bytes), selected.size, fmtBytes(selBytes))}
            </span>
            <WriteButton variant="danger" size="sm" icon={<Trash2 className="size-4" />} loading={busy === 'clean'} disabled={!selected.size} onClick={cleanup}>
              {t.clean}
            </WriteButton>
          </div>
          <div className="max-h-80 overflow-y-auto rounded-none border border-b2b-line">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-b2b-bg text-xs font-bold text-b2b-muted uppercase">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={t.selectAll}
                      checked={selected.size === scan.orphans.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(scan.orphans.map((f) => f.key)) : new Set())}
                    />
                  </th>
                  <th className="px-3 py-2">{t.filesHead[0]}</th>
                  <th className="px-3 py-2">{t.filesHead[1]}</th>
                  <th className="px-3 py-2">{t.filesHead[3]}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-b2b-line">
                {scan.orphans.map((f) => (
                  <tr key={f.key}>
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={t.selectAria(f.key)} checked={selected.has(f.key)} onChange={() => toggle(f.key)} />
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
      {scan && !scan.orphans.length && <p className="text-sm text-emerald-700">{t.bucketClean}</p>}
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
  const t = useDict('admin').storage.maint;
  const actions: { action: MaintenanceAction; title: string; body: string; confirm?: string }[] = [
    { action: 'prune_bus', title: t.pruneBusTitle, body: t.pruneBusBody(retention.bus_days, fmt.num(prunable)), confirm: t.pruneBusConfirm },
    { action: 'prune_idempotency', title: t.pruneIdemTitle, body: t.pruneIdemBody(retention.idempotency_days), confirm: t.pruneIdemConfirm },
    { action: 'vacuum_analyze', title: 'VACUUM ANALYZE', body: t.vacuumBody },
    { action: 'snapshot', title: t.snapshotTitle, body: t.snapshotBody },
  ];
  async function run(a: (typeof actions)[number]) {
    if (a.confirm && !confirm(a.confirm)) return;
    setBusy(a.action);
    try {
      const r = await api<{ action: string; result: unknown; duration_ms: number }>('/v1/admin/platform/storage/maintenance', {
        body: { action: a.action, schema: a.action === 'vacuum_analyze' && schema ? schema : undefined },
      });
      setLast(r);
      toast.success(t.toastDone(a.title, fmt.num(r.duration_ms)));
      qc.invalidateQueries({ queryKey: ['platform-storage'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card title={<span className="flex items-center gap-2"><Wrench className="size-4" /> {t.title}</span>}>
      <div className="grid gap-3 md:grid-cols-2">
        {actions.map((a) => (
          <div key={a.action} className="flex flex-col justify-between gap-3 rounded-none border border-b2b-line p-4">
            <div>
              <p className="font-bold">{a.title}</p>
              <p className="mt-1 text-sm text-b2b-muted">{a.body}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {a.action === 'vacuum_analyze' && (
                <Select value={schema} onChange={(e) => setSchema(e.target.value)} className="w-44 py-1.5 text-sm" aria-label="Schema">
                  <option value="">{t.allSchemas}</option>
                  {schemas.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </Select>
              )}
              <WriteButton size="sm" variant="ink" icon={<Play className="size-4" />} loading={busy === a.action} disabled={!!busy && busy !== a.action} onClick={() => run(a)}>
                {t.run}
              </WriteButton>
            </div>
          </div>
        ))}
      </div>
      {last && (
        <div className="mt-4 rounded-none border border-b2b-line bg-b2b-bg p-3">
          <p className="mb-2 text-xs font-bold text-b2b-muted">
            {t.result} <span className="font-mono text-b2b-ink">{last.action}</span> · {fmt.num(last.duration_ms)} ms
          </p>
          <pre className="max-h-64 overflow-auto font-mono text-[11px] whitespace-pre-wrap">{JSON.stringify(last.result, null, 2)}</pre>
        </div>
      )}
    </Card>
  );
}

// ---------- /admin/platform/backups ----------
const BACKUP_TONE = { RUNNING: 'blue', COMPLETED: 'green', FAILED: 'red' } as const;

export function PlatformBackups() {
  const d = useDict('admin');
  const t = d.backups;
  const BACKUP_LABEL: Record<string, string> = t.status;
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
      toast.success(t.toastStarted);
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
    if (!confirm(t.confirmDelete(b.filename))) return;
    setBusy(b.id);
    try {
      await api(`/v1/admin/platform/backups/${b.id}`, { method: 'DELETE' });
      toast.success(t.toastDeleted);
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
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <WriteButton variant="ink" icon={<Plus className="size-4" />} disabled={running} onClick={() => setCreating(true)}>
            {t.createNow}
          </WriteButton>
        }
      />
      <ReadOnlyNote>{t.readOnly}</ReadOnlyNote>
      <QueryState q={q}>
        {sched && (
          <Card
            className="mb-6"
            title={t.schedule}
            action={
              <Link to="/admin/platform/settings?group=storage" className="text-xs font-bold underline">
                {t.changeInSettings}
              </Link>
            }
          >
            <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <Mini label={t.statusLabel} value={<Badge tone={sched.enabled ? 'green' : 'neutral'}>{sched.enabled ? t.enabled : t.disabled}</Badge>} />
              <Mini label={t.interval} value={t.hours(sched.interval_hours)} />
              <Mini label={t.kept} value={t.keepLast(sched.keep)} />
              <Mini label={t.next} value={sched.enabled ? fmt.dateTime(sched.next_run_at) : '—'} />
            </dl>
          </Card>
        )}
        {q.data && !q.data.data.length ? (
          <Empty title={t.emptyTitle} body={t.emptyBody} />
        ) : (
          <Table head={[...t.head]}>
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
                  <Badge tone={b.trigger === 'manual' ? 'purple' : 'neutral'}>{b.trigger === 'manual' ? t.manual : t.scheduled}</Badge>
                </td>
                <td className="max-w-xs px-4 py-2.5 text-xs">{b.note ?? '—'}</td>
                <td className="px-4 py-2.5 text-xs">{b.created_by ?? t.system}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">{fmt.dateTime(b.finished_at)}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <div className="flex justify-end gap-2">
                    {b.status === 'COMPLETED' && (
                      <WriteButton size="sm" variant="outline-ink" aria-label={d.storage.downloadAria(b.filename)} loading={busy === b.id} onClick={() => download(b)}>
                        <Download className="size-4" />
                      </WriteButton>
                    )}
                    {b.status !== 'RUNNING' && (
                      <WriteButton size="sm" variant="outline-ink" aria-label={d.storage.deleteAria(b.filename)} disabled={busy === b.id} onClick={() => remove(b)}>
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

      <Modal open={creating && sup} onClose={() => setCreating(false)} title={t.createNow}>
        <p className="mb-3 text-sm text-b2b-muted">{t.createBody}</p>
        <Field label={t.note} hint={t.optional}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.notePlaceholder} className="min-h-20" />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline-ink" onClick={() => setCreating(false)}>
            {d.common.cancel}
          </Button>
          <Button variant="ink" loading={busy === 'create'} onClick={create}>
            {t.start}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
