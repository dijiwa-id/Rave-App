import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowLeft, Copy, ExternalLink, Eye, EyeOff, KeyRound, Pencil, Plus, Radio, Trash2 } from 'lucide-react';
import HoldButton from '@/components/reactbits/HoldButton';
import { api, ApiError, fmt } from '@/lib/api';
import type { EventSummary, LiveAccess, LiveKeyInfo, LiveStream, LiveStreamDetail, OrgClaim, StreamHealth } from '@/lib/types';
import { Badge, Button, Card, cx, Field, Input, Modal, PageHeader, Select, Stat, Textarea, toast } from '@/components/ui';
import { Empty, QueryState, Table, useCurrentArtist, useCurrentPromotor } from '@/components/b2b/common';
import { endedReason, isOnAir, LiveStatusBadge, useLiveSettings } from '@/components/live/common';
import { LivePlayer } from '@/components/live/LivePlayer';
import { LiveChat } from '@/components/live/LiveChat';
import { BrowserBroadcast } from '@/components/live/BrowserBroadcast';
import { localeTag, useDict } from '@/lib/i18n';

// Live di Artist Studio (/studio/live) & Promotor Hub (/promotor/live) — satu komponen, org dari pemilih layout.

type Kind = 'artist' | 'promotor';
type CreateResult = LiveKeyInfo & { stream: LiveStream };

function useLiveOrg(kind: Kind): { org: OrgClaim; base: string } {
  const artist = useCurrentArtist();
  const promotor = useCurrentPromotor();
  return kind === 'artist' ? { org: artist!, base: '/studio/live' } : { org: promotor!, base: '/promotor/live' };
}

function useStudioStreams(orgId: string) {
  return useQuery({
    queryKey: ['live-studio', orgId],
    queryFn: () => api<{ data: LiveStream[] }>('/v1/live/studio/streams', { query: { org_id: orgId } }),
    refetchInterval: 10_000,
  });
}

/** Event milik org untuk akses TICKET: promotor → event org, artis → event yang menampilkan artis tsb. */
function useOrgEvents(kind: Kind, org: OrgClaim) {
  return useQuery({
    queryKey: ['live-org-events', kind, org.id],
    queryFn: async () =>
      kind === 'promotor'
        ? (await api<{ data: EventSummary[] }>(`/v1/ticketing/orgs/${org.id}/events`)).data
        : org.artist_id
          ? (await api<{ data: EventSummary[] }>('/v1/ticketing/events', { query: { artist_id: org.artist_id } })).data
          : [],
  });
}

const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

// ---------- Modal kunci stream (sekali tampil) ----------
function Secret({ label, value, mask }: { label: string; value: string; mask?: boolean }) {
  const [show, setShow] = useState(!mask);
  const d = useDict('live');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(d.studio.copied(label));
    } catch {
      toast.error(d.studio.copyFailed);
    }
  };
  return (
    <div>
      <p className="mb-1 text-xs font-bold text-b2b-muted">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-none border border-b2b-line bg-b2b-bg px-3 py-2 font-mono text-sm">{show ? value : '•'.repeat(Math.min(24, value.length))}</code>
        {mask && (
          <button onClick={() => setShow(!show)} aria-label={show ? d.studio.hide : d.studio.show} className="grid size-9 place-items-center rounded-none border border-b2b-line hover:border-b2b-ink">
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
        <button onClick={copy} aria-label={d.studio.copy(label)} className="grid size-9 place-items-center rounded-none border border-b2b-line hover:border-b2b-ink">
          <Copy className="size-4" />
        </button>
      </div>
    </div>
  );
}

function KeyModal({ info, onClose }: { info: LiveKeyInfo | null; onClose: () => void }) {
  const d = useDict('live');
  const t = d.studio;
  return (
    <Modal open={!!info} onClose={onClose} title={t.keyTitle} wide>
      {info && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-none border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>
              <b>{t.keyOnce}</b>{t.keyWarning}
            </p>
          </div>
          <Secret label={t.rtmpServer} value={info.rtmp_server} />
          <Secret label={t.streamKey} value={info.stream_key} mask />
          <details className="rounded-none border border-b2b-line p-3 text-sm">
            <summary className="cursor-pointer font-bold">{t.fullUrl}</summary>
            <div className="mt-3">
              <Secret label={t.rtmpUrl} value={info.rtmp_url} mask />
            </div>
          </details>
          <div className="rounded-none bg-b2b-bg p-4 text-sm">
            <p className="mb-2 font-bold">{t.obsGuide}</p>
            <ol className="list-decimal space-y-1 pl-5 text-b2b-muted">
              <li>
                {t.obs1a}<b className="text-b2b-ink">Settings → Stream</b>{t.obs1b}<b className="text-b2b-ink">Custom…</b>
              </li>
              <li>
                {t.obs2a}<b className="text-b2b-ink">Server</b>{t.obs2b}<b className="text-b2b-ink">Stream Key</b>{t.obs2c}
              </li>
              <li>
                <b className="text-b2b-ink">Settings → Output</b>{t.obs3a}<b className="text-b2b-ink">x264</b>{t.obs3b}<b className="text-b2b-ink">2500–4500 kbps</b>{t.obs3c}<b className="text-b2b-ink">2 s</b>{t.obs3d}
              </li>
              <li>
                {t.obs4a}<b className="text-b2b-ink">AAC 128 kbps</b>{t.obs4b}
              </li>
              <li>
                {t.obs5a}<b className="text-b2b-ink">Start Streaming</b>{t.obs5b}
              </li>
            </ol>
          </div>
          <div className="flex justify-end">
            <Button variant="ink" onClick={onClose}>
              {t.saved}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------- Form buat/ubah ----------
interface FormValue {
  title: string;
  description: string;
  scheduled_at: string;
  access: LiveAccess;
  event_id: string;
}

function StreamForm({ kind, org, initial, submitLabel, onSubmit }: { kind: Kind; org: OrgClaim; initial: FormValue; submitLabel: string; onSubmit: (v: FormValue, events: EventSummary[]) => Promise<void> }) {
  const [v, setV] = useState<FormValue>(initial);
  const d = useDict('live');
  const t = d.studio;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const events = useOrgEvents(kind, org);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (v.title.trim().length < 3) errors.title = t.titleMin;
    if (v.access === 'TICKET' && !v.event_id) errors.event_id = t.pickEventErr;
    setErr(errors);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      await onSubmit(v, events.data ?? []);
    } catch (x) {
      if (x instanceof ApiError && x.problem.errors?.length) setErr(Object.fromEntries(x.problem.errors.map((e) => [e.path.replace(/^\//, ''), e.message])));
      toast.error(x);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t.titleLabel} error={err.title}>
        <Input value={v.title} maxLength={120} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder={t.titlePlaceholder} autoFocus />
      </Field>
      <Field label={t.description} hint={t.optional}>
        <Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder={t.descPlaceholder} />
      </Field>
      <Field label={t.schedule} hint={t.scheduleHint} error={err.scheduled_at}>
        <Input type="datetime-local" value={v.scheduled_at} onChange={(e) => setV({ ...v, scheduled_at: e.target.value })} />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-sm font-bold text-b2b-ink">{t.access}</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['PUBLIC', t.public, t.publicDesc],
              ['TICKET', t.ticketed, t.ticketedDesc],
            ] as const
          ).map(([val, l, desc]) => (
            <button
              key={val}
              type="button"
              aria-pressed={v.access === val}
              onClick={() => setV({ ...v, access: val })}
              className={cx('rounded-none border p-3 text-left text-sm', v.access === val ? 'border-b2b-ink bg-b2b-ink/5' : 'border-b2b-line hover:border-b2b-ink/50')}
            >
              <p className="font-bold">{l}</p>
              <p className="text-xs text-b2b-muted">{desc}</p>
            </button>
          ))}
        </div>
      </fieldset>
      {v.access === 'TICKET' && (
        <Field label={t.event} error={err.event_id} hint={events.isLoading ? t.loading : undefined}>
          <Select value={v.event_id} onChange={(e) => setV({ ...v, event_id: e.target.value })}>
            <option value="">{t.pickEvent}</option>
            {(events.data ?? []).map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title} · {ev.city}, {fmt.date(ev.starts_at)}
              </option>
            ))}
          </Select>
          {!events.isLoading && !events.data?.length && <span className="mt-1 block text-xs text-b2b-muted">{kind === 'promotor' ? t.noEventsPromotor : t.noEventsArtist}</span>}
        </Field>
      )}
      <div className="flex justify-end">
        <Button type="submit" variant="ink" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

// ---------- Daftar ----------
function LiveList({ kind }: { kind: Kind }) {
  const { org, base } = useLiveOrg(kind);
  const settings = useLiveSettings();
  const d = useDict('live');
  const t = d.studio;
  const q = useStudioStreams(org.id);
  const qc = useQueryClient();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const [keyInfo, setKeyInfo] = useState<{ info: LiveKeyInfo; id: string } | null>(null);
  const rows = q.data?.data ?? [];
  const onAir = rows.filter((s) => isOnAir(s.status));

  async function create(v: FormValue, events: EventSummary[]) {
    const ev = events.find((e) => e.id === v.event_id);
    const r = await api<CreateResult>('/v1/live/studio/streams', {
      body: {
        org_id: org.id,
        title: v.title.trim(),
        description: v.description.trim() || undefined,
        scheduled_at: v.scheduled_at ? new Date(v.scheduled_at).toISOString() : undefined,
        access: v.access,
        event_id: v.access === 'TICKET' ? v.event_id : undefined,
        // Promotor: artis utama event (artis org ARTIST otomatis di backend).
        artist_id: kind === 'promotor' && ev?.artists[0] ? ev.artists[0].id : undefined,
      },
    });
    setCreating(false);
    qc.invalidateQueries({ queryKey: ['live-studio'] });
    toast.success(t.created);
    if (settings.rtmp) setKeyInfo({ info: r, id: r.stream.id });
    else nav(`${base}/${r.stream.id}`);
  }

  if (!settings.enabled) return <Empty title={t.disabledTitle} body={t.disabledBody} />;

  return (
    <div>
      <PageHeader
        title={t.pageTitle}
        subtitle={t.pageSubtitle(org.name)}
        actions={
          <Button variant="ink" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            {t.create}
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={t.statLive} value={onAir.length} />
        <Stat label={t.statViewers} value={fmt.num(onAir.reduce((n, s) => n + s.viewers, 0))} />
        <Stat label={t.statScheduled} value={rows.filter((s) => s.status === 'SCHEDULED').length} />
        <Stat label={t.statTotal} value={fmt.compact(rows.reduce((n, s) => n + s.total_views, 0))} />
      </div>
      <QueryState q={q} empty={q.data && !rows.length ? <Empty title={t.emptyTitle} body={t.emptyBody} action={<Button variant="ink" onClick={() => setCreating(true)}>{t.create}</Button>} /> : undefined}>
        <Table head={[t.colStream, t.colStatus, t.colSchedule, t.colAccess, t.colViewers, t.colSource, '']}>
          {rows.map((s) => (
            <tr key={s.id} className="cursor-pointer hover:bg-b2b-bg/60" onClick={() => nav(`${base}/${s.id}`)}>
              <td className="px-4 py-3">
                <p className="font-bold">{s.title}</p>
                <p className="text-xs text-b2b-muted">{s.event ? t.eventPrefix(s.event.title) : (s.artist?.name ?? s.org.name)}</p>
              </td>
              <td className="px-4 py-3">
                <LiveStatusBadge status={s.status} />
              </td>
              <td className="px-4 py-3 whitespace-nowrap">{fmt.dateTime(s.started_at ?? s.scheduled_at)}</td>
              <td className="px-4 py-3">{s.access === 'TICKET' ? <Badge tone="purple">{t.ticketed}</Badge> : <Badge>{t.public}</Badge>}</td>
              <td className="px-4 py-3 tabular-nums">{isOnAir(s.status) ? t.activeViewers(fmt.num(s.viewers)) : t.peakViewers(fmt.num(s.peak_viewers))}</td>
              <td className="px-4 py-3 text-xs">{s.ingest ? s.ingest.toUpperCase() : s.key_hint ? t.keyHint(s.key_hint) : '—'}</td>
              <td className="px-4 py-3 text-right">
                <Link to={`${base}/${s.id}`} onClick={(e) => e.stopPropagation()} className="text-sm font-bold underline">
                  {t.manage}
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      </QueryState>

      <Modal open={creating} onClose={() => setCreating(false)} title={t.create}>
        <StreamForm kind={kind} org={org} initial={{ title: '', description: '', scheduled_at: '', access: 'PUBLIC', event_id: '' }} submitLabel={t.create} onSubmit={create} />
      </Modal>
      <KeyModal
        info={keyInfo?.info ?? null}
        onClose={() => {
          const id = keyInfo?.id;
          setKeyInfo(null);
          if (id) nav(`${base}/${id}`);
        }}
      />
    </div>
  );
}

// ---------- Detail ----------
function ageTone(age: number | null) {
  if (age == null) return 'text-b2b-muted';
  if (age <= 8) return 'text-emerald-600';
  if (age <= 20) return 'text-amber-600';
  return 'text-red-600';
}
const TRANSCODER_TONE: Record<StreamHealth['transcoder'], 'neutral' | 'blue' | 'green' | 'amber' | 'red'> = { idle: 'neutral', starting: 'blue', running: 'green', restarting: 'amber', failed: 'red' };

function HealthCard({ streamId, enabled }: { streamId: string; enabled: boolean }) {
  const h = useQuery({
    queryKey: ['live-health', streamId],
    queryFn: () => api<StreamHealth>(`/v1/live/studio/streams/${streamId}/health`),
    refetchInterval: enabled ? 3000 : false,
    enabled,
  });
  const d = h.data;
  const t = useDict('live').studio;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Activity className="size-4" /> {t.health}
        </span>
      }
      action={d && <LiveStatusBadge status={d.status} />}
    >
      {!enabled ? (
        <p className="text-sm text-b2b-muted">{t.healthEnded}</p>
      ) : (
        <QueryState q={h}>
          {d && (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-b2b-muted">{t.source}</dt>
                  <dd className="font-bold">{d.ingest ? d.ingest.toUpperCase() : t.noSignal}</dd>
                </div>
                <div>
                  <dt className="text-xs text-b2b-muted">{t.transcoder}</dt>
                  <dd>
                    <Badge tone={TRANSCODER_TONE[d.transcoder]}>{d.transcoder}</Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-b2b-muted">{t.bitrate}</dt>
                  <dd className="font-bold tabular-nums">{d.bitrate_kbps != null ? `${fmt.num(Math.round(d.bitrate_kbps))} kbps` : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-b2b-muted">{t.segmentAge}</dt>
                  <dd className={cx('font-bold tabular-nums', ageTone(d.segment_age_s))}>{d.segment_age_s != null ? t.seconds(d.segment_age_s.toFixed(1)) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-b2b-muted">{t.duration}</dt>
                  <dd className="font-bold tabular-nums">{fmt.duration(d.uptime_s * 1000)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-b2b-muted">{t.viewers}</dt>
                  <dd className="font-bold tabular-nums">{fmt.num(d.viewers)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-b2b-muted">{t.restarts}</dt>
                  <dd className={cx('font-bold tabular-nums', d.restarts > 2 && 'text-amber-600')}>{d.restarts}</dd>
                </div>
                <div>
                  <dt className="text-xs text-b2b-muted">{t.updated}</dt>
                  <dd className="text-xs text-b2b-muted">{h.dataUpdatedAt ? new Date(h.dataUpdatedAt).toLocaleTimeString(localeTag()) : '—'}</dd>
                </div>
              </dl>
              {d.warnings.length > 0 && (
                <ul className="mt-4 space-y-1.5">
                  {d.warnings.map((w, i) => (
                    <li key={i} className="flex items-start gap-2 rounded-none border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </QueryState>
      )}
    </Card>
  );
}

function LiveDetail({ kind }: { kind: Kind }) {
  const { id = '' } = useParams();
  const { org, base } = useLiveOrg(kind);
  const settings = useLiveSettings();
  const t = useDict('live').studio;
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['live-stream', id], queryFn: () => api<LiveStreamDetail>(`/v1/live/streams/${id}`), refetchInterval: 10_000 });
  const list = useStudioStreams(org.id);
  const [editing, setEditing] = useState(false);
  const [keyInfo, setKeyInfo] = useState<LiveKeyInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [holdKey, setHoldKey] = useState(0);

  // Org di pemilih layout berganti → stream ini bukan milik org aktif; kembali ke daftar.
  const s = q.data;
  useEffect(() => {
    if (s && s.org.id !== org.id) nav(base, { replace: true });
  }, [s, org.id, base, nav]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['live-stream', id] });
    qc.invalidateQueries({ queryKey: ['live-studio'] });
  };
  async function run(name: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(name);
    try {
      await fn();
      toast.success(ok);
      refresh();
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (q.isLoading || !s) return <QueryState q={q}>{null}</QueryState>;
  const hint = list.data?.data.find((x) => x.id === id)?.key_hint;
  const onAir = isOnAir(s.status);
  const ended = s.status === 'ENDED';

  return (
    <div>
      <Link to={base} className="mb-4 inline-flex items-center gap-1.5 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
        <ArrowLeft className="size-4" /> {t.allStreams}
      </Link>
      <PageHeader
        title={s.title}
        subtitle={[s.artist?.name, s.event ? t.eventPrefix(s.event.title) : null, s.access === 'TICKET' ? t.ticketed : t.public, s.scheduled_at && !s.started_at ? t.scheduledAt(fmt.dateTime(s.scheduled_at)) : null].filter(Boolean).join(' · ')}
        actions={
          <>
            <a href={`/app/live/${s.id}`} target="_blank" rel="noreferrer">
              <Button variant="outline-ink" size="sm" icon={<ExternalLink className="size-4" />}>
                {t.viewerPage}
              </Button>
            </a>
            {!ended && (
              <Button variant="outline-ink" size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                {t.edit}
              </Button>
            )}
            {(s.status === 'SCHEDULED' || ended) && (
              <Button
                variant="outline-ink"
                size="sm"
                icon={<Trash2 className="size-4" />}
                loading={busy === 'delete'}
                onClick={async () => {
                  if (!window.confirm(t.deleteConfirm)) return;
                  if (await run('delete', () => api(`/v1/live/studio/streams/${s.id}`, { method: 'DELETE' }), t.deleted)) nav(base);
                }}
              >
                {t.delete}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <LiveStatusBadge status={s.status} />
        {ended && <span className="text-sm text-b2b-muted">{endedReason(s.ended_reason)} · {fmt.dateTime(s.ended_at)}</span>}
        {onAir && (
          <span className="text-sm text-b2b-muted">
            {t.watching(fmt.num(s.viewers), fmt.num(s.peak_viewers))}
          </span>
        )}
        {onAir && (
          <span className="ml-auto">
            <HoldButton
              key={holdKey}
              holdTime={1500}
              backgroundColor="#dc2626"
              fillColor="#7f1d1d"
              textColor="#ffffff"
              fillTextColor="#ffffff"
              size="sm"
              doneLabel={t.endedDone}
              disabled={busy === 'end'}
              onHold={() =>
                void run('end', () => api(`/v1/live/studio/streams/${s.id}/end`, { method: 'POST' }), t.endedToast).then((ok) => {
                  if (!ok) setHoldKey((k) => k + 1);
                })
              }
            >
              {t.holdToEnd}
            </HoldButton>
          </span>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Card title={t.preview}>
            {onAir ? (
              <LivePlayer streamId={s.id} countViewer={false} preview />
            ) : (
              <div className="grid aspect-video place-items-center rounded-none bg-black text-center text-sm text-white/70">
                <div className="flex flex-col items-center gap-2 p-4">
                  <Radio className="size-8" />
                  {ended ? t.previewEnded : t.previewWaiting}
                </div>
              </div>
            )}
          </Card>
          <HealthCard streamId={s.id} enabled={!ended} />
          {settings.browserIngest && <BrowserBroadcast streamId={s.id} ended={ended} />}
          {settings.rtmp && !ended && (
            <Card
              title={
                <span className="flex items-center gap-2">
                  <KeyRound className="size-4" /> {t.obsTitle}
                </span>
              }
              action={
                <Button
                  size="sm"
                  variant="outline-ink"
                  disabled={s.status === 'LIVE'}
                  loading={busy === 'key'}
                  title={s.status === 'LIVE' ? t.notWhileLive : undefined}
                  onClick={async () => {
                    if (hint && !window.confirm(t.regenConfirm)) return;
                    setBusy('key');
                    try {
                      setKeyInfo(await api<LiveKeyInfo>(`/v1/live/studio/streams/${s.id}/key`, { method: 'POST' }));
                      refresh();
                    } catch (e) {
                      toast.error(e);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {t.regen}
                </Button>
              }
            >
              <p className="text-sm text-b2b-muted">
                {t.activeKey}<span className="font-mono font-bold text-b2b-ink">{hint ? `••••••••${hint}` : '—'}</span>{t.activeKeyHint}
              </p>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          {settings.chat && s.chat_enabled ? <LiveChat streamId={s.id} theme="light" disabled={ended} className="h-[560px]" /> : <Card title={t.chatTitle}><p className="text-sm text-b2b-muted">{t.chatOff}</p></Card>}
        </div>
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title={t.editTitle}>
        <StreamForm
          kind={kind}
          org={org}
          initial={{ title: s.title, description: s.description ?? '', scheduled_at: toLocalInput(s.scheduled_at), access: s.access, event_id: s.event?.id ?? '' }}
          submitLabel={t.save}
          onSubmit={async (v) => {
            await api(`/v1/live/studio/streams/${s.id}`, {
              method: 'PATCH',
              body: {
                title: v.title.trim(),
                description: v.description.trim() || null,
                scheduled_at: v.scheduled_at ? new Date(v.scheduled_at).toISOString() : null,
                access: v.access,
                event_id: v.access === 'TICKET' ? v.event_id : null,
              },
            });
            setEditing(false);
            toast.success(t.updatedToast);
            refresh();
          }}
        />
      </Modal>
      <KeyModal info={keyInfo} onClose={() => setKeyInfo(null)} />
    </div>
  );
}

export const StudioLive = () => <LiveList kind="artist" />;
export const StudioLiveDetail = () => <LiveDetail kind="artist" />;
export const PromotorLive = () => <LiveList kind="promotor" />;
export const PromotorLiveDetail = () => <LiveDetail kind="promotor" />;
