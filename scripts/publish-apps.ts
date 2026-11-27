/**
 * Terbitkan installer aplikasi ke folder `downloads/` (disajikan di /downloads/) + tulis `downloads/manifest.json`.
 *
 *   npm run apps:publish
 *
 * Sumber (repo saudara, bisa ditimpa env):
 * - Desktop : $RAVE_DESKTOP_DIR (../RAVE-Desktop-apps) → installers/RAVE_<versi package.json>_x64-setup.exe & .msi
 * - Android : TIDAK diterbitkan di sini — web membaca GitHub Release terbaru dijiwa-id/RAVE-Mobile-Apps.
 * Hanya versi terbaru yang disimpan per platform (berkas lama dihapus). Platform yang tidak ditemukan dilewati
 * (manifest tetap ditulis tanpa platform itu → web menampilkan "segera").
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'downloads');
const DESKTOP = resolve(process.env.RAVE_DESKTOP_DIR ?? join(ROOT, '..', 'RAVE-Desktop-apps'));

interface Asset {
  file: string;
  url: string;
  size: number;
  sha256: string;
}
const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** Salin `src` ke downloads/<dir>/<name>, hapus berkas lain berekstensi sama (versi lama). */
function publish(dir: 'desktop' | 'mobile', src: string, name: string): Asset {
  const ext = name.slice(name.lastIndexOf('.'));
  for (const old of readdirSync(join(OUT, dir))) if (old.endsWith(ext) && old !== name) rmSync(join(OUT, dir, old));
  const dest = join(OUT, dir, name);
  copyFileSync(src, dest);
  return { file: name, url: `/downloads/${dir}/${encodeURIComponent(name)}`, size: statSync(dest).size, sha256: sha256(dest) };
}

const manifest: {
  generated_at: string;
  desktop?: { platform: 'windows'; version: string; installer: Asset; msi?: Asset };
} = { generated_at: new Date().toISOString() };

// ---- Desktop (Windows) ----
try {
  const v = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')).version as string;
  const exe = join(DESKTOP, 'installers', `RAVE_${v}_x64-setup.exe`);
  const msi = join(DESKTOP, 'installers', `RAVE_${v}_x64_en-US.msi`);
  if (!existsSync(exe)) throw new Error(`installer ${exe} belum ada — build dulu`);
  manifest.desktop = {
    platform: 'windows',
    version: v,
    installer: publish('desktop', exe, `RAVE_${v}_x64-setup.exe`),
    msi: existsSync(msi) ? publish('desktop', msi, `RAVE_${v}_x64_en-US.msi`) : undefined,
  };
  console.log(`✓ desktop ${v}`);
} catch (e) {
  console.warn(`! desktop dilewati: ${(e as Error).message}`);
}

// ---- Android ----
// Tidak lagi disalin ke sini: web mengambil APK langsung dari GitHub Release terbaru dijiwa-id/RAVE-Mobile-Apps
// (lihat apps/web/src/lib/appDownloads.ts). APK lama di downloads/mobile dibersihkan agar tak ada versi basi.
for (const old of readdirSync(join(OUT, 'mobile'))) if (old.endsWith('.apk')) rmSync(join(OUT, 'mobile', old));

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`✓ ${join(OUT, 'manifest.json')}`);
