import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ImageOff, ImagePlus, Link2, Pencil, Plus, Shapes, Tag, Trash2, X } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import { IMAGE_ACCEPT, uploadFile } from '@/lib/upload';
import { useDict } from '@/lib/i18n';
import { Badge, Button, Card, cx, Field, Input, Modal, PageHeader, toast } from '@/components/ui';
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
    <div className={cx('relative aspect-square overflow-hidden ring-1 ring-black/10 ring-inset', small ? 'p-1.5' : 'p-3', className)} style={{ background: color }}>
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

  const stats = {
    total: rows.length,
    genre: rows.filter((r) => r.href.startsWith('/app/genre/')).length,
    custom: rows.filter((r) => !r.href.startsWith('/app/genre/')).length,
    noImage: rows.filter((r) => !r.image_url).length,
  };
  /** Pilihan (chip/segmen) bergaya token tema — terbaca di terang & gelap. */
  const chip = (on: boolean) =>
    cx(
      'inline-flex items-center border-2 font-bold transition-colors',
      on ? 'border-transparent bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line bg-b2b-card text-b2b-ink hover:border-b2b-ink',
    );

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <Button variant="ink" icon={<Plus />} onClick={openNew}>
            {t.add}
          </Button>
        }
      />
      <QueryState q={q} empty={q.data && !rows.length ? <Empty title={t.empty} action={<Button variant="ink" icon={<Plus />} onClick={openNew}>{t.add}</Button>} /> : undefined}>
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {(
            [
              ['total', Shapes, stats.total],
              ['genre', Tag, stats.genre],
              ['custom', Link2, stats.custom],
              ['noImage', ImageOff, stats.noImage],
            ] as const
          ).map(([k, Icon, v]) => (
            <div key={k} className="b2b-surface flex items-center gap-3 border border-b2b-line px-4 py-3">
              <span className={cx('grid size-9 shrink-0 place-items-center', k === 'noImage' && v > 0 ? 'bg-red-500/15 text-red-600' : 'bg-b2b-ink/5 text-b2b-muted')}>
                <Icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-b2b-muted">{t.stats[k]}</p>
                <p className="text-xl leading-tight font-extrabold text-b2b-ink tabular-nums">{v}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card title={t.list} action={<span className="hidden text-xs text-b2b-muted sm:inline">{t.listHint}</span>}>
            <ol className="-mx-4 -mb-4 divide-y divide-b2b-line sm:-mx-5 sm:-mb-5">
              {rows.map((c, i) => {
                const genreLink = c.href.startsWith('/app/genre/');
                return (
                  <li key={c.id} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-b2b-ink/[0.03] sm:gap-4 sm:px-5">
                    <span className="w-6 shrink-0 text-right font-mono text-xs font-bold text-b2b-muted tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                    <Tile small name={c.name} color={c.color} image={c.image_url} className="w-14 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-b2b-ink">{c.name}</p>
                      <p className="truncate font-mono text-[11px] text-b2b-muted">{c.href}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {genreLink ? (
                          c.genres?.length ? (
                            c.genres.slice(0, 4).map((g) => <Badge key={g}>{genreName(g)}</Badge>)
                          ) : (
                            <Badge tone="amber">{t.allGenres}</Badge>
                          )
                        ) : (
                          <Badge tone="blue">{t.customLink}</Badge>
                        )}
                        {genreLink && (c.genres?.length ?? 0) > 4 && <Badge>+{c.genres.length - 4}</Badge>}
                        {!c.image_url && <Badge tone="red">{t.noImage}</Badge>}
                      </div>
                    </div>
                    <div className="hidden w-24 shrink-0 text-right lg:block">
                      <p className="text-[10.5px] font-semibold tracking-wide text-b2b-muted uppercase">{t.updated}</p>
                      <p className="text-xs text-b2b-ink tabular-nums">{c.updated_at ? fmt.date(c.updated_at) : '—'}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="hidden gap-1 sm:flex">
                        <Button size="sm" variant="outline-ink" icon={<ArrowUp />} title={t.moveUp} aria-label={`${t.moveUp} ${c.name}`} disabled={i === 0} onClick={() => move(i, -1)} />
                        <Button size="sm" variant="outline-ink" icon={<ArrowDown />} title={t.moveDown} aria-label={`${t.moveDown} ${c.name}`} disabled={i === rows.length - 1} onClick={() => move(i, 1)} />
                      </div>
                      <Button size="sm" variant="outline-ink" icon={<Pencil />} onClick={() => openEdit(c)} aria-label={`${t.edit} ${c.name}`}>
                        <span className="hidden md:inline">{t.edit}</span>
                      </Button>
                      <Button size="sm" variant="danger" icon={<Trash2 />} title={t.delete} aria-label={`${t.delete} ${c.name}`} onClick={() => setRemoving(c)} />
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>

          <Card title={t.livePreview} className="xl:sticky xl:top-24">
            <p className="-mt-1 mb-3 text-xs text-b2b-muted">{t.livePreviewHint}</p>
            <div className="rave-keep-white grid grid-cols-2 gap-2 bg-[#121212] p-3">
              {rows.map((c) => (
                <Tile key={c.id} name={c.name} color={c.color} image={c.image_url} className="w-full !p-2 [&>span]:!text-[13px]" />
              ))}
            </div>
          </Card>
        </div>
      </QueryState>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={editing ? t.editTitle : t.addTitle} wide>
        {draft && (
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_200px]">
            <div className="min-w-0 space-y-5">
              <section className="space-y-4">
                <p className="text-[10.5px] font-bold tracking-[0.12em] text-b2b-muted uppercase">{t.appearance}</p>
                <div className="grid gap-4 sm:grid-cols-2">
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
                </div>
                <Field label={t.color}>
                  <div className="flex flex-wrap items-center gap-2">
                    {SWATCHES.map((s) => {
                      const on = draft.color.toLowerCase() === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          aria-label={s}
                          aria-pressed={on}
                          title={s}
                          onClick={() => setDraft({ ...draft, color: s })}
                          className={cx('size-8 ring-offset-2 ring-offset-b2b-card transition', on ? 'ring-2 ring-b2b-ink' : 'ring-1 ring-black/10 hover:ring-2 hover:ring-b2b-line')}
                          style={{ background: s }}
                        />
                      );
                    })}
                    <label className="ml-1 flex h-8 items-center gap-2 border-2 border-b2b-line bg-b2b-card pr-2.5 pl-1 hover:border-b2b-ink">
                      <input type="color" aria-label={t.customColor} value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0" />
                      <span className="font-mono text-xs text-b2b-ink uppercase">{draft.color}</span>
                    </label>
                  </div>
                </Field>
                <Field label={t.image} hint={t.imageHint}>
                  <div className="flex flex-wrap items-center gap-2">
                    <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} className="hidden" onChange={(e) => pickImage(e.target.files?.[0])} />
                    <Button size="sm" variant="outline-ink" icon={<ImagePlus />} loading={uploading} onClick={() => fileRef.current?.click()}>
                      {draft.image_url ? t.replaceImage : t.uploadImage}
                    </Button>
                    {draft.image_url && (
                      <Button size="sm" variant="outline-ink" icon={<X />} onClick={() => setDraft({ ...draft, image_url: null })}>
                        {t.removeImage}
                      </Button>
                    )}
                  </div>
                </Field>
              </section>

              <section className="space-y-4 border-t border-dashed border-b2b-line pt-5">
                <p className="text-[10.5px] font-bold tracking-[0.12em] text-b2b-muted uppercase">{t.behaviour}</p>
                <Field label={t.link}>
                  <div className="space-y-2">
                    <div className="inline-flex" role="radiogroup" aria-label={t.link}>
                      {(['genre', 'custom'] as const).map((m, idx) => (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={draft.linkMode === m}
                          onClick={() => setDraft({ ...draft, linkMode: m, href: m === 'custom' && !draft.href ? LINK_PRESETS[0] : draft.href })}
                          className={cx(chip(draft.linkMode === m), 'h-8 px-3.5 text-xs', idx > 0 && '-ml-0.5')}
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
                            <button key={h} type="button" onClick={() => setDraft({ ...draft, href: h })} className={cx(chip(draft.href === h), 'h-7 px-2.5 text-[11px]')}>
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
                            className={cx(chip(on), 'h-7 px-2.5 text-xs')}
                          >
                            {g.name}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                )}
              </section>
            </div>
            <div className="md:border-l md:border-dashed md:border-b2b-line md:pl-6">
              <div className="md:sticky md:top-0">
                <p className="mb-2 text-[10.5px] font-bold tracking-[0.12em] text-b2b-muted uppercase">{t.preview}</p>
                <div className="rave-keep-white bg-[#121212] p-3">
                  <Tile name={draft.name} color={draft.color} image={draft.image_url} className="w-full" />
                </div>
                <p className="mt-2 text-xs text-b2b-muted">{t.previewNote}</p>
              </div>
            </div>
            <div className="-mx-6 -mb-6 flex justify-end gap-2 border-t border-b2b-line px-6 py-4 md:col-span-2">
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
            <div className="flex items-start gap-4">
              <Tile small name={removing.name} color={removing.color} image={removing.image_url} className="w-14 shrink-0" />
              <p className="text-sm text-b2b-ink">{t.deleteBody(removing.name)}</p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline-ink" onClick={() => setRemoving(null)}>
                {common.cancel}
              </Button>
              <Button variant="danger" icon={<Trash2 />} loading={busy} onClick={remove}>
                {t.delete}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
