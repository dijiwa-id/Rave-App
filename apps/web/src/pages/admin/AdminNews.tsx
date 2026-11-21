import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Heading2,
  ImageOff,
  Pencil,
  Pilcrow,
  Plus,
  Quote,
  RotateCcw,
  Search,
  Send,
  SplitSquareVertical,
  Star,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import { NEWS_CATEGORIES, NEWS_LIMITS, readMinutes, slugify, type NewsBlock, type NewsCategory, type NewsStatus, type NewsText } from '@rave/domain/news';
import { api, fmt } from '@/lib/api';
import { IMAGE_ACCEPT, uploadFile } from '@/lib/upload';
import { useDict } from '@/lib/i18n';
import { Badge, Button, confirmDialog, cx, Field, Input, Modal, PageHeader, Select, Textarea, toast } from '@/components/ui';
import { Empty, QueryState } from '@/components/b2b/common';
import { CategoryTag } from '@/pages/company/newsUi';

/**
 * Back Office → Konten → Ruang Berita (izin `news.publish`). Redaksi menulis artikel dwibahasa (ID wajib, EN opsional)
 * dengan editor blok (paragraf / subjudul / kutipan), mengunggah foto utama, lalu menerbitkan atau menjadwalkan.
 * Artikel tayang muncul di /berita. API: docs/API.md §9 (service Platform). Semua perubahan tercatat di audit log.
 */

type Lang = 'id' | 'en';
interface Row {
  id: string;
  slug: string;
  category: NewsCategory;
  status: NewsStatus;
  title: string;
  excerpt: string;
  image_url: string | null;
  author: string;
  featured: boolean;
  read_min: number;
  has_en: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}
type Content = { id: NewsText; en?: Partial<NewsText> | null };
type Detail = Row & { content: Content };
type Counts = Record<(typeof STATUSES)[number], number>;
interface Form {
  slug: string;
  category: NewsCategory;
  author: string;
  image_url: string | null;
  featured: boolean;
  content: { id: NewsText; en: NewsText };
}

const STATUSES = ['all', 'draft', 'scheduled', 'published', 'archived'] as const;
const STATUS_TONE: Record<NewsStatus, 'green' | 'amber' | 'blue' | 'neutral'> = { published: 'green', scheduled: 'blue', draft: 'amber', archived: 'neutral' };
const emptyText = (): NewsText => ({ title: '', excerpt: '', image_alt: '', body: [] });

function toForm(d: Detail): Form {
  const en = d.content.en ?? {};
  return {
    slug: d.slug,
    category: d.category,
    author: d.author,
    image_url: d.image_url,
    featured: d.featured,
    content: {
      id: { ...emptyText(), ...d.content.id },
      en: { title: en.title ?? '', excerpt: en.excerpt ?? '', image_alt: en.image_alt ?? '', body: en.body ?? [] },
    },
  };
}

/** Blok kosong tidak dikirim (server menolak teks kosong). */
/** Pecah teks per baris kosong; baris tunggal tetap di dalam paragraf. */
const splitParagraphs = (text: string) => text.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
const cleanBlocks = (b: NewsBlock[]) => b.filter((x) => ('p' in x ? x.p.trim() : 'h' in x ? x.h.trim() : x.quote.trim()));
const payload = (f: Form) => ({
  // Slug dinormalkan (tanpa '--' / tanda hubung di ujung); kosong → server membuat dari judul (saat buat) atau tidak diubah.
  slug: slugify(f.slug) || undefined,
  category: f.category,
  author: f.author.trim() || 'Tim RAVE',
  image_url: f.image_url,
  featured: f.featured,
  content: { id: { ...f.content.id, body: cleanBlocks(f.content.id.body) }, en: { ...f.content.en, body: cleanBlocks(f.content.en.body) } },
});

export function AdminNews() {
  const t = useDict('admin').news;
  const common = useDict('admin').common;
  const qc = useQueryClient();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all');
  const [search, setSearch] = useState('');
  // Cari setelah jeda mengetik (bukan satu permintaan per ketukan).
  const [query, setQuery] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(h);
  }, [search]);
  const [category, setCategory] = useState<NewsCategory | ''>('');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useQuery({
    queryKey: ['admin-news', status, query, category],
    queryFn: () => api<{ data: Row[]; counts: Counts }>('/v1/admin/platform/news', { query: { status, q: query || undefined, category: category || undefined } }),
  });
  const rows = list.data?.data ?? [];
  const counts = list.data?.counts;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-news'] });
    qc.invalidateQueries({ queryKey: ['news'] });
    qc.invalidateQueries({ queryKey: ['news-article'] });
  };

  // Pilih otomatis hanya dari daftar yang segar: setelah hapus, daftar lama masih memuat artikel terhapus sampai refetch.
  const [deleted, setDeleted] = useState<string | null>(null);
  useEffect(() => {
    if (selected) return;
    const next = rows.find((r) => r.id !== deleted);
    if (next) setSelected(next.id);
  }, [rows, selected, deleted]);

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
      <div className="grid gap-5 xl:grid-cols-[minmax(300px,380px)_1fr]">
        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label={t.title}>
            {STATUSES.map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={status === s}
                onClick={() => setStatus(s)}
                className={cx('border px-3 py-1.5 text-xs font-bold', status === s ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted hover:text-b2b-ink')}
              >
                {t.filters[s]}
                {counts && <span className="ml-1.5 tabular-nums opacity-70">{counts[s]}</span>}
              </button>
            ))}
          </div>
          <div className="mb-3 flex gap-2">
            <label className="relative block min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-b2b-muted" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.search} className="pl-9" aria-label={t.search} />
            </label>
            <div className="w-40 shrink-0">
              <Select value={category} onChange={(e) => setCategory(e.target.value as NewsCategory | '')} aria-label={t.fCategory}>
                <option value="">{t.allCategories}</option>
                {NEWS_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <QueryState q={list} empty={list.data && !rows.length ? <Empty title={t.empty} body={t.emptyBody} /> : undefined}>
            <ul className="divide-y divide-b2b-line border border-b2b-line bg-b2b-card">
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    className={cx('flex w-full items-center gap-3 p-2.5 text-left hover:bg-b2b-bg', selected === r.id && 'bg-b2b-bg outline-2 -outline-offset-2 outline-b2b-ink')}
                    onClick={() => setSelected(r.id)}
                  >
                    <Thumb url={r.image_url} className="w-20 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        {r.featured && <Star className="size-3.5 shrink-0 fill-amber-500 text-amber-500" aria-label={t.featured} />}
                        <span className="truncate text-sm font-bold">{r.title}</span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-b2b-muted">
                        <Badge tone={STATUS_TONE[r.status]}>{t.status[r.status]}</Badge>
                        <span>{r.category}</span>
                        <span aria-hidden>·</span>
                        <span>{r.published_at && r.status !== 'draft' ? fmt.date(r.published_at) : fmt.date(r.updated_at)}</span>
                        {!r.has_en && <span className="text-[10px] tracking-wide uppercase">· {t.noEnglish}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </QueryState>
        </section>
        <section className="min-w-0">
          {selected ? (
            <Editor key={selected} id={selected} onChanged={refresh} onDeleted={() => (setDeleted(selected), setSelected(null), refresh())} />
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
            setCategory('');
            setSelected(id);
            refresh();
          }}
        />
      )}
      <span className="sr-only">{common.auditHint}</span>
    </div>
  );
}

function Thumb({ url, className }: { url: string | null; className?: string }) {
  return url ? (
    <img src={url} alt="" loading="lazy" className={cx('aspect-[16/10] object-cover grayscale', className)} />
  ) : (
    <span className={cx('grid aspect-[16/10] place-items-center bg-b2b-bg text-b2b-muted', className)}>
      <ImageOff className="size-4" />
    </span>
  );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const t = useDict('admin').news;
  const common = useDict('admin').common;
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<NewsCategory>('Rilis');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const r = await api<Detail>('/v1/admin/platform/news', { body: { category, content: { id: { title: title.trim() } } } });
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
          <Input value={title} maxLength={NEWS_LIMITS.title} onChange={(e) => setTitle(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && title.trim() && submit()} />
        </Field>
        <Field label={t.fCategory}>
          <Select value={category} onChange={(e) => setCategory(e.target.value as NewsCategory)}>
            {NEWS_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
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
  const t = useDict('admin').news;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-news-detail', id], queryFn: () => api<Detail>(`/v1/admin/platform/news/${id}`) });
  const d = q.data;
  const [form, setForm] = useState<Form | null>(null);
  const [lang, setLang] = useState<Lang>('id');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [busy, setBusy] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  useEffect(() => {
    if (d) setForm(toForm(d));
  }, [d?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const saved = useMemo(() => (d ? JSON.stringify(payload(toForm(d))) : ''), [d]);
  const dirty = !!form && !!d && JSON.stringify(payload(form)) !== saved;
  // Syarat tayang dicek dari versi tersimpan (server memvalidasi hal yang sama).
  const missing = d
    ? [
        !d.content.id.excerpt?.trim() && t.need.excerpt,
        !d.content.id.body?.length && t.need.body,
        !d.image_url && t.need.image,
        d.image_url && !d.content.id.image_alt?.trim() && t.need.alt,
      ].filter(Boolean)
    : [];

  const set = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));
  const setText = (l: Lang, p: Partial<NewsText>) => setForm((f) => (f ? { ...f, content: { ...f.content, [l]: { ...f.content[l], ...p } } } : f));

  const apply = (r: Detail) => {
    qc.setQueryData(['admin-news-detail', id], r);
    onChanged();
  };
  async function run(key: string, fn: () => Promise<Detail | void>, ok?: string) {
    setBusy(key);
    try {
      const r = await fn();
      if (r) apply(r);
      if (ok) toast.success(ok);
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    } finally {
      setBusy(null);
    }
  }
  const save = () => form && run('save', () => api<Detail>(`/v1/admin/platform/news/${id}`, { method: 'PATCH', body: payload(form) }), t.saved);
  const act = (path: string, ok: string, body: object = {}) => run(path, () => api<Detail>(`/v1/admin/platform/news/${id}/${path}`, { body }), ok);

  async function confirmAct(path: 'publish' | 'unpublish' | 'archive', title: string, body: string, label: string, ok: string, danger = false) {
    if (await confirmDialog({ title, body, confirmLabel: label, danger, image: d?.image_url ?? undefined, detail: d?.title })) await act(path, ok);
  }
  async function remove() {
    if (!d) return;
    const ok = await confirmDialog({ title: t.deleteTitle, body: t.deleteBody, confirmLabel: t.delete, danger: true, image: d.image_url ?? undefined, detail: d.title });
    if (!ok) return;
    const done = await run('delete', () => api(`/v1/admin/platform/news/${id}`, { method: 'DELETE' }), t.deleted);
    if (done) onDeleted();
  }
  async function upload(f: File) {
    setBusy('image');
    try {
      const url = await uploadFile(f, 'artwork', 'news');
      set({ image_url: url });
      toast.success(t.imageSaved);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }

  const live = d?.status === 'published' || d?.status === 'scheduled';
  const locked = dirty ? t.saveFirst : undefined;
  const text = form?.content[lang];

  return (
    <QueryState q={q}>
      {d && form && text && (
        <div className="border border-b2b-line bg-b2b-card">
          {/* Bilah status & tindakan */}
          <div className="flex flex-wrap items-center gap-2 border-b border-b2b-line p-3">
            <Badge tone={STATUS_TONE[d.status]}>{t.status[d.status]}</Badge>
            <span className="text-xs text-b2b-muted">
              {d.status === 'scheduled' && d.published_at
                ? t.scheduledFor(fmt.dateTime(d.published_at))
                : d.status === 'published' && d.published_at
                  ? t.publishedOn(fmt.dateTime(d.published_at))
                  : t.updated(fmt.dateTime(d.updated_at), d.updated_by)}
            </span>
            <span className="ml-auto flex flex-wrap gap-2">
              {d.status === 'published' && (
                <a href={`/berita/${d.slug}`} target="_blank" rel="noreferrer" className="rave-btn rave-btn--flat inline-flex h-8 items-center gap-1.5 border-b2b-line px-3 text-[11px] text-b2b-ink">
                  <ExternalLink className="size-3.5" /> {t.viewOnSite}
                </a>
              )}
              {(d.status === 'draft' || d.status === 'scheduled' || d.status === 'archived') && (
                <>
                  <Button
                    size="sm"
                    variant="ink"
                    icon={<Send />}
                    loading={busy === 'publish'}
                    disabled={!!locked || missing.length > 0}
                    title={locked ?? (missing.length ? t.needs(missing.join(', ')) : undefined)}
                    onClick={() => confirmAct('publish', t.publishTitle, t.publishBody, d.status === 'archived' ? t.republish : t.publishNow, t.published)}
                  >
                    {d.status === 'archived' ? t.republish : t.publishNow}
                  </Button>
                  {d.status !== 'archived' && (
                    <Button size="sm" variant="outline-ink" icon={<CalendarClock />} disabled={!!locked || missing.length > 0} title={locked} onClick={() => setScheduling(true)}>
                      {t.schedule}
                    </Button>
                  )}
                </>
              )}
              {live && (
                <Button size="sm" variant="outline-ink" icon={<EyeOff />} loading={busy === 'unpublish'} disabled={!!locked} title={locked} onClick={() => confirmAct('unpublish', t.unpublishTitle, t.unpublishBody, t.unpublish, t.unpublished)}>
                  {t.unpublish}
                </Button>
              )}
              {d.status === 'published' && (
                <Button size="sm" variant="ghost" icon={<Archive />} loading={busy === 'archive'} disabled={!!locked} title={locked ?? t.archive} aria-label={t.archive} onClick={() => confirmAct('archive', t.archiveTitle, t.archiveBody, t.archive, t.archived)} />
              )}
              <Button size="sm" variant="ghost" icon={<Trash2 />} disabled={live} title={live ? t.deleteLive : t.delete} aria-label={t.delete} onClick={remove} />
            </span>
          </div>
          {missing.length > 0 && d.status !== 'published' && (
            <p className="border-b border-amber-500/70 bg-amber-500/10 px-3 py-2 text-xs text-b2b-ink">{t.needs(missing.join(', '))}</p>
          )}

          {/* Metadata */}
          <div className="grid gap-4 border-b border-b2b-line p-4 lg:grid-cols-[minmax(220px,300px)_1fr]">
            <div>
              <p className="mb-1.5 text-xs font-bold">{t.fImage}</p>
              <Thumb url={form.image_url} className="w-full border border-b2b-line" />
              <div className="mt-2 flex flex-wrap gap-1.5">
                <label className="inline-flex cursor-pointer items-center gap-1.5 border border-b2b-line px-2.5 py-1 text-xs font-bold hover:border-b2b-ink">
                  <Upload className="size-3.5" /> {busy === 'image' ? t.uploading : form.image_url ? t.replaceImage : t.uploadImage}
                  <input
                    type="file"
                    accept={IMAGE_ACCEPT}
                    className="sr-only"
                    disabled={busy === 'image'}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) upload(f);
                    }}
                  />
                </label>
                {form.image_url && (
                  <button className="inline-flex items-center gap-1 px-2 py-1 text-xs text-b2b-muted hover:text-b2b-ink" onClick={() => set({ image_url: null })}>
                    <X className="size-3.5" /> {t.removeImage}
                  </button>
                )}
              </div>
              <p className="mt-1 text-[11px] text-b2b-muted">{t.fImageHint}</p>
            </div>
            <div className="grid content-start gap-3 sm:grid-cols-2">
              <Field label={t.fCategory}>
                <Select value={form.category} onChange={(e) => set({ category: e.target.value as NewsCategory })}>
                  {NEWS_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.fAuthor}>
                <Input value={form.author} maxLength={NEWS_LIMITS.author} onChange={(e) => set({ author: e.target.value })} />
              </Field>
              <div className="sm:col-span-2">
                <Field label={t.fSlug} hint={t.fSlugHint(`/berita/${form.slug || '…'}`)} error={live && form.slug !== d.slug ? t.slugLiveWarn : undefined}>
                  <div className="flex gap-2">
                    <Input value={form.slug} maxLength={NEWS_LIMITS.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} className="font-mono text-sm" />
                    <Button size="md" variant="outline-ink" icon={<Wand2 />} title={t.slugAuto} aria-label={t.slugAuto} onClick={() => set({ slug: slugify(form.content.id.title) || form.slug })} />
                  </div>
                </Field>
              </div>
              <label className="flex cursor-pointer items-start gap-2.5 sm:col-span-2">
                <input type="checkbox" className="mt-0.5 size-4 accent-current" checked={form.featured} onChange={(e) => set({ featured: e.target.checked })} />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-bold">
                    <Star className="size-3.5" /> {t.featured}
                  </span>
                  <span className="block text-xs text-b2b-muted">{t.featuredHint}</span>
                </span>
              </label>
            </div>
          </div>

          {/* Bahasa + mode */}
          <div className="flex flex-wrap items-center gap-2 border-b border-b2b-line px-4 pt-3">
            {(['id', 'en'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={cx('-mb-px border-b-2 px-3 pb-2 text-sm font-bold', lang === l ? 'border-b2b-ink text-b2b-ink' : 'border-transparent text-b2b-muted hover:text-b2b-ink')}
              >
                {l === 'id' ? t.langId : t.langEn}
                {l === 'en' && (
                  <Badge tone={d.has_en ? 'green' : 'neutral'} className="ml-2">
                    {d.has_en ? t.english : t.noEnglish}
                  </Badge>
                )}
              </button>
            ))}
            <span className="ml-auto flex items-center gap-3 pb-2">
              <span className="text-xs text-b2b-muted">{t.readMin(readMinutes({ ...form.content.id, body: cleanBlocks(form.content.id.body) }))}</span>
              <Button size="sm" variant="outline-ink" icon={mode === 'edit' ? <Eye /> : <Pencil />} onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}>
                {mode === 'edit' ? t.preview : t.edit}
              </Button>
            </span>
          </div>

          {mode === 'preview' ? (
            <Preview form={form} lang={lang} />
          ) : (
            <div className="space-y-4 p-4">
              {lang === 'en' && (
                <div className="flex flex-wrap items-center justify-between gap-2 border border-dashed border-b2b-line p-3 text-xs text-b2b-muted">
                  <span>{t.langEnHint}</span>
                  {!form.content.en.body.length && form.content.id.body.length > 0 && (
                    <button className="inline-flex items-center gap-1 font-bold text-b2b-ink hover:underline" onClick={() => setText('en', { body: form.content.id.body.map((b) => ({ ...b })) })}>
                      <Copy className="size-3.5" /> {t.copyFromId}
                    </button>
                  )}
                </div>
              )}
              <Field label={t.fTitle}>
                <Input value={text.title} maxLength={NEWS_LIMITS.title} placeholder={lang === 'en' ? form.content.id.title : undefined} onChange={(e) => setText(lang, { title: e.target.value })} className="text-base font-bold" />
              </Field>
              <Field label={t.fExcerpt} hint={t.fExcerptHint}>
                <Textarea rows={2} maxLength={NEWS_LIMITS.excerpt} value={text.excerpt} placeholder={lang === 'en' ? form.content.id.excerpt : undefined} onChange={(e) => setText(lang, { excerpt: e.target.value })} />
              </Field>
              <Field label={t.fImageAlt} hint={t.fImageAltHint}>
                <Input value={text.image_alt} maxLength={NEWS_LIMITS.imageAlt} placeholder={lang === 'en' ? form.content.id.image_alt : undefined} onChange={(e) => setText(lang, { image_alt: e.target.value })} />
              </Field>
              <div>
                <p className="mb-1.5 text-xs font-bold">{t.body}</p>
                <BlockEditor blocks={text.body} onChange={(body) => setText(lang, { body })} />
              </div>
            </div>
          )}

          {/* Simpan */}
          <div className={cx('sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-b2b-line bg-b2b-card p-3', dirty && 'shadow-[0_-6px_16px_rgba(0,0,0,0.08)]')}>
            {dirty && <span className="mr-auto text-xs font-bold text-amber-600 dark:text-amber-400">{t.unsaved}</span>}
            <Button size="sm" variant="ghost" icon={<RotateCcw />} disabled={!dirty} onClick={() => setForm(toForm(d))}>
              {t.discard}
            </Button>
            <Button size="sm" variant="ink" loading={busy === 'save'} disabled={!dirty || !form.content.id.title.trim()} onClick={save}>
              {t.save}
            </Button>
          </div>
        </div>
      )}
      {scheduling && d && (
        <ScheduleModal
          initial={d.status === 'scheduled' ? d.published_at : null}
          onClose={() => setScheduling(false)}
          onSubmit={async (iso) => {
            if (await act('publish', t.scheduled, { published_at: iso })) setScheduling(false);
          }}
        />
      )}
    </QueryState>
  );
}

/** Editor blok: paragraf, subjudul, kutipan — tambah, ubah urutan, hapus. */
function BlockEditor({ blocks, onChange }: { blocks: NewsBlock[]; onChange: (b: NewsBlock[]) => void }) {
  const t = useDict('admin').news;
  const update = (i: number, b: NewsBlock) => onChange(blocks.map((x, j) => (j === i ? b : x)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = (b: NewsBlock) => onChange([...blocks, b]);
  /** Teks dengan baris kosong → beberapa blok paragraf (hasil tempel dari dokumen/WhatsApp). */
  const splitAt = (i: number, text: string) => {
    const parts = splitParagraphs(text);
    onChange([...blocks.slice(0, i), ...parts.map((p) => ({ p })), ...blocks.slice(i + 1)].slice(0, NEWS_LIMITS.blocks));
  };
  const full = blocks.length >= NEWS_LIMITS.blocks;
  return (
    <div className="space-y-2">
      {!blocks.length && <p className="border border-dashed border-b2b-line p-4 text-center text-sm text-b2b-muted">{t.bodyEmpty}</p>}
      {blocks.map((b, i) => {
        const kind = 'p' in b ? 'p' : 'h' in b ? 'h' : 'quote';
        const Icon = kind === 'p' ? Pilcrow : kind === 'h' ? Heading2 : Quote;
        return (
          <div key={i} className={cx('group flex gap-2 border border-b2b-line bg-b2b-bg/40 p-2 focus-within:border-b2b-ink', kind === 'quote' && 'border-l-4 border-l-amber-500')}>
            <span className="flex flex-col items-center gap-0.5 pt-1 text-b2b-muted">
              <Icon className="size-4" aria-label={kind === 'p' ? t.blockParagraph : kind === 'h' ? t.blockHeading : t.blockQuote} />
              <button className="p-0.5 hover:text-b2b-ink disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t.moveUp} title={t.moveUp}>
                <ArrowUp className="size-3.5" />
              </button>
              <button className="p-0.5 hover:text-b2b-ink disabled:opacity-30" disabled={i === blocks.length - 1} onClick={() => move(i, 1)} aria-label={t.moveDown} title={t.moveDown}>
                <ArrowDown className="size-3.5" />
              </button>
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
              {kind === 'p' && (
                <>
                  <Textarea
                    rows={Math.min(10, Math.max(3, Math.ceil((b as { p: string }).p.length / 90)))}
                    maxLength={NEWS_LIMITS.block}
                    value={(b as { p: string }).p}
                    onChange={(e) => update(i, { p: e.target.value })}
                    onPaste={(e) => {
                      // Tempel beberapa paragraf ke blok kosong → langsung dipecah per paragraf (tidak terpotong batas blok).
                      const text = e.clipboardData.getData('text/plain');
                      if (!(b as { p: string }).p.trim() && splitParagraphs(text).length > 1) {
                        e.preventDefault();
                        splitAt(i, text);
                      }
                    }}
                    aria-label={t.blockParagraph}
                  />
                  {splitParagraphs((b as { p: string }).p).length > 1 && (
                    <button className="inline-flex items-center gap-1 text-xs font-bold text-b2b-ink hover:underline" onClick={() => splitAt(i, (b as { p: string }).p)}>
                      <SplitSquareVertical className="size-3.5" /> {t.splitParagraphs(splitParagraphs((b as { p: string }).p).length)}
                    </button>
                  )}
                </>
              )}
              {kind === 'h' && <Input value={(b as { h: string }).h} maxLength={200} onChange={(e) => update(i, { h: e.target.value })} className="font-bold" aria-label={t.blockHeading} placeholder={t.blockHeading} />}
              {kind === 'quote' && (
                <>
                  <Textarea rows={2} maxLength={600} value={(b as { quote: string }).quote} onChange={(e) => update(i, { ...(b as { quote: string; by: string }), quote: e.target.value })} aria-label={t.blockQuote} placeholder={t.blockQuote} className="italic" />
                  <Input value={(b as { by: string }).by} maxLength={NEWS_LIMITS.quoteBy} onChange={(e) => update(i, { ...(b as { quote: string; by: string }), by: e.target.value })} placeholder={t.quoteBy} aria-label={t.quoteBy} className="text-sm" />
                </>
              )}
            </div>
            <button className="self-start p-1 text-b2b-muted hover:text-red-600" onClick={() => onChange(blocks.filter((_, j) => j !== i))} aria-label={t.removeBlock} title={t.removeBlock}>
              <Trash2 className="size-4" />
            </button>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="outline-ink" icon={<Pilcrow />} disabled={full} onClick={() => add({ p: '' })}>
          {t.addParagraph}
        </Button>
        <Button size="sm" variant="outline-ink" icon={<Heading2 />} disabled={full} onClick={() => add({ h: '' })}>
          {t.addHeading}
        </Button>
        <Button size="sm" variant="outline-ink" icon={<Quote />} disabled={full} onClick={() => add({ quote: '', by: '' })}>
          {t.addQuote}
        </Button>
      </div>
    </div>
  );
}

/** Pratinjau sesuai tampilan publik /berita (latar gelap, foto hitam-putih bertinta ungu). */
function Preview({ form, lang }: { form: Form; lang: Lang }) {
  const t = useDict('admin').news;
  const c = useDict('company').news;
  const base = form.content.id;
  const en = form.content.en;
  const x = lang === 'en' ? { title: en.title || base.title, excerpt: en.excerpt || base.excerpt, image_alt: en.image_alt || base.image_alt, body: en.body.length ? en.body : base.body } : base;
  const body = cleanBlocks(x.body);
  return (
    <div className="bg-[#181818] px-5 py-8 text-[#f4efe6] md:px-10">
      <div className="mx-auto max-w-2xl">
        <CategoryTag c={c.categories[form.category]} />
        <h1 className="mt-4 font-display text-5xl leading-[0.92] uppercase">{x.title || '—'}</h1>
        {x.excerpt && <p className="mt-4 text-lg leading-relaxed text-[#cfc4d8]">{x.excerpt}</p>}
        <p className="mt-4 font-label text-[10.5px] font-bold tracking-[0.08em] text-white/50 uppercase">
          {c.by} {form.author || 'Tim RAVE'} · {t.readMin(readMinutes({ ...x, body }))}
        </p>
        <div className="relative mt-6 aspect-[16/8] overflow-hidden border-2 border-black bg-rave-plum shadow-[8px_8px_0_#F4C21F]">
          {form.image_url ? <img src={form.image_url} alt={x.image_alt} className="size-full object-cover grayscale contrast-[1.2]" /> : <ImageOff className="absolute inset-0 m-auto size-8 text-white/30" />}
          <span className="absolute inset-0 bg-rave-purple opacity-30 mix-blend-color" aria-hidden />
        </div>
        <div className="py-8">
          {body.map((b, i) =>
            'h' in b ? (
              <h2 key={i} className="mt-10 font-display text-3xl leading-none uppercase">
                {b.h}
              </h2>
            ) : 'quote' in b ? (
              <blockquote key={i} className="my-8 border-l-4 border-rave-primary bg-[#1e1c1f] p-5">
                <p className="font-display text-2xl leading-[1.05] uppercase">“{b.quote}”</p>
                {b.by && <footer className="mt-2 font-label text-[11px] font-bold tracking-[0.1em] text-rave-primary-text uppercase">— {b.by}</footer>}
              </blockquote>
            ) : (
              <p key={i} className="mt-5 text-[16px] leading-[1.8] whitespace-pre-line text-white/80 first:mt-0">
                {b.p}
              </p>
            ),
          )}
          {!body.length && <p className="text-white/40">{t.bodyEmpty}</p>}
        </div>
      </div>
    </div>
  );
}

function ScheduleModal({ initial, onClose, onSubmit }: { initial: string | null; onClose: () => void; onSubmit: (iso: string) => Promise<void> }) {
  const t = useDict('admin').news;
  const common = useDict('admin').common;
  // Nilai datetime-local dalam zona waktu perangkat; default besok 09.00.
  const toLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [value, setValue] = useState(() => {
    if (initial) return toLocal(new Date(initial));
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return toLocal(d);
  });
  const [busy, setBusy] = useState(false);
  const at = value ? new Date(value) : null;
  const valid = !!at && !Number.isNaN(at.getTime()) && at.getTime() > Date.now() + 60_000;
  return (
    <Modal open onClose={onClose} title={t.scheduleTitle}>
      <div className="space-y-4">
        <p className="text-sm text-b2b-muted">{t.scheduleBody}</p>
        <Field label={t.scheduleAt} error={value && !valid ? t.scheduleFuture : undefined}>
          <Input type="datetime-local" value={value} min={toLocal(new Date())} onChange={(e) => setValue(e.target.value)} />
        </Field>
        {valid && at && <p className="text-xs text-b2b-muted">{t.scheduledFor(fmt.dateTime(at.toISOString()))}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline-ink" onClick={onClose}>
            {common.cancel}
          </Button>
          <Button
            variant="ink"
            icon={<CalendarClock />}
            loading={busy}
            disabled={!valid}
            onClick={async () => {
              setBusy(true);
              await onSubmit(at!.toISOString());
              setBusy(false);
            }}
          >
            {t.schedule}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
