import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readdirSync } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createGzip } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { audit, config, conflict, idempotent, notFound, requireSuperAdmin, settings, uuidv7, z, type Db, type ServiceContext } from '@rave/service-kit';
import { BUCKETS, filePath, invalidateBucket } from './storage.js';

const GB = 1024 ** 3;
/** Batas waktu pg_dump; lewat dari ini proses dibunuh dan backup FAILED. */
const BACKUP_TIMEOUT_MS = 30 * 60_000;
const STDERR_MAX = 8000;
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** pg_dump harus ≥ versi server: pakai yang terbaru di /usr/lib/postgresql (sama dengan scripts/dev-db.sh). */
function pgDumpBin(): string {
  if (process.env.PG_DUMP) return process.env.PG_DUMP;
  const base = '/usr/lib/postgresql';
  if (existsSync(base)) {
    const v = readdirSync(base)
      .filter((d) => existsSync(join(base, d, 'bin', 'pg_dump')))
      .sort((a, b) => Number(a) - Number(b))
      .pop();
    if (v) return join(base, v, 'bin', 'pg_dump');
  }
  return 'pg_dump';
}

const running = new Set<string>();

function backupOut(r: any) {
  return {
    id: r.id,
    filename: r.filename,
    status: r.status,
    size_bytes: r.size_bytes,
    sha256: r.sha256,
    trigger: r.trigger,
    note: r.note,
    error: r.error,
    started_at: r.started_at,
    finished_at: r.finished_at,
    created_by: r.created_by,
  };
}

async function insertBackup(q: { query: (s: string, p?: unknown[]) => Promise<any> }, trigger: 'manual' | 'schedule', note: string | null, by: string | null) {
  const id = uuidv7();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const filename = `rave-${stamp}-${id.slice(-8)}.sql.gz`;
  const r = await q.query(`INSERT INTO backups (id, filename, status, trigger, note, created_by) VALUES ($1,$2,'RUNNING',$3,$4,$5) RETURNING *`, [id, filename, trigger, note, by]);
  return (Array.isArray(r) ? r[0] : r.rows[0]) as any;
}

/** pg_dump → gzip → bucket backups, dengan sha256 dihitung saat streaming. */
async function runBackup(db: Db, id: string, log: ServiceContext['log']) {
  if (running.has(id)) return;
  running.add(id);
  let out: string | null = null;
  let killer: NodeJS.Timeout | null = null;
  try {
    const b = await db.one(`SELECT * FROM backups WHERE id = $1`, [id]);
    if (!b) throw new Error('Baris backup tidak ditemukan');
    out = join(BUCKETS.backups.path, b.filename);
    const child = spawn(pgDumpBin(), ['--dbname', config.databaseUrl, '--no-owner', '--no-privileges', '--format=plain'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr = (stderr + d.toString()).slice(-STDERR_MAX)));
    const exited = new Promise<number>((res, rej) => {
      child.on('error', rej);
      child.on('exit', (code) => res(code ?? 1));
    });
    // Tangkap sekarang: bila pg_dump tidak ada ('error'), penolakan tidak boleh menjadi unhandled rejection
    // sebelum pipeline selesai/gagal. Hasilnya tetap dibaca lewat `await exited` di bawah.
    exited.catch(() => {});
    killer = setTimeout(() => {
      stderr += `\nDihentikan: melebihi batas waktu ${BACKUP_TIMEOUT_MS / 60_000} menit`;
      child.kill('SIGKILL');
    }, BACKUP_TIMEOUT_MS);
    const hash = createHash('sha256');
    const tap = new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    await pipeline(child.stdout, createGzip({ level: 6 }), tap, createWriteStream(out));
    const code = await exited;
    if (code !== 0) throw new Error(stderr.trim() || `pg_dump keluar dengan kode ${code}`);
    const size = (await stat(out)).size;
    await db.query(`UPDATE backups SET status='COMPLETED', size_bytes=$2, sha256=$3, finished_at=now() WHERE id=$1`, [id, size, hash.digest('hex')]);
    log.info({ id, size }, 'backup selesai');
    await enforceRetention(db, log);
  } catch (e: any) {
    if (out) await unlink(out).catch(() => {});
    await db
      .query(`UPDATE backups SET status='FAILED', error=$2, finished_at=now() WHERE id=$1`, [id, String(e?.message ?? e).slice(0, 2000)])
      .catch((err) => log.error({ id, err: err?.message }, 'status backup gagal diperbarui'));
    log.error({ id, err: e?.message }, 'backup gagal');
  } finally {
    if (killer) clearTimeout(killer);
    running.delete(id);
    invalidateBucket('backups');
  }
}

/** Simpan `storage.backup_keep` backup terbaru dan patuhi kuota bucket (hapus yang terlama). */
async function enforceRetention(db: Db, log: ServiceContext['log']) {
  const keep = settings.num('storage.backup_keep');
  const quota = settings.num('storage.quota_backups_gb') * GB;
  const done = await db.query(`SELECT id, filename, size_bytes FROM backups WHERE status='COMPLETED' ORDER BY started_at DESC`);
  let total = done.reduce((s, r) => s + r.size_bytes, 0);
  for (let i = done.length - 1; i >= 1; i--) {
    if (i < keep && total <= quota) break;
    const r = done[i];
    await unlink(join(BUCKETS.backups.path, r.filename)).catch(() => {});
    await db.query(`DELETE FROM backups WHERE id=$1`, [r.id]);
    total -= r.size_bytes;
    log.info({ filename: r.filename }, 'backup lama dihapus (retensi)');
  }
  await db.query(`DELETE FROM backups WHERE status='FAILED' AND started_at < now() - interval '30 days'`);
}

async function schedule(db: Db) {
  const last = await db.one(`SELECT started_at FROM backups WHERE status <> 'FAILED' ORDER BY started_at DESC LIMIT 1`);
  const hours = settings.num('storage.backup_interval_hours');
  const enabled = settings.bool('storage.backup_enabled');
  const next = last ? new Date(new Date(last.started_at).getTime() + hours * 3600_000) : new Date();
  return { enabled, interval_hours: hours, keep: settings.num('storage.backup_keep'), next_run_at: enabled ? next.toISOString() : null };
}

export async function lastBackupAt(db: Db): Promise<string | null> {
  return (await db.one(`SELECT max(finished_at) AS t FROM backups WHERE status='COMPLETED'`))?.t ?? null;
}

export async function backupRoutes(app: FastifyInstance, { db, log }: ServiceContext) {
  // Backup yang RUNNING saat proses mati tidak akan selesai.
  await db.query(`UPDATE backups SET status='FAILED', error='Terputus: service platform berhenti saat backup berjalan', finished_at=now() WHERE status='RUNNING'`);

  app.register(async (a) => {
    // Area Platform khusus Super Admin — termasuk membaca (tidak dapat didelegasikan lewat "Peran & Akses").
    a.addHook('preHandler', requireSuperAdmin);

    a.get('/v1/admin/platform/backups', async () => {
      const rows = await db.query(`SELECT * FROM backups ORDER BY started_at DESC LIMIT 200`);
      return { data: rows.map(backupOut), schedule: await schedule(db) };
    });

    a.post('/v1/admin/platform/backups', { preHandler: requireSuperAdmin }, async (req, reply) => {
      const b = z.object({ note: z.string().trim().max(300).optional().nullable() }).parse(req.body ?? {});
      const out = await idempotent(db, req, reply, 'platform.backup', async (tx) => {
        // Satu backup pada satu waktu (pg_dump berat). Replay key yang sama tetap dilayani idempotent() sebelum fn ini.
        if (running.size || (await tx.query(`SELECT 1 FROM backups WHERE status='RUNNING' LIMIT 1`)).rows.length)
          throw conflict('Backup lain sedang berjalan — tunggu sampai selesai');
        const r = await insertBackup(tx, 'manual', b.note || null, req.user!.name ?? req.user!.email ?? req.user!.sub);
        await audit(tx, { actorId: req.user!.sub, action: 'backup.create', entity: 'backup', entityId: r.id, data: { note: b.note } });
        return { status: 202, body: backupOut(r) };
      });
      if (!reply.getHeader('Idempotent-Replayed'))
        runBackup(db, out.id, log).catch((e) => log.error({ id: out.id, err: e?.message }, 'backup gagal dijalankan'));
      return out;
    });

    a.get('/v1/admin/platform/backups/:id/download', { preHandler: requireSuperAdmin }, async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Backup');
      const r = await db.one(`SELECT * FROM backups WHERE id = $1 AND status='COMPLETED'`, [id]);
      if (!r) throw notFound('Backup');
      const p = filePath('backups', r.filename);
      await audit(db, { actorId: req.user!.sub, action: 'backup.download', entity: 'backup', entityId: id });
      reply.header('content-type', 'application/gzip');
      reply.header('content-length', (await stat(p)).size);
      reply.header('content-disposition', `attachment; filename="${r.filename}"`);
      return reply.send(createReadStream(p));
    });

    a.delete('/v1/admin/platform/backups/:id', { preHandler: requireSuperAdmin }, async (req) => {
      const { id } = req.params as { id: string };
      if (!isUuid(id)) throw notFound('Backup');
      const r = await db.one(`SELECT * FROM backups WHERE id = $1`, [id]);
      if (!r) throw notFound('Backup');
      if (r.status === 'RUNNING') throw conflict('Backup masih berjalan');
      await unlink(join(BUCKETS.backups.path, r.filename)).catch((e) => {
        if (e?.code !== 'ENOENT') throw e;
      });
      invalidateBucket('backups');
      await db.query(`DELETE FROM backups WHERE id = $1`, [r.id]);
      await audit(db, { actorId: req.user!.sub, action: 'backup.delete', entity: 'backup', entityId: r.id, data: { filename: r.filename } });
      return { deleted: true };
    });
  });
}

/** Penjadwal backup: cek tiap menit apakah interval sudah lewat. */
export const backupJob = {
  name: 'backup-scheduler',
  everyMs: 60_000,
  run: async ({ db, log }: ServiceContext) => {
    const s = await schedule(db);
    if (!s.enabled || !s.next_run_at || new Date(s.next_run_at) > new Date() || running.size) return;
    const r = await insertBackup(db, 'schedule', 'Backup terjadwal', 'sistem');
    await runBackup(db, r.id, log);
  },
};
