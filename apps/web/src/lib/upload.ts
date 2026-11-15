import { AUDIO_UPLOAD_TYPES, type AudioMeta } from '@rave/domain/audio';
import { api, ApiError, forceRefresh } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { currentLocale } from '@/lib/i18n';
import { toast } from '@/components/ui';

/** Format master yang diterima (server memvalidasi isi berkas dengan ffmpeg). Lossless → tersedia Lossless untuk Premium. */
export const AUDIO_ACCEPT = '.wav,.flac,.aif,.aiff,.m4a,.alac,.mp3,.aac,.ogg,.opus,audio/*';
/** Gambar yang diterima server (JPEG/PNG — dimensi divalidasi dari header berkas). */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,.png,.jpg,.jpeg';

/**
 * Unggah berkas ke bucket uploads catalog (dua langkah: daftar → PUT biner) dan kembalikan URL publiknya.
 * `purpose: 'playlist'` = sampul playlist pengguna, `'category'` = gambar kategori Jelajahi (≤ 8 MB, ≥ 300 px); default artwork/master rilis Artist Studio.
 * Peringatan validasi dari server (mis. master lossy, gambar bukan persegi) ditampilkan sebagai toast info.
 */
export async function uploadFile(file: File, kind: 'audio' | 'artwork', purpose: 'release' | 'playlist' | 'category' | 'podcast' | 'ad' = 'release'): Promise<string> {
  const u = await api<{ upload_id: string; upload_url: string; public_url: string }>('/v1/studio/uploads', {
    // MIME kosong (umum untuk .flac/.aiff di Windows) → server menentukan dari ekstensi.
    body: { kind, purpose, filename: file.name, content_type: file.type || 'application/octet-stream', size: file.size },
  });
  const r = await api<{ public_url?: string; warnings?: string[] }>(u.upload_url, { method: 'PUT', body: file });
  for (const w of r?.warnings ?? []) toast.info(w);
  return r?.public_url ?? u.public_url;
}

// ------------------------------------------------------------ Unggah dengan progres (Artist Studio)

export type TranscodeStatus = 'none' | 'pending' | 'processing' | 'done' | 'failed' | 'skipped';
export interface UploadResult {
  upload_id: string;
  url: string;
  meta: Partial<AudioMeta> & { width?: number; height?: number };
  warnings: string[];
  transcode_status: TranscodeStatus;
}
export interface UploadProgress {
  loaded: number;
  total: number;
}

/** Ekstensi master audio yang diterima server (sama dengan AUDIO_UPLOAD_TYPES di @rave/domain/audio). */
export const AUDIO_EXTENSIONS = Object.keys(AUDIO_UPLOAD_TYPES);
const extOf = (name: string) => (name.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? '').toLowerCase();

/** Cek berkas sebelum diunggah (ekstensi & ukuran) — server tetap memvalidasi isi berkas. */
export function precheckFile(file: File, kind: 'audio' | 'artwork', maxMb: number): 'type' | 'size' | 'empty' | null {
  const ext = extOf(file.name);
  if (kind === 'audio' ? !AUDIO_UPLOAD_TYPES[ext] : !['.jpg', '.jpeg', '.png'].includes(ext)) return 'type';
  if (!file.size) return 'empty';
  if (file.size > maxMb * 1024 * 1024) return 'size';
  return null;
}

/** PUT biner lewat XHR (fetch belum punya progres unggah). Token kedaluwarsa → refresh sekali lalu ulangi. */
function putWithProgress(url: string, file: File, onProgress: (p: UploadProgress) => void, signal?: AbortSignal, retried = false): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    const token = useAuth.getState().accessToken;
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('accept-language', currentLocale());
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) =>
      onProgress({
        loaded: e.loaded,
        total: e.lengthComputable ? e.total : file.size,
      });
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    xhr.onerror = () => reject(new ApiError(0, { title: 'Network error' }));
    xhr.onload = async () => {
      signal?.removeEventListener('abort', onAbort);
      let data: any = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = { detail: xhr.responseText };
      }
      if (xhr.status === 401 && !retried && useAuth.getState().refreshToken && (await forceRefresh())) {
        putWithProgress(url, file, onProgress, signal, true).then(resolve, reject);
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) reject(new ApiError(xhr.status, data ?? { title: xhr.statusText }));
      else resolve(data);
    };
    xhr.send(file);
  });
}

/**
 * Unggah dua langkah (daftar → PUT biner) dengan progres byte nyata. `onSent` dipanggil saat semua byte terkirim —
 * server lalu memeriksa isi berkas (ffprobe/dimensi gambar) sebelum menjawab.
 */
export async function uploadWithProgress(
  file: File,
  kind: 'audio' | 'artwork',
  o: {
    onProgress?: (p: UploadProgress) => void;
    onSent?: () => void;
    signal?: AbortSignal;
  } = {},
): Promise<UploadResult> {
  const u = await api<{
    upload_id: string;
    upload_url: string;
    public_url: string;
  }>('/v1/studio/uploads', {
    body: {
      kind,
      purpose: 'release',
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
      size: file.size,
    },
    signal: o.signal,
  });
  let sent = false;
  const r = await putWithProgress(
    u.upload_url,
    file,
    (p) => {
      o.onProgress?.(p);
      if (!sent && p.loaded >= p.total) {
        sent = true;
        o.onSent?.();
      }
    },
    o.signal,
  );
  return {
    upload_id: u.upload_id,
    url: r?.public_url ?? u.public_url,
    meta: r?.meta ?? {},
    warnings: r?.warnings ?? [],
    transcode_status: r?.transcode_status ?? 'none',
  };
}

/** Status pengolahan upload (GET /v1/studio/uploads/:id) — dipolling selama transcoding. */
export const uploadStatus = (id: string, signal?: AbortSignal) =>
  api<{
    transcode_status: TranscodeStatus;
    transcode_error: string | null;
    audio_meta: AudioMeta | null;
  }>(`/v1/studio/uploads/${id}`, { signal });
