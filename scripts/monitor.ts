// Pemantauan uptime + alert disk/database RAVE (BRD §15.1 "Monitoring uptime dan alert disk/database aktif").
//
//   npm run monitor                         # sekali jalan terhadap stack dev (./rave start)
//   npm run monitor:prod                    # sekali jalan terhadap stack produksi lokal (docker-compose.prod.yml)
//   npm run monitor -- --watch 60           # ulang tiap 60 dtk (systemd/tmux); alert hanya saat status berubah
//   npm run monitor -- --json               # keluaran JSON (untuk dashboard / pengumpul log)
//   npm run monitor -- --test-alert         # kirim pesan uji ke ALERT_WEBHOOK_URL lalu keluar
//
// Kode keluar: 0 = OK/WARN, 1 = WARN dengan --strict, 2 = CRITICAL (cocok untuk cron, systemd OnFailure, Nagios).
// Ambang & tujuan alert lewat env — lihat docs/OPERATIONS.md §2. Tidak pernah mencetak secret dari .env.production.
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------- Argumen & konfigurasi ----------------
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
if (flag('--help') || flag('-h')) {
  console.log(`Pakai: node --import tsx scripts/monitor.ts [--prod] [--target URL] [--watch DETIK] [--json] [--strict] [--test-alert]
Env ambang: MONITOR_LATENCY_WARN_MS (800) MONITOR_LATENCY_CRIT_MS (3000) MONITOR_DISK_WARN_PCT (20) MONITOR_DISK_CRIT_PCT (10)
            MONITOR_PG_CONN_WARN_PCT (70) MONITOR_PG_CONN_CRIT_PCT (90) MONITOR_BACKUP_WARN_HOURS (26) MONITOR_BACKUP_CRIT_HOURS (50, 0 = matikan)
            MONITOR_OUTBOX_WARN_SEC (120) MONITOR_OUTBOX_CRIT_SEC (900) MONITOR_TX_WARN_SEC (300)
Env alert:  ALERT_WEBHOOK_URL ALERT_MIN_LEVEL (WARN|CRITICAL, default WARN) ALERT_REPEAT_MIN (60) MONITOR_STATE_FILE
Env lain:   MONITOR_TARGET MONITOR_DATABASE_URL MONITOR_ENV_FILE MONITOR_STORAGE_DIR MONITOR_BACKUP_DIR MONITOR_PGDATA_DIR`);
  process.exit(0);
}

const PROD = flag('--prod') || process.env.MONITOR_ENV === 'prod';
const ENV_NAME = PROD ? 'prod' : 'dev';
const ENV_FILE = resolve(ROOT, process.env.MONITOR_ENV_FILE ?? (PROD ? '.env.production' : '.env'));
/** Isi file env dibaca ke objek (BUKAN ke process.env, dan tidak pernah dicetak). */
const fileEnv: Record<string, string> = existsSync(ENV_FILE) ? (parseEnv(readFileSync(ENV_FILE, 'utf8')) as Record<string, string>) : {};
const envv = (k: string) => process.env[k] ?? fileEnv[k];
const num = (k: string, d: number) => {
  const v = process.env[k];
  return v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d;
};

function defaultTarget(): string {
  if (PROD) {
    const bind = fileEnv.WEB_BIND || '80';
    return bind.includes(':') ? `http://${bind}` : `http://127.0.0.1:${bind}`;
  }
  return `http://127.0.0.1:${fileEnv.GATEWAY_PORT || '8080'}`;
}
const TARGET = (opt('--target') ?? process.env.MONITOR_TARGET ?? defaultTarget()).replace(/\/$/, '');

function defaultDbUrl(): string | null {
  if (process.env.MONITOR_DATABASE_URL) return process.env.MONITOR_DATABASE_URL;
  if (PROD) {
    // DB terkelola (DATABASE_URL di .env.production) dipakai apa adanya; kalau tidak, Postgres container lewat port host.
    if (fileEnv.DATABASE_URL) return fileEnv.DATABASE_URL;
    if (!fileEnv.POSTGRES_PASSWORD) return null;
    return `postgres://rave:${encodeURIComponent(fileEnv.POSTGRES_PASSWORD)}@127.0.0.1:${fileEnv.PROD_PG_PORT || '5432'}/rave`;
  }
  return fileEnv.DATABASE_URL ?? 'postgres://rave:rave@127.0.0.1:55432/rave';
}

const T = {
  latWarn: num('MONITOR_LATENCY_WARN_MS', 800),
  latCrit: num('MONITOR_LATENCY_CRIT_MS', 3000),
  diskWarn: num('MONITOR_DISK_WARN_PCT', 20),
  diskCrit: num('MONITOR_DISK_CRIT_PCT', 10),
  connWarn: num('MONITOR_PG_CONN_WARN_PCT', 70),
  connCrit: num('MONITOR_PG_CONN_CRIT_PCT', 90),
  backupWarnH: num('MONITOR_BACKUP_WARN_HOURS', 26),
  backupCritH: num('MONITOR_BACKUP_CRIT_HOURS', 50),
  outboxWarn: num('MONITOR_OUTBOX_WARN_SEC', 120),
  outboxCrit: num('MONITOR_OUTBOX_CRIT_SEC', 900),
  txWarn: num('MONITOR_TX_WARN_SEC', 300),
};

// ---------------- Model hasil ----------------
type Level = 'OK' | 'WARN' | 'CRITICAL' | 'SKIP';
interface Check {
  name: string;
  level: Level;
  detail: string;
  value?: number | string | null;
}
const RANK: Record<Level, number> = { SKIP: 0, OK: 0, WARN: 1, CRITICAL: 2 };
const worst = (cs: Check[]): Level => cs.reduce<Level>((w, c) => (RANK[c.level] > RANK[w] ? c.level : w), 'OK');
const byThreshold = (v: number, warn: number, crit: number, higherIsWorse = true): Level =>
  higherIsWorse ? (v >= crit ? 'CRITICAL' : v >= warn ? 'WARN' : 'OK') : v <= crit ? 'CRITICAL' : v <= warn ? 'WARN' : 'OK';

const fmtBytes = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`);

// ---------------- HTTP (uptime) ----------------
async function timed(path: string, timeoutMs = 10_000) {
  const t = performance.now();
  try {
    const r = await fetch(TARGET + path, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'rave-monitor' } });
    const text = await r.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: r.status, ms: Math.round(performance.now() - t), body, error: null as string | null };
  } catch (e: any) {
    return { status: 0, ms: Math.round(performance.now() - t), body: null, error: e?.cause?.code ?? e?.name ?? String(e) };
  }
}

async function httpChecks(): Promise<Check[]> {
  const out: Check[] = [];
  const h = await timed('/healthz');
  // Di belakang nginx (prod) /healthz milik web; gateway sehat dibuktikan /v1/status di bawah.
  if (h.status === 200) {
    out.push({ name: 'http.healthz', level: byThreshold(h.ms, T.latWarn, T.latCrit), detail: `200 dalam ${h.ms} ms`, value: h.ms });
  } else {
    out.push({ name: 'http.healthz', level: 'CRITICAL', detail: h.error ? `tidak terjangkau (${h.error})` : `HTTP ${h.status}`, value: h.ms });
  }

  const s = await timed('/v1/status');
  if (s.status !== 200 || typeof s.body !== 'object' || !s.body) {
    out.push({ name: 'http.status', level: 'CRITICAL', detail: s.error ? `tidak terjangkau (${s.error})` : `HTTP ${s.status}`, value: s.ms });
    return out;
  }
  const st = s.body as { ok: boolean; version: string; version_drift?: string[]; services: { service: string; ok: boolean; ms: number; version: string | null }[] };
  const down = st.services.filter((x) => !x.ok).map((x) => x.service);
  out.push({
    name: 'http.status',
    level: !st.ok ? 'CRITICAL' : byThreshold(s.ms, T.latWarn, T.latCrit),
    detail: st.ok ? `ok, versi ${st.version}, ${st.services.length} service, ${s.ms} ms` : `ok=false — service down: ${down.join(', ') || '?'}`,
    value: s.ms,
  });
  out.push({
    name: 'version.drift',
    level: st.version_drift?.length ? 'WARN' : 'OK',
    detail: st.version_drift?.length ? `versi berbeda dari gateway ${st.version}: ${st.version_drift.join(', ')}` : `seragam ${st.version}`,
  });
  for (const x of st.services) {
    out.push({
      name: `svc.${x.service}`,
      level: !x.ok ? 'CRITICAL' : byThreshold(x.ms, T.latWarn, T.latCrit),
      detail: x.ok ? `readyz ${x.ms} ms` : `readyz gagal (${x.ms} ms)`,
      value: x.ms,
    });
  }
  if (PROD) {
    const w = await timed('/');
    out.push({ name: 'http.web', level: w.status === 200 ? 'OK' : 'CRITICAL', detail: w.status === 200 ? `index.html ${w.ms} ms` : w.error ?? `HTTP ${w.status}`, value: w.ms });
  }
  return out;
}

// ---------------- Postgres ----------------
interface DbFacts {
  dataDir: string | null;
  lastBackupDb: Date | null;
}
async function dbChecks(facts: DbFacts): Promise<Check[]> {
  const url = defaultDbUrl();
  if (!url) return [{ name: 'pg.connect', level: 'SKIP', detail: `DATABASE_URL/POSTGRES_PASSWORD tidak ada di ${ENV_FILE}` }];
  const out: Check[] = [];
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000, statement_timeout: 5000, application_name: 'rave-monitor' });
  const t = performance.now();
  try {
    await c.connect();
    await c.query('SELECT 1');
  } catch (e: any) {
    await c.end().catch(() => {});
    // Pesan galat pg bisa memuat host/user tetapi tidak memuat password.
    return [{ name: 'pg.connect', level: 'CRITICAL', detail: `gagal terhubung: ${e?.code ?? ''} ${e?.message ?? e}`.trim() }];
  }
  const ms = Math.round(performance.now() - t);
  out.push({ name: 'pg.connect', level: byThreshold(ms, T.latWarn, T.latCrit), detail: `terhubung dalam ${ms} ms`, value: ms });
  const q = async <R = any>(sql: string): Promise<R[] | null> => {
    try {
      return (await c.query(sql)).rows as R[];
    } catch {
      return null;
    }
  };
  try {
    const conn = await q<{ n: number; max: number; reserved: number }>(
      `SELECT (SELECT count(*)::int FROM pg_stat_activity) AS n, current_setting('max_connections')::int AS max,
              current_setting('superuser_reserved_connections')::int AS reserved`,
    );
    if (conn?.[0]) {
      const { n, max } = conn[0];
      const pct = Math.round((n / max) * 100);
      out.push({ name: 'pg.connections', level: byThreshold(pct, T.connWarn, T.connCrit), detail: `${n}/${max} koneksi (${pct}%)`, value: pct });
    }
    const size = await q<{ b: string }>(`SELECT pg_database_size(current_database())::text AS b`);
    if (size?.[0]) out.push({ name: 'pg.size', level: 'OK', detail: `database ${fmtBytes(Number(size[0].b))}`, value: Number(size[0].b) });

    // Transaksi menggantung (idle in transaction / query panjang) menahan lock & vacuum.
    const tx = await q<{ age: number; state: string; app: string }>(
      `SELECT extract(epoch FROM now() - xact_start)::int AS age, state, application_name AS app FROM pg_stat_activity
        WHERE xact_start IS NOT NULL AND pid <> pg_backend_pid() AND backend_type = 'client backend' ORDER BY xact_start LIMIT 1`,
    );
    const oldest = tx?.[0];
    out.push({
      name: 'pg.long_tx',
      level: oldest && oldest.age >= T.txWarn ? 'WARN' : 'OK',
      detail: oldest ? `transaksi tertua ${oldest.age} dtk (${oldest.state}${oldest.app ? ', ' + oldest.app : ''})` : 'tidak ada transaksi terbuka',
      value: oldest?.age ?? 0,
    });

    // Outbox per schema: event yang belum terbit = konsumen/publisher macet (pembayaran tiket tidak menjadi PAID, dsb.).
    const outboxes = await q<{ s: string }>(`SELECT table_schema AS s FROM information_schema.tables WHERE table_name = 'outbox' AND table_type = 'BASE TABLE'`);
    if (outboxes?.length) {
      const parts = outboxes.map((o) => `SELECT '${o.s.replace(/'/g, "''")}' AS s, count(*)::int AS n, coalesce(extract(epoch FROM now() - min(occurred_at)),0)::int AS age FROM "${o.s.replace(/"/g, '""')}".outbox WHERE published_at IS NULL`);
      const rows = await q<{ s: string; n: number; age: number }>(parts.join(' UNION ALL '));
      if (rows) {
        const lag = rows.filter((r) => r.n > 0).sort((a, b) => b.age - a.age);
        const age = lag[0]?.age ?? 0;
        out.push({
          name: 'bus.outbox',
          level: byThreshold(age, T.outboxWarn, T.outboxCrit),
          detail: lag.length ? `belum terbit: ${lag.map((r) => `${r.s}=${r.n} (${r.age} dtk)`).join(', ')}` : `kosong (${rows.length} schema)`,
          value: age,
        });
      }
    }
    const dl = await q<{ n: number; recent: number }>(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE failed_at > now() - interval '24 hours')::int AS recent FROM bus.dead_letters WHERE retry_requested_at IS NULL`,
    );
    if (dl?.[0]) {
      out.push({
        name: 'bus.dead_letters',
        level: dl[0].recent > 0 ? 'WARN' : 'OK',
        detail: dl[0].n ? `${dl[0].n} dead letter (${dl[0].recent} dalam 24 jam) — tinjau di Super Admin` : 'kosong',
        value: dl[0].n,
      });
    }

    const dd = await q<{ d: string }>(`SHOW data_directory`); // hanya superuser / pg_read_all_settings
    facts.dataDir = dd?.[0]?.d ?? null;
    const b = await q<{ t: Date | null }>(`SELECT max(finished_at) AS t FROM platform.backups WHERE status = 'COMPLETED'`);
    facts.lastBackupDb = b?.[0]?.t ?? null;
  } finally {
    await c.end().catch(() => {});
  }
  return out;
}

// ---------------- Disk & backup ----------------
function diskCheck(name: string, path: string, availBytes: number, totalBytes: number): Check {
  if (!totalBytes) return { name, level: 'SKIP', detail: `${path}: ukuran tidak diketahui` };
  const freePct = Math.round((availBytes / totalBytes) * 1000) / 10;
  return {
    name,
    level: byThreshold(freePct, T.diskWarn, T.diskCrit, false),
    detail: `${path}: bebas ${freePct}% (${fmtBytes(availBytes)} dari ${fmtBytes(totalBytes)})`,
    value: freePct,
  };
}
function localDisk(name: string, path: string | null): Check {
  if (!path) return { name, level: 'SKIP', detail: 'path tidak diketahui' };
  try {
    const s = statfsSync(path);
    return diskCheck(name, path, s.bavail * s.bsize, s.blocks * s.bsize);
  } catch (e: any) {
    return { name, level: 'WARN', detail: `${path}: ${e?.code ?? e}` };
  }
}

const BACKUP_RE = /\.(sql\.gz|sql|dump|backup|tar\.gz)$/;
function newestLocalBackup(dir: string): { file: string; at: Date } | null {
  if (!existsSync(dir)) return null;
  let best: { file: string; at: Date } | null = null;
  for (const f of readdirSync(dir)) {
    if (!BACKUP_RE.test(f)) continue;
    try {
      const m = statSync(join(dir, f));
      if (m.isFile() && m.size > 0 && (!best || m.mtime > best.at)) best = { file: f, at: m.mtime };
    } catch {
      /* berkas hilang saat dibaca */
    }
  }
  return best;
}

function backupCheck(fileNewest: { file: string; at: Date } | null, dbNewest: Date | null, where: string): Check {
  if (T.backupCritH <= 0) return { name: 'backup.age', level: 'SKIP', detail: 'dimatikan (MONITOR_BACKUP_CRIT_HOURS=0)' };
  const candidates = [fileNewest?.at, dbNewest].filter((d): d is Date => !!d);
  if (!candidates.length) return { name: 'backup.age', level: 'CRITICAL', detail: `belum ada backup (${where} kosong, platform.backups tanpa COMPLETED)` };
  const at = new Date(Math.max(...candidates.map((d) => d.getTime())));
  const h = Math.round(((Date.now() - at.getTime()) / 3_600_000) * 10) / 10;
  const src = fileNewest && fileNewest.at.getTime() === at.getTime() ? fileNewest.file : 'platform.backups';
  return { name: 'backup.age', level: byThreshold(h, T.backupWarnH, T.backupCritH), detail: `terbaru ${h} jam lalu (${src}, ${at.toISOString()})`, value: h };
}

function sh(cmd: string, args: string[], timeoutMs = 20_000): Promise<string> {
  return new Promise((res, rej) =>
    execFile(cmd, args, { cwd: ROOT, timeout: timeoutMs, maxBuffer: 1 << 20 }, (err, stdout, stderr) =>
      err ? rej(new Error((stderr || err.message).trim().split('\n').slice(-1)[0])) : res(stdout),
    ),
  );
}
const dc = (args: string[]) => sh('docker', ['compose', '-f', 'docker-compose.prod.yml', '--env-file', relEnvFile(), ...args]);
const relEnvFile = () => (ENV_FILE.startsWith(ROOT + '/') ? ENV_FILE.slice(ROOT.length + 1) : ENV_FILE);

/** Skrip yang dijalankan `node -e` DI DALAM container platform: statfs volume storage + backup terbaru. */
const IN_CONTAINER = `
const fs=require('fs'),p=require('path');const dir=process.env.BACKUP_DIR||'/data/backups';const root=p.dirname(dir);
const s=fs.statfsSync(root);let best=null;
try{for(const f of fs.readdirSync(dir)){if(!/${BACKUP_RE.source}/.test(f))continue;const m=fs.statSync(p.join(dir,f));if(m.size>0&&(!best||m.mtimeMs>best.t))best={f,t:m.mtimeMs};}}catch{}
console.log(JSON.stringify({root,dir,avail:s.bavail*s.bsize,total:s.blocks*s.bsize,best}));`.replace(/\n/g, '');

async function diskChecksProd(facts: DbFacts): Promise<Check[]> {
  const out: Check[] = [];
  let fileNewest: { file: string; at: Date } | null = null;
  let where = 'volume storage';
  try {
    const j = JSON.parse((await dc(['exec', '-T', 'platform', 'node', '-e', IN_CONTAINER])).trim().split('\n').pop()!);
    out.push(diskCheck('disk.storage', `${j.root} (volume rave_storage)`, j.avail, j.total));
    where = j.dir;
    if (j.best) fileNewest = { file: j.best.f, at: new Date(j.best.t) };
  } catch (e: any) {
    out.push({ name: 'disk.storage', level: 'CRITICAL', detail: `docker compose exec platform gagal: ${e?.message ?? e}` });
  }
  try {
    const df = (await dc(['exec', '-T', 'postgres', 'df', '-Pk', '/var/lib/postgresql/data'])).trim().split('\n').pop()!.split(/\s+/);
    // Filesystem 1024-blocks Used Available Capacity Mounted
    out.push(diskCheck('disk.pgdata', '/var/lib/postgresql/data (volume rave_pgdata)', Number(df[3]) * 1024, Number(df[1]) * 1024));
  } catch (e: any) {
    // DB terkelola (DATABASE_URL eksternal): tidak ada container postgres → pantau disk dari konsol penyedia.
    out.push({ name: 'disk.pgdata', level: fileEnv.DATABASE_URL ? 'SKIP' : 'CRITICAL', detail: `docker compose exec postgres gagal: ${e?.message ?? e}` });
  }
  out.push(backupCheck(fileNewest, facts.lastBackupDb, where));
  return out;
}

function diskChecksDev(facts: DbFacts): Check[] {
  const storage = process.env.MONITOR_STORAGE_DIR ?? envv('UPLOAD_DIR')?.replace(/\/uploads\/?$/, '') ?? join(ROOT, 'storage');
  const backupDir = process.env.MONITOR_BACKUP_DIR ?? envv('BACKUP_DIR') ?? join(ROOT, 'storage', 'backups');
  const pgdata = process.env.MONITOR_PGDATA_DIR ?? facts.dataDir ?? envv('RAVE_PGDATA') ?? join(homedir(), '.rave', 'pgdata');
  return [
    localDisk('disk.storage', existsSync(storage) ? storage : null),
    localDisk('disk.pgdata', existsSync(pgdata) ? pgdata : null),
    backupCheck(newestLocalBackup(backupDir), facts.lastBackupDb, backupDir),
  ];
}

// ---------------- Satu putaran ----------------
interface Report {
  env: string;
  target: string;
  host: string;
  at: string;
  level: Level;
  ms: number;
  checks: Check[];
}
async function runOnce(): Promise<Report> {
  const t = performance.now();
  const facts: DbFacts = { dataDir: null, lastBackupDb: null };
  const [http, db] = await Promise.all([httpChecks(), dbChecks(facts)]);
  const disk = PROD && !process.env.MONITOR_STORAGE_DIR ? await diskChecksProd(facts) : diskChecksDev(facts);
  const checks = [...http, ...db, ...disk];
  return { env: ENV_NAME, target: TARGET, host: hostname(), at: new Date().toISOString(), level: worst(checks), ms: Math.round(performance.now() - t), checks };
}

const COLOR: Record<Level, string> = { OK: '\x1b[32m', WARN: '\x1b[33m', CRITICAL: '\x1b[31m', SKIP: '\x1b[90m' };
function printReport(r: Report) {
  const tty = process.stdout.isTTY;
  const paint = (l: Level, s: string) => (tty ? `${COLOR[l]}${s}\x1b[0m` : s);
  console.log(`RAVE monitor [${r.env}] ${r.target} — ${r.at} (${r.ms} ms)`);
  for (const c of r.checks) console.log(`  ${paint(c.level, c.level.padEnd(8))} ${c.name.padEnd(18)} ${c.detail}`);
  console.log(`  → status keseluruhan: ${paint(r.level, r.level)}`);
}

// ---------------- Alert (webhook generik; kompatibel Slack `text` & Discord `content`) ----------------
interface AlertState {
  level: Level;
  sentAt: number;
  sentLevel: Level | null;
  keys: string;
}
const STATE_FILE = process.env.MONITOR_STATE_FILE ?? join(tmpdir(), `rave-monitor-${ENV_NAME}.json`);
const MIN_LEVEL: Level = (process.env.ALERT_MIN_LEVEL ?? 'WARN').toUpperCase() === 'CRITICAL' ? 'CRITICAL' : 'WARN';
const REPEAT_MS = num('ALERT_REPEAT_MIN', 60) * 60_000;
let memState: AlertState | null = null;

function loadState(): AlertState {
  if (memState) return memState;
  try {
    return (memState = JSON.parse(readFileSync(STATE_FILE, 'utf8')));
  } catch {
    return (memState = { level: 'OK', sentAt: 0, sentLevel: null, keys: '' });
  }
}
function saveState(s: AlertState) {
  memState = s;
  try {
    writeFileSync(STATE_FILE, JSON.stringify(s), { mode: 0o600 });
  } catch {
    /* state hanya untuk dedup alert */
  }
}

async function postWebhook(text: string, r: Report | null) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return false;
  const payload = {
    text,
    content: text.slice(0, 1900), // Discord
    source: 'rave-monitor',
    ...(r ? { env: r.env, level: r.level, target: r.target, host: r.host, at: r.at, checks: r.checks.filter((c) => c.level === 'WARN' || c.level === 'CRITICAL') } : {}),
  };
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) console.error(`! webhook alert HTTP ${res.status}`);
    return res.ok;
  } catch (e: any) {
    console.error(`! webhook alert gagal: ${e?.cause?.code ?? e?.message ?? e}`);
    return false;
  }
}

function alertText(r: Report, recovered: boolean) {
  const icon = recovered ? '✅' : r.level === 'CRITICAL' ? '🔴' : '🟠';
  const bad = r.checks.filter((c) => c.level === 'WARN' || c.level === 'CRITICAL');
  const head = recovered ? `${icon} RAVE ${r.env} pulih — semua pemeriksaan OK` : `${icon} RAVE ${r.env} ${r.level}`;
  return [head + ` (${r.target}, ${r.host})`, ...bad.map((c) => `• [${c.level}] ${c.name}: ${c.detail}`)].join('\n');
}

/** Kirim saat level/daftar masalah berubah, saat pulih, atau pengingat tiap ALERT_REPEAT_MIN selama masih bermasalah. */
async function maybeAlert(r: Report) {
  const st = loadState();
  const keys = r.checks
    .filter((c) => RANK[c.level] >= RANK[MIN_LEVEL])
    .map((c) => `${c.name}:${c.level}`)
    .sort()
    .join(',');
  const alerting = RANK[r.level] >= RANK[MIN_LEVEL];
  const wasAlerting = st.sentLevel !== null && RANK[st.sentLevel] >= RANK[MIN_LEVEL];
  let send: 'problem' | 'recovered' | null = null;
  if (alerting && (keys !== st.keys || !wasAlerting || Date.now() - st.sentAt >= REPEAT_MS)) send = 'problem';
  else if (!alerting && wasAlerting) send = 'recovered';
  if (send && process.env.ALERT_WEBHOOK_URL) {
    const ok = await postWebhook(alertText(r, send === 'recovered'), r);
    if (ok) {
      saveState({ level: r.level, sentAt: Date.now(), sentLevel: send === 'recovered' ? null : r.level, keys: send === 'recovered' ? '' : keys });
      if (!flag('--json')) console.log(`  → alert ${send === 'recovered' ? 'pemulihan' : r.level} terkirim ke ALERT_WEBHOOK_URL`);
      return;
    }
  }
  saveState({ ...st, level: r.level });
}

// ---------------- Main ----------------
if (flag('--test-alert')) {
  if (!process.env.ALERT_WEBHOOK_URL) {
    console.error('✗ ALERT_WEBHOOK_URL belum di-set');
    process.exit(1);
  }
  const ok = await postWebhook(`🧪 RAVE monitor [${ENV_NAME}] uji alert dari ${hostname()} — webhook berfungsi.`, null);
  console.log(ok ? '✓ pesan uji terkirim' : '✗ pesan uji gagal');
  process.exit(ok ? 0 : 1);
}

const exitCode = (l: Level) => (l === 'CRITICAL' ? 2 : l === 'WARN' && flag('--strict') ? 1 : 0);
const watchSec = Number(opt('--watch') ?? 0);

async function tick() {
  let r: Report;
  try {
    r = await runOnce();
  } catch (e: any) {
    r = { env: ENV_NAME, target: TARGET, host: hostname(), at: new Date().toISOString(), level: 'CRITICAL', ms: 0, checks: [{ name: 'monitor', level: 'CRITICAL', detail: `monitor gagal: ${e?.message ?? e}` }] };
  }
  if (flag('--json')) console.log(JSON.stringify(r));
  else printReport(r);
  await maybeAlert(r);
  return r;
}

if (watchSec > 0) {
  let stop = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => (stop = true));
  while (!stop) {
    await tick();
    for (let i = 0; i < watchSec * 10 && !stop; i++) await new Promise((res) => setTimeout(res, 100));
  }
  process.exit(0);
} else {
  const r = await tick();
  process.exit(exitCode(r.level));
}
