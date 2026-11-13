import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Play, Timer, Trash2 } from 'lucide-react';
import { api, ApiError, fmt } from '@/lib/api';
import type { Release, Track } from '@/lib/types';
import { Button, Card, Field, Input, Modal, Select, Textarea, cx, toast } from '@/components/ui';
import { genreName, GENRES } from '@/components/b2b/common';
import { useDict } from '@/lib/i18n';

const todayWib = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/**
 * Pengajuan perubahan rilis yang sudah lolos QC (PUT /v1/studio/releases/:id/changes). Hanya bidang yang berubah
 * dikirim; server menyimpannya sebagai pengajuan yang ditinjau QC — data lama tetap tayang.
 */
export function ChangeRequestEditor({ r, onDone }: { r: Release; onDone: () => void }) {
  const t = useDict('b2b').studio.release;
  const qc = useQueryClient();
  const base = r.pending_changes?.release ?? {};
  const [f, setF] = useState({
    title: (base.title as string) ?? r.title,
    genre: (base.genre as string) ?? r.genre ?? GENRES[0]!,
    label: (base.label as string | null) ?? r.label ?? '',
    explicit: (base.explicit as boolean) ?? r.explicit,
    release_date: (base.release_date as string) ?? r.release_date,
  });
  const [tracks, setTracks] = useState(() =>
    r.tracks.map((tr) => ({
      id: tr.id,
      no: tr.track_number,
      title: (r.pending_changes?.tracks[tr.id]?.title as string) ?? tr.title,
      explicit: (r.pending_changes?.tracks[tr.id]?.explicit as boolean) ?? tr.explicit,
      orig: tr,
    })),
  );
  const [note, setNote] = useState(r.pending_changes?.note ?? '');
  const [busy, setBusy] = useState(false);
  const scheduled = r.status === 'SCHEDULED';

  const relDiff: Record<string, unknown> = {};
  if (f.title.trim() !== r.title) relDiff.title = f.title.trim();
  if (f.genre !== (r.genre ?? '')) relDiff.genre = f.genre;
  if ((f.label.trim() || null) !== (r.label ?? null)) relDiff.label = f.label.trim() || null;
  if (f.explicit !== r.explicit) relDiff.explicit = f.explicit;
  if (scheduled && f.release_date !== r.release_date) relDiff.release_date = f.release_date;
  const trDiff = tracks
    .map((x) => ({ id: x.id, ...(x.title.trim() !== x.orig.title ? { title: x.title.trim() } : {}), ...(x.explicit !== x.orig.explicit ? { explicit: x.explicit } : {}) }))
    .filter((x) => Object.keys(x).length > 1);
  const dirty = Object.keys(relDiff).length > 0 || trDiff.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/v1/studio/releases/${r.id}/changes`, { method: 'PUT', body: { ...relDiff, tracks: trDiff, note: note.trim() || undefined } });
      qc.invalidateQueries({ queryKey: ['studio-releases'] });
      toast.success(t.changesSubmitted);
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-6">
      <Card title={t.changesTitle}>
        <p className="mb-4 border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900">{t.changesHint}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label={t.releaseTitle}>
              <Input required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </Field>
          </div>
          <Field label={t.genre}>
            <Select value={f.genre} onChange={(e) => setF({ ...f, genre: e.target.value })}>
              {[...new Set([f.genre, ...GENRES])].map((g) => (
                <option key={g} value={g}>
                  {genreName(g)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t.labelOptional}>
            <Input maxLength={120} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
          </Field>
          <Field label={t.releaseDate} hint={scheduled ? undefined : t.dateLocked}>
            <Input type="date" disabled={!scheduled} min={scheduled ? todayWib() : undefined} value={f.release_date} onChange={(e) => setF({ ...f, release_date: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm font-bold">
            <input type="checkbox" checked={f.explicit} onChange={(e) => setF({ ...f, explicit: e.target.checked })} /> {t.explicitContent}
          </label>
        </div>
        <div className="mt-5 border-t border-dashed border-b2b-line pt-4">
          <p className="mb-2 text-xs font-bold tracking-wide text-b2b-muted uppercase">{t.tracksSplits}</p>
          <ul className="space-y-2">
            {tracks.map((x, i) => (
              <li key={x.id} className="grid grid-cols-[2rem_1fr_auto] items-center gap-2">
                <span className="text-sm text-b2b-muted tabular-nums">{x.no}</span>
                <Input
                  aria-label={t.changeTrack(x.no)}
                  maxLength={200}
                  value={x.title}
                  onChange={(e) => setTracks(tracks.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))}
                />
                <label className="flex items-center gap-1.5 text-xs font-bold">
                  <input type="checkbox" checked={x.explicit} onChange={(e) => setTracks(tracks.map((y, j) => (j === i ? { ...y, explicit: e.target.checked } : y)))} /> {t.explicit}
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-4">
          <Field label={t.changesNote}>
            <Input maxLength={500} value={note} placeholder={t.changesNotePlaceholder} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="ink" size="sm" type="submit" loading={busy} disabled={!dirty || !f.title.trim() || tracks.some((x) => !x.title.trim())}>
            {t.submitChanges}
          </Button>
          <Button variant="outline-ink" size="sm" type="button" onClick={onDone}>
            {t.cancel}
          </Button>
          {!dirty && <span className="text-xs text-b2b-muted">{t.noChanges}</span>}
        </div>
      </Card>
    </form>
  );
}

/** Ringkasan pengajuan perubahan yang menunggu QC (+ batalkan), atau catatan penolakan terakhir. */
export function PendingChanges({ r }: { r: Release }) {
  const t = useDict('b2b').studio.release;
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const show = (v: unknown) => (typeof v === 'boolean' ? (v ? t.yes : t.no) : v == null || v === '' ? '—' : String(v));
  const p = r.pending_changes;
  if (!p) return r.changes_review_note ? <p className="mb-6 border border-red-200 bg-red-50 p-3 text-sm text-red-700">{t.changesRejected(r.changes_review_note)}</p> : null;
  async function withdraw() {
    setBusy(true);
    try {
      await api(`/v1/studio/releases/${r.id}/changes`, { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['studio-releases'] });
      toast.success(t.changesWithdrawn);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mb-6 border border-amber-400/60 bg-amber-50 p-3 text-sm text-amber-950" role="status">
      <p className="font-bold">{t.changesPending(fmt.dateTime(p.submitted_at))}</p>
      <ul className="mt-1.5 space-y-0.5 text-xs">
        {Object.entries(p.release).map(([k, v]) => (
          <li key={k}>
            {t.changeField[k] ?? k}: <span className="line-through opacity-60">{show((r as unknown as Record<string, unknown>)[k])}</span> → <strong>{show(v)}</strong>
          </li>
        ))}
        {Object.entries(p.tracks).map(([id, ch]) => {
          const tr = r.tracks.find((x) => x.id === id);
          return Object.entries(ch).map(([k, v]) => (
            <li key={id + k}>
              {t.changeTrack(tr?.track_number ?? 0)} · {t.changeField[k] ?? k}: <span className="line-through opacity-60">{show(tr ? (tr as unknown as Record<string, unknown>)[k] : null)}</span> →{' '}
              <strong>{show(v)}</strong>
            </li>
          ));
        })}
      </ul>
      <button type="button" disabled={busy} onClick={withdraw} className="mt-2 text-xs font-bold underline underline-offset-2 disabled:opacity-50">
        {t.changesWithdraw}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Lirik

const TAG = /^(\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+\s*/;
const fmtLrc = (ms: number) => {
  const cs = Math.max(0, Math.round(ms / 10));
  return `${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
/** Baris yang bisa diberi stempel waktu (bukan kosong & bukan tag metadata LRC seperti [ar:…]). */
const stampable = (line: string) => line.trim() !== '' && !/^\s*\[[a-z]+:.*\]\s*$/i.test(line);

type LyricsRes = { lyrics: { synced: boolean; language: string | null; line_count: number; text: string; updated_at?: string } | null };
const LANGS = ['id', 'en', 'jv', 'su', 'ms', 'ko', 'ja'];

/** Editor lirik satu lagu: teks biasa / LRC, impor berkas, dan alat sinkron ketuk-waktu memakai pratinjau audio. */
export function LyricsEditor({ track, open, onClose }: { track: Track; open: boolean; onClose: () => void }) {
  const t = useDict('b2b').studio.release.lyrics;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['studio-lyrics', track.id], queryFn: () => api<LyricsRes>(`/v1/studio/tracks/${track.id}/lyrics`), enabled: open });
  const [mode, setMode] = useState<'plain' | 'synced'>('plain');
  const [text, setText] = useState('');
  const [lang, setLang] = useState('id');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!q.data) return;
    const l = q.data.lyrics;
    setMode(l?.synced ? 'synced' : 'plain');
    setText(l?.text ?? '');
    setLang(l?.language ?? 'id');
    setCursor(0);
    setErr(null);
  }, [q.data]);

  const rows = text.split('\n');
  const targets = rows.map((l, i) => (stampable(l) ? i : -1)).filter((i) => i >= 0);

  async function loadAudio() {
    try {
      const p = await api<{ url: string }>(`/v1/studio/tracks/${track.id}/preview`);
      setSrc(p.url);
    } catch (e) {
      toast.error(e);
    }
  }
  function toSynced() {
    setText(
      rows
        .filter((l) => l.trim())
        .map((l) => (TAG.test(l) ? l : `[00:00.00] ${l.trim()}`))
        .join('\n'),
    );
    setMode('synced');
    setCursor(0);
  }
  function stamp() {
    const a = audio.current;
    if (!a || cursor >= targets.length) return;
    const i = targets[cursor]!;
    const next = [...rows];
    next[i] = `[${fmtLrc(a.currentTime * 1000)}] ${next[i]!.replace(TAG, '').trim()}`;
    setText(next.join('\n'));
    setCursor(cursor + 1);
  }
  async function importFile(f: File) {
    const s = await f.text();
    setText(s.replace(/\r\n?/g, '\n').trim());
    setMode(/\[\d{1,3}:\d{1,2}/.test(s) ? 'synced' : 'plain');
    setCursor(0);
  }
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/v1/studio/tracks/${track.id}/lyrics`, { method: 'PUT', body: { mode, text, language: lang || null } });
      qc.invalidateQueries({ queryKey: ['studio-lyrics', track.id] });
      qc.invalidateQueries({ queryKey: ['studio-releases'] });
      toast.success(t.saved);
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? (e.problem.detail ?? e.message) : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm(t.removeConfirm)) return;
    setBusy(true);
    try {
      await api(`/v1/studio/tracks/${track.id}/lyrics`, { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['studio-lyrics', track.id] });
      qc.invalidateQueries({ queryKey: ['studio-releases'] });
      toast.success(t.removed);
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t.title(track.title)} wide>
      {q.isLoading ? (
        <p className="text-sm text-b2b-muted">…</p>
      ) : q.error ? (
        <p className="text-sm text-red-600">{t.loadError}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" className="inline-flex border border-b2b-line">
              {(['plain', 'synced'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => (m === 'synced' && mode === 'plain' && text.trim() && !TAG.test(text) ? toSynced() : setMode(m))}
                  className={cx('px-3 py-1.5 text-xs font-bold', mode === m ? 'bg-b2b-ink text-b2b-on-ink' : 'text-b2b-muted hover:text-b2b-ink')}
                >
                  {m === 'plain' ? t.modePlain : t.modeSynced}
                </button>
              ))}
            </div>
            <Select aria-label={t.language} value={lang} onChange={(e) => setLang(e.target.value)} className="w-24">
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {l.toUpperCase()}
                </option>
              ))}
            </Select>
            <label className="inline-flex cursor-pointer items-center gap-1.5 border border-b2b-line px-3 py-1.5 text-xs font-bold text-b2b-ink hover:border-b2b-ink">
              <FileUp className="size-3.5" /> {t.import}
              <input
                type="file"
                accept=".lrc,.txt,text/plain"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void importFile(f);
                }}
              />
            </label>
            <span className="ml-auto text-xs text-b2b-muted">{t.lines(rows.filter((l) => l.trim()).length)}</span>
          </div>
          <p className="text-xs text-b2b-muted">{mode === 'plain' ? t.plainHint : t.syncedHint}</p>

          {mode === 'synced' && (
            <div className="flex flex-wrap items-center gap-2 border border-dashed border-b2b-line p-2">
              {src ? (
                <audio ref={audio} controls src={src} className="h-8 min-w-0 flex-1" />
              ) : (
                <Button type="button" size="sm" variant="outline-ink" onClick={loadAudio}>
                  <Play className="size-3.5" /> {t.play}
                </Button>
              )}
              <Button type="button" size="sm" variant="ink" disabled={!src || cursor >= targets.length} onClick={stamp}>
                <Timer className="size-3.5" /> {t.stamp}
              </Button>
              <span className="text-xs text-b2b-muted tabular-nums">{cursor >= targets.length ? t.stampDone : t.stampHint(cursor + 1, targets.length)}</span>
            </div>
          )}

          <Textarea
            rows={14}
            value={text}
            spellCheck={false}
            placeholder={mode === 'plain' ? t.placeholderPlain : t.placeholderSynced}
            onChange={(e) => setText(e.target.value)}
            className={cx('font-mono text-[13px] leading-relaxed', err && 'border-red-500')}
            aria-invalid={!!err}
            aria-describedby={err ? 'lyrics-err' : undefined}
          />
          {mode === 'synced' && cursor < targets.length && src && (
            <p className="truncate text-xs">
              <span className="font-bold text-rave-accent">▶ </span>
              {rows[targets[cursor]!]?.replace(TAG, '')}
            </p>
          )}
          {err && (
            <p id="lyrics-err" className="text-sm font-bold text-red-600">
              {err}
            </p>
          )}
          <p className="text-xs text-b2b-muted">{t.liveNote}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ink" size="sm" loading={busy} disabled={!text.trim()} onClick={save}>
              {t.save}
            </Button>
            <Button type="button" variant="outline-ink" size="sm" onClick={onClose}>
              {t.close}
            </Button>
            {q.data?.lyrics && (
              <button type="button" disabled={busy} onClick={remove} className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-b2b-muted hover:text-red-600">
                <Trash2 className="size-3.5" /> {t.remove}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
