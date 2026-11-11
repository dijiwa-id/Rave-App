import { api } from '@/lib/api';
import { toast } from '@/components/ui';

/** Format master yang diterima (server memvalidasi isi berkas dengan ffmpeg). Lossless → tersedia Lossless untuk Premium. */
export const AUDIO_ACCEPT = '.wav,.flac,.aif,.aiff,.m4a,.alac,.mp3,.aac,.ogg,.opus,audio/*';
/** Gambar yang diterima server (JPEG/PNG — dimensi divalidasi dari header berkas). */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,.png,.jpg,.jpeg';

/**
 * Unggah berkas ke bucket uploads catalog (dua langkah: daftar → PUT biner) dan kembalikan URL publiknya.
 * `purpose: 'playlist'` = sampul playlist pengguna (≤ 8 MB, ≥ 300 px); default artwork/master rilis Artist Studio.
 * Peringatan validasi dari server (mis. master lossy, gambar bukan persegi) ditampilkan sebagai toast info.
 */
export async function uploadFile(file: File, kind: 'audio' | 'artwork', purpose: 'release' | 'playlist' = 'release'): Promise<string> {
  const u = await api<{ upload_id: string; upload_url: string; public_url: string }>('/v1/studio/uploads', {
    // MIME kosong (umum untuk .flac/.aiff di Windows) → server menentukan dari ekstensi.
    body: { kind, purpose, filename: file.name, content_type: file.type || 'application/octet-stream', size: file.size },
  });
  const r = await api<{ public_url?: string; warnings?: string[] }>(u.upload_url, { method: 'PUT', body: file });
  for (const w of r?.warnings ?? []) toast.info(w);
  return r?.public_url ?? u.public_url;
}
