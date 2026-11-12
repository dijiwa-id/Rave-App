import type { DomainEvents, EventEnvelope, Topic } from '@rave/domain';
import pg from 'pg';
import { config } from './config.js';
import type { Client, Db } from './db.js';
import { uuidv7 } from './ids.js';

export type Handler<T extends Topic = Topic> = (evt: EventEnvelope<T>, tx: Client) => Promise<void>;
export type Consumers = { [K in Topic]?: Handler<K> };

/**
 * Tulis event ke outbox DI DALAM transaksi domain. Relay akan memublikasikannya ke bus.
 * Jangan publish langsung ke Kafka dari handler — itu merusak konsistensi.
 */
export async function publish<T extends Topic>(tx: Client, topic: T, key: string, payload: DomainEvents[T]): Promise<string> {
  const id = uuidv7();
  await tx.query(`INSERT INTO outbox (id, topic, key, payload) VALUES ($1,$2,$3,$4)`, [id, topic, key, JSON.stringify(payload)]);
  // Bangunkan relay service ini tepat saat transaksi commit (NOTIFY transaksional; duplikat dalam satu transaksi
  // digabung Postgres). Menggantikan polling outbox tiap 250 ms di setiap service.
  if (outboxChannel) await tx.query(`SELECT pg_notify($1, '')`, [outboxChannel]);
  return id;
}

/** Saluran NOTIFY outbox milik service di proses ini (diisi createBus). */
let outboxChannel: string | null = null;

/**
 * Satu koneksi LISTEN per proses untuk semua saluran (relay outbox, bus). Putus (mis. Postgres restart) → sambung
 * ulang dengan backoff; setelah tersambung semua handler dipanggil sekali untuk mengejar sinyal yang terlewat.
 */
function createListener(log: (o: object, m: string) => void) {
  const handlers = new Map<string, Set<() => void>>();
  let client: pg.Client | null = null;
  let closed = false;
  let reconnectMs = 1000;
  let connecting: Promise<void> | null = null;
  const fireAll = () => handlers.forEach((set) => set.forEach((h) => h()));

  async function connect(): Promise<void> {
    if (client || closed) return;
    const c = new pg.Client({ connectionString: config.databaseUrl, application_name: 'rave-listen' });
    const lost = (err?: Error) => {
      if (client !== c) return;
      client = null;
      if (closed) return;
      log({ err: err?.message }, 'koneksi LISTEN terputus — menyambung ulang');
      setTimeout(() => void ensure(), reconnectMs).unref();
      reconnectMs = Math.min(reconnectMs * 2, 30_000);
    };
    c.on('error', lost);
    c.on('end', () => lost());
    c.on('notification', (n) => handlers.get(n.channel)?.forEach((h) => h()));
    client = c;
    try {
      await c.connect();
      for (const ch of handlers.keys()) await c.query(`LISTEN ${pg.escapeIdentifier(ch)}`);
      reconnectMs = 1000;
      fireAll();
    } catch (e: any) {
      lost(e);
    }
  }
  const ensure = () => (connecting ??= connect().finally(() => (connecting = null)));

  return {
    async on(channel: string, fn: () => void) {
      const isNew = !handlers.has(channel);
      if (isNew) handlers.set(channel, new Set());
      handlers.get(channel)!.add(fn);
      if (client && isNew) await client.query(`LISTEN ${pg.escapeIdentifier(channel)}`).catch(() => {});
      else await ensure();
    },
    async close() {
      closed = true;
      await client?.end().catch(() => {});
    },
  };
}

interface Driver {
  publish(c: Client, envs: EventEnvelope[]): Promise<void>;
  subscribe(group: string, topics: Topic[], onEvent: (e: EventEnvelope) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

/** Galat yang layak dicoba ulang: deadlock/serialisasi Postgres, putus koneksi, timeout/5xx upstream. */
function isTransient(e: any): boolean {
  if (['40P01', '40001', '57014', '08006', '08003'].includes(e?.code)) return true;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || e?.code === 'ECONNREFUSED' || e?.code === 'ECONNRESET') return true;
  return typeof e?.status === 'number' && e.status >= 502;
}

// ---------- Driver PG: log append-only bus.events + offset per consumer group ----------
function pgDriver(db: Db, log: (o: object, m: string) => void, listener: ReturnType<typeof createListener>): Driver {
  const timers: NodeJS.Timeout[] = [];
  let closed = false;

  return {
    async publish(c, envs) {
      if (!envs.length) return;
      // seq (bigserial) diambil saat INSERT, bukan saat commit. Tanpa kunci, relay A (seq 10) yang commit setelah
      // relay B (seq 11) membuat konsumen yang sudah membaca 11 melewatkan 10 selamanya. Kunci transaksi global
      // menyerialkan relay sehingga urutan seq = urutan commit.
      await c.query(`SELECT pg_advisory_xact_lock(4243)`);
      for (const e of envs) {
        await c.query(
          `INSERT INTO bus.events (id, topic, key, payload, occurred_at, producer) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
          [e.id, e.topic, e.key, JSON.stringify(e.payload), e.occurredAt, e.producer],
        );
      }
      if (envs.length) await c.query(`SELECT pg_notify('rave_bus', '')`);
    },
    async subscribe(group, topics, onEvent) {
      for (const t of topics) {
        await db.query(`INSERT INTO bus.consumer_offsets (group_id, topic, last_seq) VALUES ($1,$2,0) ON CONFLICT DO NOTHING`, [group, t]);
      }
      let running = false;
      let again = false;
      /** Proses ulang dead letter yang diminta retry (panel Super Admin). Sukses → dihapus; gagal → attempts+1. */
      const retryDeadLetters = async () => {
        const due = await db.query(
          `SELECT d.event_id FROM bus.dead_letters d WHERE d.group_id=$1 AND d.retry_requested_at IS NOT NULL AND d.topic = ANY($2) LIMIT 20`,
          [group, topics],
        );
        for (const { event_id } of due) {
          await db.tx(async (c) => {
            const row = (await c.query(`SELECT * FROM bus.events WHERE id=$1`, [event_id])).rows[0];
            const lock = await c.query(`SELECT 1 FROM bus.dead_letters WHERE group_id=$1 AND event_id=$2 AND retry_requested_at IS NOT NULL FOR UPDATE SKIP LOCKED`, [group, event_id]);
            if (!lock.rows[0]) return;
            if (!row) {
              await c.query(`DELETE FROM bus.dead_letters WHERE group_id=$1 AND event_id=$2`, [group, event_id]);
              return;
            }
            const env: EventEnvelope = { id: row.id, topic: row.topic, key: row.key, payload: row.payload, occurredAt: new Date(row.occurred_at).toISOString(), producer: row.producer };
            await c.query('SAVEPOINT r');
            try {
              await (onEvent as any)(env, c);
              await c.query('RELEASE SAVEPOINT r');
              await c.query(`DELETE FROM bus.dead_letters WHERE group_id=$1 AND event_id=$2`, [group, event_id]);
              log({ topic: row.topic, eventId: event_id }, 'dead letter berhasil diproses ulang');
            } catch (err: any) {
              await c.query('ROLLBACK TO SAVEPOINT r');
              await c.query(
                `UPDATE bus.dead_letters SET retry_requested_at=NULL, attempts=attempts+1, error=$3, failed_at=now() WHERE group_id=$1 AND event_id=$2`,
                [group, event_id, String(err?.stack ?? err)],
              );
            }
          });
        }
      };
      const drain = async () => {
        if (closed) return;
        if (running) {
          again = true;
          return;
        }
        running = true;
        try {
          do {
            again = false;
            // Satu query murah untuk menemukan topik yang punya event baru — tanpa membuka transaksi per topik
            // saat bus diam (sebelumnya: 1 transaksi × jumlah topik × setiap 2 dtk × setiap service).
            const pending = await db.query(
              `SELECT o.topic FROM bus.consumer_offsets o
                WHERE o.group_id = $1 AND o.topic = ANY($2)
                  AND EXISTS (SELECT 1 FROM bus.events e WHERE e.topic = o.topic AND e.seq > o.last_seq)`,
              [group, topics],
            );
            for (const { topic: t } of pending) {
              // Satu event per transaksi: offset & efek samping handler commit bersama (exactly-once dalam DB).
              for (let i = 0; i < 200; i++) {
                const handled = await db.tx(async (c) => {
                  const off = await c.query(`SELECT last_seq FROM bus.consumer_offsets WHERE group_id=$1 AND topic=$2 FOR UPDATE SKIP LOCKED`, [group, t]);
                  if (!off.rows[0]) return false;
                  const ev = await c.query(`SELECT * FROM bus.events WHERE topic=$1 AND seq > $2 ORDER BY seq LIMIT 1`, [t, off.rows[0].last_seq]);
                  const row = ev.rows[0];
                  if (!row) return false;
                  const env: EventEnvelope = {
                    id: row.id,
                    topic: row.topic,
                    key: row.key,
                    payload: row.payload,
                    occurredAt: new Date(row.occurred_at).toISOString(),
                    producer: row.producer,
                  };
                  let err: any = null;
                  for (let attempt = 1; ; attempt++) {
                    await c.query('SAVEPOINT h');
                    try {
                      await (onEvent as any)(env, c);
                      await c.query('RELEASE SAVEPOINT h');
                      err = null;
                      break;
                    } catch (e: any) {
                      await c.query('ROLLBACK TO SAVEPOINT h');
                      err = e;
                      // Galat sementara (deadlock, serialisasi, upstream timeout) dicoba ulang dulu, baru dead letter.
                      if (attempt >= 3 || !isTransient(e)) break;
                      await new Promise((r) => setTimeout(r, 150 * attempt));
                    }
                  }
                  if (err) {
                    log({ err: err?.message, topic: t, eventId: env.id }, 'consumer handler gagal → dead letter');
                    await c.query(
                      `INSERT INTO bus.dead_letters (group_id, event_id, topic, error) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
                      [group, env.id, t, String(err?.stack ?? err)],
                    );
                  }
                  await c.query(`UPDATE bus.consumer_offsets SET last_seq=$3 WHERE group_id=$1 AND topic=$2`, [group, t, row.seq]);
                  return true;
                });
                if (!handled) break;
              }
            }
          } while (again && !closed);
          await retryDeadLetters();
        } catch (e: any) {
          log({ err: e?.message }, 'consumer drain error');
        } finally {
          running = false;
        }
      };
      // LISTEN/NOTIFY membangunkan drain secara real-time; interval hanya jaring pengaman (NOTIFY terlewat, retry dead letter).
      await listener.on('rave_bus', () => void drain());
      timers.push(setInterval(() => void drain(), Number(process.env.BUS_DRAIN_POLL_MS) || 10_000));
      void drain();
    },
    async close() {
      closed = true;
      timers.forEach(clearInterval);
    },
  };
}

// ---------- Driver Kafka/Redpanda (produksi) ----------
function kafkaDriver(db: Db, service: string, log: (o: object, m: string) => void): Driver {
  let producer: any;
  const consumers: any[] = [];
  let kafka: any;
  async function k() {
    if (!kafka) {
      const { Kafka, logLevel } = await import('kafkajs');
      kafka = new Kafka({ clientId: `rave-${service}`, brokers: config.kafkaBrokers, logLevel: logLevel.WARN });
    }
    return kafka;
  }
  return {
    async publish(_c, envs) {
      if (!producer) {
        producer = (await k()).producer({ idempotent: true });
        await producer.connect();
      }
      for (const e of envs) {
        await producer.send({ topic: e.topic, messages: [{ key: e.key, value: JSON.stringify(e) }] });
      }
    },
    async subscribe(group, topics, onEvent) {
      const consumer = (await k()).consumer({ groupId: group });
      await consumer.connect();
      for (const t of topics) await consumer.subscribe({ topic: t, fromBeginning: true });
      await consumer.run({
        eachMessage: async ({ message }: any) => {
          const env = JSON.parse(message.value.toString()) as EventEnvelope;
          await db.tx(async (c) => {
            const dup = await c.query(`INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING`, [env.id]);
            if (dup.rowCount === 0) return; // sudah diproses (at-least-once → idempoten)
            await (onEvent as any)(env, c);
          });
        },
      });
      consumers.push(consumer);
      log({ group, topics }, 'kafka consumer berjalan');
    },
    async close() {
      await producer?.disconnect().catch(() => {});
      for (const c of consumers) await c.disconnect().catch(() => {});
    },
  };
}

/** Relay outbox → bus, plus registrasi konsumen. */
export function createBus(db: Db, service: string, log: (o: object, m: string) => void) {
  const listener = createListener(log);
  const driver = config.busDriver === 'kafka' ? kafkaDriver(db, service, log) : pgDriver(db, log, listener);
  outboxChannel = `rave_outbox_${service}`.replace(/[^a-z0-9_]/gi, '_');
  let timer: NodeJS.Timeout | null = null;
  let relaying = false;
  let again = false;

  async function relayOnce(): Promise<void> {
    if (relaying) {
      again = true; // sinyal datang saat relay berjalan → ulangi setelah selesai, jangan sampai terlewat
      return;
    }
    relaying = true;
    try {
      do {
        again = false;
        // Cek murah via indeks parsial outbox_unpublished_idx.
        if (!(await db.one(`SELECT 1 AS x FROM outbox WHERE published_at IS NULL LIMIT 1`))) continue;
        const n = await relayBatch();
        if (n === 100) again = true; // masih ada antrean
      } while (again);
    } catch (e: any) {
      log({ err: e?.message }, 'outbox relay error');
    } finally {
      relaying = false;
    }
  }

  async function relayBatch(): Promise<number> {
    return db.tx(async (c) => {
        const r = await c.query(`SELECT * FROM outbox WHERE published_at IS NULL ORDER BY occurred_at, id LIMIT 100 FOR UPDATE SKIP LOCKED`);
        if (!r.rows.length) return 0;
        const envs: EventEnvelope[] = r.rows.map((row) => ({
          id: row.id,
          topic: row.topic,
          key: row.key,
          payload: row.payload,
          occurredAt: new Date(row.occurred_at).toISOString(),
          producer: service,
        }));
        await driver.publish(c, envs);
        await c.query(`UPDATE outbox SET published_at = now() WHERE id = ANY($1)`, [envs.map((e) => e.id)]);
        return envs.length;
    });
  }

  return {
    relayOnce,
    /** Dengarkan saluran NOTIFY lewat koneksi LISTEN bersama proses ini. */
    listen: (channel: string, fn: () => void) => listener.on(channel, fn),
    /**
     * Relay dibangunkan NOTIFY dari publish() (latensi ≈ 0); polling hanya jaring pengaman untuk baris outbox yang
     * ditulis tanpa publish() atau sinyal yang terlewat saat koneksi LISTEN tersambung ulang.
     */
    async startRelay(fallbackMs = Number(process.env.BUS_RELAY_POLL_MS) || 2000) {
      await listener.on(outboxChannel!, () => void relayOnce());
      timer = setInterval(() => void relayOnce(), fallbackMs);
      void relayOnce();
    },
    async consume(consumers: Consumers) {
      const topics = Object.keys(consumers) as Topic[];
      if (!topics.length) return;
      await driver.subscribe(service, topics, async (env: EventEnvelope, c?: Client) => {
        const h = consumers[env.topic] as Handler | undefined;
        if (h) await h(env, c as Client);
      });
    },
    async close() {
      if (timer) clearInterval(timer);
      await driver.close();
      await listener.close();
    },
  };
}
