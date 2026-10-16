import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';

// BIGINT (int8) dan NUMERIC dikembalikan sebagai number. Aman: nilai rupiah < 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export type Client = pg.PoolClient;

export interface Db {
  pool: pg.Pool;
  schema: string;
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | null>;
  tx<T>(fn: (c: Client) => Promise<T>, opts?: { isolation?: 'serializable' | 'repeatable read' }): Promise<T>;
  close(): Promise<void>;
}

export interface DbOptions {
  max?: number;
  connectTimeoutMs?: number;
  statementTimeoutMs?: number;
  /** Batas waktu sisi klien per query (mis. jaringan macet) — melengkapi statement_timeout server. */
  queryTimeoutMs?: number;
  appName?: string;
}

/** Pool yang terikat ke schema milik service (search_path). Service hanya boleh menyentuh schema-nya + bus. */
export function createDb(schema: string, opts: DbOptions = {}): Db {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    // 11 service × pool + koneksi LISTEN harus muat di max_connections (default 100). Naikkan per service via DB_POOL_MAX.
    max: opts.max ?? Number(process.env.DB_POOL_MAX ?? 6),
    idleTimeoutMillis: 30_000,
    // Pool penuh → gagal cepat (503) daripada antre tanpa batas.
    connectionTimeoutMillis: opts.connectTimeoutMs ?? Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 5_000),
    query_timeout: opts.queryTimeoutMs,
    // Query liar & transaksi menggantung dihentikan server (melepas kunci). Maintenance (VACUUM) memakai SET lokal.
    options: `-c search_path=${schema},public -c statement_timeout=${opts.statementTimeoutMs ?? process.env.DB_STATEMENT_TIMEOUT_MS ?? 30_000} -c idle_in_transaction_session_timeout=60000`,
    application_name: opts.appName ?? `gema-${schema}`,
  });
  pool.on('error', (e) => console.error(`[db:${schema}] idle client error`, e.message));

  return {
    pool,
    schema,
    async query(sql, params) {
      const r = await pool.query(sql, params as any[]);
      return r.rows;
    },
    async one(sql, params) {
      const r = await pool.query(sql, params as any[]);
      return r.rows[0] ?? null;
    },
    async tx(fn, opts) {
      const c = await pool.connect();
      let broken = false;
      try {
        await c.query(opts?.isolation ? `BEGIN ISOLATION LEVEL ${opts.isolation.toUpperCase()}` : 'BEGIN');
        const out = await fn(c);
        await c.query('COMMIT');
        return out;
      } catch (e) {
        // ROLLBACK gagal = koneksi rusak → buang dari pool (jangan dipakai ulang).
        broken = await c.query('ROLLBACK').then(
          () => false,
          () => true,
        );
        throw e;
      } finally {
        c.release(broken ? new Error('koneksi rusak') : undefined);
      }
    },
    async close() {
      await pool.end();
    },
  };
}

/**
 * Kunci advisory tingkat sesi pada koneksi khusus (bukan pool) — "hanya satu replika yang menjalankan X".
 * Kunci lepas otomatis bila koneksi putus/proses mati; `onLost` dipanggil agar pemegang berhenti seketika.
 */
export function sessionLock(name: string, opts: { onLost?: () => void; log?: (o: object, m: string) => void } = {}) {
  let client: pg.Client | null = null;
  let held = false;
  const drop = (c: pg.Client, err?: Error) => {
    if (client !== c) return;
    client = null;
    const was = held;
    held = false;
    c.end().catch(() => {});
    if (was) {
      opts.log?.({ lock: name, err: err?.message }, 'koneksi kunci advisory putus — kunci dilepas');
      opts.onLost?.();
    }
  };
  return {
    get held() {
      return held;
    },
    /** true bila kunci dipegang proses ini (dicoba tanpa menunggu). */
    async tryAcquire(): Promise<boolean> {
      if (held) return true;
      if (!client) {
        const c = new pg.Client({ connectionString: config.databaseUrl, application_name: `gema-lock-${name}`.slice(0, 63) });
        c.on('error', (e) => drop(c, e));
        c.on('end', () => drop(c));
        client = c;
        try {
          await c.connect();
        } catch (e: any) {
          drop(c, e);
          throw e;
        }
      }
      const r = await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [name]);
      held = !!r.rows[0]?.ok;
      return held;
    },
    async release() {
      if (!held || !client) return;
      held = false;
      await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [name]).catch(() => {});
    },
    async close() {
      held = false;
      const c = client;
      client = null;
      await c?.end().catch(() => {});
    },
  };
}

const KIT_MIGRATIONS = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'migrations');

/**
 * Menjalankan migrasi SQL berurutan (nama file leksikografis) dalam schema service.
 * Migrasi kit (outbox, idempotency, audit, bus) dijalankan lebih dulu.
 */
export async function migrate(db: Db, dir: string | URL, log: (m: string) => void = console.log) {
  const svcDir = typeof dir === 'string' ? dir : fileURLToPath(dir);
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${db.schema}`);
  // Lock global agar beberapa service yang start bersamaan tidak balapan membuat schema bus/extension.
  await db.tx(async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(424242)`);
    await c.query(`CREATE TABLE IF NOT EXISTS ${db.schema}._migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await c.query(`SELECT name FROM ${db.schema}._migrations`)).rows.map((r) => r.name));
    const files = [
      ...listSql(KIT_MIGRATIONS).map((f) => ({ name: `kit/${f}`, path: join(KIT_MIGRATIONS, f) })),
      ...listSql(svcDir).map((f) => ({ name: f, path: join(svcDir, f) })),
    ];
    for (const f of files) {
      if (done.has(f.name)) continue;
      await c.query(`SET LOCAL search_path TO ${db.schema},public`);
      await c.query(readFileSync(f.path, 'utf8'));
      await c.query(`INSERT INTO ${db.schema}._migrations(name) VALUES ($1)`, [f.name]);
      log(`[migrate:${db.schema}] ${f.name}`);
    }
  });
}

function listSql(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}
