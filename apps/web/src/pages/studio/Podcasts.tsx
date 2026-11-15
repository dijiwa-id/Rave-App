import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Code2, EyeOff, FileAudio, Headphones, Lock, Pencil, Plus, Send, Trash2, Undo2, Upload } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { useDict } from '@/lib/i18n';
import type { EpisodeEmbed, OrgClaim } from '@/lib/types';
import { Badge, Button, confirmDialog, cx, Field, Input, Modal, PageHeader, Select, Textarea, toast } from '@/components/ui';
import { Empty, QueryState, useCurrentArtist } from '@/components/b2b/common';
import { EmbedPlayer, EMBED_LABEL } from '@/components/podcast/EmbedPlayer';

/**
 * Podcaster — kelola acara (podcast / audio fiksi) & episode milik org: unggah audio atau tempel kode embed dari
 * platform lain. Dipakai di Artist Studio (/studio/podcasts) dan Podcaster Studio (/podcaster) untuk akun Kreator.
 * Kebijakan (siapa boleh, tinjauan, batas, embed) diatur Super Admin → Pengaturan → Podcaster. API: docs/API.md §3b.
 */

export interface PodcastPolicy {
  creator_enabled: boolean;
  creator_org_types: string[];
  require_review: boolean;
  fiction_enabled: boolean;
  max_shows_per_org: number;
  max_episode_minutes: number;
  premium_episodes: boolean;
  embed_enabled: boolean;
  embed_providers: string[];
  audio_max_mb: number;
  cover_min_px: number;
}
interface StudioShow {
  id: string;
  org_id: string;
  kind: 'PODCAST' | 'FICTION';
  title: string;
  publisher: string;
  description: string;
  category: string;
  cover_url: string | null;
  explicit: boolean;
  content_warning: string | null;
  status: 'ACTIVE' | 'HIDDEN';
  hidden_reason: string | null;
  episode_count: number;
  published_count: number;
  pending_count: number;
  updated_at: string;
}
type EpisodeStatus = 'DRAFT' | 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'HIDDEN';
interface StudioEpisode {
  id: string;
  title: string;
  description: string;
  status: EpisodeStatus;
  source: 'upload' | 'embed';
  audio_url: string | null;
  embed: EpisodeEmbed | null;
  duration_ms: number;
  is_premium: boolean;
  season: number | null;
  episode_number: number | null;
  review_note: string | null;
  published_at: string | null;
  updated_at: string;
}

const CATEGORIES = ['Musik', 'Komedi', 'Cerita', 'Budaya', 'Edukasi', 'Bisnis', 'Teknologi', 'Gaya Hidup', 'Berita', 'Olahraga', 'Kesehatan', 'Religi'];
const STATUS_TONE: Record<EpisodeStatus, 'neutral' | 'amber' | 'green' | 'red' | 'purple'> = { DRAFT: 'neutral', PENDING: 'amber', PUBLISHED: 'green', REJECTED: 'red', HIDDEN: 'purple' };

/** Halaman Artist Studio → Podcast (org artis yang sedang dipilih). */
export default function StudioPodcasts() {
  const org = useCurrentArtist();
  return org ? <PodcastManager org={org} /> : null;
}

export function PodcastManager({ org }: { org: OrgClaim }) {
  const t = useDict('b2b').podcaster;
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<StudioShow | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['studio-podcasts', org.id],
    queryFn: () => api<{ data: StudioShow[]; policy: PodcastPolicy; eligible: boolean }>('/v1/studio/podcasts', { query: { org_id: org.id } }),
  });
  const shows = q.data?.data ?? [];
  const policy = q.data?.policy;
  // Tunggu refetch selesai: acara yang baru dibuat dipilih sebelum daftar memuatnya (jangan langsung dibatalkan).
  useEffect(() => {
    if (selected && q.data && !q.isFetching && !q.data.data.some((s) => s.id === selected)) setSelected(null);
  }, [q.data, q.isFetching, selected]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['studio-podcasts', org.id] });
  const current = shows.find((s) => s.id === selected);
  const atLimit = !!policy && shows.length >= policy.max_shows_per_org;

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          q.data?.eligible && (
            <Button variant="ink" icon={<Plus />} disabled={atLimit} title={atLimit ? t.limitReached(policy!.max_shows_per_org) : undefined} onClick={() => setEditing('new')}>
              {t.newShow}
            </Button>
          )
        }
      />
      <QueryState q={q}>
        {q.data && !q.data.eligible ? (
          <Empty title={policy?.creator_enabled ? t.notEligible : t.disabled} body={policy?.creator_enabled ? t.notEligibleBody : t.disabledBody} />
        ) : (
          <>
            {policy && (
              <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-b2b-muted">
                <span>{policy.require_review ? t.policyReview : t.policyNoReview}</span>
                <span>{t.policyLimits(policy.max_shows_per_org, policy.max_episode_minutes, policy.audio_max_mb)}</span>
                {policy.embed_enabled && <span>{t.policyEmbed(policy.embed_providers.map((p) => EMBED_LABEL[p] ?? p).join(', '))}</span>}
              </p>
            )}
            {!shows.length ? (
              <Empty
                title={t.empty}
                body={t.emptyBody}
                action={
                  <Button variant="ink" icon={<Plus />} onClick={() => setEditing('new')}>
                    {t.newShow}
                  </Button>
                }
              />
            ) : current ? (
              <ShowDetail show={current} policy={policy!} onBack={() => setSelected(null)} onEdit={() => setEditing(current)} onChanged={refresh} />
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {shows.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => setSelected(s.id)} className="flex w-full gap-3 border border-b2b-line bg-b2b-card p-3 text-left hover:border-b2b-ink">
                      <Cover url={s.cover_url} className="size-20 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate font-bold">{s.title}</span>
                        <span className="block truncate text-xs text-b2b-muted">
                          {s.kind === 'FICTION' ? t.fiction : 'Podcast'} · {s.category}
                        </span>
                        <span className="mt-2 flex flex-wrap gap-1">
                          {s.status === 'HIDDEN' && <Badge tone="red">{t.hidden}</Badge>}
                          <Badge tone="green">{t.publishedN(s.published_count)}</Badge>
                          {s.pending_count > 0 && <Badge tone="amber">{t.pendingN(s.pending_count)}</Badge>}
                          <Badge>{t.episodesN(s.episode_count)}</Badge>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </QueryState>
      {editing && policy && (
        <ShowModal
          org={org}
          policy={policy}
          show={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            setSelected(id);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function Cover({ url, className }: { url: string | null; className?: string }) {
  return url ? (
    <img src={url} alt="" loading="lazy" className={cx('aspect-square object-cover', className)} />
  ) : (
    <span className={cx('grid aspect-square place-items-center bg-b2b-bg text-b2b-muted', className)}>
      <Headphones className="size-6" />
    </span>
  );
}

function ShowModal({ org, policy, show, onClose, onSaved }: { org: OrgClaim; policy: PodcastPolicy; show: StudioShow | null; onClose: () => void; onSaved: (id: string) => void }) {
  const t = useDict('b2b').podcaster;
  const [f, setF] = useState({
    kind: show?.kind ?? ('PODCAST' as 'PODCAST' | 'FICTION'),
    title: show?.title ?? '',
    publisher: show?.publisher ?? org.name,
    category: show?.category ?? 'Musik',
    description: show?.description ?? '',
    cover_url: show?.cover_url ?? null,
    explicit: show?.explicit ?? false,
    content_warning: show?.content_warning ?? '',
  });
  const [busy, setBusy] = useState<string | null>(null);
  async function save() {
    setBusy('save');
    try {
      const body = { ...f, content_warning: f.content_warning.trim() || null };
      const r = show
        ? await api<StudioShow>(`/v1/studio/podcasts/${show.id}`, { method: 'PATCH', body })
        : await api<StudioShow>('/v1/studio/podcasts', { body: { ...body, org_id: org.id } });
      toast.success(show ? t.showSaved : t.showCreated);
      onSaved(r.id);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Modal open onClose={onClose} title={show ? t.editShow : t.newShow} wide>
      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <div>
          <Cover url={f.cover_url} className="w-full" />
          <label className="mt-2 inline-flex w-full cursor-pointer items-center justify-center gap-1.5 border border-b2b-line px-2 py-1.5 text-xs font-bold hover:border-b2b-ink">
            <Upload className="size-3.5" /> {busy === 'cover' ? t.uploading : t.uploadCover}
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setBusy('cover');
                try {
                  const url = await uploadFile(file, 'artwork', 'podcast');
                  setF((x) => ({ ...x, cover_url: url }));
                } catch (err) {
                  toast.error(err);
                } finally {
                  setBusy(null);
                }
              }}
            />
          </label>
          <p className="mt-1 text-[11px] text-b2b-muted">{t.coverHint(policy.cover_min_px)}</p>
        </div>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t.kind}>
              <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'PODCAST' | 'FICTION' })}>
                <option value="PODCAST">Podcast</option>
                {(policy.fiction_enabled || show?.kind === 'FICTION') && <option value="FICTION">{t.fiction}</option>}
              </Select>
            </Field>
            <Field label={t.category}>
              <Input list="podcast-categories" value={f.category} maxLength={60} onChange={(e) => setF({ ...f, category: e.target.value })} />
              <datalist id="podcast-categories">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
          </div>
          <Field label={t.showTitle}>
            <Input value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus />
          </Field>
          <Field label={t.publisher} hint={t.publisherHint}>
            <Input value={f.publisher} maxLength={120} onChange={(e) => setF({ ...f, publisher: e.target.value })} />
          </Field>
          <Field label={t.description}>
            <Textarea rows={4} maxLength={4000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.explicit} onChange={(e) => setF({ ...f, explicit: e.target.checked })} /> {t.explicit}
          </label>
          <Field label={t.contentWarning} hint={t.contentWarningHint}>
            <Input value={f.content_warning} maxLength={200} onChange={(e) => setF({ ...f, content_warning: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline-ink" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button variant="ink" loading={busy === 'save'} disabled={f.title.trim().length < 2 || f.publisher.trim().length < 2 || f.category.trim().length < 2 || busy === 'cover'} onClick={save}>
              {show ? t.save : t.create}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ShowDetail({ show, policy, onBack, onEdit, onChanged }: { show: StudioShow; policy: PodcastPolicy; onBack: () => void; onEdit: () => void; onChanged: () => void }) {
  const t = useDict('b2b').podcaster;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['studio-podcast', show.id], queryFn: () => api<StudioShow & { episodes: StudioEpisode[] }>(`/v1/studio/podcasts/${show.id}`) });
  const [ep, setEp] = useState<StudioEpisode | 'new' | null>(null);
  const reload = () => {
    qc.invalidateQueries({ queryKey: ['studio-podcast', show.id] });
    onChanged();
  };
  async function setPublish(e: StudioEpisode, publish: boolean) {
    try {
      const r = await api<StudioEpisode>(`/v1/studio/podcasts/${show.id}/episodes/${e.id}`, { method: 'PATCH', body: { publish } });
      toast.success(publish ? (r.status === 'PENDING' ? t.sentForReview : t.publishedOk) : t.movedToDraft);
      reload();
    } catch (err) {
      toast.error(err);
    }
  }
  async function removeEpisode(e: StudioEpisode) {
    if (!(await confirmDialog({ title: t.deleteEpisodeTitle, body: t.deleteEpisodeBody, confirmLabel: t.delete, danger: true, detail: e.title }))) return;
    try {
      await api(`/v1/studio/podcasts/${show.id}/episodes/${e.id}`, { method: 'DELETE' });
      toast.success(t.deleted);
      reload();
    } catch (err) {
      toast.error(err);
    }
  }
  async function removeShow() {
    if (!(await confirmDialog({ title: t.deleteShowTitle, body: t.deleteShowBody, confirmLabel: t.delete, danger: true, image: show.cover_url, detail: `${show.title} · ${t.episodesN(show.episode_count)}` }))) return;
    try {
      await api(`/v1/studio/podcasts/${show.id}`, { method: 'DELETE' });
      toast.success(t.deleted);
      onBack();
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  }
  return (
    <div>
      <button onClick={onBack} className="mb-3 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
        ← {t.allShows}
      </button>
      <div className="flex flex-col gap-4 border border-b2b-line bg-b2b-card p-4 sm:flex-row">
        <Cover url={show.cover_url} className="size-32 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-b2b-muted uppercase">
            {show.kind === 'FICTION' ? t.fiction : 'Podcast'} · {show.category}
            {show.explicit && ' · E'}
          </p>
          <h2 className="text-xl font-extrabold">{show.title}</h2>
          <p className="text-sm text-b2b-muted">{show.publisher}</p>
          <p className="mt-2 line-clamp-3 text-sm">{show.description}</p>
          {show.status === 'HIDDEN' && (
            <p className="mt-3 flex items-start gap-2 border border-red-300 bg-red-50 p-2 text-sm text-red-800">
              <EyeOff className="mt-0.5 size-4 shrink-0" /> {t.hiddenNotice(show.hidden_reason ?? '')}
            </p>
          )}
          {show.published_count > 0 && show.status === 'ACTIVE' && (
            <Link to={`/app/show/${show.id}`} target="_blank" className="mt-2 inline-block text-sm font-bold underline">
              {t.viewPublic}
            </Link>
          )}
        </div>
        <div className="flex shrink-0 gap-2 sm:flex-col">
          <Button size="sm" variant="outline-ink" icon={<Pencil />} onClick={onEdit}>
            {t.editShow}
          </Button>
          <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={removeShow}>
            {t.delete}
          </Button>
        </div>
      </div>

      <div className="mt-6 mb-3 flex items-center justify-between">
        <h3 className="font-bold">{t.episodes}</h3>
        <Button size="sm" variant="ink" icon={<Plus />} disabled={show.status === 'HIDDEN'} onClick={() => setEp('new')}>
          {t.newEpisode}
        </Button>
      </div>
      <QueryState q={q} empty={q.data && !q.data.episodes.length ? <Empty title={t.noEpisodes} body={t.noEpisodesBody} /> : undefined}>
        <ul className="divide-y divide-b2b-line border border-b2b-line bg-b2b-card">
          {q.data?.episodes.map((e) => (
            <li key={e.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <span className="grid size-9 shrink-0 place-items-center bg-b2b-bg text-b2b-muted">{e.source === 'embed' ? <Code2 className="size-4" /> : <FileAudio className="size-4" />}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate font-bold">
                    {e.season ? `S${e.season} E${e.episode_number ?? '?'} · ` : ''}
                    {e.title}
                  </span>
                  <Badge tone={STATUS_TONE[e.status]}>{t.status[e.status]}</Badge>
                  {e.is_premium && (
                    <Badge tone="amber">
                      <Lock className="mr-0.5 inline size-3" />
                      Premium
                    </Badge>
                  )}
                </span>
                <span className="block text-xs text-b2b-muted">
                  {e.source === 'embed' ? t.viaEmbed(EMBED_LABEL[e.embed?.provider ?? ''] ?? '') : t.uploaded}
                  {e.duration_ms > 0 && ` · ${fmt.duration(e.duration_ms)}`} · {t.updatedAt(fmt.dateTime(e.updated_at))}
                </span>
                {e.review_note && (e.status === 'REJECTED' || e.status === 'HIDDEN') && (
                  <span className="mt-1 flex items-start gap-1 text-xs text-red-700">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {t.reviewNote(e.review_note)}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 flex-wrap gap-1.5">
                {e.status !== 'HIDDEN' && (
                  <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEp(e)}>
                    {t.edit}
                  </Button>
                )}
                {(e.status === 'DRAFT' || e.status === 'REJECTED') && show.status === 'ACTIVE' && (
                  <Button size="sm" variant="outline-ink" icon={<Send />} onClick={() => setPublish(e, true)}>
                    {policy.require_review ? t.submit : t.publish}
                  </Button>
                )}
                {(e.status === 'PENDING' || e.status === 'PUBLISHED') && (
                  <Button size="sm" variant="ghost" icon={<Undo2 />} onClick={() => setPublish(e, false)}>
                    {t.toDraft}
                  </Button>
                )}
                <Button size="sm" variant="ghost" icon={<Trash2 />} aria-label={t.delete} title={t.delete} onClick={() => removeEpisode(e)} />
              </span>
            </li>
          ))}
        </ul>
      </QueryState>
      {ep && <EpisodeModal show={show} policy={policy} episode={ep === 'new' ? null : ep} onClose={() => setEp(null)} onSaved={() => (setEp(null), reload())} />}
    </div>
  );
}

function EpisodeModal({ show, policy, episode, onClose, onSaved }: { show: StudioShow; policy: PodcastPolicy; episode: StudioEpisode | null; onClose: () => void; onSaved: () => void }) {
  const t = useDict('b2b').podcaster;
  const embedAllowed = policy.embed_enabled || episode?.source === 'embed';
  const [f, setF] = useState({
    title: episode?.title ?? '',
    description: episode?.description ?? '',
    source: episode?.source ?? ('upload' as 'upload' | 'embed'),
    audio_url: episode?.audio_url ?? null as string | null,
    audio_name: '',
    embed_code: episode?.embed?.src ?? '',
    is_premium: episode?.is_premium ?? false,
    season: episode?.season ?? null as number | null,
    episode_number: episode?.episode_number ?? null as number | null,
  });
  const [preview, setPreview] = useState<EpisodeEmbed | null>(episode?.embed ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const sourceChanged = !episode || f.source !== episode.source || (f.source === 'upload' ? f.audio_url !== episode.audio_url : f.embed_code !== (episode.embed?.src ?? ''));

  async function checkEmbed() {
    setBusy('preview');
    try {
      setPreview(await api<EpisodeEmbed>('/v1/studio/podcasts/embed/preview', { body: { embed_code: f.embed_code } }));
    } catch (e) {
      setPreview(null);
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }
  async function save(publish: boolean | undefined) {
    setBusy(publish ? 'publish' : 'save');
    try {
      const body: Record<string, unknown> = {
        title: f.title.trim(),
        description: f.description.trim(),
        is_premium: f.source === 'upload' && f.is_premium,
        season: show.kind === 'FICTION' ? f.season : null,
        episode_number: show.kind === 'FICTION' ? f.episode_number : null,
      };
      if (sourceChanged) Object.assign(body, f.source === 'upload' ? { source: 'upload', audio_url: f.audio_url } : { source: 'embed', embed_code: f.embed_code });
      if (publish !== undefined) body.publish = publish;
      const r = episode
        ? await api<StudioEpisode>(`/v1/studio/podcasts/${show.id}/episodes/${episode.id}`, { method: 'PATCH', body })
        : await api<StudioEpisode>(`/v1/studio/podcasts/${show.id}/episodes`, { body: { ...body, source: f.source, publish: !!publish } });
      toast.success(r.status === 'PENDING' ? t.sentForReview : r.status === 'PUBLISHED' ? t.publishedOk : t.savedDraft);
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }
  const ready = f.title.trim().length >= 2 && (f.source === 'upload' ? !!f.audio_url : !!f.embed_code.trim()) && !busy;
  const willReview = policy.require_review && !(episode?.status === 'PUBLISHED' && !sourceChanged && f.title === episode.title && f.description === episode.description);

  return (
    <Modal open onClose={onClose} title={episode ? t.editEpisode : t.newEpisode} wide>
      <div className="space-y-4">
        <Field label={t.episodeTitle}>
          <Input value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus />
        </Field>
        <Field label={t.description}>
          <Textarea rows={3} maxLength={4000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        {show.kind === 'FICTION' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t.season}>
              <Input type="number" min={1} value={f.season ?? ''} onChange={(e) => setF({ ...f, season: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label={t.episodeNumber}>
              <Input type="number" min={1} value={f.episode_number ?? ''} onChange={(e) => setF({ ...f, episode_number: e.target.value ? Number(e.target.value) : null })} />
            </Field>
          </div>
        )}

        <div>
          <p className="mb-2 text-sm font-bold">{t.source}</p>
          <div className="mb-3 inline-flex border border-b2b-line">
            {(['upload', 'embed'] as const).map((s) => (
              <button
                key={s}
                disabled={s === 'embed' && !embedAllowed}
                onClick={() => setF({ ...f, source: s })}
                className={cx('flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold disabled:opacity-40', f.source === s ? 'bg-b2b-ink text-b2b-on-ink' : 'text-b2b-muted hover:text-b2b-ink')}
              >
                {s === 'upload' ? <FileAudio className="size-3.5" /> : <Code2 className="size-3.5" />}
                {s === 'upload' ? t.sourceUpload : t.sourceEmbed}
              </button>
            ))}
          </div>
          {f.source === 'upload' ? (
            <div className="border border-dashed border-b2b-line p-3">
              <label className="inline-flex cursor-pointer items-center gap-1.5 border border-b2b-line bg-b2b-card px-3 py-1.5 text-sm font-bold hover:border-b2b-ink">
                <Upload className="size-4" /> {busy === 'audio' ? t.uploading : f.audio_url ? t.replaceAudio : t.uploadAudio}
                <input
                  type="file"
                  accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg,.opus,.aiff"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    if (file.size > policy.audio_max_mb * 1024 * 1024) return toast.error(t.tooBig(policy.audio_max_mb));
                    setBusy('audio');
                    try {
                      const url = await uploadFile(file, 'audio', 'podcast');
                      setF((x) => ({ ...x, audio_url: url, audio_name: file.name }));
                    } catch (err) {
                      toast.error(err);
                    } finally {
                      setBusy(null);
                    }
                  }}
                />
              </label>
              <p className="mt-2 text-xs text-b2b-muted">{f.audio_url ? t.audioReady(f.audio_name || f.audio_url.split('/').pop() || '') : t.audioHint(policy.audio_max_mb, policy.max_episode_minutes)}</p>
              {policy.premium_episodes && (
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={f.is_premium} onChange={(e) => setF({ ...f, is_premium: e.target.checked })} /> {t.premium}
                </label>
              )}
            </div>
          ) : (
            <div className="space-y-2 border border-dashed border-b2b-line p-3">
              <Textarea
                rows={3}
                className="font-mono text-xs"
                placeholder={'<iframe src="https://open.spotify.com/embed/episode/…"></iframe>\n' + t.embedPlaceholder}
                value={f.embed_code}
                onChange={(e) => {
                  setF({ ...f, embed_code: e.target.value });
                  setPreview(null);
                }}
              />
              <p className="text-xs text-b2b-muted">{t.embedHint(policy.embed_providers.map((p) => EMBED_LABEL[p] ?? p).join(', '))}</p>
              <Button size="sm" variant="outline-ink" loading={busy === 'preview'} disabled={!f.embed_code.trim()} onClick={checkEmbed}>
                {t.checkEmbed}
              </Button>
              {preview && <EmbedPlayer embed={preview} title={f.title || show.title} className="pt-2" />}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-b2b-line pt-3">
          <p className="mr-auto text-xs text-b2b-muted">{willReview ? t.reviewHint : t.noReviewHint}</p>
          <Button variant="outline-ink" onClick={onClose}>
            {t.cancel}
          </Button>
          {episode?.status === 'PUBLISHED' || episode?.status === 'PENDING' ? (
            <Button variant="ink" loading={busy === 'save'} disabled={!ready} onClick={() => save(undefined)}>
              {t.save}
            </Button>
          ) : (
            <>
              <Button variant="outline-ink" loading={busy === 'save'} disabled={!ready} onClick={() => save(false)}>
                {t.saveDraft}
              </Button>
              <Button variant="ink" icon={<Send />} loading={busy === 'publish'} disabled={!ready || show.status === 'HIDDEN'} onClick={() => save(true)}>
                {policy.require_review ? t.submit : t.publish}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
