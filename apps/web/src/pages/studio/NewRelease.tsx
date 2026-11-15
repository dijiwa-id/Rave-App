import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Disc3, FileText, Loader2, Plus, Save, Send, Trash2, X } from 'lucide-react';
import { api, ApiError, fmt } from '@/lib/api';
import type { Release } from '@/lib/types';
import { Button, Field, Input, Modal, PageHeader, Select, confirmDialog, cx, toast } from '@/components/ui';
import { genreName, GENRES, useCurrentArtist } from '@/components/b2b/common';
import { localeTag, useDict } from '@/lib/i18n';
import { setting, usePlatformConfig } from '@/lib/platform';
import { AUDIO_ACCEPT, IMAGE_ACCEPT, precheckFile, uploadFile, uploadWithProgress } from '@/lib/upload';
import { analyzeLyrics } from '@/lib/lrc';
import { audioDuration, DropZone, IDLE, isBusy, PickButton, UploadMeter, useAudioUploads, type AudioPatch, type AudioUpload } from '@/components/studio/upload-deck';
import { LyricsWorkbench, lyricsErrors, type LyricsValue } from '@/components/studio/lyrics-workbench';
import '@/components/studio/studio.css';

// Dipakai ulang oleh halaman Studio lain (ReleaseDetail).
export { AUDIO_ACCEPT, audioDuration, uploadFile };

/** `key` = id stabil baris: unggahan yang selesai belakangan ditulis ke baris yang benar walau baris lain dihapus/diurutkan. */
interface TrackDraft {
  key: string;
  title: string;
  audio_url: string;
  duration_ms?: number;
  isrc: string;
  explicit: boolean;
  up: AudioUpload;
  lyrics?: LyricsValue;
}
const newTrack = (title = ''): TrackDraft => ({
  key: crypto.randomUUID(),
  title,
  audio_url: '',
  isrc: '',
  explicit: false,
  up: IDLE,
});
interface ShareDraft {
  party_name: string;
  email: string;
  pct: number;
}
type Meta = {
  title: string;
  type: 'SINGLE' | 'EP' | 'ALBUM';
  release_date: string;
  genre: string;
  label: string;
  upc: string;
  explicit: boolean;
};
type Cover = {
  url: string;
  preview?: string;
  up: AudioUpload;
  w?: number;
  h?: number;
};

const STEPS = ['info', 'tracks', 'artwork', 'lyrics', 'splits', 'review'] as const;
type StepId = (typeof STEPS)[number];
const MAX_TRACKS = { SINGLE: 3, EP: 40, ALBUM: 40 } as const;

const todayWib = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const daysUntil = (d: string) => Math.round((Date.parse(d) - Date.parse(todayWib())) / 86400_000);
const sum = (s: ShareDraft[]) => Math.round(s.reduce((a, x) => a + (Number(x.pct) || 0), 0) * 100) / 100;
const ISRC = /^[A-Z]{2}-?[A-Z0-9]{3}-?\d{2}-?\d{5}$/i;
/** UPC-A/EAN-13 dengan digit periksa (server memvalidasi ulang). */
export function validGtin(raw: string) {
  const s = raw.replace(/[\s-]/g, '');
  if (!/^\d{12,13}$/.test(s)) return false;
  const d = [...s].map(Number);
  const check = d.pop()!;
  const total = d.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (total % 10)) % 10 === check;
}
/** "01 - Judul_Lagu (Master).wav" → "Judul Lagu (Master)". */
const titleFromFile = (name: string) =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/^\s*\d{1,3}\s*[-.)_]?\s+/, '')
    .trim() || name;

// ---------------------------------------------------------------- Draf lokal (autosave)

const DRAFT_KEY = (artistId: string) => `rave-studio-release-draft:${artistId}`;
interface LocalDraft {
  v: 1;
  savedAt: number;
  step: number;
  meta: Meta;
  tracks: TrackDraft[];
  cover: { url: string; w?: number; h?: number; warnings?: string[] };
  master: ShareDraft[];
  publishing: ShareDraft[];
}
export function readReleaseDraft(artistId: string): LocalDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(artistId));
    const d = raw ? (JSON.parse(raw) as LocalDraft) : null;
    return d?.v === 1 && d.meta ? d : null;
  } catch {
    return null;
  }
}
function writeDraft(artistId: string, d: LocalDraft | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY(artistId), JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY(artistId));
  } catch {
    /* penyimpanan diblokir/penuh — autosave dilewati */
  }
}
/** Unggahan yang belum selesai tidak dipulihkan (berkasnya tidak tersimpan di perangkat). */
const restoreTrack = (t: TrackDraft): TrackDraft => {
  const keep = t.audio_url && (t.up?.stage === 'ready' || t.up?.stage === 'processing');
  return {
    ...t,
    up: keep ? t.up : t.audio_url ? { ...(t.up ?? IDLE), stage: 'ready' } : IDLE,
  };
};

// ---------------------------------------------------------------- Split hak

export function SharesEditor({ title, shares, onChange }: { title: string; shares: ShareDraft[]; onChange: (s: ShareDraft[]) => void }) {
  const total = sum(shares);
  const t = useDict('b2b').studio.shares;
  const n = useDict('b2b').studio.newRelease;
  const ok = total === 100;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold">{title}</p>
        <span className={cx('font-label text-xs font-bold tracking-wider uppercase tabular-nums', ok ? 'text-emerald-600' : 'text-red-600')}>{t.total(total)}</span>
      </div>
      <div className="mb-3 h-2 bg-b2b-line" aria-hidden>
        <div className={cx('h-full transition-[width]', ok ? 'bg-rave-purple' : total > 100 ? 'bg-rave-berry' : 'bg-rave-mustard')} style={{ width: `${Math.min(100, total)}%` }} />
      </div>
      <div className="space-y-2">
        {shares.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_84px_36px] gap-2 sm:grid-cols-[1fr_1fr_96px_36px]">
            <Input
              className="col-span-3 sm:col-span-1"
              aria-label={t.partyName}
              placeholder={t.partyName}
              value={s.party_name}
              onChange={(e) => onChange(shares.map((x, j) => (j === i ? { ...x, party_name: e.target.value } : x)))}
            />
            <Input aria-label={t.email} placeholder={t.email} type="email" value={s.email} onChange={(e) => onChange(shares.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
            <Input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={s.pct}
              onChange={(e) => onChange(shares.map((x, j) => (j === i ? { ...x, pct: Number(e.target.value) } : x)))}
              aria-label={t.percent}
            />
            <button
              type="button"
              aria-label={t.remove}
              title={t.remove}
              disabled={shares.length === 1}
              onClick={() => onChange(shares.filter((_, j) => j !== i))}
              className="grid place-items-center text-b2b-muted hover:text-red-600 disabled:opacity-30"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4">
        <button type="button" onClick={() => onChange([...shares, { party_name: '', email: '', pct: 0 }])} className="flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
          <Plus className="size-4" /> {t.addParty}
        </button>
        {shares.length > 1 && (
          <button
            type="button"
            onClick={() => {
              const each = Math.floor((100 / shares.length) * 100) / 100;
              onChange(
                shares.map((x, i) => ({
                  ...x,
                  pct: i === 0 ? Math.round((100 - each * (shares.length - 1)) * 100) / 100 : each,
                })),
              );
            }}
            className="text-sm font-bold text-b2b-muted hover:text-b2b-ink"
          >
            {n.equalSplit}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Halaman

export default function NewRelease() {
  const artist = useCurrentArtist()!;
  const draftId = artist.artist_id ?? artist.id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const d = useDict('b2b').studio.newRelease;
  const cfg = usePlatformConfig();
  const maxMb = setting<number>(cfg, 'storage.max_upload_mb', 50);

  const initial = useMemo(() => readReleaseDraft(draftId), [draftId]);
  const [restoredAt, setRestoredAt] = useState<number | null>(initial?.savedAt ?? null);
  const [step, setStep] = useState(Math.min(initial?.step ?? 0, STEPS.length - 1));
  const [meta, setMeta] = useState<Meta>(
    () =>
      initial?.meta ?? {
        title: '',
        type: 'SINGLE',
        release_date: new Date(Date.now() + 8 * 86400_000).toISOString().slice(0, 10),
        genre: GENRES[0]!,
        label: '',
        upc: '',
        explicit: false,
      },
  );
  const [tracks, setTracks] = useState<TrackDraft[]>(() => (initial?.tracks?.length ? initial.tracks.map(restoreTrack) : [newTrack()]));
  const [cover, setCover] = useState<Cover>(() =>
    initial?.cover?.url
      ? {
          url: initial.cover.url,
          w: initial.cover.w,
          h: initial.cover.h,
          up: { stage: 'ready', warnings: initial.cover.warnings },
        }
      : { url: '', up: IDLE },
  );
  const [master, setMaster] = useState<ShareDraft[]>(initial?.master ?? [{ party_name: artist.name, email: '', pct: 100 }]);
  const [publishing, setPublishing] = useState<ShareDraft[]>(initial?.publishing ?? [{ party_name: artist.name, email: '', pct: 100 }]);
  const [shown, setShown] = useState<Record<number, boolean>>({});
  const [rejected, setRejected] = useState<string[]>([]);
  const [warranty, setWarranty] = useState(false);
  const [phase, setPhase] = useState<null | 'create' | 'splits' | 'lyrics' | 'submit'>(null);
  const [errors, setErrors] = useState<{ path: string; message: string }[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(initial?.savedAt ?? null);
  const [lyricsFor, setLyricsFor] = useState<string | null>(null);
  const coverCtrl = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const created = useRef(false);

  const patchTrack = (key: string, p: AudioPatch) => setTracks((ts) => ts.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const uploads = useAudioUploads(patchTrack);

  // Lanjutkan polling transcoding untuk lagu dari draf yang dipulihkan.
  useEffect(() => {
    for (const t of tracks) if (t.up.stage === 'processing') uploads.resume(t.key, t.up);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave draf ke perangkat (tanpa unggahan yang belum selesai).
  useEffect(() => {
    if (created.current) return;
    const h = setTimeout(() => {
      const empty = !meta.title.trim() && !cover.url && tracks.every((t) => !t.audio_url && !t.title.trim());
      if (empty) return;
      const at = Date.now();
      writeDraft(draftId, {
        v: 1,
        savedAt: at,
        step,
        meta,
        tracks: tracks.map((t) => (isBusy(t.up.stage) || t.up.stage === 'error' ? { ...t, up: t.audio_url ? { ...t.up, stage: 'ready' } : IDLE } : t)),
        cover:
          cover.up.stage === 'ready'
            ? {
                url: cover.url,
                w: cover.w,
                h: cover.h,
                warnings: cover.up.warnings,
              }
            : { url: '' },
        master,
        publishing,
      });
      setSavedAt(at);
    }, 600);
    return () => clearTimeout(h);
  }, [draftId, step, meta, tracks, cover, master, publishing]);

  const uploading = tracks.some((t) => isBusy(t.up.stage)) || isBusy(cover.up.stage);
  useEffect(() => {
    if (!uploading) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    addEventListener('beforeunload', h);
    return () => removeEventListener('beforeunload', h);
  }, [uploading]);

  // ---------------- Validasi per langkah
  const maxTracks = MAX_TRACKS[meta.type];
  const metaErr = {
    title: !meta.title.trim() ? d.err.title : undefined,
    date: !meta.release_date ? d.err.date : meta.release_date < todayWib() ? d.err.datePast : undefined,
    upc: meta.upc.trim() && !validGtin(meta.upc) ? d.err.upc : undefined,
  };
  const trackErr = (t: TrackDraft) =>
    !t.title.trim() ? d.err.trackTitle : isBusy(t.up.stage) ? d.err.uploading : !t.audio_url ? d.err.noAudio : t.isrc.trim() && !ISRC.test(t.isrc.trim()) ? d.err.isrc : undefined;
  const splitsOk = sum(master) === 100 && sum(publishing) === 100 && [...master, ...publishing].every((s) => s.party_name.trim() && s.pct > 0);
  const stepErr: Record<StepId, string | undefined> = {
    info: Object.values(metaErr).find(Boolean),
    tracks: !tracks.length ? d.err.noTracks : tracks.length > maxTracks ? d.err.tooMany(maxTracks) : tracks.map(trackErr).find(Boolean),
    artwork: isBusy(cover.up.stage) ? d.err.uploading : !cover.url ? d.err.cover : undefined,
    lyrics: undefined,
    splits: splitsOk ? undefined : d.err.splits,
    review: warranty ? undefined : d.err.warranty,
  };
  const firstInvalid = STEPS.findIndex((s) => s !== 'review' && stepErr[s]);
  const reachable = (i: number) => firstInvalid < 0 || i <= firstInvalid;
  const cur = STEPS[step]!;
  const busy = phase !== null;

  function go(i: number) {
    if (i < 0 || i >= STEPS.length || busy) return;
    if (i > step && !reachable(i)) {
      setShown((s) => ({ ...s, [step]: true }));
      return;
    }
    setStep(i);
    requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({
        block: 'nearest',
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    });
  }
  function next() {
    if (stepErr[cur]) {
      setShown((s) => ({ ...s, [step]: true }));
      return;
    }
    if (cur === 'review') void finish('submit');
    else go(step + 1);
  }

  // ---------------- Lagu: seret & lepas banyak berkas
  function addFiles(files: File[]) {
    const bad: string[] = [];
    let list = [...tracks];
    const used = new Set<string>();
    for (const f of files) {
      const why = precheckFile(f, 'audio', maxMb);
      if (why) {
        bad.push(why === 'size' ? d.rejected.size(f.name, maxMb) : why === 'empty' ? d.rejected.empty(f.name) : d.rejected.type(f.name));
        continue;
      }
      let slot = list.find((t) => !used.has(t.key) && !t.audio_url && t.up.stage === 'idle');
      if (!slot) {
        if (list.length >= maxTracks) {
          bad.push(d.rejected.limit(f.name, maxTracks));
          continue;
        }
        slot = newTrack();
        list = [...list, slot];
      }
      used.add(slot.key);
      const title = slot.title || titleFromFile(f.name);
      list = list.map((x) => (x.key === slot!.key ? { ...x, title } : x));
      // Mulai setelah state baris baru terpasang.
      const key = slot.key;
      queueMicrotask(() => uploads.start(key, f, maxMb));
    }
    setTracks(list);
    setRejected(bad);
  }
  function pickFor(t: TrackDraft, f: File) {
    const why = uploads.start(t.key, f, maxMb, {
      audio_url: t.audio_url,
      duration_ms: t.duration_ms,
      up: t.up,
    });
    if (why) setRejected([why === 'size' ? d.rejected.size(f.name, maxMb) : why === 'empty' ? d.rejected.empty(f.name) : d.rejected.type(f.name)]);
    else {
      setRejected([]);
      setTracks((ts) => ts.map((x) => (x.key === t.key && !x.title.trim() ? { ...x, title: titleFromFile(f.name) } : x)));
    }
  }
  function removeTrack(key: string) {
    uploads.forget(key);
    setTracks((ts) => ts.filter((x) => x.key !== key));
  }
  function move(i: number, dir: -1 | 1) {
    setTracks((ts) => {
      const j = i + dir;
      if (j < 0 || j >= ts.length) return ts;
      const n = [...ts];
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  }
  const setTrack = (key: string, p: Partial<TrackDraft>) => setTracks((ts) => ts.map((x) => (x.key === key ? { ...x, ...p } : x)));

  // ---------------- Artwork
  async function onCover(file: File) {
    const why = precheckFile(file, 'artwork', maxMb);
    if (why) {
      setCover((c) => ({
        ...c,
        up: {
          stage: 'error',
          fileName: file.name,
          error: why === 'size' ? d.rejected.size(file.name, maxMb) : d.rejected.imageType(file.name),
        },
      }));
      return;
    }
    coverCtrl.current?.abort();
    const ctrl = new AbortController();
    coverCtrl.current = ctrl;
    const prev = cover;
    const preview = URL.createObjectURL(file);
    const dims = await new Promise<{ w: number; h: number }>((res) => {
      const im = new Image();
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => res({ w: 0, h: 0 });
      im.src = preview;
    });
    const base: AudioUpload = {
      stage: 'uploading',
      fileName: file.name,
      size: file.size,
      loaded: 0,
    };
    setCover({ url: '', preview, ...dims, up: base });
    try {
      const r = await uploadWithProgress(file, 'artwork', {
        signal: ctrl.signal,
        onProgress: (p) =>
          setCover((c) => ({
            ...c,
            up: { ...base, loaded: p.loaded, size: p.total },
          })),
        onSent: () =>
          setCover((c) => ({
            ...c,
            up: { ...base, stage: 'verifying', loaded: file.size },
          })),
      });
      setCover({
        url: r.url,
        preview,
        w: r.meta.width ?? dims.w,
        h: r.meta.height ?? dims.h,
        up: {
          ...base,
          stage: 'ready',
          loaded: file.size,
          warnings: r.warnings,
        },
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setCover(prev);
        URL.revokeObjectURL(preview);
      } else
        setCover((c) => ({
          ...c,
          url: '',
          up: {
            ...base,
            stage: 'error',
            error: e instanceof ApiError && e.status === 0 ? d.up.network : e instanceof Error ? e.message : String(e),
          },
        }));
    } finally {
      if (coverCtrl.current === ctrl) coverCtrl.current = null;
    }
  }
  useEffect(() => () => coverCtrl.current?.abort(), []);

  // ---------------- Kirim
  async function finish(mode: 'submit' | 'draft') {
    if (mode === 'submit' && firstInvalid >= 0) return go(firstInvalid);
    setErrors([]);
    let release: Release | null = null;
    try {
      setPhase('create');
      release = await api<Release>('/v1/studio/releases', {
        body: {
          artist_id: artist.artist_id,
          ...meta,
          label: meta.label.trim() || undefined,
          upc: meta.upc.trim() || undefined,
          cover_url: cover.url || undefined,
          tracks: tracks
            .filter((t) => t.title.trim())
            .map((t) => ({
              title: t.title.trim(),
              audio_url: t.audio_url || undefined,
              duration_ms: t.duration_ms,
              isrc: t.isrc.trim() || undefined,
              explicit: t.explicit,
            })),
        },
      });
      created.current = true;
      writeDraft(draftId, null);
      setPhase('splits');
      const strip = (s: ShareDraft[]) =>
        s
          .filter((x) => x.party_name.trim())
          .map((x) => ({
            party_name: x.party_name.trim(),
            email: x.email.trim() || undefined,
            pct: Number(x.pct),
          }));
      if (splitsOk)
        for (const t of release.tracks)
          await api(`/v1/studio/tracks/${t.id}/splits`, {
            method: 'PUT',
            body: { master: strip(master), publishing: strip(publishing) },
          });
      // Lirik (opsional): tidak menggagalkan rilis — gagal → kabari dan lanjut.
      setPhase('lyrics');
      const withText = tracks.filter((t) => t.title.trim());
      for (let i = 0; i < release.tracks.length; i++) {
        const l = withText[i]?.lyrics;
        if (!l?.text.trim()) continue;
        try {
          await api(`/v1/studio/tracks/${release.tracks[i]!.id}/lyrics`, {
            method: 'PUT',
            body: { mode: l.mode, text: l.text, language: l.lang || null },
          });
        } catch {
          toast.info(d.lyricsSaveFailed(release.tracks[i]!.title));
        }
      }
      if (mode === 'submit') {
        setPhase('submit');
        await api(`/v1/studio/releases/${release.id}/submit`, { body: {} });
        toast.success(d.submitted);
      } else toast.success(d.draftCreated);
      qc.invalidateQueries({ queryKey: ['studio-releases'] });
      nav(`/studio/releases/${release.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) setErrors(e.problem.errors);
      toast.error(e);
      if (release) {
        // Rilis sudah dibuat sebagai DRAFT → lanjutkan perbaikan di halaman detail.
        qc.invalidateQueries({ queryKey: ['studio-releases'] });
        toast.info(d.draftSaved);
        nav(`/studio/releases/${release.id}`);
      }
    } finally {
      setPhase(null);
    }
  }

  async function discard() {
    if (
      !(await confirmDialog({
        title: d.discardConfirm,
        body: d.discardBody,
        confirmLabel: d.discard,
        cancelLabel: d.back,
        danger: true,
      }))
    )
      return;
    for (const t of tracks) uploads.forget(t.key);
    writeDraft(draftId, null);
    setRestoredAt(null);
    setSavedAt(null);
    setStep(0);
    setMeta({
      title: '',
      type: 'SINGLE',
      release_date: new Date(Date.now() + 8 * 86400_000).toISOString().slice(0, 10),
      genre: GENRES[0]!,
      label: '',
      upc: '',
      explicit: false,
    });
    setTracks([newTrack()]);
    setCover({ url: '', up: IDLE });
    setMaster([{ party_name: artist.name, email: '', pct: 100 }]);
    setPublishing([{ party_name: artist.name, email: '', pct: 100 }]);
    setShown({});
    setWarranty(false);
  }

  const show = shown[step];
  const lyricTrack = tracks.find((t) => t.key === lyricsFor) ?? null;
  const days = daysUntil(meta.release_date);
  const checks = [
    { ok: !stepErr.info, label: d.check.info, step: 0 },
    { ok: !stepErr.tracks, label: d.check.tracks, step: 1 },
    { ok: !stepErr.artwork, label: d.check.artwork, step: 2 },
    { ok: !stepErr.splits, label: d.check.splits, step: 4 },
  ];
  const timeOf = (ms: number) =>
    new Date(ms).toLocaleTimeString(localeTag(), {
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !lyricsFor) {
          e.preventDefault();
          next();
        }
      }}
    >
      <PageHeader title={d.title} subtitle={d.subtitle} />

      {restoredAt && (
        <div className="mb-4 flex flex-wrap items-center gap-3 border-2 border-b2b-line bg-b2b-card px-3 py-2 text-sm" role="status">
          <FileText className="size-4 shrink-0 text-rave-accent" />
          <span className="min-w-0 flex-1">{d.restored(fmt.dateTime(new Date(restoredAt).toISOString()))}</span>
          <button type="button" onClick={discard} className="text-xs font-bold underline underline-offset-2 hover:text-red-600">
            {d.discard}
          </button>
          <button type="button" aria-label={d.back} onClick={() => setRestoredAt(null)} className="text-b2b-muted hover:text-b2b-ink">
            <X className="size-4" />
          </button>
        </div>
      )}

      <nav aria-label={d.title} className="mb-4">
        <ol className="st-steps">
          {STEPS.map((s, i) => (
            <li key={s} className={cx('flex min-w-0', i === step ? 'flex-[1_1_auto]' : 'flex-[0_0_auto] sm:flex-1')}>
              <button
                type="button"
                className="st-step w-full"
                data-state={i === step ? 'current' : i < step && !stepErr[s] ? 'done' : 'todo'}
                aria-current={i === step ? 'step' : undefined}
                disabled={busy || (!reachable(i) && i > step)}
                onClick={() => go(i)}
              >
                <span className="st-step__no">{i < step && !stepErr[s] ? <Check className="size-4" strokeWidth={3} /> : i + 1}</span>
                <span className="st-step__label">
                  {d.steps[s]}
                  {s === 'lyrics' && <span className="st-step__opt">{d.optional}</span>}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="flex h-1.5 overflow-hidden" aria-hidden>
          <span className="bg-rave-mustard transition-[width] duration-300" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          <span className="flex-1 bg-b2b-line" />
        </div>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="b2b-surface min-w-0 border border-b2b-line p-4 sm:p-5">
          <p className="font-label text-[11px] font-bold tracking-[0.14em] text-rave-accent uppercase">{d.stepOf(step + 1, STEPS.length)}</p>
          <h2 ref={heading} tabIndex={-1} className="mt-1 text-xl" style={{ outline: 'none', boxShadow: 'none' }}>
            {d.steps[cur]}
          </h2>
          <p className="mt-1 mb-5 max-w-2xl text-sm text-b2b-muted">{d.intro[cur]}</p>

          {cur === 'info' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label={d.releaseTitle} error={show ? metaErr.title : undefined}>
                  <Input
                    autoFocus
                    maxLength={200}
                    value={meta.title}
                    aria-invalid={!!(show && metaErr.title)}
                    placeholder={d.titlePlaceholder}
                    onChange={(e) => setMeta({ ...meta, title: e.target.value })}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <span className="mb-1.5 block font-label text-[11px] font-bold tracking-[0.1em] text-b2b-muted uppercase">{d.type}</span>
                <div role="radiogroup" aria-label={d.type} className="grid grid-cols-3 gap-2">
                  {(['SINGLE', 'EP', 'ALBUM'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={meta.type === k}
                      onClick={() => setMeta({ ...meta, type: k })}
                      className={cx(
                        'border-2 px-3 py-2.5 text-left transition-colors',
                        meta.type === k ? 'border-b2b-ink bg-rave-mustard text-rave-ink shadow-[3px_3px_0_#181818]' : 'border-b2b-line bg-b2b-card text-b2b-ink hover:border-b2b-ink',
                      )}
                    >
                      <span className="block font-display text-xl leading-none">{k === 'SINGLE' ? 'Single' : k === 'EP' ? 'EP' : 'Album'}</span>
                      <span className={cx('mt-1 block text-[11px]', meta.type === k ? 'text-rave-ink/75' : 'text-b2b-muted')}>{d.typeHint[k]}</span>
                    </button>
                  ))}
                </div>
              </div>
              <Field label={d.releaseDate} hint="00:00 WIB" error={show ? metaErr.date : undefined}>
                <Input type="date" min={todayWib()} value={meta.release_date} onChange={(e) => setMeta({ ...meta, release_date: e.target.value })} />
              </Field>
              <Field label={d.genre}>
                <Select value={meta.genre} onChange={(e) => setMeta({ ...meta, genre: e.target.value })}>
                  {GENRES.map((g) => (
                    <option key={g} value={g}>
                      {genreName(g)}
                    </option>
                  ))}
                </Select>
              </Field>
              {!metaErr.date && days < 7 && <p className="-mt-2 text-xs font-semibold text-amber-700 sm:col-span-2">⚠ {d.pitchSoon(days)}</p>}
              <Field label={d.label} hint={d.labelHint}>
                <Input maxLength={120} value={meta.label} onChange={(e) => setMeta({ ...meta, label: e.target.value })} />
              </Field>
              {/* UPC/EAN tidak dibuat otomatis: isi hanya bila sudah punya dari label/agregator (divalidasi digit periksanya di server). */}
              <Field label={d.upc} hint={d.upcHint} error={meta.upc.trim() ? metaErr.upc : undefined}>
                <Input value={meta.upc} inputMode="numeric" maxLength={20} onChange={(e) => setMeta({ ...meta, upc: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-sm font-bold sm:col-span-2">
                <input type="checkbox" checked={meta.explicit} onChange={(e) => setMeta({ ...meta, explicit: e.target.checked })} /> {d.explicitContent}
              </label>
            </div>
          )}

          {cur === 'tracks' && (
            <div className="space-y-3">
              <DropZone
                accept={AUDIO_ACCEPT}
                multiple
                disabled={tracks.length >= maxTracks && tracks.every((t) => t.audio_url || t.up.stage !== 'idle')}
                onFiles={addFiles}
                label={d.dropLabel}
                title={d.dropTitle}
                hint={d.dropHint(maxMb, maxTracks)}
              />
              {rejected.length > 0 && (
                <ul className="space-y-0.5 border-l-4 border-rave-berry bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert">
                  {rejected.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              {tracks.map((t, i) => {
                const err = show ? trackErr(t) : undefined;
                return (
                  <div key={t.key} className="st-track p-3" data-stage={t.up.stage}>
                    <div className="grid grid-cols-[34px_1fr_auto] items-start gap-2 sm:grid-cols-[34px_1fr_170px_auto]">
                      <span className="st-track__no" aria-hidden>
                        {i + 1}
                      </span>
                      <Input
                        aria-label={`${d.trackTitle} ${i + 1}`}
                        placeholder={d.trackTitle}
                        maxLength={200}
                        value={t.title}
                        aria-invalid={!!(show && !t.title.trim())}
                        onChange={(e) => setTrack(t.key, { title: e.target.value })}
                      />
                      <Input
                        className="col-span-2 col-start-2 row-start-2 sm:col-span-1 sm:col-start-auto sm:row-start-auto"
                        aria-label={d.isrcOptional}
                        placeholder={d.isrcOptional}
                        title={d.isrcTitle}
                        value={t.isrc}
                        aria-invalid={!!(t.isrc.trim() && !ISRC.test(t.isrc.trim()))}
                        onChange={(e) =>
                          setTrack(t.key, {
                            isrc: e.target.value.toUpperCase(),
                          })
                        }
                      />
                      <div className="col-start-3 row-start-1 flex items-center sm:col-start-4">
                        <button
                          type="button"
                          aria-label={d.moveUp}
                          title={d.moveUp}
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                          className="grid size-8 place-items-center text-b2b-muted hover:text-b2b-ink disabled:opacity-25"
                        >
                          <ArrowUp className="size-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={d.moveDown}
                          title={d.moveDown}
                          disabled={i === tracks.length - 1}
                          onClick={() => move(i, 1)}
                          className="grid size-8 place-items-center text-b2b-muted hover:text-b2b-ink disabled:opacity-25"
                        >
                          <ArrowDown className="size-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={d.removeTrack}
                          title={d.removeTrack}
                          disabled={tracks.length === 1}
                          onClick={() => removeTrack(t.key)}
                          className="grid size-8 place-items-center text-b2b-muted hover:text-red-600 disabled:opacity-25"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 sm:pl-[42px]">
                      <UploadMeter
                        up={t.up}
                        onCancel={() => uploads.cancel(t.key)}
                        onRetry={uploads.file(t.key) ? () => uploads.retry(t.key) : undefined}
                        pick={<PickButton accept={AUDIO_ACCEPT} label={t.audio_url ? d.up.replace : d.up.pick} onFile={(f) => pickFor(t, f)} />}
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                        <label className="flex items-center gap-1.5 font-bold">
                          <input type="checkbox" checked={t.explicit} onChange={(e) => setTrack(t.key, { explicit: e.target.checked })} /> {d.explicit}
                        </label>
                        {!!t.duration_ms && <span className="font-label text-b2b-muted tabular-nums">{fmt.duration(t.duration_ms)}</span>}
                        {t.isrc.trim() && !ISRC.test(t.isrc.trim()) && <span className="font-bold text-red-600">{d.err.isrc}</span>}
                        {err && err !== d.err.isrc && <span className="font-bold text-red-600">{err}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
              {tracks.length < maxTracks ? (
                <Button type="button" variant="outline-ink" size="sm" icon={<Plus />} onClick={() => setTracks([...tracks, newTrack()])}>
                  {d.addTrack}
                </Button>
              ) : (
                <p className="text-xs text-b2b-muted">{d.err.tooMany(maxTracks)}</p>
              )}
            </div>
          )}

          {cur === 'artwork' && (
            <div className="grid gap-5 sm:grid-cols-[240px_minmax(0,1fr)]">
              <div className="relative">
                {cover.preview || cover.url ? (
                  <div className="relative aspect-square overflow-hidden border-2 border-b2b-ink bg-rave-plum shadow-[4px_4px_0_#181818]">
                    <img src={cover.preview ?? cover.url} alt={d.artworkAlt} className={cx('size-full object-cover', isBusy(cover.up.stage) && 'opacity-60')} />
                    {isBusy(cover.up.stage) && <Loader2 className="absolute top-1/2 left-1/2 size-8 -translate-1/2 animate-spin text-white motion-reduce:animate-none" />}
                  </div>
                ) : (
                  <DropZone square accept={IMAGE_ACCEPT} onFiles={(f) => void onCover(f[0]!)} label={d.uploadImage} title={d.artworkDrop} hint={d.artworkHint}>
                    <Disc3 className="size-10 text-rave-accent" aria-hidden />
                  </DropZone>
                )}
              </div>
              <div className="min-w-0 space-y-3">
                <UploadMeter
                  kind="artwork"
                  up={cover.up}
                  idleText={d.noArtwork}
                  onCancel={() => coverCtrl.current?.abort()}
                  pick={<PickButton accept={IMAGE_ACCEPT} label={cover.url ? d.replaceArtwork : d.uploadImage} onFile={(f) => void onCover(f)} />}
                />
                <ul className="space-y-1.5">
                  {[
                    {
                      ok: !!cover.w && cover.w === cover.h,
                      label: d.artworkChecks.square,
                    },
                    {
                      ok: !!cover.w && Math.min(cover.w, cover.h ?? 0) >= 3000,
                      label: d.artworkChecks.res + (cover.w ? ` · ${cover.w}×${cover.h}` : ''),
                    },
                    { ok: !!cover.url, label: d.artworkChecks.format },
                  ].map((c) => (
                    <li key={c.label} className="st-check" data-ok={c.ok}>
                      <i>{c.ok && <Check className="size-3" strokeWidth={3} />}</i>
                      {c.label}
                    </li>
                  ))}
                </ul>
                {show && stepErr.artwork && <p className="text-xs font-bold text-red-600">{stepErr.artwork}</p>}
              </div>
            </div>
          )}

          {cur === 'lyrics' && (
            <div className="space-y-2">
              {tracks.map((t, i) => {
                const l = t.lyrics;
                const n = l ? analyzeLyrics(l.mode, l.text).rows.filter((r) => !r.meta && r.text).length : 0;
                return (
                  <div key={t.key} className="st-track flex flex-wrap items-center gap-3 p-3">
                    <span className="st-track__no" aria-hidden>
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{t.title || d.untitledTrack}</p>
                      <p className={cx('font-label text-[11px] font-bold tracking-wider uppercase', l ? 'text-rave-accent' : 'text-b2b-muted')}>
                        {!l ? d.lyricsNone : l.mode === 'synced' ? d.lyricsSynced(n) : d.lyricsPlain(n)}
                      </p>
                    </div>
                    {l && (
                      <Button type="button" size="sm" variant="outline-ink" onClick={() => setTrack(t.key, { lyrics: undefined })}>
                        {d.clearLyrics}
                      </Button>
                    )}
                    <Button type="button" size="sm" variant="ink" icon={<FileText />} onClick={() => setLyricsFor(t.key)}>
                      {l ? d.editLyrics : d.writeLyrics}
                    </Button>
                  </div>
                );
              })}
              <p className="pt-1 text-xs text-b2b-muted">{d.lyricsSkip}</p>
            </div>
          )}

          {cur === 'splits' && (
            <div className="space-y-6">
              <p className="border-l-4 border-rave-mustard bg-amber-50 px-3 py-2 text-xs text-amber-900">{d.splitNote}</p>
              <SharesEditor title={d.masterTitle} shares={master} onChange={setMaster} />
              <SharesEditor title={d.publishingTitle} shares={publishing} onChange={setPublishing} />
              {show && stepErr.splits && <p className="text-xs font-bold text-red-600">{stepErr.splits}</p>}
            </div>
          )}

          {cur === 'review' && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-4">
                {cover.url ? <img src={cover.url} alt="" className="size-28 border-2 border-b2b-ink object-cover shadow-[3px_3px_0_#181818]" /> : <div className="size-28 bg-rave-plum" />}
                <div className="min-w-0 flex-1">
                  <p className="font-display text-3xl leading-none break-words">{meta.title || d.untitled}</p>
                  <p className="mt-1 text-sm text-b2b-muted">
                    {artist.name} · {meta.type} · {genreName(meta.genre)} · {d.releaseOn(fmt.date(meta.release_date))}
                    {meta.explicit && ' · [E]'}
                  </p>
                  {(meta.label || meta.upc) && <p className="text-xs text-b2b-muted">{[meta.label, meta.upc && `UPC ${meta.upc}`].filter(Boolean).join(' · ')}</p>}
                  <button type="button" onClick={() => go(0)} className="mt-1 text-xs font-bold underline underline-offset-2">
                    {d.review.edit}
                  </button>
                </div>
              </div>
              <ReviewBlock title={d.review.tracks} onEdit={() => go(1)} editLabel={d.review.edit}>
                <ol className="divide-y divide-dashed divide-b2b-line">
                  {tracks.map((t, i) => (
                    <li key={t.key} className="flex items-center gap-3 py-2 text-sm">
                      <span className="w-5 text-right font-label text-xs text-b2b-muted">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-bold">
                        {t.title} {t.explicit && <span className="text-xs">[E]</span>}
                      </span>
                      {t.up.stage === 'processing' && <span className="text-[11px] font-bold text-amber-700">{d.review.processing}</span>}
                      <span className="hidden text-[11px] text-b2b-muted sm:inline">{t.lyrics ? (t.lyrics.mode === 'synced' ? 'LRC' : d.review.lyrics) : d.review.noLyrics}</span>
                      <span className="font-label text-xs text-b2b-muted tabular-nums">{t.duration_ms ? fmt.duration(t.duration_ms) : '—'}</span>
                    </li>
                  ))}
                </ol>
              </ReviewBlock>
              <ReviewBlock title={d.review.splits} onEdit={() => go(4)} editLabel={d.review.edit}>
                <p className="text-xs text-b2b-muted">
                  Master: {master.map((s) => `${s.party_name} ${s.pct}%`).join(', ')}
                  <br />
                  Publishing: {publishing.map((s) => `${s.party_name} ${s.pct}%`).join(', ')}
                </p>
              </ReviewBlock>
              <label className={cx('flex items-start gap-2.5 border-2 p-3 text-sm', show && !warranty ? 'border-red-500' : 'border-b2b-line')}>
                <input type="checkbox" className="mt-0.5" checked={warranty} onChange={(e) => setWarranty(e.target.checked)} />
                <span>{d.warrantyLabel}</span>
              </label>
              {phase && (
                <ol className="space-y-1 text-sm" aria-live="polite">
                  {(['create', 'splits', 'lyrics', 'submit'] as const).map((p, i, all) => {
                    const at = all.indexOf(phase);
                    return (
                      <li key={p} className={cx('flex items-center gap-2', i > at ? 'text-b2b-muted' : 'font-bold')}>
                        {i < at ? <Check className="size-4 text-emerald-600" /> : i === at ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <span className="size-4" />}
                        {d.phase[p]}
                      </li>
                    );
                  })}
                </ol>
              )}
              {errors.length > 0 && (
                <ul className="space-y-1 border-l-4 border-red-500 bg-red-50 p-3 text-sm text-red-700" role="alert">
                  {errors.map((e, i) => (
                    <li key={i}>
                      {e.path && <strong>{e.path}: </strong>}
                      {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Bilah aksi */}
          <div className="st-footer">
            <Button type="button" variant="outline-ink" size="md" icon={<ArrowLeft />} disabled={step === 0 || busy} onClick={() => go(step - 1)}>
              <span className="hidden sm:inline">{d.back}</span>
            </Button>
            <div className="min-w-0 flex-1 text-xs">
              {show && stepErr[cur] ? (
                <span className="font-bold text-red-600" role="alert">
                  {stepErr[cur]}
                </span>
              ) : (
                <span className="hidden text-b2b-muted sm:inline">{savedAt ? d.autosaved(timeOf(savedAt)) : d.shortcutNext}</span>
              )}
            </div>
            {cur === 'review' ? (
              <>
                <Button
                  type="button"
                  variant="outline-ink"
                  size="md"
                  icon={<Save />}
                  disabled={busy || !meta.title.trim()}
                  onClick={() => void finish('draft')}
                  aria-label={d.saveDraft}
                  title={d.saveDraft}
                >
                  <span className="hidden sm:inline">{d.saveDraft}</span>
                </Button>
                <Button type="button" variant="primary" size="md" icon={<Send />} loading={busy} onClick={next}>
                  {d.submit}
                </Button>
              </>
            ) : (
              <Button type="button" variant="ink" size="md" onClick={next}>
                {cur === 'lyrics' && !tracks.some((t) => t.lyrics) ? d.skip : d.next} <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </section>

        {/* Sampul ringkas (desktop) */}
        <aside className="hidden lg:block">
          <div className="st-sleeve sticky top-4">
            <div className="st-sleeve__art">
              {cover.preview || cover.url ? <img src={cover.preview ?? cover.url} alt="" /> : <div className="grid size-full place-items-center text-xs text-white/50">{d.sleeveEmpty}</div>}
              <span className="st-sticker bottom-3 left-3">{meta.type}</span>
            </div>
            <div className="space-y-3 p-4">
              <div>
                <p className="font-display text-2xl leading-none break-words">{meta.title || d.untitled}</p>
                <p className="mt-1 text-xs text-b2b-muted">
                  {artist.name} · {fmt.date(meta.release_date)}
                </p>
                <p className="mt-0.5 font-label text-[11px] font-bold tracking-wider text-b2b-muted uppercase">{d.trackCount(tracks.length)}</p>
              </div>
              <ul className="space-y-1.5 border-t-2 border-dashed border-b2b-line pt-3">
                {checks.map((c) => (
                  <li key={c.label}>
                    <button
                      type="button"
                      className="st-check w-full text-left disabled:cursor-default"
                      data-ok={c.ok}
                      disabled={busy || (!reachable(c.step) && c.step > step)}
                      onClick={() => go(c.step)}
                    >
                      <i>{c.ok && <Check className="size-3" strokeWidth={3} />}</i>
                      {c.label}
                    </button>
                  </li>
                ))}
              </ul>
              {savedAt && <p className="font-label text-[10px] tracking-wider text-b2b-muted uppercase">{d.autosaved(timeOf(savedAt))}</p>}
            </div>
          </div>
        </aside>
      </div>

      {lyricTrack && <LyricsModal track={lyricTrack} file={uploads.file(lyricTrack.key)} onClose={() => setLyricsFor(null)} onSave={(v) => setTrack(lyricTrack.key, { lyrics: v })} />}
    </div>
  );
}

function ReviewBlock({ title, onEdit, editLabel, children }: { title: string; onEdit: () => void; editLabel: string; children: ReactNode }) {
  return (
    <div className="border-t-2 border-dashed border-b2b-line pt-3">
      <div className="mb-1 flex items-center justify-between">
        <p className="font-label text-[11px] font-bold tracking-[0.12em] text-b2b-muted uppercase">{title}</p>
        <button type="button" onClick={onEdit} className="text-xs font-bold underline underline-offset-2">
          {editLabel}
        </button>
      </div>
      {children}
    </div>
  );
}

/** Lirik untuk lagu yang belum dibuat di server: disimpan di draf, dikirim setelah rilis dibuat. */
function LyricsModal({ track, file, onClose, onSave }: { track: TrackDraft; file?: File; onClose: () => void; onSave: (v: LyricsValue | undefined) => void }) {
  const t = useDict('b2b').studio.release.lyrics;
  const d = useDict('b2b').studio.newRelease;
  const [value, setValue] = useState<LyricsValue>(track.lyrics ?? { mode: 'plain', text: '', lang: 'id' });
  // Object URL dibuat di effect (StrictMode menjalankan cleanup sekali saat dev — URL dari useMemo akan mati).
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setSrc(u);
    return () => {
      URL.revokeObjectURL(u);
      setSrc(null);
    };
  }, [file]);
  const blocking = lyricsErrors(value, track.duration_ms);
  return (
    <Modal open onClose={onClose} title={t.title(track.title || d.untitledTrack)} wide="xl">
      <div className="space-y-3">
        <LyricsWorkbench value={value} onChange={setValue} audioSrc={src} durationMs={track.duration_ms} />
        {!src && <p className="text-xs text-b2b-muted">{d.lyricsNoAudio}</p>}
        <div className="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-b2b-line pt-3">
          <Button
            type="button"
            variant="ink"
            size="sm"
            disabled={!!value.text.trim() && blocking > 0}
            onClick={() => {
              onSave(value.text.trim() ? value : undefined);
              onClose();
            }}
          >
            {d.lyricsApply}
          </Button>
          <Button type="button" variant="outline-ink" size="sm" onClick={onClose}>
            {t.close}
          </Button>
          {value.text.trim() && blocking > 0 && <span className="text-xs font-bold text-red-600">{t.issueSummary(blocking)}</span>}
        </div>
      </div>
    </Modal>
  );
}
