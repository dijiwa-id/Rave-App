import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, ImageOff, ListMusic, Plus, RotateCcw, Search, Trash2, Upload, X } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { useDict } from '@/lib/i18n';
import type { Track } from '@/lib/types';
import { Badge, Button, confirmDialog, cx, Field, Input, Modal, PageHeader, Textarea, toast } from '@/components/ui';
import { Empty, QueryState } from '@/components/b2b/common';

/**
 * Back Office → Konten → Playlist Editorial (izin `library.curate`). Kurator membuat playlist milik RAVE, menyusun lagu,
 * menentukan sampul & tag, lalu menayangkannya di beranda/Jelajahi. Draf tidak terlihat publik. API: docs/API.md §3.
 */

interface EditorialPlaylist {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  has_custom_cover: boolean;
  tags: string[];
  sort_order: number;
  published: boolean;
  track_count: number;
  created_at: string;
  updated_at: string;
}
type Item = { item_id: string; added_at: string; track: Track & { unavailable?: boolean } };
type Detail = EditorialPlaylist & { items: Item[] };

const STATUSES = ['all', 'published', 'draft'] as const;
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const parseTags = (s: string) => [...new Set(s.split(/[,\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean))];

export function AdminEditorial() {
  const t = useDict('admin').editorial;
  const common = useDict('admin').common;
  const qc = useQueryClient();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useQuery({
    queryKey: ['admin-editorial', status, search],
    queryFn: () => api<{ data: EditorialPlaylist[] }>('/v1/admin/library/playlists', { query: { status, q: search || undefined } }),
  });
  const rows = list.data?.data ?? [];
  // Urutan hanya bisa diubah dari tampilan lengkap (tanpa filter) agar posisi relatif tidak salah tafsir.
  const canReorder = status === 'all' && !search;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-editorial'] });
    qc.invalidateQueries({ queryKey: ['featured'] });
  };

  useEffect(() => {
    if (!selected && rows.length) setSelected(rows[0].id);
  }, [rows, selected]);

  async function move(idx: number, dir: -1 | 1) {
    const ids = rows.map((r) => r.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    try {
      await api('/v1/admin/library/playlists/order', { method: 'PUT', body: { ids } });
      refresh();
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
          <Button variant="ink" icon={<Plus />} onClick={() => setCreating(true)}>
            {t.create}
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={cx('border px-3 py-1.5 text-xs font-bold', status === s ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted hover:text-b2b-ink')}
              >
                {t.filters[s]}
              </button>
            ))}
          </div>
          <label className="relative mb-3 block">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-b2b-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.search} className="pl-9" aria-label={t.search} />
          </label>
          {!canReorder && rows.length > 1 && <p className="mb-2 text-xs text-b2b-muted">{t.reorderHint}</p>}
          <QueryState q={list} empty={list.data && !rows.length ? <Empty title={t.empty} body={t.emptyBody} /> : undefined}>
            <ol className="divide-y divide-b2b-line border border-b2b-line bg-b2b-card">
              {rows.map((p, i) => (
                <li key={p.id} className={cx('flex items-center gap-3 p-2.5', selected === p.id && 'bg-b2b-bg outline-2 -outline-offset-2 outline-b2b-ink')}>
                  <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setSelected(p.id)}>
                    <Cover url={p.cover_url} className="size-12 shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold">{p.title}</span>
                      <span className="flex items-center gap-1.5 text-xs text-b2b-muted">
                        <Badge tone={p.published ? 'green' : 'amber'}>{p.published ? t.published : t.draft}</Badge>
                        {t.tracks(p.track_count)}
                      </span>
                    </span>
                  </button>
                  {canReorder && (
                    <span className="flex flex-col">
                      <button className="p-0.5 text-b2b-muted hover:text-b2b-ink disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t.moveUp}>
                        <ArrowUp className="size-4" />
                      </button>
                      <button className="p-0.5 text-b2b-muted hover:text-b2b-ink disabled:opacity-30" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={t.moveDown}>
                        <ArrowDown className="size-4" />
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </QueryState>
        </section>
        <section className="min-w-0">
          {selected ? (
            <Editor key={selected} id={selected} onChanged={refresh} onDeleted={() => (setSelected(null), refresh())} />
          ) : (
            <Empty title={t.pick} />
          )}
        </section>
      </div>
      {creating && (
        <CreateModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setStatus('all');
            setSearch('');
            setSelected(id);
            refresh();
          }}
        />
      )}
      <span className="sr-only">{common.auditHint}</span>
    </div>
  );
}

function Cover({ url, className }: { url: string | null; className?: string }) {
  return url ? (
    <img src={url} alt="" loading="lazy" className={cx('aspect-square object-cover', className)} />
  ) : (
    <span className={cx('grid aspect-square place-items-center bg-b2b-bg text-b2b-muted', className)}>
      <ListMusic className="size-5" />
    </span>
  );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const t = useDict('admin').editorial;
  const common = useDict('admin').common;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const r = await api<Detail>('/v1/admin/library/playlists', { body: { title: title.trim(), description: description.trim() || null } });
      toast.success(t.created);
      onCreated(r.id);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={t.create}>
      <div className="space-y-4">
        <Field label={t.fTitle}>
          <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label={t.fDescription}>
          <Textarea rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <p className="text-xs text-b2b-muted">{t.createHint}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline-ink" onClick={onClose}>
            {common.cancel}
          </Button>
          <Button variant="ink" loading={busy} disabled={!title.trim()} onClick={submit}>
            {t.create}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Editor({ id, onChanged, onDeleted }: { id: string; onChanged: () => void; onDeleted: () => void }) {
  const t = useDict('admin').editorial;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-editorial-detail', id], queryFn: () => api<Detail>(`/v1/admin/library/playlists/${id}`) });
  const p = q.data;
  const [form, setForm] = useState({ title: '', description: '', tags: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (p) setForm({ title: p.title, description: p.description ?? '', tags: p.tags.join(', ') });
  }, [p?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const tags = parseTags(form.tags);
  const badTag = tags.find((x) => !TAG_RE.test(x));
  const dirty = !!p && (form.title.trim() !== p.title || (form.description.trim() || null) !== (p.description || null) || tags.join(',') !== p.tags.join(','));

  const reload = (d?: Detail) => {
    if (d) qc.setQueryData(['admin-editorial-detail', id], d);
    else qc.invalidateQueries({ queryKey: ['admin-editorial-detail', id] });
    onChanged();
  };
  async function patch(body: Record<string, unknown>, key: string, ok?: string) {
    setBusy(key);
    try {
      reload(await api<Detail>(`/v1/admin/library/playlists/${id}`, { method: 'PATCH', body }));
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }
  async function removeItem(it: Item) {
    try {
      await api(`/v1/library/playlists/${id}/items/${it.item_id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      toast.error(e);
    }
  }
  async function moveItem(idx: number, dir: -1 | 1) {
    if (!p) return;
    const items = p.items;
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    // Endpoint "move" menaruh lagu setelah item lain (null = paling atas).
    const after = dir === -1 ? (j === 0 ? null : items[j - 1].item_id) : items[j].item_id;
    try {
      await api(`/v1/library/playlists/${id}/items/${items[idx].item_id}/move`, { body: { after_item_id: after } });
      reload();
    } catch (e) {
      toast.error(e);
    }
  }
  async function remove() {
    if (!p) return;
    const ok = await confirmDialog({ title: t.deleteTitle, body: t.deleteBody, confirmLabel: t.delete, danger: true, image: p.cover_url, detail: `${p.title} · ${t.tracks(p.track_count)}` });
    if (!ok) return;
    try {
      await api(`/v1/admin/library/playlists/${id}`, { method: 'DELETE' });
      toast.success(t.deleted);
      onDeleted();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <QueryState q={q}>
      {p && (
        <div className="border border-b2b-line bg-b2b-card">
          <div className="flex flex-col gap-4 border-b border-b2b-line p-4 sm:flex-row">
            <div className="w-full shrink-0 sm:w-44">
              <Cover url={p.cover_url} className="w-full" />
              <div className="mt-2 flex flex-wrap gap-1.5">
                <label className="inline-flex cursor-pointer items-center gap-1.5 border border-b2b-line px-2.5 py-1 text-xs font-bold hover:border-b2b-ink">
                  <Upload className="size-3.5" /> {busy === 'cover' ? t.uploading : t.uploadCover}
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="sr-only"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      setBusy('cover');
                      try {
                        const url = await uploadFile(f, 'artwork', 'playlist');
                        await patch({ cover_url: url }, 'cover', t.coverSaved);
                      } catch (err) {
                        toast.error(err);
                        setBusy(null);
                      }
                    }}
                  />
                </label>
                {p.has_custom_cover && (
                  <button className="inline-flex items-center gap-1 px-2 py-1 text-xs text-b2b-muted hover:text-b2b-ink" onClick={() => patch({ cover_url: null }, 'cover', t.coverReset)}>
                    <RotateCcw className="size-3.5" /> {t.autoCover}
                  </button>
                )}
              </div>
              {!p.has_custom_cover && <p className="mt-1 text-[11px] text-b2b-muted">{p.cover_url ? t.autoCoverHint : t.noCoverHint}</p>}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={p.published ? 'green' : 'amber'}>{p.published ? t.published : t.draft}</Badge>
                <span className="text-xs text-b2b-muted">{t.updated(fmt.dateTime(p.updated_at))}</span>
                <span className="ml-auto flex gap-2">
                  <Button
                    size="sm"
                    variant={p.published ? 'outline-ink' : 'ink'}
                    icon={p.published ? <EyeOff /> : <Eye />}
                    loading={busy === 'pub'}
                    disabled={!p.published && p.track_count === 0}
                    title={!p.published && p.track_count === 0 ? t.publishNeedsTracks : undefined}
                    onClick={() => patch({ published: !p.published }, 'pub', p.published ? t.unpublishedOk : t.publishedOk)}
                  >
                    {p.published ? t.unpublish : t.publish}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={remove} aria-label={t.delete} title={t.delete} />
                </span>
              </div>
              <Field label={t.fTitle}>
                <Input value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </Field>
              <Field label={t.fDescription}>
                <Textarea rows={2} maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
              <Field label={t.fTags} hint={t.tagsHint} error={badTag ? t.badTag(badTag) : tags.length > 12 ? t.tooManyTags : undefined}>
                <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="chill, indie-lokal" />
              </Field>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="ink"
                  icon={<Check />}
                  loading={busy === 'meta'}
                  disabled={!dirty || !form.title.trim() || !!badTag || tags.length > 12}
                  onClick={() => patch({ title: form.title.trim(), description: form.description.trim() || null, tags }, 'meta', t.saved)}
                >
                  {t.save}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 px-4 pt-4">
            <h3 className="text-sm font-bold">
              {t.trackList} <span className="font-normal text-b2b-muted">· {t.tracks(p.track_count)}</span>
            </h3>
            <Button size="sm" variant="outline-ink" icon={<Plus />} onClick={() => setAdding(true)}>
              {t.addTracks}
            </Button>
          </div>
          {p.items.length ? (
            <ol className="m-4 divide-y divide-b2b-line border border-b2b-line">
              {p.items.map((it, i) => (
                <li key={it.item_id} className="flex items-center gap-3 px-2.5 py-2">
                  <span className="w-6 text-right font-mono text-xs text-b2b-muted">{i + 1}</span>
                  <Cover url={it.track.release?.cover_url ?? null} className="size-9 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className={cx('block truncate text-sm font-bold', it.track.unavailable && 'text-b2b-muted line-through')}>{it.track.title}</span>
                    <span className="block truncate text-xs text-b2b-muted">
                      {it.track.unavailable ? t.unavailable : `${it.track.artist?.name ?? ''} · ${it.track.release?.title ?? ''}`}
                    </span>
                  </span>
                  <span className="hidden font-mono text-xs text-b2b-muted sm:block">{it.track.duration_ms ? fmt.duration(it.track.duration_ms) : ''}</span>
                  <span className="flex items-center">
                    <button className="p-1 text-b2b-muted hover:text-b2b-ink disabled:opacity-30" disabled={i === 0} onClick={() => moveItem(i, -1)} aria-label={t.moveUp}>
                      <ArrowUp className="size-4" />
                    </button>
                    <button className="p-1 text-b2b-muted hover:text-b2b-ink disabled:opacity-30" disabled={i === p.items.length - 1} onClick={() => moveItem(i, 1)} aria-label={t.moveDown}>
                      <ArrowDown className="size-4" />
                    </button>
                    <button className="p-1 text-b2b-muted hover:text-red-600" onClick={() => removeItem(it)} aria-label={t.removeTrack}>
                      <X className="size-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="m-4">
              <Empty title={t.noTracks} body={t.noTracksBody} />
            </div>
          )}
          {adding && <AddTracksModal playlist={p} onClose={() => setAdding(false)} onAdded={() => (setAdding(false), reload())} />}
        </div>
      )}
    </QueryState>
  );
}

function AddTracksModal({ playlist, onClose, onAdded }: { playlist: Detail; onClose: () => void; onAdded: () => void }) {
  const t = useDict('admin').editorial;
  const common = useDict('admin').common;
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picked, setPicked] = useState<Map<string, Track>>(new Map());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(h);
  }, [q]);
  const res = useQuery({
    queryKey: ['editorial-track-search', debounced],
    queryFn: () => api<{ tracks: Track[] }>('/v1/catalog/search', { query: { q: debounced, type: 'track' } }),
    enabled: debounced.length >= 2,
  });
  const have = useMemo(() => new Set(playlist.items.map((i) => i.track.id)), [playlist.items]);
  const toggle = (tr: Track) =>
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(tr.id)) n.delete(tr.id);
      else n.set(tr.id, tr);
      return n;
    });
  async function submit() {
    setBusy(true);
    try {
      const r = await api<{ added: unknown[]; skipped_duplicates: number }>(`/v1/admin/library/playlists/${playlist.id}/items`, { body: { track_ids: [...picked.keys()] } });
      toast.success(t.addedN(r.added.length, r.skipped_duplicates));
      onAdded();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={t.addTitle(playlist.title)} wide>
      <div className="space-y-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-b2b-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.searchTracks} className="pl-9" autoFocus aria-label={t.searchTracks} />
        </label>
        <div className="max-h-[50vh] overflow-y-auto border border-b2b-line">
          {debounced.length < 2 ? (
            <p className="p-6 text-center text-sm text-b2b-muted">{t.typeToSearch}</p>
          ) : res.isLoading ? (
            <p className="p-6 text-center text-sm text-b2b-muted">…</p>
          ) : !res.data?.tracks.length ? (
            <p className="p-6 text-center text-sm text-b2b-muted">{t.noResults}</p>
          ) : (
            <ul className="divide-y divide-b2b-line">
              {res.data.tracks.map((tr) => {
                const inList = have.has(tr.id);
                const on = picked.has(tr.id);
                return (
                  <li key={tr.id}>
                    <button disabled={inList} onClick={() => toggle(tr)} className={cx('flex w-full items-center gap-3 px-3 py-2 text-left', on && 'bg-b2b-bg', inList ? 'opacity-50' : 'hover:bg-b2b-bg')}>
                      <span className={cx('grid size-5 shrink-0 place-items-center border', on || inList ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line')}>
                        {(on || inList) && <Check className="size-3.5" />}
                      </span>
                      {tr.release?.cover_url ? <img src={tr.release.cover_url} alt="" className="size-9 object-cover" /> : <ImageOff className="size-9 p-2 text-b2b-muted" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{tr.title}</span>
                        <span className="block truncate text-xs text-b2b-muted">
                          {tr.artist?.name} · {tr.release?.title}
                          {inList && ` · ${t.alreadyIn}`}
                        </span>
                      </span>
                      <span className="font-mono text-xs text-b2b-muted">{fmt.duration(tr.duration_ms)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-b2b-muted">{t.selectedN(picked.size)}</span>
          <span className="flex gap-2">
            <Button variant="outline-ink" onClick={onClose}>
              {common.cancel}
            </Button>
            <Button variant="ink" loading={busy} disabled={!picked.size} onClick={submit}>
              {t.addSelected}
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  );
}
