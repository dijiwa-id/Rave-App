import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ImageOff, MessageSquareWarning, RefreshCcw, Search, Upload, X } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { useDict } from '@/lib/i18n';
import { Badge, Button, cx, Field, Input, Modal, PageHeader, Textarea, toast } from '@/components/ui';
import { Empty, QueryState } from '@/components/b2b/common';

/**
 * Kurasi artwork (Super Admin): galeri sampul semua rilis yang diunggah artis/manajemen. Tinjau pengajuan ganti sampul,
 * temukan artwork bermasalah (kosong, eksternal, tidak persegi, resolusi rendah), ganti langsung atau minta artis mengganti.
 * Setiap tindakan beralasan, tercatat di audit, dan dinotifikasi ke artis.
 */

type Size = { width: number; height: number; bytes: number } | null;
interface ArtworkRow {
  id: string;
  title: string;
  status: string;
  artist_name: string;
  cover_url: string | null;
  size: Size;
  issues: ('missing' | 'external' | 'not_square' | 'low_res')[];
  pending_cover: { url: string; submitted_at: string; size: Size } | null;
  review_note: string | null;
  updated_at: string;
}

const FILTERS = ['pending', 'issues', 'all'] as const;
const dims = (s: Size) => (s ? `${s.width}×${s.height}` : '—');

export function PlatformArtwork() {
  const t = useDict('admin').artwork;
  const common = useDict('admin').common;
  const qc = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('pending');
  const [search, setSearch] = useState('');
  const [act, setAct] = useState<{ row: ArtworkRow; kind: 'replace' | 'request' | 'reject' } | null>(null);
  const [reason, setReason] = useState('');
  const [newCover, setNewCover] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['admin-artwork', filter, search],
    queryFn: () => api<{ data: ArtworkRow[] }>('/v1/admin/artwork', { query: { filter, q: search || undefined } }),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-artwork'] });
    qc.invalidateQueries({ queryKey: ['qc-covers'] });
  };

  async function approve(r: ArtworkRow) {
    try {
      await api(`/v1/admin/qc/covers/${r.id}/decision`, { body: { approve: true } });
      toast.success(t.approved);
      refresh();
    } catch (e) {
      toast.error(e);
    }
  }
  async function submit() {
    if (!act) return;
    setBusy(true);
    try {
      if (act.kind === 'reject') await api(`/v1/admin/qc/covers/${act.row.id}/decision`, { body: { approve: false, reason } });
      else if (act.kind === 'request') await api(`/v1/admin/artwork/${act.row.id}/request-change`, { body: { reason } });
      else await api(`/v1/admin/artwork/${act.row.id}/replace`, { body: { cover_url: newCover, reason } });
      toast.success(act.kind === 'replace' ? t.replaced : act.kind === 'request' ? t.requested : t.rejected);
      setAct(null);
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  const open = (row: ArtworkRow, kind: 'replace' | 'request' | 'reject') => {
    setReason('');
    setNewCover(null);
    setAct({ row, kind });
  };

  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cx('rounded-none border px-3 py-1.5 text-xs font-bold', filter === f ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted hover:text-b2b-ink')}
          >
            {t.filters[f]}
          </button>
        ))}
        <label className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-b2b-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.search} className="pl-9" aria-label={t.search} />
        </label>
      </div>

      <QueryState q={q} empty={q.data && !q.data.data.length ? <Empty title={t.empty[filter]} /> : undefined}>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {q.data?.data.map((r) => (
            <li key={r.id} className="flex flex-col border border-b2b-line bg-b2b-card">
              <div className={cx('grid gap-px bg-b2b-line', r.pending_cover ? 'grid-cols-2' : 'grid-cols-1')}>
                <figure className="relative bg-b2b-bg">
                  {r.cover_url ? (
                    <img src={r.cover_url} alt="" loading="lazy" className={cx('aspect-square w-full object-cover', r.pending_cover && 'opacity-75')} />
                  ) : (
                    <div className="grid aspect-square place-items-center text-b2b-muted">
                      <ImageOff className="size-8" />
                    </div>
                  )}
                  <figcaption className="absolute bottom-1.5 left-1.5 bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
                    {r.pending_cover ? t.current : ''} {dims(r.size)}
                  </figcaption>
                </figure>
                {r.pending_cover && (
                  <figure className="relative bg-b2b-bg">
                    <img src={r.pending_cover.url} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                    <figcaption className="absolute bottom-1.5 left-1.5 bg-amber-400 px-1.5 py-0.5 font-mono text-[10px] font-bold text-black">
                      {t.proposed} {dims(r.pending_cover.size)}
                    </figcaption>
                  </figure>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <div>
                  <p className="truncate font-bold">{r.title}</p>
                  <p className="truncate text-xs text-b2b-muted">
                    {r.artist_name} · {r.status}
                    {r.pending_cover && ` · ${t.submittedAt(fmt.dateTime(r.pending_cover.submitted_at))}`}
                  </p>
                </div>
                {r.issues.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {r.issues.map((i) => (
                      <Badge key={i} tone={i === 'missing' || i === 'external' ? 'red' : 'amber'}>
                        {t.issues[i]}
                      </Badge>
                    ))}
                  </div>
                )}
                {r.review_note && <p className="text-xs text-b2b-muted italic">{r.review_note}</p>}
                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  {r.pending_cover && (
                    <>
                      <Button size="sm" variant="ink" icon={<Check className="size-3.5" />} onClick={() => approve(r)}>
                        {common.approve}
                      </Button>
                      <Button size="sm" variant="outline-ink" icon={<X className="size-3.5" />} onClick={() => open(r, 'reject')}>
                        {common.reject}
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" icon={<RefreshCcw className="size-3.5" />} onClick={() => open(r, 'replace')}>
                    {t.replace}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<MessageSquareWarning className="size-3.5" />} onClick={() => open(r, 'request')}>
                    {t.requestChange}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </QueryState>

      {act && (
        <Modal open onClose={() => setAct(null)} title={act.kind === 'replace' ? t.replaceTitle : act.kind === 'request' ? t.requestTitle : t.rejectTitle}>
          <div className="space-y-4 text-sm">
            <p>
              <strong>{act.row.title}</strong> — {act.row.artist_name}
            </p>
            {act.kind === 'replace' && (
              <div className="flex items-center gap-3">
                {newCover ? <img src={newCover} alt="" className="size-24 object-cover" /> : <div className="grid size-24 place-items-center bg-b2b-bg text-xs text-b2b-muted">{t.noFile}</div>}
                <label className="inline-flex cursor-pointer items-center gap-1.5 border border-b2b-line px-3 py-1.5 text-sm font-bold hover:border-b2b-ink">
                  <Upload className="size-4" /> {busy ? t.uploading : t.upload}
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="sr-only"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      setBusy(true);
                      try {
                        setNewCover(await uploadFile(f, 'artwork'));
                      } catch (err) {
                        toast.error(err);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                </label>
              </div>
            )}
            <Field label={t.reason} hint={t.reasonHint}>
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline-ink" onClick={() => setAct(null)}>
                {common.cancel}
              </Button>
              <Button variant={act.kind === 'reject' ? 'danger' : 'ink'} loading={busy} disabled={reason.trim().length < 5 || (act.kind === 'replace' && !newCover)} onClick={submit}>
                {act.kind === 'replace' ? t.replace : act.kind === 'request' ? t.requestChange : common.reject}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
