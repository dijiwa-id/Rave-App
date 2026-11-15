import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Code2, Eye, EyeOff, FileAudio, Headphones, Lock, Search, X } from 'lucide-react';
import { api, fmt } from '@/lib/api';
import { useDict } from '@/lib/i18n';
import type { EpisodeEmbed } from '@/lib/types';
import { Badge, Button, cx, Field, Input, Modal, PageHeader, Textarea, toast } from '@/components/ui';
import { Empty, QueryState } from '@/components/b2b/common';
import { EmbedPlayer, EMBED_LABEL } from '@/components/podcast/EmbedPlayer';

/**
 * Back Office → Konten → Moderasi Podcast (izin `podcast.moderate`). Tinjau episode buatan kreator sebelum tayang
 * (`podcast.require_review`), sembunyikan episode/acara bermasalah. Alasan wajib, ditampilkan ke kreator & diaudit.
 */

type EpStatus = 'PENDING' | 'PUBLISHED' | 'REJECTED' | 'HIDDEN';
interface ModEpisode {
  id: string;
  title: string;
  description: string;
  status: EpStatus | 'DRAFT';
  source: 'upload' | 'embed';
  audio_preview_url: string | null;
  embed: EpisodeEmbed | null;
  duration_ms: number;
  is_premium: boolean;
  review_note: string | null;
  submitted_at: string | null;
  updated_at: string;
  show: { id: string; title: string; publisher: string; kind: string; cover_url: string | null; status: string };
}
interface ModShow {
  id: string;
  org_id: string | null;
  kind: string;
  title: string;
  publisher: string;
  category: string;
  cover_url: string | null;
  status: 'ACTIVE' | 'HIDDEN';
  hidden_reason: string | null;
  episode_count: number;
  published_count: number;
  pending_count: number;
}
const TABS = ['PENDING', 'PUBLISHED', 'REJECTED', 'HIDDEN', 'shows'] as const;
type Tab = (typeof TABS)[number];
type Act = { kind: 'reject' | 'hide'; ep: ModEpisode } | { kind: 'hideShow'; show: ModShow };

export function AdminPodcasts() {
  const t = useDict('admin').podcasts;
  const common = useDict('admin').common;
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('PENDING');
  const [search, setSearch] = useState('');
  const [act, setAct] = useState<Act | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const eps = useQuery({
    queryKey: ['admin-podcast-episodes', tab, search],
    queryFn: () => api<{ data: ModEpisode[]; pending: number }>('/v1/admin/podcasts/episodes', { query: { status: tab, q: search || undefined } }),
    enabled: tab !== 'shows',
  });
  const shows = useQuery({
    queryKey: ['admin-podcast-shows', search],
    queryFn: () => api<{ data: ModShow[] }>('/v1/admin/podcasts/shows', { query: { q: search || undefined } }),
    enabled: tab === 'shows',
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-podcast-episodes'] });
    qc.invalidateQueries({ queryKey: ['admin-podcast-shows'] });
  };

  async function decide(ep: ModEpisode, action: 'approve' | 'reject' | 'hide', why?: string) {
    try {
      await api(`/v1/admin/podcasts/episodes/${ep.id}/decision`, { body: { action, reason: why } });
      toast.success(t.done[action]);
      refresh();
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  }
  async function setShowHidden(show: ModShow, hidden: boolean, why?: string) {
    try {
      await api(`/v1/admin/podcasts/shows/${show.id}/visibility`, { body: { hidden, reason: why } });
      toast.success(hidden ? t.showHidden : t.showRestored);
      refresh();
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  }
  async function submitAct() {
    if (!act) return;
    setBusy(true);
    const ok = act.kind === 'hideShow' ? await setShowHidden(act.show, true, reason.trim()) : await decide(act.ep, act.kind, reason.trim());
    setBusy(false);
    if (ok) setAct(null);
  }
  const open = (a: Act) => {
    setReason('');
    setAct(a);
  };

  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {TABS.map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cx('border px-3 py-1.5 text-xs font-bold', tab === k ? 'border-b2b-ink bg-b2b-ink text-b2b-on-ink' : 'border-b2b-line text-b2b-muted hover:text-b2b-ink')}
          >
            {t.tabs[k]}
            {k === 'PENDING' && !!eps.data?.pending && tab !== 'shows' && <span className="ml-1.5 bg-amber-400 px-1.5 text-black">{eps.data.pending}</span>}
          </button>
        ))}
        <label className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-b2b-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.search} className="pl-9" aria-label={t.search} />
        </label>
      </div>

      {tab === 'shows' ? (
        <QueryState q={shows} empty={shows.data && !shows.data.data.length ? <Empty title={t.noShows} /> : undefined}>
          <ul className="divide-y divide-b2b-line border border-b2b-line bg-b2b-card">
            {shows.data?.data.map((s) => (
              <li key={s.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                <Thumb url={s.cover_url} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-bold">{s.title}</span>
                    {s.status === 'HIDDEN' && <Badge tone="red">{t.hidden}</Badge>}
                    <Badge>{s.org_id ? t.creatorShow : t.catalogShow}</Badge>
                  </span>
                  <span className="block text-xs text-b2b-muted">
                    {s.publisher} · {s.category} · {t.counts(s.published_count, s.pending_count, s.episode_count)}
                  </span>
                  {s.hidden_reason && <span className="block text-xs text-red-700">{s.hidden_reason}</span>}
                </span>
                {s.status === 'HIDDEN' ? (
                  <Button size="sm" variant="outline-ink" icon={<Eye />} onClick={() => setShowHidden(s, false)}>
                    {t.restore}
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" icon={<EyeOff />} onClick={() => open({ kind: 'hideShow', show: s })}>
                    {t.hideShow}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </QueryState>
      ) : (
        <QueryState q={eps} empty={eps.data && !eps.data.data.length ? <Empty title={t.empty[tab]} /> : undefined}>
          <ul className="grid gap-4 xl:grid-cols-2">
            {eps.data?.data.map((e) => (
              <li key={e.id} className="flex flex-col border border-b2b-line bg-b2b-card">
                <div className="flex gap-3 p-3">
                  <Thumb url={e.show.cover_url} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{e.title}</p>
                    <p className="truncate text-xs text-b2b-muted">
                      {e.show.title} · {e.show.publisher}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-b2b-muted">
                      {e.source === 'embed' ? <Code2 className="size-3.5" /> : <FileAudio className="size-3.5" />}
                      {e.source === 'embed' ? t.embedFrom(EMBED_LABEL[e.embed?.provider ?? ''] ?? '') : t.upload}
                      {e.duration_ms > 0 && ` · ${fmt.duration(e.duration_ms)}`}
                      {e.is_premium && (
                        <Badge tone="amber">
                          <Lock className="mr-0.5 inline size-3" />
                          Premium
                        </Badge>
                      )}
                      {e.submitted_at && <span>· {t.submitted(fmt.dateTime(e.submitted_at))}</span>}
                    </p>
                  </div>
                </div>
                <div className="px-3">
                  {e.description && <p className="mb-2 line-clamp-3 text-sm text-b2b-muted">{e.description}</p>}
                  {e.source === 'embed' && e.embed ? (
                    <EmbedPlayer embed={e.embed} title={e.title} />
                  ) : e.audio_preview_url ? (
                    <audio controls preload="none" src={e.audio_preview_url} className="w-full" />
                  ) : null}
                  {e.review_note && <p className="mt-2 text-xs text-red-700">{t.note(e.review_note)}</p>}
                </div>
                <div className="mt-auto flex flex-wrap gap-2 p-3">
                  {(e.status === 'PENDING' || e.status === 'REJECTED' || e.status === 'HIDDEN') && (
                    <Button size="sm" variant="ink" icon={<Check />} onClick={() => decide(e, 'approve')}>
                      {e.status === 'PENDING' ? common.approve : t.republish}
                    </Button>
                  )}
                  {e.status === 'PENDING' && (
                    <Button size="sm" variant="outline-ink" icon={<X />} onClick={() => open({ kind: 'reject', ep: e })}>
                      {common.reject}
                    </Button>
                  )}
                  {e.status === 'PUBLISHED' && (
                    <Button size="sm" variant="outline-ink" icon={<EyeOff />} onClick={() => open({ kind: 'hide', ep: e })}>
                      {t.hideEpisode}
                    </Button>
                  )}
                  <a href={`/app/show/${e.show.id}`} target="_blank" rel="noreferrer" className="ml-auto self-center text-xs font-bold text-b2b-muted underline">
                    {t.openShow}
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </QueryState>
      )}

      {act && (
        <Modal open onClose={() => setAct(null)} title={act.kind === 'reject' ? t.rejectTitle : act.kind === 'hide' ? t.hideEpisodeTitle : t.hideShowTitle}>
          <div className="space-y-4 text-sm">
            <p>
              <strong>{act.kind === 'hideShow' ? act.show.title : act.ep.title}</strong>
              {act.kind !== 'hideShow' && ` — ${act.ep.show.title}`}
            </p>
            <Field label={t.reason} hint={t.reasonHint}>
              <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline-ink" onClick={() => setAct(null)}>
                {common.cancel}
              </Button>
              <Button variant="danger" loading={busy} disabled={reason.trim().length < 5} onClick={submitAct}>
                {act.kind === 'reject' ? common.reject : act.kind === 'hide' ? t.hideEpisode : t.hideShow}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Thumb({ url }: { url: string | null }) {
  return url ? (
    <img src={url} alt="" loading="lazy" className="size-14 shrink-0 object-cover" />
  ) : (
    <span className="grid size-14 shrink-0 place-items-center bg-b2b-bg text-b2b-muted">
      <Headphones className="size-5" />
    </span>
  );
}
