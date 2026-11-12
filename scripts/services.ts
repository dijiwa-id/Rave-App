import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Urutan seed penting: IAM (user/org) → katalog → turunan. */
export const SERVICES = ['platform', 'iam', 'catalog', 'library', 'playback', 'booking', 'finance', 'ticketing', 'notification', 'live', 'ads'] as const;

const COLORS = [36, 35, 33, 32, 34, 91, 92, 93, 94, 95];

export function available(): string[] {
  return SERVICES.filter((s) => existsSync(join(ROOT, 'services', s, 'src', 'index.ts')));
}

/** Jalankan perintah tsx pada service; log JSON pino diringkas jadi satu baris berwarna. */
export function run(name: string, args: string[] = [], idx = 0, opts: { group?: boolean } = {}): ChildProcess {
  const cwd = name === 'web' ? join(ROOT, 'apps', 'web') : join(ROOT, 'services', name);
  const cmd = name === 'web' ? ['vite'] : ['tsx', 'src/index.ts', ...args];
  // group: proses grup sendiri (npx → sh → tsx → node) agar killTree bisa menghentikan seluruh pohon sekaligus —
  // SIGTERM ke npx saja meninggalkan node cucu yang masih memegang port.
  const child = spawn('npx', cmd, { cwd, env: { ...process.env, FORCE_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: !!opts.group });
  const tag = `\x1b[${COLORS[idx % COLORS.length]}m${name.padEnd(12)}\x1b[0m`;
  const out = (buf: Buffer) => {
    for (const line of buf.toString().split('\n')) {
      if (!line.trim() || line.includes('globalignorefile')) continue;
      let text = line;
      try {
        const j = JSON.parse(line);
        if (j.msg === 'incoming request' || j.msg === 'request completed') {
          if (j.res?.statusCode < 400 || j.msg === 'incoming request') continue;
          text = `${j.res?.statusCode} ${j.reqId}`;
        } else {
          const lvl = j.level >= 50 ? '\x1b[31mERR\x1b[0m ' : j.level >= 40 ? '\x1b[33mWRN\x1b[0m ' : '';
          text = lvl + j.msg + (j.err ? ` — ${typeof j.err === 'string' ? j.err : (j.err.message ?? JSON.stringify(j.err))}` : '');
        }
      } catch {
        /* bukan JSON */
      }
      process.stdout.write(`${tag} ${text}\n`);
    }
  };
  child.stdout!.on('data', out);
  child.stderr!.on('data', out);
  return child;
}

export function waitExit(c: ChildProcess): Promise<number> {
  return new Promise((r) => c.on('exit', (code) => r(code ?? 0)));
}

/** Hentikan seluruh pohon proses milik child yang dijalankan dengan `run(..., { group: true })`. */
export function killTree(c: ChildProcess, sig: NodeJS.Signals = 'SIGTERM') {
  if (!c.pid) return;
  try {
    process.kill(-c.pid, sig);
  } catch {
    try {
      c.kill(sig);
    } catch {
      /* sudah berhenti */
    }
  }
}
