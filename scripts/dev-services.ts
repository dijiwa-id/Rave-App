// Jalankan semua microservice + gateway (opsional: + web dengan argumen "web").
//
// Auto-restart (RAVE_WATCH=1, default dari `./rave start|dev`): perubahan di services/<nama>/src me-restart service itu;
// perubahan di packages/*/src me-restart semua service. Memakai polling mtime (bukan inotify) karena proyek di /mnt/*
// (drvfs WSL) tidak mengirim event file — interval diatur RAVE_WATCH_INTERVAL (ms, default 1500).
import type { ChildProcess } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { available, killTree, ROOT, run, waitExit } from './services.js';

const withWeb = process.argv.includes('web');
const watch = process.env.RAVE_WATCH === '1';
const interval = Math.max(500, Number(process.env.RAVE_WATCH_INTERVAL) || 1500);

const backend = [...available(), 'gateway'];
const procs = new Map<string, { child: ChildProcess; idx: number }>();
let stopping = false;

const start = (s: string, idx: number) => run(s, [], idx, { group: true });
backend.forEach((s, i) => procs.set(s, { child: start(s, i), idx: i }));
if (withWeb) procs.set('web', { child: start('web', backend.length), idx: backend.length });

const stop = () => {
  stopping = true;
  for (const { child } of procs.values()) killTree(child);
  setTimeout(() => {
    for (const { child } of procs.values()) killTree(child, 'SIGKILL');
    process.exit(0);
  }, 3000);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGHUP', stop);
// Proses induk keluar karena galat → jangan tinggalkan service yatim (grup terpisah tidak ikut mati otomatis).
process.on('exit', () => {
  for (const { child } of procs.values()) killTree(child, 'SIGKILL');
});

if (watch) {
  /** Sidik jari direktori: jumlah file + mtime terbaru (.ts/.json/.sql, tanpa test). */
  const fingerprint = (dir: string): string => {
    let n = 0;
    let max = 0;
    const walk = (d: string) => {
      let entries;
      try {
        entries = readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|json|sql)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
          n++;
          try {
            max = Math.max(max, statSync(p).mtimeMs);
          } catch {
            /* file baru saja dihapus */
          }
        }
      }
    };
    walk(dir);
    return `${n}:${max}`;
  };
  const pkgDirs = (() => {
    try {
      return readdirSync(join(ROOT, 'packages')).map((p) => join(ROOT, 'packages', p, 'src'));
    } catch {
      return [];
    }
  })();
  const svcDir = (s: string) => join(ROOT, 'services', s, 'src');
  const svcMigrations = (s: string) => join(ROOT, 'services', s, 'migrations');
  const snap = () => ({
    pkg: pkgDirs.map(fingerprint).join('|'),
    svc: Object.fromEntries(backend.map((s) => [s, fingerprint(svcDir(s)) + '|' + fingerprint(svcMigrations(s))])) as Record<string, string>,
  });

  const restart = async (s: string) => {
    const p = procs.get(s);
    if (!p || stopping) return;
    process.stdout.write(`\x1b[2m↻ ${s} — perubahan terdeteksi, restart\x1b[0m\n`);
    if (p.child.exitCode === null && p.child.signalCode === null) {
      const exited = waitExit(p.child);
      killTree(p.child);
      const t = setTimeout(() => killTree(p.child, 'SIGKILL'), 5000);
      await exited;
      clearTimeout(t);
    }
    await new Promise((r) => setTimeout(r, 500)); // beri waktu socket lama tertutup sebelum bind ulang
    if (!stopping) procs.set(s, { child: start(s, p.idx), idx: p.idx });
  };

  let prev = snap();
  let busy = false;
  setInterval(async () => {
    if (busy || stopping) return;
    busy = true;
    try {
      let cur = snap();
      if (cur.pkg === prev.pkg && backend.every((s) => cur.svc[s] === prev.svc[s])) return;
      // Tunggu editor selesai menulis (simpan beruntun / format-on-save) sebelum restart.
      await new Promise((r) => setTimeout(r, 400));
      cur = snap();
      const targets = cur.pkg !== prev.pkg ? backend : backend.filter((s) => cur.svc[s] !== prev.svc[s]);
      prev = cur;
      await Promise.all(targets.map(restart));
    } finally {
      busy = false;
    }
  }, interval);
  process.stdout.write(`\x1b[2m● auto-restart service aktif (polling ${interval} ms) — matikan dengan RAVE_WATCH=0\x1b[0m\n`);
}
