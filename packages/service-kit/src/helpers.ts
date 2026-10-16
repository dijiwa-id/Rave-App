import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Client, Db } from './db.js';
import { badRequest } from './errors.js';
import { serviceUrl, type ServiceName } from './config.js';
import { serviceHeaders } from './auth.js';
import { HttpError } from './errors.js';

/**
 * Idempotency-Key wajib untuk POST yang membuat transaksi (TDD §11.2).
 * Respons pertama disimpan; request ulang dengan key sama mengembalikan respons identik.
 */
export async function idempotent<T>(
  db: Db,
  req: FastifyRequest,
  reply: FastifyReply,
  scope: string,
  fn: (tx: Client) => Promise<{ status?: number; body: T }>,
  opts: { required?: boolean } = { required: true },
): Promise<T> {
  const key = req.headers['idempotency-key'] as string | undefined;
  if (!key) {
    if (opts.required) throw badRequest('Header Idempotency-Key wajib untuk operasi ini');
    const r = await db.tx(fn);
    reply.status(r.status ?? 200);
    return r.body;
  }
  const fullScope = `${scope}:${req.user?.sub ?? 'anon'}`;
  const prev = await db.one(`SELECT status_code, response FROM idempotency_keys WHERE scope=$1 AND key=$2`, [fullScope, key]);
  if (prev) {
    reply.header('Idempotent-Replayed', 'true').status(prev.status_code);
    return prev.response as T;
  }
  return db.tx(async (tx) => {
    // Retry paralel dengan key sama: tunggu yang pertama selesai lalu putar ulang responsnya (bukan menjalankan fn dua kali).
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [fullScope, key]);
    const again = (await tx.query(`SELECT status_code, response FROM idempotency_keys WHERE scope=$1 AND key=$2`, [fullScope, key])).rows[0];
    if (again) {
      reply.header('Idempotent-Replayed', 'true').status(again.status_code);
      return again.response as T;
    }
    const r = await fn(tx);
    const status = r.status ?? 200;
    await tx.query(`INSERT INTO idempotency_keys (scope, key, status_code, response) VALUES ($1,$2,$3,$4)`, [fullScope, key, status, JSON.stringify(r.body ?? null)]);
    reply.status(status);
    return r.body;
  });
}

export async function audit(
  tx: Client | Db,
  e: { actorId?: string | null; action: string; entity: string; entityId?: string | null; data?: unknown; ip?: string },
) {
  await (tx as any).query(`INSERT INTO audit_logs (actor_id, action, entity, entity_id, data, ip) VALUES ($1,$2,$3,$4,$5,$6)`, [
    e.actorId ?? null,
    e.action,
    e.entity,
    e.entityId ?? null,
    e.data === undefined ? null : JSON.stringify(e.data),
    e.ip ?? null,
  ]);
}

/** Panggilan sinkron antar-service (pakai seperlunya; utamakan event). */
export async function callService<T = any>(
  from: string,
  to: Exclude<ServiceName, 'gateway'>,
  path: string,
  init: { method?: string; body?: unknown; userToken?: string } = {},
): Promise<T> {
  const auth = init.userToken ? { authorization: `Bearer ${init.userToken}` } : await serviceHeaders(from);
  let res: Response;
  try {
    res = await fetch(serviceUrl(to) + path, {
      method: init.method ?? 'GET',
      headers: { ...auth, 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e: any) {
    // Timeout → 504, tidak terjangkau → 502 (Problem Details), bukan 500 dengan stack trace.
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    throw new HttpError(timeout ? 504 : 502, timeout ? 'Gateway Timeout' : 'Bad Gateway', `${to} ${timeout ? 'tidak merespons' : 'tidak terjangkau'}`);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null; // halaman galat HTML dari proxy dsb.
  }
  if (!res.ok) throw new HttpError(res.status >= 500 ? 502 : res.status, 'Upstream error', data?.detail ?? `${to}${path} → ${res.status}`);
  return data as T;
}

/** Pagination cursor sederhana berbasis offset ter-encode (cukup untuk MVP). */
export function pageParams(q: { cursor?: string; limit?: string | number }) {
  const limit = Math.min(Math.max(Number(q.limit ?? 20) || 20, 1), 100);
  const offset = q.cursor ? Number(Buffer.from(q.cursor, 'base64url').toString()) || 0 : 0;
  return { limit, offset };
}
export function nextCursor(offset: number, limit: number, got: number): string | null {
  return got < limit ? null : Buffer.from(String(offset + limit)).toString('base64url');
}
