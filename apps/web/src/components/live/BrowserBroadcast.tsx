import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Camera, CameraOff, CircleStop, Radio, UploadCloud } from 'lucide-react';
import { api, ApiError, fmt } from '@/lib/api';
import { Badge, Button, Card, cx, Select, toast } from '@/components/ui';

/**
 * Siaran dari browser (docs/API.md §10): kamera+mic → MediaRecorder (WebM, potongan 1 dtk) →
 * `PUT .../ingest/:session/chunks/:seq` **berurutan** lewat antrean (tidak pernah paralel; seq sama aman diulang).
 * Gagal jaringan → ulang seq yang sama dengan backoff hingga ±30 dtk, lalu siaran dihentikan dengan pesan jelas.
 */

const MIMES = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'];
const RES = { '480p': { width: 854, height: 480, vbps: 1_200_000 }, '720p': { width: 1280, height: 720, vbps: 2_500_000 } } as const;
type Res = keyof typeof RES;
const RETRY_BUDGET_MS = 30_000;
const BACKLOG_WARN = 5;

const pickMime = () => (typeof MediaRecorder === 'undefined' ? null : (MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mediaErrorMessage(e: unknown) {
  const name = (e as DOMException)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Izin kamera/mikrofon ditolak. Izinkan akses lewat ikon gembok di bilah alamat, lalu coba lagi.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Kamera atau mikrofon tidak ditemukan. Sambungkan perangkat lalu coba lagi.';
  if (name === 'NotReadableError') return 'Kamera/mikrofon sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.';
  return (e as Error)?.message ?? 'Tidak bisa mengakses kamera/mikrofon.';
}

export function BrowserBroadcast({ streamId, ended, onChange }: { streamId: string; ended?: boolean; onChange?: () => void }) {
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const queue = useRef<{ seq: number; blob: Blob }[]>([]);
  const pumping = useRef<Promise<void> | null>(null);
  const session = useRef<string | null>(null);
  const seq = useRef(0);
  const aborted = useRef(false);
  /** Komponen sudah dibongkar — hasil await yang datang belakangan (kamera, sesi ingest) harus dilepas, bukan dipakai. */
  const unmounted = useRef(false);

  const [devices, setDevices] = useState<{ video: MediaDeviceInfo[]; audio: MediaDeviceInfo[] }>({ video: [], audio: [] });
  const [videoId, setVideoId] = useState('');
  const [audioId, setAudioId] = useState('');
  const [res, setRes] = useState<Res>('720p');
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'starting' | 'live' | 'stopping'>('idle');
  const [backlog, setBacklog] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [sent, setSent] = useState({ chunks: 0, bytes: 0 });
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, tick] = useState(0);
  const mime = pickMime();
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!mime;
  const broadcasting = state === 'live' || state === 'starting' || state === 'stopping';

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['live-stream', streamId] });
    qc.invalidateQueries({ queryKey: ['live-studio'] });
    onChange?.();
  }, [qc, streamId, onChange]);

  const stopTracks = () => {
    mediaRef.current?.getTracks().forEach((t) => t.stop());
    mediaRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  // ---------- Pratinjau & perangkat ----------
  async function openPreview(v = videoId, a = audioId, r: Res = res) {
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: v ? { exact: v } : undefined, width: { ideal: RES[r].width }, height: { ideal: RES[r].height }, frameRate: { ideal: 30, max: 30 } },
        audio: { deviceId: a ? { exact: a } : undefined, echoCancellation: true, noiseSuppression: true },
      });
      if (unmounted.current) {
        media.getTracks().forEach((t) => t.stop()); // kamera dibuka setelah halaman ditinggal → matikan lagi
        return;
      }
      stopTracks();
      mediaRef.current = media;
      if (videoRef.current) videoRef.current.srcObject = media;
      setPreviewing(true);
      // Label perangkat baru tersedia setelah izin diberikan.
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices({ video: all.filter((d) => d.kind === 'videoinput'), audio: all.filter((d) => d.kind === 'audioinput') });
      setVideoId(media.getVideoTracks()[0]?.getSettings().deviceId ?? v);
      setAudioId(media.getAudioTracks()[0]?.getSettings().deviceId ?? a);
    } catch (e) {
      setError(mediaErrorMessage(e));
    }
  }
  function closePreview() {
    stopTracks();
    setPreviewing(false);
  }

  // ---------- Antrean unggah (berurutan) ----------
  function pump(): Promise<void> {
    if (pumping.current) return pumping.current;
    pumping.current = (async () => {
      while (queue.current.length && !aborted.current) {
        const head = queue.current[0];
        const firstTry = Date.now();
        let delay = 500;
        for (;;) {
          if (aborted.current) return;
          try {
            await api(`/v1/live/studio/streams/${streamId}/ingest/${session.current}/chunks/${head.seq}`, { method: 'PUT', body: head.blob });
            setRetrying(false);
            break;
          } catch (e) {
            // 4xx selain 408/429 = sesi tidak berlaku (stream diakhiri, sesi lain aktif) → hentikan.
            if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
              fatal(`Unggahan ditolak server: ${e.message}`);
              return;
            }
            if (Date.now() - firstTry > RETRY_BUDGET_MS) {
              fatal('Koneksi ke server terputus lebih dari 30 detik. Siaran dari browser dihentikan — periksa internet lalu mulai lagi.');
              return;
            }
            setRetrying(true);
            await sleep(delay);
            delay = Math.min(delay * 2, 5000);
          }
        }
        queue.current.shift();
        setBacklog(queue.current.length);
        setSent((s) => ({ chunks: s.chunks + 1, bytes: s.bytes + head.blob.size }));
      }
    })().finally(() => {
      pumping.current = null;
    });
    // Potongan yang masuk tepat saat loop selesai tidak boleh tertinggal.
    const run = pumping.current.then(() => (queue.current.length && !aborted.current ? pump() : undefined));
    return run;
  }

  function fatal(msg: string) {
    aborted.current = true;
    setError(msg);
    try {
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
    } catch {
      /* sudah berhenti */
    }
    recRef.current = null;
    queue.current = [];
    setBacklog(0);
    setRetrying(false);
    setState('idle');
    setStartedAt(null);
    if (session.current) void api(`/v1/live/studio/streams/${streamId}/ingest/${session.current}/stop`, { method: 'POST' }).catch(() => {});
    session.current = null;
    refresh();
  }

  // ---------- Mulai / berhenti ----------
  async function start() {
    if (!mime) return;
    if (!mediaRef.current) await openPreview();
    const media = mediaRef.current;
    if (!media) return;
    setError(null);
    setState('starting');
    try {
      const r = await api<{ session_id: string; chunk_ms: number }>(`/v1/live/studio/streams/${streamId}/ingest/start`, { body: { mime } });
      if (unmounted.current) {
        // Sesi dibuka setelah halaman ditinggal: tutup agar percobaan berikutnya tidak ditolak 409.
        void api(`/v1/live/studio/streams/${streamId}/ingest/${r.session_id}/stop`, { method: 'POST' }).catch(() => {});
        return;
      }
      session.current = r.session_id;
      seq.current = 0;
      queue.current = [];
      aborted.current = false;
      setSent({ chunks: 0, bytes: 0 });
      const rec = new MediaRecorder(media, { mimeType: mime, videoBitsPerSecond: RES[res].vbps, audioBitsPerSecond: 128_000 });
      rec.ondataavailable = (ev) => {
        if (!ev.data || !ev.data.size || aborted.current) return;
        queue.current.push({ seq: seq.current++, blob: new Blob([ev.data], { type: 'video/webm' }) });
        setBacklog(queue.current.length);
        void pump();
      };
      rec.onerror = () => fatal('Perekam media berhenti karena galat. Mulai ulang siaran.');
      recRef.current = rec;
      rec.start(r.chunk_ms || 1000);
      setStartedAt(Date.now());
      setState('live');
      toast.success('Siaran dari browser dimulai');
      refresh();
    } catch (e) {
      setState('idle');
      if (e instanceof ApiError && e.status === 429) setError('Kapasitas siaran bersamaan platform sedang penuh. Coba beberapa menit lagi.');
      else if (e instanceof ApiError && e.status === 409) setError(e.message || 'Sudah ada sumber siaran aktif untuk stream ini (mis. OBS).');
      else setError((e as Error)?.message ?? 'Gagal memulai siaran');
    }
  }

  async function stop() {
    const rec = recRef.current;
    setState('stopping');
    // Tunggu potongan terakhir dari recorder, lalu kuras antrean (maks ±30 dtk per potongan).
    if (rec && rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        rec.addEventListener('stop', () => resolve(), { once: true });
        rec.stop();
      });
    }
    recRef.current = null;
    await sleep(0);
    await pump();
    if (session.current) await api(`/v1/live/studio/streams/${streamId}/ingest/${session.current}/stop`, { method: 'POST' }).catch((e) => toast.error(e));
    session.current = null;
    setState('idle');
    setStartedAt(null);
    toast.info('Siaran dari browser dihentikan. Stream berstatus terputus — akhiri siaran bila sudah selesai.');
    refresh();
  }

  // Detik berjalan untuk durasi.
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  // Cegah meninggalkan halaman saat menyiarkan (tab ditutup / navigasi dalam aplikasi).
  useEffect(() => {
    if (!broadcasting) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [broadcasting]);
  const blocker = useBlocker(broadcasting);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('Siaran dari browser sedang berjalan. Tinggalkan halaman dan hentikan siaran?')) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  // Bersihkan saat unmount: hentikan recorder, kamera, dan tutup sesi.
  useEffect(
    () => {
      unmounted.current = false;
      return () => {
      unmounted.current = true;
      aborted.current = true;
      try {
        if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
      } catch {
        /* abaikan */
      }
      if (session.current) void api(`/v1/live/studio/streams/${streamId}/ingest/${session.current}/stop`, { method: 'POST' }).catch(() => {});
      mediaRef.current?.getTracks().forEach((t) => t.stop());
      };
    },
    [streamId],
  );

  if (ended) return null;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Camera className="size-4" /> Siaran dari browser
        </span>
      }
      action={state === 'live' ? <Badge tone="red">● Menyiarkan {startedAt && fmt.duration(Date.now() - startedAt)}</Badge> : undefined}
    >
      {!supported ? (
        <p className="text-sm text-b2b-muted">Browser ini tidak mendukung perekaman WebM (MediaRecorder). Gunakan Chrome, Edge, atau Firefox terbaru di desktop/Android — atau siarkan lewat OBS (RTMP).</p>
      ) : (
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} muted playsInline autoPlay className={cx('size-full object-cover', !previewing && 'hidden')} style={{ transform: 'scaleX(-1)' }} />
            {!previewing && (
              <div className="absolute inset-0 grid place-items-center text-center text-sm text-white/70">
                <div className="flex flex-col items-center gap-3 p-4">
                  <CameraOff className="size-8" />
                  <p>Kamera belum aktif</p>
                  <Button size="sm" variant="white" onClick={() => openPreview()}>
                    Aktifkan kamera & mikrofon
                  </Button>
                </div>
              </div>
            )}
            {state === 'live' && (
              <span className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded bg-red-600 px-2 py-0.5 text-[11px] font-black text-white uppercase">
                <span className="size-2 animate-pulse rounded-full bg-white" /> On air
              </span>
            )}
          </div>
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-b2b-muted">Kamera</span>
              <Select
                value={videoId}
                disabled={broadcasting || !devices.video.length}
                onChange={(e) => {
                  setVideoId(e.target.value);
                  void openPreview(e.target.value, audioId);
                }}
              >
                {!devices.video.length && <option value="">—</option>}
                {devices.video.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Kamera ${i + 1}`}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-b2b-muted">Mikrofon</span>
              <Select
                value={audioId}
                disabled={broadcasting || !devices.audio.length}
                onChange={(e) => {
                  setAudioId(e.target.value);
                  void openPreview(videoId, e.target.value);
                }}
              >
                {!devices.audio.length && <option value="">—</option>}
                {devices.audio.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Mikrofon ${i + 1}`}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-b2b-muted">Resolusi</span>
              <Select
                value={res}
                disabled={broadcasting}
                onChange={(e) => {
                  const r = e.target.value as Res;
                  setRes(r);
                  if (previewing) void openPreview(videoId, audioId, r);
                }}
              >
                <option value="480p">480p — hemat kuota (±1,3 Mbps)</option>
                <option value="720p">720p — HD (±2,6 Mbps)</option>
              </Select>
            </label>
            {state === 'idle' ? (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="danger" icon={<Radio className="size-4" />} onClick={start}>
                  Mulai siaran
                </Button>
                {previewing && (
                  <Button variant="outline-ink" onClick={closePreview}>
                    Matikan kamera
                  </Button>
                )}
              </div>
            ) : (
              <Button variant="ink" icon={<CircleStop className="size-4" />} loading={state !== 'live'} onClick={stop}>
                {state === 'stopping' ? 'Mengirim sisa data…' : state === 'starting' ? 'Memulai…' : 'Hentikan siaran browser'}
              </Button>
            )}
            {state !== 'idle' && (
              <p className="text-xs text-b2b-muted">
                Terkirim {fmt.num(sent.chunks)} potongan · {(sent.bytes / 1_048_576).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB
              </p>
            )}
          </div>
        </div>
      )}
      {(backlog > BACKLOG_WARN || retrying) && state !== 'idle' && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700">
          <UploadCloud className="mt-0.5 size-4 shrink-0" />
          <p>
            {retrying ? 'Koneksi tersendat — mencoba mengirim ulang. ' : ''}
            Antrean unggah: <b>{backlog} potongan</b> (±{backlog} dtk tertunda). Bandwidth unggah tidak cukup — pilih 480p, tutup aplikasi lain yang memakai internet, atau gunakan koneksi kabel/Wi-Fi yang lebih stabil.
          </p>
        </div>
      )}
      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}
      <p className="mt-4 text-xs text-b2b-muted">Jaga tab ini tetap terbuka selama siaran. Untuk kualitas terbaik dan koneksi lebih stabil gunakan OBS (RTMP).</p>
    </Card>
  );
}
