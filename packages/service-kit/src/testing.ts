// Perkakas test handler (vitest) — TIDAK diekspor dari index (tidak ikut runtime service).
// `testApp` merakit Fastify dengan hook auth & error handler yang sama seperti createService; `fakeDb` = Db tiruan
// berbasis pencocokan SQL yang mencatat event outbox, cukup untuk menguji jalur otorisasi/validasi/event tanpa Postgres.
import Fastify, { type FastifyInstance } from 'fastify';
import { attachUser, serviceHeaders, signAccessToken, type AuthUser } from './auth.js';
import type { Db } from './db.js';
import { errorHandler } from './errors.js';

export async function testApp(register: (app: FastifyInstance) => Promise<void> | void): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('user', null);
  app.addHook('onRequest', attachUser);
  app.setErrorHandler(errorHandler);
  await register(app);
  await app.ready();
  return app;
}

/** Header Authorization untuk pengguna uji (JWT asli bertanda tangan secret dev). */
export async function authAs(u: Partial<AuthUser> & { sub: string }): Promise<Record<string, string>> {
  const token = await signAccessToken({ roles: ['fan'], orgs: [], ...u });
  return { authorization: `Bearer ${token}` };
}
export const asService = () => serviceHeaders('test');

export interface OutboxEvent {
  topic: string;
  key: string;
  payload: any;
}
export type SqlHandler = (sql: string, params: any[]) => any[] | undefined;

/**
 * Db tiruan: setiap query diteruskan ke `handler` (kembalikan baris, atau undefined bila tidak dikenali → error agar
 * query baru tidak lolos diam-diam). Outbox, pg_notify, audit, advisory lock & BEGIN/COMMIT ditangani otomatis.
 */
export function fakeDb(handler: SqlHandler) {
  const events: OutboxEvent[] = [];
  const queries: string[] = [];
  const run = (sql: string, params: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    queries.push(s);
    if (/^INSERT INTO outbox/i.test(s)) {
      events.push({ topic: params[1], key: params[2], payload: JSON.parse(params[3]) });
      return [];
    }
    if (/pg_notify|pg_advisory_xact_lock|^INSERT INTO audit_logs|^(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return [];
    const rows = handler(s, params);
    if (rows === undefined) throw new Error(`fakeDb: query tidak dikenali: ${s.slice(0, 160)}`);
    return rows;
  };
  const client = { query: async (sql: string, params?: any[]) => { const rows = run(sql, params); return { rows, rowCount: rows.length }; } };
  const db = {
    schema: 'test',
    pool: null as any,
    query: async (sql: string, params?: unknown[]) => run(sql, params as any[]),
    one: async (sql: string, params?: unknown[]) => run(sql, params as any[])[0] ?? null,
    tx: async (fn: (c: any) => Promise<any>) => {
      // Rollback tiruan: event outbox dari transaksi yang gagal dibuang.
      const before = events.length;
      try {
        return await fn(client);
      } catch (e) {
        events.splice(before);
        throw e;
      }
    },
    close: async () => {},
  } as unknown as Db;
  return { db, events, queries };
}
