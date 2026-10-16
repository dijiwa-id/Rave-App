/**
 * Store rate limit bersama antar-replika gateway (`RATE_LIMIT_STORE=pg`) untuk @fastify/rate-limit v10.
 * Fixed window di tabel UNLOGGED `gateway.rate_limits` (tanpa WAL — hitungan boleh hilang saat crash):
 * satu upsert atomik per permintaan → hitungan + sisa TTL. Jam = jam Postgres (konsisten antar-replika).
 * DB bermasalah → FAIL OPEN (permintaan diizinkan, log warn dibatasi) dan pemutus singkat agar gateway tidak
 * menunggu DB yang mati di setiap permintaan.
 */
import { createDb, type Db } from '@gema/service-kit';

type Log = { warn: (o: object, m: string) => void; info: (o: object, m: string) => void };
type IncrCb = (err: Error | null, res?: { current: number; ttl: number }) => void;

const UPSERT = `
  INSERT INTO gateway.rate_limits (key, win, count, expires_at)
  SELECT $1::text, w.win, 1, to_timestamp(((w.win + 1) * $2::bigint) / 1000.0)
    FROM (SELECT floor(extract(epoch FROM now()) * 1000 / $2::bigint)::bigint AS win) w
  ON CONFLICT (key, win) DO UPDATE SET count = rate_limits.count + 1
  RETURNING count, greatest(1, ceil(extract(epoch FROM (expires_at - now())) * 1000))::int AS ttl`;

export interface PgRateLimit {
  /** Kelas store untuk opsi `store` @fastify/rate-limit. */
  Store: new (opts: unknown) => { incr(key: string, cb: IncrCb, timeWindow: number, max: number): void; child(o: unknown): unknown };
  close(): Promise<void>;
}

export async function createPgRateLimit(log: Log): Promise<PgRateLimit> {
  // Pool kecil khusus: jalur panas tiap permintaan, timeout pendek (lebih baik fail open daripada lambat).
  const db: Db = createDb('gateway', { max: Number(process.env.RATE_LIMIT_PG_POOL_MAX ?? 5), connectTimeoutMs: 1000, statementTimeoutMs: 500, queryTimeoutMs: 1000, appName: 'gema-gateway-ratelimit' });
  let ready = false;
  let downUntil = 0;
  let suppressed = 0;
  let lastWarn = 0;

  async function ensureTable() {
    // Advisory lock: beberapa replika start bersamaan tidak balapan CREATE TABLE.
    await db.tx(async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('gema.gateway.rate_limits'))`);
      await c.query(`CREATE SCHEMA IF NOT EXISTS gateway`);
      await c.query(
        `CREATE UNLOGGED TABLE IF NOT EXISTS gateway.rate_limits (
           key text NOT NULL, win bigint NOT NULL, count int NOT NULL, expires_at timestamptz NOT NULL,
           PRIMARY KEY (key, win))`,
      );
      await c.query(`CREATE INDEX IF NOT EXISTS rate_limits_expires_idx ON gateway.rate_limits (expires_at)`);
    });
    ready = true;
  }
  const failOpen = (e: any) => {
    downUntil = Date.now() + 5000;
    if (Date.now() - lastWarn > 30_000) {
      log.warn({ err: e?.message, suppressed }, 'rate limit store pg gagal — fail open (permintaan diizinkan)');
      lastWarn = Date.now();
      suppressed = 0;
    } else suppressed++;
  };

  try {
    await ensureTable();
  } catch (e) {
    failOpen(e); // dicoba lagi saat permintaan berikutnya setelah jeda pemutus
  }
  // Bersihkan window kedaluwarsa (setiap replika; DELETE idempoten & murah lewat indeks expires_at).
  const cleanup = setInterval(() => {
    if (!ready) return;
    db.query(`DELETE FROM gateway.rate_limits WHERE expires_at < now() - interval '1 minute'`).catch(() => {});
  }, 60_000);
  cleanup.unref();

  class PgStore {
    // Opsi global (continueExceeding/exponentialBackoff) tidak dipakai gateway → tidak didukung store ini.
    constructor(_opts?: unknown) {}
    incr(key: string, cb: IncrCb, timeWindow: number, _max: number) {
      const allow = () => cb(null, { current: 0, ttl: timeWindow });
      if (Date.now() < downUntil) return allow();
      (ready ? Promise.resolve() : ensureTable())
        .then(() => db.one<{ count: number; ttl: number }>(UPSERT, [`${timeWindow}:${key}`, timeWindow]))
        .then(
          (r) => cb(null, { current: r?.count ?? 0, ttl: r?.ttl ?? timeWindow }),
          (e) => (failOpen(e), allow()),
        );
    }
    child(_routeOptions: unknown) {
      return new PgStore();
    }
  }

  log.info({ store: 'pg' }, 'rate limit memakai store Postgres bersama');
  return {
    Store: PgStore,
    async close() {
      clearInterval(cleanup);
      await db.close().catch(() => {});
    },
  };
}
