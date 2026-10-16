// E2E pada stack terisolasi: database `gema_test` baru + semua service di port terpisah (+1000) + storage sementara.
// Data development (database `gema`, folder storage/) tidak disentuh — aman dijalankan saat aplikasi sedang dipakai.
//   npm run e2e:isolated            → reset gema_test, seed, jalankan service, e2e, matikan
//   KEEP=1 npm run e2e:isolated     → biarkan stack uji tetap jalan setelah e2e (untuk uji manual)
//   KEEP=1 SKIP_E2E=1 npm run e2e:isolated → hanya siapkan stack uji (gateway :9080)
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './services.js';

const OFFSET = Number(process.env.E2E_PORT_OFFSET ?? 1000);
const DB = process.env.E2E_DB ?? 'gema_test';
const PG = { host: '127.0.0.1', port: process.env.GEMA_PGPORT ?? '55432' };
const SERVICES = { iam: 4001, catalog: 4002, library: 4003, playback: 4004, booking: 4005, finance: 4006, ticketing: 4007, notification: 4008, platform: 4009, live: 4010, ads: 4011 };
const storage = join(tmpdir(), `gema-e2e-${process.pid}`);

const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: `postgres://gema:gema@${PG.host}:${PG.port}/${DB}`,
  GATEWAY_PORT: String(8080 + OFFSET),
  LIVE_RTMP_PORT: String(1935 + OFFSET),
  LIVE_RTMP_PUBLIC_URL: `rtmp://localhost:${1935 + OFFSET}/live`,
  UPLOAD_DIR: join(storage, 'uploads'),
  BACKUP_DIR: join(storage, 'backups'),
  BRANDING_DIR: join(storage, 'branding'),
  LIVE_DIR: join(storage, 'live'),
  LOG_LEVEL: 'warn',
  // Stack uji berbagi Postgres (max_connections 100) dengan stack dev yang sedang dipakai: pool kecil agar keduanya muat.
  DB_POOL_MAX: process.env.DB_POOL_MAX ?? '3',
};
for (const [name, port] of Object.entries(SERVICES)) {
  env[`${name.toUpperCase()}_PORT`] = String(port + OFFSET);
  env[`${name.toUpperCase()}_URL`] = `http://127.0.0.1:${port + OFFSET}`;
}
for (const d of ['uploads', 'backups', 'branding', 'live']) mkdirSync(join(storage, d), { recursive: true });

const psql = (sql: string) =>
  execFileSync('psql', ['-h', PG.host, '-p', PG.port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qc', sql], { stdio: 'pipe' });

function run(cmd: string, args: string[], opts: { detached?: boolean; quiet?: boolean } = {}): ChildProcess {
  return spawn(cmd, args, { cwd: ROOT, env, stdio: opts.quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit', detached: opts.detached });
}
const exited = (c: ChildProcess) => new Promise<number>((r) => c.on('exit', (code) => r(code ?? 1)));

async function waitHealthy(ms = 120_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${8080 + OFFSET}/v1/status`, { signal: AbortSignal.timeout(2000) });
      if ((await r.json()).ok) return;
    } catch {
      /* belum siap */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('stack uji tidak sehat dalam batas waktu');
}

console.log(`▶ reset database ${DB}`);
psql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
psql(`CREATE DATABASE ${DB} OWNER gema`);

console.log('▶ migrasi + seed');
if ((await exited(run('node', ['--import', 'tsx', 'scripts/seed-all.ts'], { quiet: true }))) !== 0) process.exit(1);

console.log(`▶ menjalankan service (gateway :${8080 + OFFSET})`);
const stack = run('node', ['--import', 'tsx', 'scripts/dev-services.ts'], { detached: true, quiet: true });
const stop = () => {
  try {
    process.kill(-stack.pid!, 'SIGTERM');
  } catch {
    /* sudah berhenti */
  }
};
process.on('SIGINT', () => (stop(), process.exit(130)));

let code = 1;
try {
  await waitHealthy();
  await new Promise((r) => setTimeout(r, 8000)); // kanal demo live & konsumen bus siap
  if (!process.env.SKIP_E2E) console.log('▶ e2e');
  Object.assign(env, { GATEWAY: `http://127.0.0.1:${8080 + OFFSET}`, LIVE_RTMP: `rtmp://127.0.0.1:${1935 + OFFSET}/live` });
  if (process.env.SKIP_E2E) code = 0;
  else code = await exited(run('node', ['--import', 'tsx', 'scripts/e2e.ts'], {}));
} finally {
  if (process.env.KEEP) console.log(`stack uji tetap berjalan (pgid ${stack.pid}); hentikan dengan: kill -- -${stack.pid}`);
  else {
    stop();
    await new Promise((r) => setTimeout(r, 3000));
    rmSync(storage, { recursive: true, force: true });
    // Database uji tidak dibiarkan menumpuk di cluster dev (dibuat ulang setiap run).
    try {
      psql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    } catch {
      /* sudah dihapus / koneksi masih ditutup — dibersihkan di awal run berikutnya */
    }
  }
}
process.exit(code);
