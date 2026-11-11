/**
 * Rilis RAVE (SemVer + Conventional Commits). Lihat docs/VERSIONING.md.
 *
 *   npm run release -- auto            # tentukan bump dari commit sejak tag terakhir (feat → minor, fix → patch, ! → major)
 *   npm run release -- patch|minor|major
 *   npm run release -- prerelease --preid rc   # 1.2.0 → 1.2.1-rc.0, 1.2.1-rc.0 → 1.2.1-rc.1
 *   npm run release -- 1.0.0           # versi eksplisit
 *   tambahkan --dry-run untuk melihat hasil tanpa mengubah apa pun
 *
 * Langkah: cek working tree bersih → hitung versi → samakan versi semua workspace (+ lockfile)
 * → tulis bagian CHANGELOG.md → commit `chore(release): vX.Y.Z` → tag beranotasi `vX.Y.Z`.
 * Tidak melakukan push — jalankan `git push --follow-tags` setelah meninjau (CI release akan membangun image).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './services.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const preid = args.includes('--preid') ? args[args.indexOf('--preid') + 1] : 'rc';
const kind = args.find((a) => !a.startsWith('--') && a !== preid) ?? 'auto';

const git = (...a: string[]) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const die = (m: string): never => {
  console.error(`✗ ${m}`);
  process.exit(1);
};

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const pkgPath = join(ROOT, 'package.json');
const current: string = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
const m = SEMVER.exec(current) ?? die(`versi package.json bukan SemVer: ${current}`);
let [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
const pre = m[4];

if (!dry && git('status', '--porcelain')) die('working tree belum bersih — commit atau stash dulu');

let lastTag = '';
try {
  lastTag = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*');
} catch {
  /* belum ada tag: semua commit masuk rilis pertama */
}
const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
const log = git('log', range, '--no-merges', '--pretty=format:%h%x1f%s%x1f%b%x1e')
  .split('\x1e')
  .map((r) => r.trim())
  .filter(Boolean)
  .map((r) => {
    const [hash, subject, body = ''] = r.split('\x1f');
    const cc = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject);
    return {
      hash,
      type: cc?.[1] ?? 'other',
      scope: cc?.[2] ?? '',
      breaking: !!cc?.[3] || /BREAKING CHANGE/.test(body),
      text: cc?.[4] ?? subject,
    };
  })
  .filter((c) => !(c.type === 'chore' && c.scope === 'release'));

if (!log.length && kind === 'auto') die(`tidak ada commit baru sejak ${lastTag || 'awal'}`);

let next: string;
const bump = kind === 'auto' ? (log.some((c) => c.breaking) ? (maj === 0 ? 'minor' : 'major') : log.some((c) => c.type === 'feat') ? 'minor' : 'patch') : kind;
switch (bump) {
  case 'major':
    next = `${maj + 1}.0.0`;
    break;
  case 'minor':
    next = pre && pat === 0 ? `${maj}.${min}.0` : `${maj}.${min + 1}.0`;
    break;
  case 'patch':
    next = pre ? `${maj}.${min}.${pat}` : `${maj}.${min}.${pat + 1}`;
    break;
  case 'prerelease': {
    const pm = pre ? new RegExp(`^${preid}\\.(\\d+)$`).exec(pre) : null;
    next = pm ? `${maj}.${min}.${pat}-${preid}.${Number(pm[1]) + 1}` : `${maj}.${min}.${pat + 1}-${preid}.0`;
    break;
  }
  default:
    next = SEMVER.test(bump) ? bump : die(`argumen tidak dikenal: ${bump} (auto|patch|minor|major|prerelease|X.Y.Z)`);
}
if (next === current) die(`versi baru sama dengan versi sekarang (${current})`);
if (git('tag', '--list', `v${next}`)) die(`tag v${next} sudah ada`);

// ---- CHANGELOG ----
const SECTIONS: [type: string, title: string][] = [
  ['feat', 'Fitur'],
  ['fix', 'Perbaikan'],
  ['perf', 'Performa'],
  ['security', 'Keamanan'],
  ['refactor', 'Refaktor'],
  ['docs', 'Dokumentasi'],
  ['build', 'Build & infrastruktur'],
  ['ci', 'Build & infrastruktur'],
  ['chore', 'Lain-lain'],
  ['test', 'Lain-lain'],
  ['style', 'Lain-lain'],
  ['other', 'Lain-lain'],
];
const today = new Date().toISOString().slice(0, 10);
const line = (c: (typeof log)[number]) => `- ${c.scope ? `**${c.scope}:** ` : ''}${c.text} (${c.hash})`;
const parts: string[] = [`## [${next}] — ${today}`];
const breaking = log.filter((c) => c.breaking);
if (breaking.length) parts.push('### ⚠ Breaking changes', breaking.map(line).join('\n'));
for (const title of [...new Set(SECTIONS.map((s) => s[1]))]) {
  const types = SECTIONS.filter((s) => s[1] === title).map((s) => s[0]);
  const items = log.filter((c) => (types.includes(c.type) || (title === 'Lain-lain' && !SECTIONS.some((s) => s[0] === c.type))) && !c.breaking);
  if (items.length) parts.push(`### ${title}`, items.map(line).join('\n'));
}
const entry = parts.join('\n\n') + '\n';

console.log(`→ ${current} → ${next}  (${bump}${lastTag ? `, sejak ${lastTag}` : ', rilis pertama'}, ${log.length} commit)\n`);
console.log(entry);
if (dry) {
  console.log('(dry-run: tidak ada yang diubah)');
  process.exit(0);
}

const clPath = join(ROOT, 'CHANGELOG.md');
const HEADER = '# Changelog\n\nSemua perubahan penting RAVE. Format: [Keep a Changelog](https://keepachangelog.com/id/1.1.0/), versi: [SemVer](https://semver.org/lang/id/).\n';
let cl = existsSync(clPath) ? readFileSync(clPath, 'utf8') : HEADER;
// Catatan manual di bawah "## [Unreleased]" ikut dipindahkan ke rilis ini.
const unrel = /## \[Unreleased\]\n([\s\S]*?)(?=\n## \[|$)/.exec(cl);
const manual = unrel?.[1].trim() ?? '';
const released = manual ? `${entry}\n### Catatan rilis\n\n${manual}\n` : entry;
cl = unrel ? cl.replace(unrel[0], `## [Unreleased]\n\n${released}`) : `${cl.trimEnd()}\n\n## [Unreleased]\n\n${released}`;
writeFileSync(clPath, cl);

// ---- Samakan versi semua workspace + lockfile ----
execFileSync('npm', ['version', next, '--no-git-tag-version', '--workspaces', '--include-workspace-root', '--allow-same-version'], {
  cwd: ROOT,
  stdio: 'inherit',
});

git('add', '-A', 'CHANGELOG.md', 'package.json', 'package-lock.json', 'packages', 'services', 'apps');
git('commit', '-m', `chore(release): v${next}`);
git('tag', '-a', `v${next}`, '-m', `RAVE v${next}`);
console.log(`\n✓ v${next} dibuat (commit + tag). Tinjau, lalu: git push --follow-tags`);
