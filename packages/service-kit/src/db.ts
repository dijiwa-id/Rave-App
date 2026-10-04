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

/** Pool yang terikat ke schema milik service (search_path). Service hanya boleh menyentuh schema-nya + bus. */
export function createDb(schema: string): Db {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    options: `-c search_path=${schema},public`,
    application_name: `gema-${schema}`,
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
      try {
        await c.query(opts?.isolation ? `BEGIN ISOLATION LEVEL ${opts.isolation.toUpperCase()}` : 'BEGIN');
        const out = await fn(c);
        await c.query('COMMIT');
        return out;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    async close() {
      await pool.end();
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
