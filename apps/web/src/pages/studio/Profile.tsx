import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useBlocker } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ChevronDown, CircleCheck, Circle, ExternalLink, ImagePlus, Info, Lock, MapPin, Plus, Trash, Upload } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import type { Artist, ArtistLink, ArtistLinkPlatform } from '@/lib/types';
import { Button, Field, Input, PageHeader, Select, Textarea, cx, toast } from '@/components/ui';
import { CITIES, GENRES, QueryState, useCurrentArtist } from '@/components/b2b/common';
import { uploadFile } from '@/lib/upload';
import { useDict } from '@/lib/i18n';
import {
  BIO_GOOD,
  BIO_MAX,
  COMPLETENESS_ANCHOR,
  IMAGE_MIN,
  LINK_ICON,
  LINK_PLATFORMS,
  MAX_GENRES,
  MAX_LINKS,
  profileCompleteness,
  readImageSize,
  sameDraft,
  type ProfileDraft,
} from '@/components/studio/artist-profile';

type T = ReturnType<typeof useDict<'b2b'>>['studio']['profile'];

const toDraft = (a: Artist): ProfileDraft => ({
  bio: a.bio ?? '',
  image_url: a.image_url ?? '',
  cover_url: a.cover_url ?? '',
  city: a.city ?? '',
  genres: a.genres ?? [],
  links: (a.links ?? []).map((l) => ({ platform: l.platform, url: l.url })),
});

function Section({ id, title, hint, children, action }: { id: string; title: string; hint?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section id={id} className="b2b-surface scroll-mt-24 rounded-none border border-b2b-line">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-dashed border-b2b-line px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="font-label text-[12px] font-bold tracking-[0.1em] text-b2b-ink uppercase">{title}</h2>
          {hint && <p className="mt-1 text-xs text-b2b-muted">{hint}</p>}
        </div>
        {action}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

/** Pemilih gambar: cek ukuran minimum di browser lalu unggah lewat alur Studio (server memvalidasi kepemilikan). */
function ImageField({
  kind,
  label,
  hint,
  url,
  onChange,
  t,
}: {
  kind: 'photo' | 'banner';
  label: string;
  hint: string;
  url: string;
  onChange: (u: string) => void;
  t: T;
}) {
  const [busy, setBusy] = useState(false);
  const wide = kind === 'banner';
  const min = IMAGE_MIN[kind];
  return (
    <div className={cx('flex gap-4', wide ? 'flex-col' : 'items-center')}>
      <div
        className={cx(
          'relative shrink-0 overflow-hidden border border-b2b-line bg-b2b-bg',
          wide ? 'aspect-[8/3] w-full' : 'size-24 rounded-full sm:size-28',
        )}
      >
        {url ? (
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center text-b2b-muted">
            <ImagePlus className="size-6" aria-hidden />
          </span>
        )}
        {busy && <span className="absolute inset-0 grid place-items-center bg-b2b-card/70 text-xs font-bold">{t.uploading}</span>}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-bold text-b2b-ink">{label}</p>
        <p className="mt-0.5 text-xs text-b2b-muted">{hint}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-none border-2 border-b2b-ink/80 bg-b2b-card px-3 font-label text-[11px] font-bold tracking-[0.08em] text-b2b-ink uppercase transition hover:border-rave-accent hover:text-rave-accent has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50">
            <Upload className="size-3.5" aria-hidden /> {url ? t.replace : t.upload}
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              disabled={busy}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setBusy(true);
                try {
                  const { w, h } = await readImageSize(f);
                  if (w < min.w || h < min.h) throw new Error(t.tooSmall(w, h, min.w, min.h));
                  onChange(await uploadFile(f, 'artwork'));
                } catch (err) {
                  toast.error(err);
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          {url && (
            <button type="button" onClick={() => onChange('')} className="h-8 px-2 text-xs font-bold text-b2b-muted hover:text-red-600">
              {t.remove}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LinksEditor({ links, onChange, t }: { links: ArtistLink[]; onChange: (l: ArtistLink[]) => void; t: T }) {
  const used = new Set<ArtistLinkPlatform>(links.map((l) => l.platform).filter((p) => p !== 'website'));
  const nextPlatform = LINK_PLATFORMS.find((p) => !used.has(p)) ?? 'website';
  const set = (i: number, patch: Partial<ArtistLink>) => onChange(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-3">
      {links.length === 0 && <p className="border border-dashed border-b2b-line p-4 text-sm text-b2b-muted">{t.noLinks}</p>}
      {links.map((l, i) => {
        const Icon = LINK_ICON[l.platform];
        return (
          <div key={i} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 sm:grid-cols-[auto_170px_1fr_auto]">
            <span className="grid size-10 place-items-center border border-b2b-line bg-b2b-bg text-b2b-ink" aria-hidden>
              <Icon className="size-4" />
            </span>
            <Select
              aria-label={t.links}
              value={l.platform}
              onChange={(e) => set(i, { platform: e.target.value as ArtistLinkPlatform })}
              className="col-span-1 sm:col-span-1"
            >
              {LINK_PLATFORMS.map((p) => (
                <option key={p} value={p} disabled={p !== l.platform && used.has(p)}>
                  {t.platforms[p]}
                </option>
              ))}
            </Select>
            <Input
              aria-label={t.platforms[l.platform]}
              type="url"
              inputMode="url"
              placeholder={t.linkPlaceholder}
              value={l.url}
              maxLength={500}
              onChange={(e) => set(i, { url: e.target.value })}
              className="col-span-3 row-start-2 sm:col-span-1 sm:row-start-auto"
            />
            <button
              type="button"
              aria-label={t.removeLink}
              title={t.removeLink}
              onClick={() => onChange(links.filter((_, j) => j !== i))}
              className="col-start-3 row-start-1 grid size-10 place-items-center text-b2b-muted hover:text-red-600 sm:col-start-auto sm:row-start-auto"
            >
              <Trash className="size-4" />
            </button>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline-ink"
        size="sm"
        disabled={links.length >= MAX_LINKS}
        onClick={() => onChange([...links, { platform: nextPlatform, url: '' }])}
      >
        <Plus className="size-3.5" /> {t.addLink} ({links.length}/{MAX_LINKS})
      </Button>
    </div>
  );
}

/** Pratinjau kartu artis seperti yang dilihat fans. */
function Preview({ a, f, t }: { a: Artist; f: ProfileDraft; t: T }) {
  const summary = f.bio.trim().split(/\n\s*\n/)[0] ?? '';
  return (
    <div className="overflow-hidden border border-b2b-line bg-b2b-card">
      <div className="relative aspect-[8/3] bg-rave-purple/20">
        {f.cover_url && <img src={f.cover_url} alt="" className="size-full object-cover" />}
        <span className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" aria-hidden />
      </div>
      <div className="px-4 pb-4">
        <div className="-mt-9 flex items-end gap-3">
          <span className="relative size-[72px] shrink-0 overflow-hidden rounded-full border-4 border-b2b-card bg-b2b-bg">
            {f.image_url && <img src={f.image_url} alt="" className="size-full object-cover" />}
          </span>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-lg leading-tight font-bold text-b2b-ink">
          <span className="truncate">{a.name}</span>
          {a.verified && <BadgeCheck className="size-4 shrink-0 text-rave-accent" aria-label={t.verified} />}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-b2b-muted">
          {f.city && (
            <span className="inline-flex items-center gap-0.5">
              <MapPin className="size-3" aria-hidden /> {f.city}
            </span>
          )}
          <span>{t.listeners(fmt.num(a.monthly_listeners))}</span>
        </p>
        {f.genres.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {f.genres.slice(0, 4).map((g) => (
              <span key={g} className="border border-b2b-line px-1.5 py-0.5 font-label text-[10px] font-bold tracking-[0.08em] text-b2b-ink uppercase">
                {g}
              </span>
            ))}
          </div>
        )}
        {summary && <p className="mt-3 line-clamp-4 text-sm leading-relaxed whitespace-pre-line text-b2b-ink/85">{summary}</p>}
        {f.links.some((l) => l.url.trim()) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {f.links
              .filter((l) => l.url.trim())
              .map((l, i) => {
                const Icon = LINK_ICON[l.platform];
                return (
                  <span key={i} title={t.platforms[l.platform]} className="grid size-8 place-items-center border border-b2b-line text-b2b-ink">
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}

function Completeness({ f, t }: { f: ProfileDraft; t: T }) {
  const { items, pct } = profileCompleteness(f);
  return (
    <div className="b2b-surface border border-b2b-line p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-label text-[12px] font-bold tracking-[0.1em] text-b2b-ink uppercase">{t.completeness}</h2>
        <span className="text-lg font-bold text-b2b-ink tabular-nums">{pct}%</span>
      </div>
      <div className="mt-2 h-1.5 bg-b2b-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t.completeness}>
        <div className={cx('h-full transition-[width] duration-500', pct === 100 ? 'bg-emerald-500' : 'bg-rave-accent')} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-b2b-muted">{t.completenessHint}</p>
      <ul className="mt-3 space-y-1">
        {items.map((i) => (
          <li key={i.key}>
            <a
              href={`#${COMPLETENESS_ANCHOR[i.key]}`}
              className={cx('flex items-center gap-2 py-0.5 text-sm hover:underline', i.done ? 'text-b2b-muted' : 'font-bold text-b2b-ink')}
            >
              {i.done ? <CircleCheck className="size-4 shrink-0 text-emerald-500" aria-hidden /> : <Circle className="size-4 shrink-0 text-b2b-muted" aria-hidden />}
              {t.checks[i.key]}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Profil publik artis (identitas, bio, tautan) — PATCH /v1/studio/artists/:artistId. */
export default function StudioProfile() {
  const artist = useCurrentArtist()!;
  const aid = artist.artist_id!;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['artist', aid], queryFn: () => api<Artist>(`/v1/catalog/artists/${aid}`) });
  const [base, setBase] = useState<ProfileDraft | null>(null);
  const [f, setF] = useState<ProfileDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const t = useDict('b2b').studio.profile;

  useEffect(() => {
    if (!q.data) return;
    const d = toDraft(q.data);
    setBase(d);
    setF(d);
  }, [q.data]);

  const dirty = !!f && !!base && !sameDraft(f, base);

  // Peringatan saat meninggalkan halaman dengan perubahan belum disimpan (navigasi internal & tutup tab).
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !busy && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(t.leaveConfirm)) blocker.proceed();
    else blocker.reset();
  }, [blocker, t.leaveConfirm]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const genreOptions = useMemo(() => [...new Set([...(f?.genres ?? []), ...GENRES])], [f?.genres]);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!f || !base) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      if (f.bio !== base.bio) body.bio = f.bio.trim() || null;
      if (f.image_url !== base.image_url) body.image_url = f.image_url || null;
      if (f.cover_url !== base.cover_url) body.cover_url = f.cover_url || null;
      if (f.city !== base.city) body.city = f.city || null;
      if (JSON.stringify(f.genres) !== JSON.stringify(base.genres)) body.genres = f.genres;
      if (JSON.stringify(f.links) !== JSON.stringify(base.links)) body.links = f.links.filter((l) => l.url.trim());
      await api(`/v1/studio/artists/${aid}`, { method: 'PATCH', body });
      const fresh = await qc.fetchQuery({ queryKey: ['artist', aid], queryFn: () => api<Artist>(`/v1/catalog/artists/${aid}`), staleTime: 0 });
      const d = toDraft(fresh);
      setBase(d);
      setF(d);
      toast.success(t.saved);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pb-6">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          q.data?.slug && (
            <Link to={`/app/artist/${q.data.slug}`} target="_blank" className="inline-flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
              {t.viewPublic} <ExternalLink className="size-4" />
            </Link>
          )
        }
      />
      <QueryState q={q}>
        {f && q.data && (
          <form onSubmit={save} className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* Pratinjau ringkas di atas (mobile) */}
            <div className="lg:hidden">
              <button
                type="button"
                aria-expanded={showPreview}
                onClick={() => setShowPreview((v) => !v)}
                className="flex w-full items-center justify-between border border-b2b-line bg-b2b-card px-4 py-3 text-sm font-bold text-b2b-ink"
              >
                <span>
                  {showPreview ? t.hidePreview : t.showPreview} · {profileCompleteness(f).pct}%
                </span>
                <ChevronDown className={cx('size-4 transition-transform', showPreview && 'rotate-180')} aria-hidden />
              </button>
              {showPreview && (
                <div className="mt-3 space-y-3">
                  <Preview a={q.data} f={f} t={t} />
                  <Completeness f={f} t={t} />
                </div>
              )}
            </div>

            <div className="min-w-0 space-y-6">
              <Section id="profile-identity" title={t.identity} hint={t.identityHint}>
                <div className="space-y-6">
                  <ImageField kind="banner" label={t.cover} hint={t.coverHint} url={f.cover_url} onChange={(u) => setF({ ...f, cover_url: u })} t={t} />
                  <ImageField kind="photo" label={t.photo} hint={t.photoHint} url={f.image_url} onChange={(u) => setF({ ...f, image_url: u })} t={t} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t.displayName}>
                      <div className="relative">
                        <Input value={q.data.name} readOnly aria-readonly className="pr-9 text-b2b-muted" />
                        <Lock className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-b2b-muted" aria-hidden />
                      </div>
                      <span className="mt-1 flex gap-1 text-xs text-b2b-muted">
                        <Info className="mt-0.5 size-3 shrink-0" aria-hidden /> {t.displayNameHint}
                      </span>
                    </Field>
                    <Field label={t.hometown}>
                      <Select value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })}>
                        <option value="">—</option>
                        {[...new Set([...(f.city ? [f.city] : []), ...CITIES])].map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div>
                    <p className="mb-1.5 text-sm font-bold text-b2b-ink">
                      {t.genres} <span className="ml-1 font-normal text-b2b-muted">{t.genresHint(f.genres.length)}</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {genreOptions.map((g) => {
                        const on = f.genres.includes(g);
                        return (
                          <button
                            type="button"
                            key={g}
                            aria-pressed={on}
                            disabled={!on && f.genres.length >= MAX_GENRES}
                            onClick={() => setF({ ...f, genres: on ? f.genres.filter((x) => x !== g) : [...f.genres, g] })}
                            className={cx(
                              'rounded-none border px-3 py-1 font-label text-[11px] font-bold tracking-[0.06em] uppercase transition disabled:opacity-40',
                              on ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted hover:border-b2b-ink hover:text-b2b-ink',
                            )}
                          >
                            {g}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </Section>

              <Section id="profile-bio" title={t.about} hint={t.aboutHint}>
                <Textarea
                  rows={9}
                  maxLength={BIO_MAX}
                  value={f.bio}
                  onChange={(e) => setF({ ...f, bio: e.target.value })}
                  placeholder={t.bioPlaceholder}
                  aria-describedby="bio-tips"
                />
                <div className="mt-2 flex flex-wrap items-start justify-between gap-2 text-xs">
                  <p id="bio-tips" className="max-w-prose text-b2b-muted">
                    {t.bioTips}
                  </p>
                  <span className={cx('tabular-nums', f.bio.trim().length >= BIO_GOOD ? 'text-emerald-600' : 'text-b2b-muted')}>
                    {f.bio.length}/{BIO_MAX}
                  </span>
                </div>
              </Section>

              <Section id="profile-links" title={t.links} hint={t.linksHint}>
                <LinksEditor links={f.links} onChange={(links) => setF({ ...f, links })} t={t} />
              </Section>

              <Section id="profile-booking" title={t.booking} hint={t.bookingHint}>
                <div className="flex flex-wrap gap-2">
                  <Link to="/studio/epk" className="inline-flex h-8 items-center gap-1.5 border-2 border-b2b-ink/80 px-3 font-label text-[11px] font-bold tracking-[0.08em] text-b2b-ink uppercase hover:border-rave-accent hover:text-rave-accent">
                    {t.openEpk}
                  </Link>
                  <Link to="/studio/rate-card" className="inline-flex h-8 items-center gap-1.5 border-2 border-b2b-ink/80 px-3 font-label text-[11px] font-bold tracking-[0.08em] text-b2b-ink uppercase hover:border-rave-accent hover:text-rave-accent">
                    {t.openRateCard}
                  </Link>
                </div>
              </Section>
            </div>

            <aside className="hidden space-y-4 lg:sticky lg:top-20 lg:block">
              <p className="font-label text-[11px] font-bold tracking-[0.1em] text-b2b-muted uppercase">{t.preview}</p>
              <Preview a={q.data} f={f} t={t} />
              <Completeness f={f} t={t} />
              <Button variant="ink" type="submit" loading={busy} disabled={!dirty} className="w-full">
                {t.save}
              </Button>
            </aside>

            {dirty && (
              <div className="sticky bottom-3 z-30 col-span-full border-2 border-b2b-ink bg-b2b-card px-4 py-3 shadow-[4px_4px_0_var(--color-rave-mustard)]" role="status">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-bold text-b2b-ink">{t.unsaved}</p>
                  <div className="flex shrink-0 gap-2">
                    <Button type="button" variant="outline-ink" size="sm" disabled={busy} onClick={() => setF(base)}>
                      {t.discard}
                    </Button>
                    <Button type="submit" variant="ink" size="sm" loading={busy}>
                      {t.save}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </form>
        )}
      </QueryState>
    </div>
  );
}
