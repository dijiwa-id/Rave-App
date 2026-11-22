// Pelaporan putar offline (P-7 T6/T7) terhadap Postgres ASLI: SQL, migrasi 006, kunci advisory, UNIQUE(device_id, seq),
// dan dasar royalti (`/internal/royalty/streams`) → computeRoyalty. Berjalan hanya bila RAVE_PG_TEST_URL diisi
// (database kosong khusus test, mis. `postgres://rave:rave@127.0.0.1:55433/rave_test`) — membuat & menghapus schema acak.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeRoyalty, currentPeriod, periodRange, previousPeriod, splitTrack, sumSource, type ListenerInput } from '@rave/domain';
import { migrate, settings, uuidv7, type Db, type ServiceContext } from '@rave/service-kit';
import { asService, authAs, testApp } from '@rave/service-kit/testing';
import { analyticsRoutes } from './analytics.js';
import { eventRoutes } from './events.js';
import { offlinePlayRoutes, type OfflinePlayDeps } from './offline-plays.js';

const PG_URL = process.env.RAVE_PG_TEST_URL;
const H = 3600_000;
const DAY = 24 * H;

function wrap(pool: pg.Pool, schema: string): Db {
  return {
    pool,
    schema,
    query: async (sql, params) => (await pool.query(sql, params as any[])).rows,
    one: async (sql, params) => (await pool.query(sql, params as any[])).rows[0] ?? null,
    tx: async (fn) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const out = await fn(c);
        await c.query('COMMIT');
        return out;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    },
    close: async () => pool.end(),
  };
}

describe.skipIf(!PG_URL)('playback offline-plays (Postgres asli)', () => {
  const schema = `t6_${process.pid}_${Date.now()}`;
  let pool: pg.Pool;
  let db: Db;
  const U1 = uuidv7();
  const U2 = uuidv7();
  const D1 = uuidv7();
  const D2 = uuidv7();
  const T1 = uuidv7();
  const T2 = uuidv7();
  const ART = uuidv7();
  const L1 = uuidv7();
  const L2 = uuidv7();
  const L3 = uuidv7();
  const deps: OfflinePlayDeps = {
    entitlement: async (userId, deviceId) => ({
      user: { id: userId, member_type: 'INDIVIDUAL', member_until: null, premium_active: true, suspended: false },
      device: ({ [D1]: { id: D1, user_id: U1 }, [D2]: { id: D2, user_id: U2 } } as any)[deviceId] ? { ...({ [D1]: { id: D1, user_id: U1 }, [D2]: { id: D2, user_id: U2 } } as any)[deviceId], platform: 'android', public_key: 'x', revoked_at: null } : null,
    }),
    contentMeta: async (tracks) => ({ tracks: Object.fromEntries(tracks.map((t) => [t, { artist_id: ART, duration_ms: 240_000 }])), episodes: {} }),
  };
  let app: Awaited<ReturnType<typeof testApp>>;
  const send = async (user: string, body: object) =>
    app.inject({ method: 'POST', url: '/v1/events/offline-plays', headers: await authAs({ sub: user }), payload: body });
  const iso = (t: number) => new Date(t).toISOString();

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: PG_URL, max: 8, options: `-c search_path=${schema},public` });
    db = wrap(pool, schema);
    await migrate(db, new URL('../migrations/', import.meta.url), () => {});
    settings.apply({ 'royalty.qualified_stream_seconds': 30, 'streaming.fraud_max_streams_per_hour': 120, 'download.report_max_age_days': 35 });
    const lic = (id: string, user: string, device: string, track: string) =>
      db.query(
        `INSERT INTO offline_licenses (id, user_id, device_id, track_id, artifact_id, artifact, wrapped_key, issued_at, expires_at, recheck_at, created_at)
         VALUES ($1,$2,$3,$4,$5,'{}','{}', now(), now() + interval '10 days', now() + interval '3 days', now() - interval '34 days')`,
        [id, user, device, track, uuidv7()],
      );
    await lic(L1, U1, D1, T1);
    await lic(L2, U1, D1, T2);
    await lic(L3, U2, D2, T2);
    app = await testApp(async (a) => {
      await offlinePlayRoutes(a, { db, name: 'playback' }, deps);
      await analyticsRoutes(a, { db, name: 'playback' } as unknown as ServiceContext);
      await eventRoutes(a, { db, name: 'playback' } as unknown as ServiceContext);
    });
  });
  afterAll(async () => {
    await app?.close();
    await pool?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool?.end();
  });

  it('migrasi 006: kolom & indeks baru ada; origin dibatasi online/offline', async () => {
    const cols = await db.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name IN ('offline_plays','qualified_streams') AND column_name IN ('origin','played_at','reported_played_ms','qualified_at') ORDER BY 1, 2`, [schema]);
    expect(cols.map((c) => `${c.table_name}.${c.column_name}`)).toEqual(['offline_plays.qualified_at', 'offline_plays.reported_played_ms', 'qualified_streams.origin', 'qualified_streams.played_at']);
    await expect(db.query(`INSERT INTO qualified_streams (session_id, user_id, track_id, artist_id, played_ms, at, origin) VALUES ($1,$2,$3,$4,1,now(),'radio')`, [uuidv7(), U1, T1, ART])).rejects.toThrow(/origin_chk/);
  });

  it('PARALEL (kunci advisory asli): batch identik ×3 → satu diterima; batch berbeda yang tumpang tindih → satu diterima', async () => {
    const t0 = Date.now() - 6 * DAY;
    const body = { device_id: D1, plays: Array.from({ length: 10 }, (_, i) => ({ seq: i + 1, license_id: L1, track_id: T1, started_at: iso(t0 + i * 5 * 60_000), played_ms: 200_000 })) };
    const rs = (await Promise.all([send(U1, body), send(U1, body), send(U1, body)])).map((r) => r.json());
    expect(rs.map((r) => r.accepted).sort()).toEqual([0, 0, 10]);
    const n = await db.one(`SELECT (SELECT count(*) FROM offline_plays WHERE device_id = $1)::int AS plays, (SELECT count(*) FROM qualified_streams WHERE origin = 'offline')::int AS qs, (SELECT count(*) FROM outbox WHERE topic = 'playback.stream.qualified')::int AS ev`, [D1]);
    expect(n).toEqual({ plays: 10, qs: 10, ev: 10 });

    const t1 = Date.now() - 5 * DAY;
    const [a, b] = await Promise.all([
      send(U1, { device_id: D1, plays: [{ seq: 50, license_id: L1, track_id: T1, started_at: iso(t1), played_ms: 200_000 }] }),
      send(U1, { device_id: D1, plays: [{ seq: 51, license_id: L2, track_id: T2, started_at: iso(t1 + 60_000), played_ms: 200_000 }] }),
    ]);
    const st = [a.json().results[0], b.json().results[0]].map((r) => r.reason ?? r.status).sort();
    expect(st).toEqual(['accepted', 'overlap']);
  });

  it('jalur online tetap: qualify() hasil refactor menulis origin online, played_at = at, satu event; tanpa dobel', async () => {
    const U4 = uuidv7();
    const sid = uuidv7();
    await db.query(
      `INSERT INTO sessions (id, user_id, track_id, artist_id, quality, codec_label, source, audio_url, duration_ms, created_at, expires_at)
       VALUES ($1,$2,$3,$4,'normal','AAC 160','search','/x',200000, now() - interval '2 minutes', now() + interval '1 hour')`,
      [sid, U4, T1, ART],
    );
    const ev = (played: number) => ({ events: [{ session_id: sid, track_id: T1, type: 'progress', position_ms: played, played_ms: played }] });
    const post = async (b: object) => (await app.inject({ method: 'POST', url: '/v1/events/play', headers: await authAs({ sub: U4 }), payload: b })).json();
    expect(await post(ev(45_000))).toEqual({ accepted: 1, qualified: 1 });
    expect(await post(ev(60_000))).toEqual({ accepted: 1, qualified: 0 });
    const q = await db.one(`SELECT origin, played_at = at AS same, suspicious FROM qualified_streams WHERE session_id = $1`, [sid]);
    expect(q).toEqual({ origin: 'online', same: true, suspicious: false });
    const d = await db.one(`SELECT count(*)::int AS n FROM agg_deltas WHERE source = 'search' AND streams = 1 AND track_id = $1`, [T1]);
    expect(d.n).toBe(1);
  });

  it('T7: periode tertutup tidak dibuka — putar didengar di periode lalu, diterima sekarang → masuk periode diterima; offline setara online; total split tepat; kirim ulang tidak dobel', async () => {
    const cur = periodRange(currentPeriod());
    const prev = periodRange(previousPeriod());
    // U2 mendengar T2 offline 1 jam sebelum periode berjalan dimulai (periode lalu), melapor sekarang.
    const heard = cur.from.getTime() - H;
    const body = { device_id: D2, plays: [{ seq: 1, license_id: L3, track_id: T2, started_at: iso(heard), played_ms: 120_000 }] };
    expect((await send(U2, body)).json()).toMatchObject({ accepted: 1, qualified: 1 });
    // Stream online pembanding: U3 memutar T1 online di periode berjalan (baris setara jalur online).
    const U3 = uuidv7();
    await db.query(`INSERT INTO qualified_streams (session_id, user_id, track_id, artist_id, played_ms, at, played_at, origin) VALUES ($1,$2,$3,$4,120000, now(), now(), 'online')`, [uuidv7(), U3, T1, ART]);

    const royalty = async (r: { from: Date; to: Date }) =>
      (await app.inject({ method: 'GET', url: `/internal/royalty/streams?from=${r.from.toISOString()}&to=${r.to.toISOString()}`, headers: await asService() })).json();
    const before = await royalty(cur);
    const closed = await royalty(prev);
    // Periode lalu (sudah ditutup) tidak menerima stream offline yang dilaporkan sekarang.
    expect(closed.rows.find((r: any) => r.user_id === U2)).toBeUndefined();
    expect(closed.offline.streams).toBe(0);
    expect(before.rows.find((r: any) => r.user_id === U2)).toMatchObject({ track_id: T2, n: 1 });
    expect(before.offline.listeners).toBe(2); // U1 (test sebelumnya) + U2
    expect(before.offline.played_before_period).toBeGreaterThanOrEqual(1);

    // Kirim ulang → duplicate, dasar royalti tidak berubah.
    expect((await send(U2, body)).json()).toMatchObject({ accepted: 0, duplicate: 1 });
    const after = await royalty(cur);
    expect(after.rows).toEqual(before.rows);
    expect(after.offline).toEqual(before.offline);

    // Hitung: U2 (offline) dan U3 (online) sama-sama Premium Rp 45.000 → porsi lagu masing-masing identik.
    const listeners: ListenerInput[] = [U2, U3].map((u) => ({
      userId: u,
      premium: 45_000,
      ads: 0,
      streams: Object.fromEntries(after.rows.filter((r: any) => r.user_id === u).map((r: any) => [r.track_id, r.n])),
    }));
    const res = computeRoyalty(listeners, { model: 'user_centric', rightsholderSharePct: 70, hybridFloor: 0 });
    const t2 = res.tracks.find((t) => t.trackId === T2)!;
    const t1 = res.tracks.find((t) => t.trackId === T1)!;
    expect(t2.amount).toEqual({ premium: 31_500, ads: 0, pool: 0 });
    expect(t1.amount).toEqual(t2.amount);
    expect(res.tracks.reduce((a, t) => a + sumSource(t.amount), 0)).toBe(res.rightsholderPool);
    const split = splitTrack(t2.amount, [{ type: 'MASTER', party: 'org:a', pct: 3333, approved: true }, { type: 'MASTER', party: 'org:b', pct: 6667, approved: true }, { type: 'PUBLISHING', party: 'user:c', pct: 100, approved: true }], 25);
    expect(split.lines.reduce((a, l) => a + sumSource(l.amount), 0)).toBe(31_500);
  });
});
