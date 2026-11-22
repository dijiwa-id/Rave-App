// Pelaporan putar offline (P-7 T6/T7) terhadap Postgres ASLI: SQL, migrasi 006/009, kunci advisory (try), UNIQUE(device_id, seq),
// regresi review keamanan (inflasi stream, DoS kunci, status akun, pertumbuhan tabel), dan dasar royalti (`/internal/royalty/streams`) → computeRoyalty. Berjalan hanya bila RAVE_PG_TEST_URL diisi
// (database kosong khusus test, mis. `postgres://rave:rave@127.0.0.1:55433/rave_test`) — membuat & menghapus schema acak.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeRoyalty, currentPeriod, periodRange, previousPeriod, splitTrack, sumSource, type ListenerInput } from '@rave/domain';
import { migrate, settings, uuidv7, type Db, type ServiceContext } from '@rave/service-kit';
import { asService, authAs, testApp } from '@rave/service-kit/testing';
import { analyticsRoutes } from './analytics.js';
import { eventRoutes } from './events.js';
import { offlinePlayRoutes, offlinePlaysPurgeJob, type OfflinePlayDeps } from './offline-plays.js';
import { OFFLINE_REJECTED_PER_DEVICE_DAY } from '@rave/domain/offline-plays';

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
  // Akun penguji regresi review keamanan (terpisah dari U1/U2 agar tidak memengaruhi skenario royalti).
  const U5 = uuidv7();
  const D5A = uuidv7();
  const D5B = uuidv7();
  const L5A = uuidv7();
  const L5B = uuidv7();
  const devices: Record<string, { id: string; user_id: string }> = { [D1]: { id: D1, user_id: U1 }, [D2]: { id: D2, user_id: U2 }, [D5A]: { id: D5A, user_id: U5 }, [D5B]: { id: D5B, user_id: U5 } };
  let suspended = false;
  const deps: OfflinePlayDeps = {
    entitlement: async (userId, deviceId) => ({
      user: { id: userId, member_type: 'INDIVIDUAL', member_until: null, premium_active: true, suspended },
      device: devices[deviceId] ? { ...devices[deviceId]!, platform: 'android', public_key: 'x', revoked_at: null } : null,
    }),
    contentMeta: async (tracks) => ({ tracks: Object.fromEntries(tracks.map((t) => [t, { artist_id: ART, duration_ms: 240_000 }])), episodes: {} }),
  };
  let app: Awaited<ReturnType<typeof testApp>>;
  const send = async (user: string, body: object) =>
    app.inject({ method: 'POST', url: '/v1/events/offline-plays', headers: await authAs({ sub: user }), payload: body });
  const iso = (t: number) => new Date(t).toISOString();
  /** Seperti klien: 429 (batch lain akun sedang diproses) → kirim ulang. */
  const sendRetry = async (user: string, body: object) => {
    for (let i = 0; i < 200; i++) {
      const r = await send(user, body);
      if (r.statusCode !== 429) return r;
      await new Promise((ok) => setTimeout(ok, 20));
    }
    throw new Error('masih 429');
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: PG_URL, max: 8, options: `-c search_path=${schema},public` });
    db = wrap(pool, schema);
    await migrate(db, new URL('../migrations/', import.meta.url), () => {});
    // Ember laju per akun dinaikkan agar skenario berurutan tidak terkena 429; ember diuji tersendiri (T-2).
    settings.apply({ 'royalty.qualified_stream_seconds': 30, 'streaming.fraud_max_streams_per_hour': 120, 'download.report_max_age_days': 35, 'download.report_per_minute': 600 });
    const lic = (id: string, user: string, device: string, track: string) =>
      db.query(
        `INSERT INTO offline_licenses (id, user_id, device_id, track_id, artifact_id, artifact, wrapped_key, issued_at, expires_at, recheck_at, created_at)
         VALUES ($1,$2,$3,$4,$5,'{}','{}', now(), now() + interval '10 days', now() + interval '3 days', now() - interval '34 days')`,
        [id, user, device, track, uuidv7()],
      );
    await lic(L1, U1, D1, T1);
    await lic(L2, U1, D1, T2);
    await lic(L3, U2, D2, T2);
    await lic(L5A, U5, D5A, T1);
    await lic(L5B, U5, D5B, T1);
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
    const raw = await Promise.all([send(U1, body), send(U1, body), send(U1, body)]);
    // Kunci try: yang kalah dijawab 429 seketika (tidak menunggu sambil memegang koneksi) → klien mengirim ulang → duplicate.
    expect(raw.every((r) => r.statusCode === 200 || (r.statusCode === 429 && r.json().code === 'rate_limited' && Number(r.headers['retry-after']) > 0))).toBe(true);
    const rs = await Promise.all(raw.map(async (r) => (r.statusCode === 429 ? (await sendRetry(U1, body)).json() : r.json())));
    expect(rs.map((r) => r.accepted).sort()).toEqual([0, 0, 10]);
    const n = await db.one(`SELECT (SELECT count(*) FROM offline_plays WHERE device_id = $1)::int AS plays, (SELECT count(*) FROM qualified_streams WHERE origin = 'offline')::int AS qs, (SELECT count(*) FROM outbox WHERE topic = 'playback.stream.qualified')::int AS ev`, [D1]);
    expect(n).toEqual({ plays: 10, qs: 10, ev: 10 });

    const t1 = Date.now() - 5 * DAY;
    const [a, b] = await Promise.all([
      sendRetry(U1, { device_id: D1, plays: [{ seq: 50, license_id: L1, track_id: T1, started_at: iso(t1), played_ms: 200_000 }] }),
      sendRetry(U1, { device_id: D1, plays: [{ seq: 51, license_id: L2, track_id: T2, started_at: iso(t1 + 60_000), played_ms: 200_000 }] }),
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
  // ---------------- Regresi review keamanan P-7 (data sintetis, akun U5) ----------------
  const u5 = (device: string, plays: object[]) => ({ device_id: device, plays });
  const pl = (seq: number, lic: string, t: number, played_ms: number) => ({ seq, license_id: lic, track_id: T1, started_at: iso(t), played_ms });
  const u5Counts = () =>
    db.one(`SELECT count(*) FILTER (WHERE NOT suspicious)::int AS ok, count(*) FILTER (WHERE suspicious)::int AS sus FROM qualified_streams WHERE user_id = $1`, [U5]);

  it('migrasi 009: indeks per pengguna (ACCEPTED) & kuota REJECTED per perangkat ada', async () => {
    const idx = await db.query(`SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'offline_plays' AND indexname IN ('offline_plays_user_started_idx','offline_plays_device_rejected_idx') ORDER BY 1`, [schema]);
    expect(idx.map((r) => r.indexname)).toEqual(['offline_plays_device_rejected_idx', 'offline_plays_user_started_idx']);
  });

  it('T-1: 30 putar dalam 1 jam dikirim satu per batch dengan urutan MENURUN → tetap hanya `batas` yang non-fraud', async () => {
    settings.apply({ 'streaming.fraud_max_streams_per_hour': 10 });
    try {
      const t0 = Date.now() - 8 * DAY;
      for (let i = 29; i >= 0; i--) expect((await send(U5, u5(D5A, [pl(2000 + i, L5A, t0 + i * 40_000, 36_000)]))).json().accepted).toBe(1);
      expect(await u5Counts()).toEqual({ ok: 10, sus: 20 });
      // Kontrol: urutan menaik dalam satu batch — hasil sama dengan hitungan satu arah (perilaku lama).
      const t1 = Date.now() - 7 * DAY;
      await send(U5, u5(D5A, Array.from({ length: 30 }, (_, i) => pl(3000 + i, L5A, t1 + i * 40_000, 36_000))));
      expect(await u5Counts()).toEqual({ ok: 20, sus: 40 });
      // Agregat & event hanya dari stream non-fraud.
      const ev = await db.one(`SELECT count(*)::int AS n FROM outbox WHERE topic = 'playback.stream.qualified' AND payload->>'userId' = $1`, [U5]);
      expect(ev.n).toBe(20);
    } finally {
      settings.apply({ 'streaming.fraud_max_streams_per_hour': 120 });
    }
  });

  it('T-1: dua perangkat akun yang sama memutar di waktu yang sama → yang kedua overlap (tumpang tindih per pengguna)', async () => {
    const t = Date.now() - 6 * DAY;
    const a = (await send(U5, u5(D5A, [pl(4000, L5A, t, 200_000)]))).json();
    const b = (await send(U5, u5(D5B, [pl(4000, L5B, t, 200_000)]))).json();
    expect(a.results[0].status).toBe('accepted');
    expect(b.results[0]).toEqual({ seq: 4000, status: 'rejected', reason: 'overlap' });
    // Paralel dari dua perangkat: tepat satu diterima.
    const t2 = t + DAY / 2;
    const [x, y] = await Promise.all([sendRetry(U5, u5(D5A, [pl(4001, L5A, t2, 200_000)])), sendRetry(U5, u5(D5B, [pl(4001, L5B, t2 + 1000, 200_000)]))]);
    expect([x.json().results[0], y.json().results[0]].map((r) => r.reason ?? r.status).sort()).toEqual(['accepted', 'overlap']);
  });

  it('T-3: akun ditangguhkan → 403 account_suspended, tidak ada yang disimpan; dipulihkan → seq yang sama diterima', async () => {
    const t = Date.now() - 4 * DAY;
    suspended = true;
    try {
      const r = await send(U5, u5(D5A, [pl(5000, L5A, t, 200_000)]));
      expect([r.statusCode, r.json().code]).toEqual([403, 'account_suspended']);
      expect((await db.one(`SELECT count(*)::int AS n FROM offline_plays WHERE device_id = $1 AND seq = 5000`, [D5A])).n).toBe(0);
    } finally {
      suspended = false;
    }
    expect((await send(U5, u5(D5A, [pl(5000, L5A, t, 200_000)]))).json()).toMatchObject({ accepted: 1, qualified: 1 });
  });

  it('T-4: kuota REJECTED per perangkat per hari — lewat kuota tetap rejected tetapi tidak ditulis; purge hanya REJECTED lama', async () => {
    const t = Date.now() - 4 * DAY; // tumpang tindih dengan seq 5000
    await db.query(
      `INSERT INTO offline_plays (id, user_id, device_id, license_id, track_id, seq, started_at_client, played_ms, received_at, status, reject_reason)
       SELECT gen_random_uuid(), $1, $2, $3, $4, 100000 + g, now(), 0, now(), 'REJECTED', 'overlap' FROM generate_series(1, $5::int) g`,
      [U5, D5A, L5A, T1, OFFLINE_REJECTED_PER_DEVICE_DAY - 5],
    );
    const before = (await db.one(`SELECT count(*)::int AS n FROM offline_plays`)).n;
    for (let k = 0; k < 5; k++) {
      const r = (await send(U5, u5(D5A, Array.from({ length: 200 }, (_, i) => pl(10_000 + k * 200 + i, L5A, t, 5000))))).json();
      expect(r.rejected).toBe(200);
    }
    expect((await db.one(`SELECT count(*)::int AS n FROM offline_plays`)).n - before).toBe(5);

    // Retensi: REJECTED diterima > report_max_age_days + 1 hari lalu dihapus; ACCEPTED lama & REJECTED baru tetap.
    const old = new Date(Date.now() - 40 * DAY);
    await db.query(`UPDATE offline_plays SET received_at = $2 WHERE device_id = $1 AND status = 'REJECTED' AND seq BETWEEN 100001 AND 100010`, [D5A, old]);
    await db.query(`UPDATE offline_plays SET received_at = $2 WHERE device_id = $1 AND seq = 5000`, [D5A, old]); // ACCEPTED
    const n0 = await db.one(`SELECT count(*) FILTER (WHERE status = 'REJECTED')::int AS rej, count(*) FILTER (WHERE status = 'ACCEPTED')::int AS acc FROM offline_plays`);
    await offlinePlaysPurgeJob.run({ db, log: { info: () => {} } } as any);
    const n1 = await db.one(`SELECT count(*) FILTER (WHERE status = 'REJECTED')::int AS rej, count(*) FILTER (WHERE status = 'ACCEPTED')::int AS acc FROM offline_plays`);
    expect(n1).toEqual({ rej: n0.rej - 10, acc: n0.acc });
    // Idempoten: jalan lagi tidak menghapus apa pun.
    await offlinePlaysPurgeJob.run({ db, log: { info: () => {} } } as any);
    expect(await db.one(`SELECT count(*) FILTER (WHERE status = 'REJECTED')::int AS rej, count(*) FILTER (WHERE status = 'ACCEPTED')::int AS acc FROM offline_plays`)).toEqual(n1);
  });

  it('T-2: kunci pengguna dipegang → 429 seketika (tanpa antre di kunci advisory); banjir batch paralel tidak menahan pool', async () => {
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT pg_advisory_xact_lock(hashtext('playback.offline-plays'), hashtext($1))`, [U5]);
      const s0 = Date.now();
      const r = await send(U5, u5(D5A, [pl(6000, L5A, Date.now() - 2 * DAY, 36_000)]));
      expect(r.statusCode).toBe(429);
      expect(r.json()).toMatchObject({ code: 'rate_limited', retry_after_s: 5 });
      expect(r.headers['retry-after']).toBe('5');
      expect(Date.now() - s0).toBeLessThan(2000);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    // Banjir: 12 batch × 200 paralel. Tidak ada sesi yang menunggu kunci advisory; kueri lain tetap cepat.
    const t = Date.now() - 2 * DAY;
    const mk = (k: number) => u5(D5A, Array.from({ length: 200 }, (_, i) => pl(50_000 + k * 200 + i, L5A, t + i * 300_000 + k, 36_000)));
    let waiters = 0;
    let stop = false;
    const probe = (async () => {
      while (!stop) {
        const w = await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'`);
        waiters = Math.max(waiters, w.rows[0].n);
        await new Promise((ok) => setTimeout(ok, 10));
      }
    })();
    const res = await Promise.all(Array.from({ length: 12 }, (_, k) => send(U5, mk(k))));
    stop = true;
    await probe;
    expect(waiters).toBe(0);
    expect(res.every((r) => r.statusCode === 200 || r.statusCode === 429)).toBe(true);
    expect(res.some((r) => r.statusCode === 200)).toBe(true);
  }, 120_000);

  it('T-2: ember laju per akun (tabel offline_rate) → 429 rate_limited setelah download.report_per_minute kiriman', async () => {
    const U7 = uuidv7();
    settings.apply({ 'download.report_per_minute': 3 });
    try {
      const st: number[] = [];
      for (let i = 0; i < 5; i++) st.push((await send(U7, { device_id: D1, plays: [{ seq: 1, license_id: L1, track_id: T1, started_at: iso(Date.now() - DAY), played_ms: 1000 }] })).statusCode);
      // 3 pertama lolos ember (perangkat milik akun lain → 404), sisanya 429 sebelum memanggil iam.
      expect(st).toEqual([404, 404, 404, 429, 429]);
    } finally {
      settings.apply({ 'download.report_per_minute': 600 });
    }
  });

  it('I-a: jalur online mengambil kunci pengguna yang sama sebelum mencatat qualified (menunggu batch offline, bukan dobel hitung)', async () => {
    const U6 = uuidv7();
    const sid = uuidv7();
    await db.query(
      `INSERT INTO sessions (id, user_id, track_id, artist_id, quality, codec_label, source, audio_url, duration_ms, created_at, expires_at)
       VALUES ($1,$2,$3,$4,'normal','AAC 160','search','/x',200000, now() - interval '2 minutes', now() + interval '1 hour')`,
      [sid, U6, T1, ART],
    );
    const holder = await pool.connect();
    let done = false;
    let res: any;
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT pg_advisory_xact_lock(hashtext('playback.offline-plays'), hashtext($1))`, [U6]);
      const p = app
        .inject({ method: 'POST', url: '/v1/events/play', headers: await authAs({ sub: U6 }), payload: { events: [{ session_id: sid, track_id: T1, type: 'progress', position_ms: 45_000, played_ms: 45_000 }] } })
        .then((r) => {
          done = true;
          res = r.json();
        });
      await new Promise((ok) => setTimeout(ok, 300));
      expect(done).toBe(false); // menunggu kunci (batch offline pengguna ini sedang berjalan)
      await holder.query('COMMIT');
      await p;
    } finally {
      holder.release();
    }
    expect(res).toEqual({ accepted: 1, qualified: 1 });
  });
});
