import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { RotateCcw, Upload, X } from 'lucide-react';
import type { AudioMeta } from '@rave/domain/audio';
import { ApiError, fmt } from '@/lib/api';
import { precheckFile, uploadStatus, uploadWithProgress, type UploadProgress } from '@/lib/upload';
import { Button, cx } from '@/components/ui';
import { useDict } from '@/lib/i18n';
import './studio.css';

/**
 * Unggah master audio Artist Studio: antrean (2 sekaligus), progres byte nyata (XHR), tahap pemeriksaan server,
 * polling status transcoding (GET /v1/studio/uploads/:id), batal & coba lagi.
 */

export type UploadStage = 'idle' | 'queued' | 'uploading' | 'verifying' | 'processing' | 'ready' | 'error';
export interface AudioUpload {
  stage: UploadStage;
  fileName?: string;
  size?: number;
  loaded?: number;
  /** byte/detik (rata-rata bergerak). */
  rate?: number;
  error?: string;
  upload_id?: string;
  meta?: Partial<AudioMeta>;
  warnings?: string[];
}
export interface AudioPatch {
  up?: AudioUpload;
  audio_url?: string;
  duration_ms?: number;
}

export const IDLE: AudioUpload = { stage: 'idle' };
export const isBusy = (s: UploadStage) => s === 'queued' || s === 'uploading' || s === 'verifying';
const MAX_PARALLEL = 2;
const POLL_MS = 2500;

export function fmtBytes(n = 0) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Durasi dari metadata browser (fallback bila server tidak mengembalikan durasi). */
export function audioDuration(file: File): Promise<number | undefined> {
  return new Promise((res) => {
    const a = new Audio();
    a.preload = 'metadata';
    const src = URL.createObjectURL(file);
    const done = (v: number | undefined) => {
      URL.revokeObjectURL(src);
      res(v);
    };
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : undefined);
    a.onerror = () => done(undefined);
    a.src = src;
  });
}

type Job = { key: string; file: File; gen: number };

export function useAudioUploads(patch: (key: string, p: AudioPatch) => void) {
  const t = useDict('b2b').studio.newRelease.up;
  const files = useRef(new Map<string, File>());
  const ctrls = useRef(new Map<string, AbortController>());
  const snapshots = useRef(new Map<string, AudioPatch>());
  const queue = useRef<Job[]>([]);
  const running = useRef(0);
  const polls = useRef(new Map<string, number>());
  /** Generasi per baris: hasil unggahan/polling lama (dibatalkan/diganti) diabaikan. */
  const gens = useRef(new Map<string, number>());
  const bump = (key: string) => {
    const g = (gens.current.get(key) ?? 0) + 1;
    gens.current.set(key, g);
    return g;
  };
  const alive = useRef(true);
  const patchRef = useRef(patch);
  patchRef.current = patch;
  const [, force] = useState(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const c of ctrls.current.values()) c.abort();
      for (const h of polls.current.values()) clearTimeout(h);
    };
  }, []);

  const message = (e: unknown) => (e instanceof ApiError ? (e.status === 0 ? t.network : e.message) : e instanceof Error ? e.message : String(e));

  const poll = useCallback(
    (key: string, uploadId: string, base: AudioUpload) => {
      const gen = gens.current.get(key);
      const tick = async () => {
        polls.current.delete(key);
        if (!alive.current || gens.current.get(key) !== gen) return;
        try {
          const s = await uploadStatus(uploadId);
          if (!alive.current || gens.current.get(key) !== gen) return;
          if (s.transcode_status === 'pending' || s.transcode_status === 'processing') {
            polls.current.set(key, window.setTimeout(tick, POLL_MS));
          } else if (s.transcode_status === 'failed') {
            patchRef.current(key, {
              audio_url: '',
              up: {
                ...base,
                stage: 'error',
                error: t.transcodeFailed(String(s.transcode_error ?? '').slice(0, 140)),
              },
            });
          } else {
            patchRef.current(key, {
              up: {
                ...base,
                stage: 'ready',
                meta: { ...base.meta, ...(s.audio_meta ?? {}) },
              },
            });
          }
        } catch {
          // Gangguan sementara: coba lagi lebih lambat (master sudah tersimpan, transcoding tetap berjalan di server).
          if (alive.current) polls.current.set(key, window.setTimeout(tick, POLL_MS * 2));
        }
      };
      clearTimeout(polls.current.get(key));
      polls.current.set(key, window.setTimeout(tick, POLL_MS));
    },
    [t],
  );

  const run = useCallback(
    async ({ key, file, gen }: Job) => {
      running.current++;
      const ctrl = new AbortController();
      ctrls.current.set(key, ctrl);
      const mine = () => alive.current && gens.current.get(key) === gen;
      const set = (p: AudioPatch) => mine() && patchRef.current(key, p);
      const base: AudioUpload = {
        stage: 'uploading',
        fileName: file.name,
        size: file.size,
        loaded: 0,
        rate: 0,
      };
      set({ up: base });
      let last = { t: performance.now(), loaded: 0, emit: 0 };
      let rate = 0;
      const onProgress = (p: UploadProgress) => {
        const now = performance.now();
        const dt = (now - last.t) / 1000;
        if (dt > 0.2) {
          const inst = (p.loaded - last.loaded) / dt;
          rate = rate ? rate * 0.7 + inst * 0.3 : inst;
          last = { ...last, t: now, loaded: p.loaded };
        }
        if (now - last.emit > 120 || p.loaded >= p.total) {
          last.emit = now;
          set({ up: { ...base, loaded: p.loaded, size: p.total, rate } });
        }
      };
      try {
        const [r, dur] = await Promise.all([
          uploadWithProgress(file, 'audio', {
            onProgress,
            onSent: () => set({ up: { ...base, stage: 'verifying', loaded: file.size } }),
            signal: ctrl.signal,
          }),
          audioDuration(file),
        ]);
        if (!mine()) return;
        const done: AudioUpload = {
          ...base,
          stage: 'ready',
          loaded: file.size,
          upload_id: r.upload_id,
          meta: r.meta,
          warnings: r.warnings,
        };
        const processing = r.transcode_status === 'pending' || r.transcode_status === 'processing';
        set({
          audio_url: r.url,
          duration_ms: r.meta.duration_ms || dur,
          up: processing ? { ...done, stage: 'processing' } : done,
        });
        snapshots.current.delete(key);
        if (processing) poll(key, r.upload_id, done);
      } catch (e) {
        // Dibatalkan → cancel() sudah memulihkan keadaan sebelumnya.
        if (!(e instanceof DOMException && e.name === 'AbortError')) set({ up: { ...base, stage: 'error', error: message(e) } });
      } finally {
        if (ctrls.current.get(key) === ctrl) ctrls.current.delete(key);
        running.current--;
        pump();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [poll],
  );

  function pump() {
    while (running.current < MAX_PARALLEL && queue.current.length) void run(queue.current.shift()!);
    force((n) => n + 1);
  }

  /** Mulai unggah (validasi ekstensi & ukuran dulu). Mengembalikan alasan penolakan bila berkas tidak valid. */
  function start(key: string, file: File, maxMb: number, previous?: AudioPatch): 'type' | 'size' | 'empty' | null {
    const bad = precheckFile(file, 'audio', maxMb);
    if (bad) return bad;
    cancel(key, true);
    files.current.set(key, file);
    if (previous) snapshots.current.set(key, previous);
    queue.current.push({ key, file, gen: bump(key) });
    patch(key, {
      up: { stage: 'queued', fileName: file.name, size: file.size },
    });
    pump();
    return null;
  }
  function cancel(key: string, silent = false) {
    clearTimeout(polls.current.get(key));
    polls.current.delete(key);
    const q = queue.current.findIndex((j) => j.key === key);
    const active = q >= 0 || ctrls.current.has(key);
    if (q >= 0) queue.current.splice(q, 1);
    ctrls.current.get(key)?.abort();
    ctrls.current.delete(key);
    bump(key);
    if (active && !silent) patch(key, snapshots.current.get(key) ?? { up: IDLE });
    snapshots.current.delete(key);
  }
  function retry(key: string) {
    const f = files.current.get(key);
    if (!f) return false;
    queue.current.push({ key, file: f, gen: bump(key) });
    patch(key, { up: { stage: 'queued', fileName: f.name, size: f.size } });
    pump();
    return true;
  }
  function forget(key: string) {
    cancel(key, true);
    files.current.delete(key);
  }
  /** Lanjutkan polling transcoding untuk draf yang dipulihkan. */
  function resume(key: string, up: AudioUpload) {
    if (up.stage === 'processing' && up.upload_id) poll(key, up.upload_id, { ...up, stage: 'ready' });
  }
  const file = (key: string) => files.current.get(key);

  return { start, cancel, retry, forget, resume, file };
}

// ---------------------------------------------------------------- UI

/** Zona seret & lepas + pemilih berkas (input file asli tetap bisa difokus & dibuka dengan keyboard). */
export function DropZone({
  accept,
  multiple,
  disabled,
  onFiles,
  title,
  hint,
  square,
  children,
  label,
}: {
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (f: File[]) => void;
  title: ReactNode;
  hint?: ReactNode;
  square?: boolean;
  children?: ReactNode;
  label: string;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  return (
    <label
      className={cx('st-drop', square && 'st-drop--square')}
      data-over={over}
      data-disabled={disabled || undefined}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        if (!disabled) setOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        if (disabled) return;
        const list = [...e.dataTransfer.files];
        if (list.length) onFiles(multiple ? list : list.slice(0, 1));
      }}
    >
      <input
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = '';
          if (list.length) onFiles(list);
        }}
      />
      {children ?? (
        <span className="st-cass" aria-hidden>
          <i />
          <i />
        </span>
      )}
      <span className="min-w-0">
        <span className="block font-display text-xl leading-none tracking-wide text-b2b-ink uppercase">{title}</span>
        {hint && <span className="mt-1.5 block text-xs text-b2b-muted">{hint}</span>}
      </span>
    </label>
  );
}

function specOf(m: Partial<AudioMeta> | undefined) {
  if (!m?.codec) return null;
  const codec = m.codec.replace(/^pcm_.*/, 'PCM').toUpperCase();
  const sr = m.sample_rate ? `${+(m.sample_rate / 1000).toFixed(1)} kHz` : '';
  const bits = m.lossless && m.bit_depth ? `${m.bit_depth}-bit` : m.bitrate_kbps ? `${m.bitrate_kbps} kbps` : '';
  return [codec, bits, sr].filter(Boolean).join(' · ');
}

/**
 * Meter unggah gaya LCD deck: gulungan kaset + meter tersegmen. Tinggi tetap di semua tahap (tidak ada lompatan tata letak).
 */
export function UploadMeter({
  up,
  onCancel,
  onRetry,
  pick,
  idleText,
  kind = 'audio',
}: {
  up: AudioUpload;
  onCancel?: () => void;
  onRetry?: () => void;
  /** Tombol/label pemilih berkas untuk tahap idle/siap/gagal. */
  pick?: ReactNode;
  idleText?: string;
  kind?: 'audio' | 'artwork';
}) {
  const t = useDict('b2b').studio.newRelease.up;
  const pct = up.size ? Math.min(100, Math.floor(((up.loaded ?? 0) / up.size) * 100)) : 0;
  const eta = up.rate && up.size && up.loaded != null && up.rate > 1 ? Math.ceil((up.size - up.loaded) / up.rate) : null;
  const busyMeter = up.stage === 'verifying' || up.stage === 'processing' || up.stage === 'queued';
  const fill = up.stage === 'ready' ? 100 : up.stage === 'uploading' ? pct : up.stage === 'error' ? pct : busyMeter ? 100 : 0;
  const spec = specOf(up.meta);
  const status = up.stage === 'uploading' ? t.stage.uploading : up.stage === 'verifying' ? (kind === 'audio' ? t.stage.verifying : t.stage.verifyingImage) : (t.stage[up.stage] as string);

  return (
    <div className="space-y-1.5">
      <div className="st-lcd" data-stage={up.stage} role="status" aria-live="polite" aria-busy={isBusy(up.stage) || up.stage === 'processing'}>
        <span className="st-reels" aria-hidden>
          <i />
          <i />
        </span>
        <div className="st-lcd__main">
          <div className="st-lcd__row st-lcd__glow">
            <span>
              {up.stage === 'idle' ? <span className="st-lcd__dim">{idleText ?? t.stage.idle}</span> : status}
              {up.stage === 'processing' && <span className="st-lcd__dim"> · {t.processingHint}</span>}
            </span>
            {up.stage === 'uploading' && <span className="st-lcd__pct">{pct}%</span>}
            {up.stage === 'ready' && spec && <span>{spec}</span>}
          </div>
          <div
            className={cx('st-meter', busyMeter && 'st-meter--busy')}
            role="progressbar"
            aria-label={status}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={up.stage === 'uploading' ? pct : busyMeter ? undefined : fill}
          >
            <span className="st-meter__fill" style={{ width: `${fill}%` }} />
          </div>
          <div className="st-lcd__row st-lcd__dim">
            <span>{up.fileName ?? '—'}</span>
            <span>
              {up.stage === 'uploading'
                ? `${fmtBytes(up.loaded)} / ${fmtBytes(up.size)}${up.rate ? ` · ${fmtBytes(up.rate)}/s` : ''}${eta != null && eta < 36_000 ? ` · ${t.eta(fmt.duration(eta * 1000))}` : ''}`
                : up.size
                  ? fmtBytes(up.size)
                  : ''}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {(isBusy(up.stage) || up.stage === 'processing') && onCancel && up.stage !== 'processing' && (
            <Button type="button" size="sm" variant="white" icon={<X />} onClick={onCancel} aria-label={t.cancel} title={t.cancel} />
          )}
          {up.stage === 'error' && onRetry && (
            <Button type="button" size="sm" variant="primary" icon={<RotateCcw />} onClick={onRetry}>
              {t.retry}
            </Button>
          )}
          {!isBusy(up.stage) && pick}
        </div>
      </div>
      {up.stage === 'error' && up.error && (
        <p className="text-xs font-bold text-red-600" role="alert">
          {up.error}
        </p>
      )}
      {up.warnings?.map((w) => (
        <p key={w} className="text-xs font-semibold text-amber-700">
          ⚠ {w}
        </p>
      ))}
    </div>
  );
}

/** Tombol kecil "pilih berkas" di dalam LCD. */
export function PickButton({ accept, label, onFile, disabled }: { accept: string; label: string; onFile: (f: File) => void; disabled?: boolean }) {
  return (
    <label
      className={cx(
        'rave-btn inline-flex h-8 cursor-pointer items-center gap-1.5 border-2 border-rave-ink bg-rave-paper px-3 font-label text-[11px] font-bold tracking-[0.08em] whitespace-nowrap text-rave-ink uppercase [--btn-shadow:#0b0a0c] focus-within:outline-2 focus-within:outline-rave-mustard',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <Upload className="size-3.5" />
      <span className="hidden sm:inline">{label}</span>
      <input
        type="file"
        accept={accept}
        className="sr-only"
        aria-label={label}
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </label>
  );
}
