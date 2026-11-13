import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ImagePlus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import { IMAGE_ACCEPT, uploadFile } from '@/lib/upload';
import { useDict } from '@/lib/i18n';
import { Badge, Button, cx, Field, Input, Modal, PageHeader, toast } from '@/components/ui';
import { Empty, QueryState } from '@/components/b2b/common';

/**
 * Kategori Jelajahi (Super Admin): tambah, ubah, hapus, urutkan, dan unggah gambar sampul. Sumber yang sama dipakai
 * tab Cari di web, desktop & mobile (`GET /v1/catalog/browse`). Setiap perubahan tercatat di audit.
 */

interface CategoryRow {
  id: string;
  name: string;
  color: string;
  image_url: string | null;
  href: string;
  genres: string[];
  position: number;
  updated_at: string | null;
}
type Draft = { id: string; name: string; color: string; image_url: string | null; genres: string[]; linkMode: 'genre' | 'custom'; href: string };

/** Tujuan tile selain halaman kategori (rute aplikasi yang dikenali web, desktop & mobile). */
const LINK_PRESETS = ['/app/podcasts', '/app/podcasts?kind=FICTION', '/app/events', '/app/live', '/app'] as const;
const SWATCHES = ['#8d67ab', '#e8115b', '#27856a', '#1e3264', '#bc5900', '#7358ff', '#148a08', '#e91429', '#503750', '#0d73ec', '#af2896', '#5b2a6e'];

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' dan ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** Pratinjau tile persis seperti di tab Cari (warna + gambar miring di pojok). */
function Tile({ name, color, image, className, small }: { name: string; color: string; image: string | null; className?: string; small?: boolean }) {
  return (
    <div className={cx('relative aspect-square overflow-hidden', small ? 'p-1.5' : 'p-3', className)} style={{ background: color }}>
      <span className={cx('block font-bold text-white [overflow-wrap:normal] [hyphens:auto]', small ? 'line-clamp-3 text-[10px] leading-tight' : 'text-base')}>{name || '—'}</span>
      {image && <img src={image} alt="" className="absolute -right-3 -bottom-1.5 size-[45%] rotate-[25deg] object-cover shadow-[0_2px_4px_rgba(0,0,0,0.2)]" />}
    </div>
  );
}

export function PlatformCategories() {
  const t = useDict('admin').categories;
  const common = useDict('admin').common;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-categories'], queryFn: () => api<{ data: CategoryRow[] }>('/v1/admin/catalog/categories') });
  const genres = useQuery({ queryKey: ['genres'], queryFn: () => api<{ data: { id: string; name: string }[] }>('/v1/catalog/genres'), staleTime: 300_000 });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // id kategori yang diubah; null = tambah baru
  const [idTouched, setIdTouched] = useState(false);
  const [removing, setRemoving] = useState<CategoryRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const rows = q.data?.data ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-categories'] });
    qc.invalidateQueries({ queryKey: ['browse'] });
  };

  function openNew() {
    setEditing(null);
    setIdTouched(false);
    setDraft({ id: '', name: '', color: SWATCHES[rows.length % SWATCHES.length]!, image_url: null, genres: [], linkMode: 'genre', href: '' });
  }
  function openEdit(c: CategoryRow) {
    setEditing(c.id);
    const genreLink = c.href === `/app/genre/${c.id}`;
    setDraft({ id: c.id, name: c.name, color: c.color, image_url: c.image_url, genres: c.genres ?? [], linkMode: genreLink ? 'genre' : 'custom', href: genreLink ? '' : c.href });
  }

  async function pickImage(f: File | undefined) {
    if (!f || !draft) return;
    setUploading(true);
    try {
      const url = await uploadFile(f, 'artwork', 'category');
      setDraft((d) => (d ? { ...d, image_url: url } : d));
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    const body = {
      name: draft.name.trim(),
      color: draft.color,
      image_url: draft.image_url,
      genres: draft.genres,
      href: draft.linkMode === 'genre' ? null : draft.href.trim(),
    };
    try {
      if (editing) await api(`/v1/admin/catalog/categories/${encodeURIComponent(editing)}`, { method: 'PATCH', body });
      else await api('/v1/admin/catalog/categories', { body: { ...body, id: draft.id } });
      toast.success(editing ? t.saved(body.name) : t.created(body.name));
      setDraft(null);
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function move(i: number, dir: -1 | 1) {
    const ids = rows.map((r) => r.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    // Optimistis: urutan langsung berubah di layar.
    qc.setQueryData(['admin-categories'], { data: ids.map((id) => rows.find((r) => r.id === id)!) });
    try {
      await api('/v1/admin/catalog/categories/order', { method: 'PUT', body: { ids } });
      refresh();
    } catch (e) {
      toast.error(e);
      refresh();
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api(`/v1/admin/catalog/categories/${encodeURIComponent(removing.id)}`, { method: 'DELETE' });
      toast.success(t.deleted(removing.name));
      setRemoving(null);
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  const valid = !!draft && draft.name.trim().length > 0 && /^#[0-9a-f]{6}$/i.test(draft.color) && (editing || /^[a-z0-9]+(-[a-z0-9]+)*$/.test(draft.id)) && (draft.linkMode === 'genre' || /^\/app(\/|$|\?)/.test(draft.href.trim()));
  const genreName = (id: string) => genres.data?.data.find((g) => g.id === id)?.name ?? id;

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <Button variant="ink" icon={<Plus className="size-4" />} onClick={openNew}>
            {t.add}
          </Button>
        }
      />
      <QueryState q={q} empty={q.data && !rows.length ? <Empty title={t.empty} /> : undefined}>
        <div className="divide-y divide-b2b-line border border-b2b-line bg-white">
          {rows.map((c, i) => (
            <div key={c.id} className="flex items-center gap-4 px-4 py-3">
              <div className="flex flex-col">
                <button type="button" title={t.moveUp} aria-label={t.moveUp} disabled={i === 0} onClick={() => move(i, -1)} className="grid size-7 place-items-center text-b2b-muted hover:text-b2b-ink disabled:opacity-30">
                  <ArrowUp className="size-4" />
                </button>
                <button type="button" title={t.moveDown} aria-label={t.moveDown} disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="grid size-7 place-items-center text-b2b-muted hover:text-b2b-ink disabled:opacity-30">
                  <ArrowDown className="size-4" />
                </button>
              </div>
              <Tile small name={c.name} color={c.color} image={c.image_url} className="w-16 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{c.name}</p>
                <p className="truncate font-mono text-xs text-b2b-muted">
                  {c.id} → {c.href}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.href.startsWith('/app/genre/') ? (
                    c.genres?.length ? c.genres.map((g) => <Badge key={g}>{genreName(g)}</Badge>) : <Badge tone="amber">{t.allGenres}</Badge>
                  ) : (
                    <Badge tone="blue">{t.customLink}</Badge>
                  )}
                  {!c.image_url && <Badge tone="red">{t.noImage}</Badge>}
                </div>
              </div>
              <span className="hidden w-28 text-right text-xs text-b2b-muted md:block">{c.updated_at ? fmt.date(c.updated_at) : '—'}</span>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="outline-ink" icon={<Pencil className="size-4" />} onClick={() => openEdit(c)}>
                  {t.edit}
                </Button>
                <Button size="sm" variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setRemoving(c)} aria-label={`${t.delete} ${c.name}`}>
                  <span className="hidden lg:inline">{t.delete}</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      </QueryState>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={editing ? t.editTitle : t.addTitle} wide>
        {draft && (
          <div className="grid gap-6 md:grid-cols-[1fr_200px]">
            <div className="space-y-4">
              <Field label={t.name}>
                <Input
                  value={draft.name}
                  maxLength={40}
                  autoFocus
                  onChange={(e) => {
                    const name = e.target.value;
                    setDraft({ ...draft, name, id: editing || idTouched ? draft.id : slugify(name) });
                  }}
                  placeholder={t.namePlaceholder}
                />
              </Field>
              <Field label={t.id} hint={editing ? t.idLocked : t.idHint}>
                <Input
                  value={draft.id}
                  disabled={!!editing}
                  maxLength={40}
                  className="font-mono"
                  onChange={(e) => {
                    setIdTouched(true);
                    setDraft({ ...draft, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') });
                  }}
                />
              </Field>
              <Field label={t.color}>
                <div className="flex flex-wrap items-center gap-2">
                  {SWATCHES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-label={s}
                      title={s}
                      onClick={() => setDraft({ ...draft, color: s })}
                      className={cx('size-7 border-2', draft.color.toLowerCase() === s ? 'border-b2b-ink' : 'border-transparent')}
                      style={{ background: s }}
                    />
                  ))}
                  <input type="color" aria-label={t.customColor} value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} className="h-7 w-10 cursor-pointer border border-b2b-line bg-white" />
                  <span className="font-mono text-xs text-b2b-muted">{draft.color}</span>
                </div>
              </Field>
              <Field label={t.image} hint={t.imageHint}>
                <div className="flex flex-wrap items-center gap-2">
                  <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} className="hidden" onChange={(e) => pickImage(e.target.files?.[0])} />
                  <Button size="sm" variant="outline-ink" icon={<ImagePlus className="size-4" />} loading={uploading} onClick={() => fileRef.current?.click()}>
                    {draft.image_url ? t.replaceImage : t.uploadImage}
                  </Button>
                  {draft.image_url && (
                    <Button size="sm" variant="outline-ink" icon={<X className="size-4" />} onClick={() => setDraft({ ...draft, image_url: null })}>
                      {t.removeImage}
                    </Button>
                  )}
                </div>
              </Field>
              <Field label={t.link}>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    {(['genre', 'custom'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setDraft({ ...draft, linkMode: m, href: m === 'custom' && !draft.href ? LINK_PRESETS[0] : draft.href })}
                        className={cx('border px-3 py-1.5 text-sm font-bold', draft.linkMode === m ? 'border-b2b-ink bg-b2b-ink text-white' : 'border-b2b-line bg-white hover:border-b2b-ink')}
                      >
                        {m === 'genre' ? t.linkGenre : t.linkCustom}
                      </button>
                    ))}
                  </div>
                  {draft.linkMode === 'custom' && (
                    <>
                      <Input value={draft.href} onChange={(e) => setDraft({ ...draft, href: e.target.value })} className="font-mono" placeholder="/app/podcasts" />
                      <div className="flex flex-wrap gap-1.5">
                        {LINK_PRESETS.map((h) => (
                          <button key={h} type="button" onClick={() => setDraft({ ...draft, href: h })} className="border border-b2b-line bg-white px-2 py-0.5 font-mono text-[11px] hover:border-b2b-ink">
                            {t.presets[h] ?? h}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </Field>
              {draft.linkMode === 'genre' && (
                <Field label={t.genres} hint={t.genresHint}>
                  <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                    {genres.data?.data.map((g) => {
                      const on = draft.genres.includes(g.id);
                      return (
                        <button
                          key={g.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setDraft({ ...draft, genres: on ? draft.genres.filter((x) => x !== g.id) : [...draft.genres, g.id] })}
                          className={cx('border px-2.5 py-1 text-xs font-bold', on ? 'border-b2b-ink bg-b2b-ink text-white' : 'border-b2b-line bg-white hover:border-b2b-ink')}
                        >
                          {g.name}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              )}
            </div>
            <div>
              <p className="mb-2 text-xs font-bold text-b2b-muted uppercase">{t.preview}</p>
              <Tile name={draft.name} color={draft.color} image={draft.image_url} className="w-full" />
              <p className="mt-2 text-xs text-b2b-muted">{t.previewNote}</p>
            </div>
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button variant="outline-ink" onClick={() => setDraft(null)}>
                {common.cancel}
              </Button>
              <Button variant="ink" loading={busy} disabled={!valid || uploading} onClick={save}>
                {editing ? t.save : t.create}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!removing} onClose={() => setRemoving(null)} title={t.deleteTitle}>
        {removing && (
          <>
            <p className="text-sm">{t.deleteBody(removing.name)}</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline-ink" onClick={() => setRemoving(null)}>
                {common.cancel}
              </Button>
              <Button variant="danger" loading={busy} onClick={remove}>
                {t.delete}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
