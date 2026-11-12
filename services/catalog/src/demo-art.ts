import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ffmpegPath } from './audio.js';
import { UPLOAD_DIR } from './storage.js';

/**
 * Karya visual demo yang dihasilkan lokal (gradasi bernuansa RAVE) untuk data seed — menggantikan host gambar
 * pihak ketiga (picsum.photos) yang tidak selalu terjangkau sehingga sampul/foto/poster tampil rusak.
 * Deterministik per seed, dibuat sekali lalu dicache di disk. Dibatasi ketat: ukuran dari daftar tetap, seed pendek.
 * URL: /v1/catalog/demo-art/<seed>-<W>x<H>.jpg (lihat `demoArt()` di @rave/domain/seed-ids).
 */
export const DEMO_ART_SIZES = new Set(['300x300', '600x600', '640x640', '800x1000', '1200x800', '1600x600']);
export const DEMO_ART_RE = /^([a-z0-9][a-z0-9-]{0,63})-(\d{3,4}x\d{3,4})\.jpg$/;
const CACHE_DIR = join(UPLOAD_DIR, '..', 'demo-art');

/** Palet RAVE: ungu, mustard, plum, teal, berry, ink. */
const PALETTES: string[][] = [
  ['0x5b2a6e', '0xf4c21f', '0x2a1233'],
  ['0x2a1233', '0x7a3e91', '0xf4c21f'],
  ['0x1f5c52', '0xf4c21f', '0x181818'],
  ['0x8a2f3f', '0xf4c21f', '0x2a1233'],
  ['0x181818', '0x5b2a6e', '0xc9a0dc'],
  ['0x7a3e91', '0x1f5c52', '0xededed'],
  ['0xf4c21f', '0x8a2f3f', '0x2a1233'],
];
const TYPES = ['radial', 'linear', 'circular', 'spiral'];

const run = promisify(execFile);
const inflight = new Map<string, Promise<string>>();

/** Path berkas JPEG demo (dibuat bila belum ada). null bila nama tidak valid / ffmpeg tidak tersedia. */
export async function demoArtFile(name: string): Promise<string | null> {
  const m = DEMO_ART_RE.exec(name);
  if (!m || !DEMO_ART_SIZES.has(m[2]!)) return null;
  const out = join(CACHE_DIR, name);
  if (existsSync(out)) return out;
  const ff = ffmpegPath();
  if (!ff) return null;
  if (!inflight.has(name)) {
    inflight.set(
      name,
      (async () => {
        mkdirSync(CACHE_DIR, { recursive: true });
        const h = createHash('sha256').update(m[1]!).digest();
        const pal = PALETTES[h[0]! % PALETTES.length]!;
        const type = TYPES[h[1]! % TYPES.length]!;
        const [w, hgt] = m[2]!.split('x');
        const tmp = `${out}.${process.pid}.tmp.jpg`;
        await run(ff, [
          '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
          '-i', `gradients=s=${w}x${hgt}:c0=${pal[0]}:c1=${pal[1]}:c2=${pal[2]}:n=3:seed=${h.readUInt32BE(2)}:type=${type}`,
          '-vf', 'vignette=PI/5', '-frames:v', '1', '-q:v', '4', tmp,
        ], { timeout: 20_000 });
        renameSync(tmp, out); // atomik: tidak pernah menyajikan berkas setengah jadi
        return out;
      })().finally(() => inflight.delete(name)),
    );
  }
  return inflight.get(name)!.catch(() => null);
}
