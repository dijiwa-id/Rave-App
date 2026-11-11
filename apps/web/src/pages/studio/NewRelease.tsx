import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Upload } from 'lucide-react';
import Stepper, { Step } from '@/components/reactbits/Stepper';
import { api, ApiError, fmt } from '@/lib/api';
import type { Release } from '@/lib/types';
import { Field, Input, PageHeader, Select, toast } from '@/components/ui';
import { GENRES, useCurrentArtist } from '@/components/b2b/common';
import { useDict } from '@/lib/i18n';
import { AUDIO_ACCEPT, uploadFile } from '@/lib/upload';

/** `key` = id stabil baris: unggahan yang selesai belakangan ditulis ke baris yang benar walau baris lain dihapus. */
interface TrackDraft {
  key: string;
  title: string;
  audio_url: string;
  duration_ms?: number;
  isrc: string;
  explicit: boolean;
  uploading?: boolean;
}
const newTrack = (): TrackDraft => ({ key: crypto.randomUUID(), title: '', audio_url: '', isrc: '', explicit: false });
interface ShareDraft {
  party_name: string;
  email: string;
  pct: number;
}

// Dipakai ulang oleh halaman Studio lain (ReleaseDetail).
export { AUDIO_ACCEPT, uploadFile };

export function audioDuration(file: File): Promise<number | undefined> {
  return new Promise((res) => {
    const a = new Audio();
    a.preload = 'metadata';
    const src = URL.createObjectURL(file);
    // Lepas object URL setelah metadata terbaca / gagal (cegah bocor memori).
    a.onloadedmetadata = () => {
      URL.revokeObjectURL(src);
      res(Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : undefined);
    };
    a.onerror = () => {
      URL.revokeObjectURL(src);
      res(undefined);
    };
    a.src = src;
  });
}

const sum = (s: ShareDraft[]) => Math.round(s.reduce((a, x) => a + (Number(x.pct) || 0), 0) * 100) / 100;

export function SharesEditor({ title, shares, onChange }: { title: string; shares: ShareDraft[]; onChange: (s: ShareDraft[]) => void }) {
  const total = sum(shares);
  const t = useDict('b2b').studio.shares;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="font-bold">{title}</p>
        <span className={`text-sm font-extrabold ${total === 100 ? 'text-emerald-600' : 'text-red-600'}`}>{t.total(total)}</span>
      </div>
      <div className="space-y-2">
        {shares.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_90px_32px] gap-2">
            <Input placeholder={t.partyName} value={s.party_name} onChange={(e) => onChange(shares.map((x, j) => (j === i ? { ...x, party_name: e.target.value } : x)))} />
            <Input placeholder={t.email} type="email" value={s.email} onChange={(e) => onChange(shares.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
            <Input type="number" min={0} max={100} step={0.01} value={s.pct} onChange={(e) => onChange(shares.map((x, j) => (j === i ? { ...x, pct: Number(e.target.value) } : x)))} aria-label={t.percent} />
            <button type="button" aria-label={t.remove} onClick={() => onChange(shares.filter((_, j) => j !== i))} className="text-b2b-muted hover:text-red-600">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...shares, { party_name: '', email: '', pct: 0 }])} className="mt-2 flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
        <Plus className="size-4" /> {t.addParty}
      </button>
    </div>
  );
}

export default function NewRelease() {
  const artist = useCurrentArtist()!;
  const nav = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [meta, setMeta] = useState({ title: '', type: 'SINGLE' as 'SINGLE' | 'EP' | 'ALBUM', release_date: new Date(Date.now() + 8 * 86400_000).toISOString().slice(0, 10), genre: GENRES[0], label: '', explicit: false });
  const [tracks, setTracks] = useState<TrackDraft[]>(() => [newTrack()]);
  const [cover, setCover] = useState({ url: '', uploading: false, warn: '' });
  const [master, setMaster] = useState<ShareDraft[]>([{ party_name: artist.name, email: '', pct: 100 }]);
  const [publishing, setPublishing] = useState<ShareDraft[]>([{ party_name: artist.name, email: '', pct: 100 }]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ path: string; message: string }[]>([]);
  const [stepperKey, setStepperKey] = useState(0);
  const d = useDict('b2b').studio.newRelease;

  const valid: Record<number, boolean> = {
    1: meta.title.trim().length > 0 && !!meta.release_date,
    2: tracks.length > 0 && tracks.every((t) => t.title.trim() && t.audio_url && !t.uploading),
    3: !!cover.url && !cover.uploading,
    4: sum(master) === 100 && sum(publishing) === 100 && [...master, ...publishing].every((s) => s.party_name.trim() && s.pct > 0),
    5: true,
  };

  async function onAudio(key: string, file: File) {
    setTracks((t) => t.map((x) => (x.key === key ? { ...x, uploading: true, title: x.title || file.name.replace(/\.[^.]+$/, '') } : x)));
    try {
      const [url, dur] = await Promise.all([uploadFile(file, 'audio'), audioDuration(file)]);
      setTracks((t) => t.map((x) => (x.key === key ? { ...x, audio_url: url, duration_ms: dur, uploading: false } : x)));
    } catch (e) {
      toast.error(e);
      setTracks((t) => t.map((x) => (x.key === key ? { ...x, uploading: false } : x)));
    }
  }
  async function onCover(file: File) {
    setCover({ url: '', uploading: true, warn: '' });
    const dims = await new Promise<number>((res) => {
      const im = new Image();
      const src = URL.createObjectURL(file);
      im.onload = () => {
        URL.revokeObjectURL(src);
        res(Math.min(im.naturalWidth, im.naturalHeight));
      };
      im.onerror = () => {
        URL.revokeObjectURL(src);
        res(0);
      };
      im.src = src;
    });
    try {
      const url = await uploadFile(file, 'artwork');
      setCover({ url, uploading: false, warn: dims && dims < 3000 ? d.lowRes(dims) : '' });
    } catch (e) {
      toast.error(e);
      setCover({ url: '', uploading: false, warn: '' });
    }
  }

  async function submit() {
    setSubmitting(true);
    setErrors([]);
    let release: Release | null = null;
    try {
      release = await api<Release>('/v1/studio/releases', {
        body: {
          artist_id: artist.artist_id,
          ...meta,
          label: meta.label || undefined,
          cover_url: cover.url,
          tracks: tracks.map((t) => ({ title: t.title, audio_url: t.audio_url, duration_ms: t.duration_ms, isrc: t.isrc || undefined, explicit: t.explicit })),
        },
      });
      const strip = (s: ShareDraft[]) => s.map((x) => ({ party_name: x.party_name, email: x.email || undefined, pct: Number(x.pct) }));
      for (const t of release.tracks) await api(`/v1/studio/tracks/${t.id}/splits`, { method: 'PUT', body: { master: strip(master), publishing: strip(publishing) } });
      await api(`/v1/studio/releases/${release.id}/submit`, { body: {} });
      toast.success(d.submitted);
      qc.invalidateQueries({ queryKey: ['studio-releases'] });
      nav(`/studio/releases/${release.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.problem.errors) setErrors(e.problem.errors);
      toast.error(e);
      if (!release) {
        // Stepper sudah di state 'selesai' — kembalikan ke langkah tinjau.
        setStepperKey((k) => k + 1);
        setStep(5);
      } else {
        qc.invalidateQueries({ queryKey: ['studio-releases'] });
        toast.info(d.draftSaved);
        nav(`/studio/releases/${release.id}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader title={d.title} subtitle={d.subtitle} />
      <Stepper
        key={stepperKey}
        className="flex w-full flex-col"
        stepCircleContainerClassName="max-w-3xl! bg-b2b-card border-b2b-line! shadow-none!"
        initialStep={stepperKey ? 5 : 1}
        onStepChange={setStep}
        onFinalStepCompleted={submit}
        backButtonText={d.back}
        nextButtonText={d.next}
        disableStepIndicators
        nextButtonProps={{ disabled: !valid[step] || submitting, className: 'rounded-none bg-b2b-ink px-5 py-2 text-sm font-bold text-b2b-on-ink disabled:opacity-40' }}
      >
        <Step>
          <h2 className="mb-4 text-lg font-extrabold">{d.step1}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label={d.releaseTitle}>
                <Input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
              </Field>
            </div>
            <Field label={d.type}>
              <Select value={meta.type} onChange={(e) => setMeta({ ...meta, type: e.target.value as any })}>
                <option value="SINGLE">Single</option>
                <option value="EP">EP</option>
                <option value="ALBUM">Album</option>
              </Select>
            </Field>
            <Field label={d.releaseDate} hint="00:00 WIB">
              <Input type="date" value={meta.release_date} onChange={(e) => setMeta({ ...meta, release_date: e.target.value })} />
            </Field>
            <Field label={d.genre}>
              <Select value={meta.genre} onChange={(e) => setMeta({ ...meta, genre: e.target.value })}>
                {GENRES.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </Select>
            </Field>
            <Field label={d.label} hint={d.labelHint}>
              <Input value={meta.label} onChange={(e) => setMeta({ ...meta, label: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={meta.explicit} onChange={(e) => setMeta({ ...meta, explicit: e.target.checked })} /> {d.explicitContent}
            </label>
          </div>
          <p className="mt-3 text-xs text-b2b-muted">{d.pitchNote}</p>
        </Step>
        <Step>
          <h2 className="mb-4 text-lg font-extrabold">{d.step2}</h2>
          <div className="space-y-3">
            {tracks.map((t, i) => (
              <div key={t.key} className="rounded-none border border-b2b-line p-3">
                <div className="grid gap-2 sm:grid-cols-[32px_1fr_160px_32px] sm:items-center">
                  <span className="text-sm font-bold text-b2b-muted">{i + 1}</span>
                  <Input placeholder={d.trackTitle} value={t.title} onChange={(e) => setTracks(tracks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                  <Input placeholder={d.isrcOptional} value={t.isrc} onChange={(e) => setTracks(tracks.map((x, j) => (j === i ? { ...x, isrc: e.target.value } : x)))} />
                  <button type="button" aria-label={d.removeTrack} disabled={tracks.length === 1} onClick={() => setTracks(tracks.filter((_, j) => j !== i))} className="text-b2b-muted hover:text-red-600 disabled:opacity-30">
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 sm:pl-10">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-none border border-b2b-line px-3 py-1.5 text-xs font-bold hover:border-b2b-ink">
                    <Upload className="size-3.5" /> {t.uploading ? d.uploading : d.uploadMaster}
                    <input type="file" accept={AUDIO_ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && void onAudio(t.key, e.target.files[0])} />
                  </label>
                  <span className="text-xs text-b2b-muted">{d.orUrl}</span>
                  <Input className="max-w-sm py-1.5! text-xs" placeholder="https://…/master.flac" value={t.audio_url} onChange={(e) => setTracks(tracks.map((x, j) => (j === i ? { ...x, audio_url: e.target.value } : x)))} />
                  {t.duration_ms && <span className="text-xs text-b2b-muted">{fmt.duration(t.duration_ms)}</span>}
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={t.explicit} onChange={(e) => setTracks(tracks.map((x, j) => (j === i ? { ...x, explicit: e.target.checked } : x)))} /> {d.explicit}
                  </label>
                </div>
              </div>
            ))}
          </div>
          {meta.type !== 'SINGLE' || tracks.length < 1 ? (
            <button type="button" onClick={() => setTracks([...tracks, newTrack()])} className="mt-3 flex items-center gap-1 text-sm font-bold text-b2b-muted hover:text-b2b-ink">
              <Plus className="size-4" /> {d.addTrack}
            </button>
          ) : null}
        </Step>
        <Step>
          <h2 className="mb-4 text-lg font-extrabold">{d.step3}</h2>
          <div className="flex flex-wrap items-start gap-6">
            {cover.url ? <img src={cover.url} alt={d.artworkAlt} className="size-48 rounded-none object-cover shadow" /> : <div className="grid size-48 place-items-center rounded-none bg-b2b-bg text-sm text-b2b-muted">{cover.uploading ? d.uploading : d.noArtwork}</div>}
            <div className="space-y-3">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-none bg-b2b-ink px-4 py-2 text-sm font-bold text-b2b-on-ink">
                <Upload className="size-4" /> {d.uploadImage}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void onCover(e.target.files[0])} />
              </label>
              <Field label={d.orArtworkUrl}>
                <Input value={cover.url} onChange={(e) => setCover({ ...cover, url: e.target.value })} placeholder="https://…" />
              </Field>
              {cover.warn && <p className="text-xs font-semibold text-amber-700">{cover.warn}</p>}
            </div>
          </div>
        </Step>
        <Step>
          <h2 className="mb-1 text-lg font-extrabold">{d.step4}</h2>
          <p className="mb-4 text-sm text-b2b-muted">{d.splitNote}</p>
          <div className="space-y-6">
            <SharesEditor title={d.masterTitle} shares={master} onChange={setMaster} />
            <SharesEditor title={d.publishingTitle} shares={publishing} onChange={setPublishing} />
          </div>
        </Step>
        <Step>
          <h2 className="mb-4 text-lg font-extrabold">{d.step5}</h2>
          <div className="flex gap-4">
            {cover.url && <img src={cover.url} alt="" className="size-24 rounded-none object-cover" />}
            <div className="text-sm">
              <p className="text-lg font-extrabold">{meta.title}</p>
              <p className="text-b2b-muted">
                {meta.type} · {meta.genre} · {d.releaseOn(fmt.date(meta.release_date))}
              </p>
              <ol className="mt-2 list-decimal pl-5">
                {tracks.map((t, i) => (
                  <li key={i}>
                    {t.title} {t.explicit && <span className="text-xs font-bold">[E]</span>}
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-xs text-b2b-muted">
                Master: {master.map((s) => `${s.party_name} ${s.pct}%`).join(', ')} · Publishing: {publishing.map((s) => `${s.party_name} ${s.pct}%`).join(', ')}
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs text-b2b-muted">{d.warranty}</p>
          {submitting && <p className="mt-3 text-sm font-bold">{d.sending}</p>}
          {errors.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-none bg-red-50 p-3 text-sm text-red-700">
              {errors.map((e, i) => (
                <li key={i}>
                  {e.path && <strong>{e.path}: </strong>}
                  {e.message}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-b2b-muted">{d.completeHint}</p>
        </Step>
      </Stepper>
    </div>
  );
}

