import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '@gema/service-kit';

/** Penyimpanan upload dev (<root>/storage/uploads). Produksi: bucket quarantine via presigned URL (TDD §11.3). */
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'storage', 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });

/** Total byte upload selesai (untuk kuota) — dari tabel uploads, bukan readdir/stat seluruh bucket. Produksi: metrik object storage. */
export async function uploadsBytes(db: Db): Promise<number> {
  const r = await db.one<{ b: string }>(`SELECT coalesce(sum(size), 0)::bigint AS b FROM uploads WHERE completed_at IS NOT NULL`);
  return Number(r?.b ?? 0);
}

/** Baca dimensi PNG/JPEG dari header (validasi artwork REQ-STU-01) tanpa dependensi. */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** Info WAV (sample rate, bit depth, durasi) untuk validasi master (min 16-bit/44,1 kHz). */
export function wavInfo(buf: Buffer): { sampleRate: number; bitDepth: number; durationMs: number } | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let i = 12;
  let sampleRate = 0;
  let bitDepth = 0;
  let byteRate = 0;
  while (i + 8 <= buf.length) {
    const id = buf.toString('ascii', i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    if (id === 'fmt ') {
      sampleRate = buf.readUInt32LE(i + 12);
      byteRate = buf.readUInt32LE(i + 16);
      bitDepth = buf.readUInt16LE(i + 22);
    } else if (id === 'data' && byteRate) {
      return { sampleRate, bitDepth, durationMs: Math.round((size / byteRate) * 1000) };
    }
    i += 8 + size + (size % 2);
  }
  return sampleRate ? { sampleRate, bitDepth, durationMs: 0 } : null;
}
