import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, OctagonX } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { LiveStatus, LiveStream, StreamHealth } from '@/lib/types';
import { Badge, Button, cx, Field, Modal, PageHeader, Select, Stat, Textarea, toast } from '@/components/ui';
import { Empty, QueryState, Table } from '@/components/b2b/common';
import { endedReason, isOnAir, LiveStatusBadge } from '@/components/live/common';

type AdminStream = LiveStream & { health: StreamHealth };

/** Back Office → Live: pantau semua siaran, hentikan (moderasi) dengan alasan. */
export function AdminLive() {
  const [status, setStatus] = useState<'' | LiveStatus>('');
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin-live', status],
    queryFn: () => api<{ data: AdminStream[] }>('/v1/admin/live/streams', { query: { status: status || undefined } }),
    refetchInterval: 5000,
  });
  const [sel, setSel] = useState<AdminStream | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = q.data?.data ?? [];
  const onAir = rows.filter((s) => isOnAir(s.status));

  async function stop() {
    setBusy(true);
    try {
      await api(`/v1/admin/live/streams/${sel!.id}/stop`, { body: { reason: reason.trim() } });
      toast.success('Siaran dihentikan');
      setSel(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['admin-live'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Live Streaming"
        subtitle="Pantau siaran, kesehatan pipa media, dan hentikan siaran yang melanggar kebijakan. Moderasi chat dilakukan di halaman tonton."
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-44">
            <option value="">Semua status</option>
            <option value="LIVE">Live</option>
            <option value="INTERRUPTED">Terputus</option>
            <option value="SCHEDULED">Terjadwal</option>
            <option value="ENDED">Selesai</option>
          </Select>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Sedang live" value={onAir.length} />
        <Stat label="Penonton aktif" value={fmt.num(onAir.reduce((n, s) => n + s.viewers, 0))} />
        <Stat label="Ada peringatan" value={onAir.filter((s) => s.health.warnings.length || s.health.transcoder === 'failed').length} />
        <Stat label="Lewat browser" value={onAir.filter((s) => s.ingest === 'browser').length} />
      </div>
      <QueryState q={q} empty={q.data && !rows.length ? <Empty title="Tidak ada siaran" /> : undefined}>
        <Table head={['Siaran', 'Org', 'Status', 'Penonton', 'Kesehatan', '']}>
          {rows.map((s) => {
            const h = s.health;
            const bad = h.transcoder === 'failed' || (h.segment_age_s ?? 0) > 20;
            return (
              <tr key={s.id}>
                <td className="px-4 py-3">
                  <p className="font-bold">{s.title}</p>
                  <p className="text-xs text-b2b-muted">
                    {s.artist?.name ?? '—'} · {s.access === 'TICKET' ? 'Bertiket' : 'Publik'}
                    {s.is_demo && ' · demo'}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <p>{s.org.name}</p>
                  <p className="text-xs text-b2b-muted">{s.org.type}</p>
                </td>
                <td className="px-4 py-3">
                  <LiveStatusBadge status={s.status} />
                  {s.status === 'ENDED' && <p className="mt-1 max-w-[220px] text-xs text-b2b-muted">{endedReason(s.ended_reason)}</p>}
                </td>
                <td className="px-4 py-3 tabular-nums">{isOnAir(s.status) ? fmt.num(s.viewers) : `${fmt.num(s.peak_viewers)} puncak`}</td>
                <td className="px-4 py-3 text-xs">
                  {isOnAir(s.status) ? (
                    <div className="space-y-0.5">
                      <p className={cx('font-semibold', bad ? 'text-red-600' : 'text-b2b-ink')}>
                        {(s.ingest ?? 'tanpa sinyal').toUpperCase()} · {h.transcoder}
                        {h.restarts > 0 && ` · ${h.restarts}× restart`}
                      </p>
                      <p className="text-b2b-muted">
                        {h.bitrate_kbps != null ? `${fmt.num(Math.round(h.bitrate_kbps))} kbps` : '— kbps'} · segmen {h.segment_age_s != null ? `${h.segment_age_s.toFixed(0)} dtk` : '—'}
                      </p>
                      {h.warnings.length > 0 && (
                        <p className="flex items-center gap-1 text-amber-600" title={h.warnings.join('\n')}>
                          <AlertTriangle className="size-3" /> {h.warnings.length} peringatan
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className="text-b2b-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <a href={`/app/live/${s.id}`} target="_blank" rel="noreferrer" aria-label="Tonton" className="grid size-8 place-items-center rounded-full border border-b2b-line hover:border-b2b-ink">
                      <ExternalLink className="size-4" />
                    </a>
                    {s.status !== 'ENDED' && (
                      <Button size="sm" variant="danger" icon={<OctagonX className="size-4" />} onClick={() => setSel(s)}>
                        Hentikan
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      </QueryState>
      <Modal open={!!sel} onClose={() => setSel(null)} title="Hentikan siaran">
        <p className="mb-3 text-sm text-b2b-muted">
          <b className="text-b2b-ink">{sel?.title}</b> akan langsung diakhiri untuk semua penonton dan tidak bisa dilanjutkan. Alasan dicatat di audit log.
        </p>
        <Field label="Alasan moderasi" hint="min. 5 karakter">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. Konten melanggar hak cipta" />
        </Field>
        <div className="mt-4 flex items-center justify-between gap-3">
          {sel && <Badge tone="red">{fmt.num(sel.viewers)} penonton akan terputus</Badge>}
          <Button variant="danger" loading={busy} disabled={reason.trim().length < 5} onClick={stop}>
            Hentikan siaran
          </Button>
        </div>
      </Modal>
    </div>
  );
}
