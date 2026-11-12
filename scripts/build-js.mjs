// Transpile TypeScript backend (packages/*/src, services/*/src) → .js di samping berkas .ts (per berkas, tanpa bundle).
// Dipakai image produksi agar service berjalan dengan `node` biasa, bukan kompilasi tsx saat start.
// Path relatif berbasis import.meta.url (migrasi, storage, package.json) tetap sama karena lokasi berkas tidak berubah.
//
//   node scripts/build-js.mjs [root] [--rewrite-exports]
//
// --rewrite-exports: arahkan main/exports package.json workspace ke .js (hanya di image produksi; dev tetap .ts + tsx).
import { build } from 'esbuild';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const root = resolve(args.find((a) => !a.startsWith('--')) ?? process.cwd());
const rewrite = args.includes('--rewrite-exports');

const workspaces = ['packages', 'services'].flatMap((d) => (existsSync(join(root, d)) ? readdirSync(join(root, d)).map((n) => join(root, d, n)) : []));
const files = [];
const walk = (dir) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith('.ts') && !n.endsWith('.d.ts') && !n.endsWith('.test.ts')) files.push(p);
  }
};
for (const w of workspaces) if (existsSync(join(w, 'src'))) walk(join(w, 'src'));
if (!files.length) throw new Error(`tidak ada berkas .ts di ${root}`);

await build({
  entryPoints: files,
  outdir: root,
  outbase: root,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  bundle: false,
  logLevel: 'warning',
});
console.log(`build-js: ${files.length} berkas → .js`);

if (rewrite) {
  const toJs = (v) => (typeof v === 'string' ? v.replace(/\.ts$/, '.js') : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJs(x)])) : v);
  for (const w of workspaces) {
    const f = join(w, 'package.json');
    if (!existsSync(f)) continue;
    const pkg = JSON.parse(readFileSync(f, 'utf8'));
    if (pkg.main) pkg.main = toJs(pkg.main);
    if (pkg.exports) pkg.exports = toJs(pkg.exports);
    writeFileSync(f, JSON.stringify(pkg, null, 2) + '\n');
  }
  console.log('build-js: exports package.json → .js');
}
