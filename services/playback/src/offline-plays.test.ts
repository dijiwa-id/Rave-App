// Pelaporan putar offline (P-7 T6): skenario uang — sukses, kiriman ulang, paralel, lisensi salah/kedaluwarsa/dicabut,
// tumpang tindih, batas harian, fraud. Store di memori meniru SQL yang dipakai offline-plays.ts + events.ts (fraudCheck,
// recordQualified) dan MENGHORMATI pg_advisory_xact_lock (transaksi paralel diserialkan seperti Postgres).
// Validasi SQL asli (Postgres) ada di offline-plays.pg.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settings } from '@rave/service-kit';
import { authAs, fakeDb, testApp } from '@rave/service-kit/testing';
import { wibDate } from '@rave/domain/offline-plays';
import { offlinePlayRoutes, type ContentMeta, type OfflinePlayDeps } from './offline-plays.js';
import type { Entitlement } from './offline.js';

const U1 = '0190a000-0000-7000-8000-0000000000e1';
const U2 = '0190a000-0000-7000-8000-0000000000e2';
const D1 = '0190a000-0000-7000-8000-0000000000f1';
const D2 = '0190a000-0000-7000-8000-0000000000f2'; // milik U2
const D3 = '0190a000-0000-7000-8000-0000000000f3'; // milik U1, dicabut
const T1 = '0190a000-0000-7000-8000-0000000000a1';
const T2 = '0190a000-0000-7000-8000-0000000000a2';
const T_GONE = '0190a000-0000-7000-8000-0000000000a9';
const EP = '0190a000-0000-7000-8000-0000000000b1';
const ART = '0190a000-0000-7000-8000-0000000000c1';
const L1 = '0190a000-0000-7000-8000-000000000101'; // U1/D1/T1
const L2 = '0190a000-0000-7000-8000-000000000102'; // U1/D1/T2 dicabut
const L3 = '0190a000-0000-7000-8000-000000000103'; // U2/D2/T1
const L4 = '0190a000-0000-7000-8000-000000000104'; // U1/D1/EP
const L5 = '0190a000-0000-7000-8000-000000000105'; // U1/D3/T1 (perangkat dicabut)
const L6 = '0190a000-0000-7000-8000-000000000106'; // U1/D1/T_GONE
const L7 = '0190a000-0000-7000-8000-000000000107'; // U1/D1/T1 lisensi lama EXPIRED

const H = 3600_000;
const DAY = 24 * H;
const MIN = 60_000;
const NOW = Date.now();
const DEVICE_REVOKED_AT = new Date(NOW - 2 * DAY);
const L2_REVOKED_AT = new Date(NOW - 3 * DAY);

function store() {
  const licenses = [
    { id: L1, user_id: U1, device_id: D1, track_id: T1, episode_id: null, created_at: new Date(NOW - 20 * DAY), expires_at: new Date(NOW + 10 * DAY), revoked_at: null },
    { id: L2, user_id: U1, device_id: D1, track_id: T2, episode_id: null, created_at: new Date(NOW - 20 * DAY), expires_at: new Date(NOW + 10 * DAY), revoked_at: L2_REVOKED_AT },
    { id: L3, user_id: U2, device_id: D2, track_id: T1, episode_id: null, created_at: new Date(NOW - 20 * DAY), expires_at: new Date(NOW + 10 * DAY), revoked_at: null },
    { id: L4, user_id: U1, device_id: D1, track_id: null, episode_id: EP, created_at: new Date(NOW - 20 * DAY), expires_at: new Date(NOW + 10 * DAY), revoked_at: null },
    { id: L5, user_id: U1, device_id: D3, track_id: T1, episode_id: null, created_at: new Date(NOW - 20 * DAY), expires_at: new Date(NOW + 10 * DAY), revoked_at: new Date(DEVICE_REVOKED_AT.getTime() + 2 * MIN) }, // konsumen iam.device.revoked menyusul
    { id: L6, user_id: U1, device_id: D1, track_id: T_GONE, episode_id: null, created_at: new Date(NOW - 20 * DAY), expires_at: new Date(NOW + 10 * DAY), revoked_at: null },
    { id: L7, user_id: U1, device_id: D1, track_id: T1, episode_id: null, created_at: new Date(NOW - 34 * DAY), expires_at: new Date(NOW - 21 * DAY), revoked_at: null },
  ];
  const plays: any[] = [];
  const qs: any[] = [];
  const listeners = new Set<string>();
  const deltas: any[] = [];
  const t = (d: any) => new Date(d).getTime();
  const f = fakeDb((sql, p) => {
    if (sql.startsWith('SELECT seq, status, reject_reason FROM offline_plays')) return plays.filter((r) => r.device_id === p[0] && p[1].includes(r.seq));
    if (sql.startsWith('SELECT id, user_id, device_id, track_id, episode_id, created_at, expires_at, revoked_at FROM offline_licenses')) return licenses.filter((l) => p[0].includes(l.id));
    if (sql.startsWith('SELECT started_at_client, played_ms FROM offline_plays'))
      return plays.filter((r) => r.device_id === p[0] && r.status === 'ACCEPTED' && t(r.started_at_client) >= t(p[1]) && t(r.started_at_client) < t(p[2]));
    if (sql.startsWith('SELECT count(*)::int AS n FROM (SELECT 1 FROM qualified_streams')) {
      const ref = p[2] ? t(p[2]) : Date.now();
      const n = qs.filter((q) => q.user_id === p[0] && t(q.played_at ?? q.at) > ref - H && (!p[2] || t(q.played_at ?? q.at) <= ref)).length;
      return [{ n: Math.min(n, p[1]) }];
    }
    if (sql.startsWith('SELECT played AS max_played_ms FROM (')) {
      return plays
        .filter((r) => r.user_id === p[0] && r.qualified_at && t(r.started_at_client) <= t(p[2]))
        .sort((a, b) => t(b.started_at_client) - t(a.started_at_client))
        .slice(0, p[1])
        .map((r) => ({ max_played_ms: r.played_ms }));
    }
    if (sql.startsWith('INSERT INTO offline_plays')) {
      if (plays.some((r) => r.device_id === p[2] && r.seq === p[6])) return [];
      const keys = ['id', 'user_id', 'device_id', 'license_id', 'track_id', 'episode_id', 'seq', 'started_at_client', 'played_ms', 'reported_played_ms', 'received_at', 'status', 'reject_reason', 'qualified_at'];
      plays.push(Object.fromEntries(keys.map((k, i) => [k, p[i]])));
      return [{}];
    }
    if (sql.startsWith('INSERT INTO qualified_streams')) {
      if (qs.some((q) => q.session_id === p[0])) return [];
      const keys = ['session_id', 'user_id', 'track_id', 'artist_id', 'city', 'played_ms', 'at', 'suspicious', 'fraud_reason', 'origin', 'played_at'];
      qs.push(Object.fromEntries(keys.map((k, i) => [k, p[i]])));
      return [{}];
    }
    if (sql.startsWith('INSERT INTO daily_listeners')) {
      const k = `${p[0]}|${p[1]}|${p[2]}`;
      if (listeners.has(k)) return [];
      listeners.add(k);
      return [{}];
    }
    if (sql.startsWith('INSERT INTO track_artists')) return [];
    if (sql.startsWith('INSERT INTO agg_deltas')) {
      p[0].forEach((_: unknown, i: number) => deltas.push({ artist_id: p[0][i], date: p[1][i], track_id: p[2][i], source: p[5][i], streams: p[6][i], listeners: p[7][i] }));
      return [];
    }
    return undefined;
  });
  // Transaksi yang menghormati kunci advisory (antrian per kunci) — seperti Postgres.
  const held = new Map<string, Promise<void>>();
  const lockLog: string[] = [];
  const db = {
    ...f.db,
    tx: async (fn: (c: any) => Promise<any>) => {
      let release: (() => void) | null = null;
      const client = {
        query: async (sql: string, params?: any[]) => {
          if (/pg_advisory_xact_lock/.test(sql)) {
            const key = String(params?.[0]);
            while (held.has(key)) await held.get(key);
            let done!: () => void;
            held.set(key, new Promise<void>((r) => (done = r)));
            release = () => {
              held.delete(key);
              done();
            };
            lockLog.push(key);
          }
          await new Promise((r) => setImmediate(r)); // beri kesempatan transaksi lain berjalan (interleaving nyata)
          const rows = await f.db.query(sql, params);
          return { rows, rowCount: rows.length };
        },
      };
      try {
        return await f.db.tx(() => fn(client));
      } finally {
        (release as (() => void) | null)?.();
      }
    },
  };
  return { db: db as any, events: f.events, queries: f.queries, licenses, plays, qs, deltas, lockLog };
}

function deps(meta: Partial<ContentMeta> = {}): OfflinePlayDeps {
  const devices: Record<string, Entitlement['device']> = {
    [D1]: { id: D1, user_id: U1, platform: 'android', public_key: 'x', revoked_at: null },
    [D2]: { id: D2, user_id: U2, platform: 'ios', public_key: 'x', revoked_at: null },
    [D3]: { id: D3, user_id: U1, platform: 'desktop', public_key: 'x', revoked_at: DEVICE_REVOKED_AT.toISOString() },
  };
  return {
    entitlement: async (userId, deviceId) => ({
      user: { id: userId, member_type: 'INDIVIDUAL', member_until: null, premium_active: true, suspended: false },
      device: devices[deviceId] && devices[deviceId]!.user_id === userId ? devices[deviceId] : null,
    }),
    contentMeta: async (tracks, episodes) => ({
      tracks: Object.fromEntries(tracks.filter((id) => id !== T_GONE).map((id) => [id, meta.tracks?.[id] ?? { artist_id: ART, duration_ms: 200_000 }])),
      episodes: Object.fromEntries(episodes.map((id) => [id, meta.episodes?.[id] ?? { duration_ms: 1_800_000 }])),
    }),
  };
}

const iso = (ms: number) => new Date(ms).toISOString();
const p = (seq: number, startMs: number, played_ms = 180_000, over: Record<string, unknown> = {}) => ({ seq, license_id: L1, track_id: T1, started_at: iso(startMs), played_ms, ...over });

describe('playback: POST /v1/events/offline-plays', () => {
  let s: ReturnType<typeof store>;
  beforeEach(() => {
    s = store();
    settings.apply({ 'download.enabled': true, 'royalty.qualified_stream_seconds': 30, 'streaming.fraud_max_streams_per_hour': 120, 'download.report_max_age_days': 35 });
  });
  afterEach(() => settings.apply({ 'download.enabled': false }));
  const app = (d = deps()) => testApp((a) => offlinePlayRoutes(a, { db: s.db, name: 'playback' }, d));
  const send = async (a: any, body: object, user = U1) =>
    a.inject({ method: 'POST', url: '/v1/events/offline-plays', headers: await authAs({ sub: user, city: 'Bandung' } as any), payload: body });

  it('tanpa token → 401; body tidak valid / > 200 event → 400', async () => {
    const a = await app();
    expect((await a.inject({ method: 'POST', url: '/v1/events/offline-plays', payload: { device_id: D1, plays: [] } })).statusCode).toBe(401);
    expect((await send(a, { device_id: D1, plays: [] })).statusCode).toBe(400);
    expect((await send(a, { device_id: D1, plays: Array.from({ length: 201 }, (_, i) => p(i, NOW - DAY + i * 200_000)) })).statusCode).toBe(400);
    expect((await send(a, { device_id: D1, plays: [{ ...p(1, NOW - H), episode_id: EP }] })).statusCode).toBe(400);
  });

  it('putar sah → accepted + qualified stream sumber offline: at = diterima (royalti), played_at = waktu dengar (agregat WIB)', async () => {
    const a = await app();
    const start = NOW - 3 * DAY;
    const r = await send(a, { device_id: D1, plays: [p(1, start), p(2, start + 200_000, 10_000)] });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b).toMatchObject({ device_id: D1, accepted: 2, duplicate: 0, rejected: 0, qualified: 1 });
    expect(b.results).toEqual([
      { seq: 1, status: 'accepted', qualified: true, played_ms: 180_000 },
      { seq: 2, status: 'accepted', qualified: false, played_ms: 10_000 }, // < 30 dtk: tercatat, bukan stream
    ]);
    expect(s.qs).toHaveLength(1);
    const q = s.qs[0];
    expect(q).toMatchObject({ user_id: U1, track_id: T1, artist_id: ART, city: 'Bandung', played_ms: 180_000, suspicious: false, origin: 'offline' });
    expect(new Date(q.played_at).getTime()).toBe(start);
    expect(Math.abs(new Date(q.at).getTime() - Date.now())).toBeLessThan(5_000);
    expect(q.session_id).toBe(s.plays.find((x) => x.seq === 1).id);
    expect(s.deltas).toEqual([{ artist_id: ART, date: wibDate(start), track_id: T1, source: 'offline', streams: 1, listeners: 1 }]);
    const ev = s.events.filter((e) => e.topic === 'playback.stream.qualified');
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ userId: U1, trackId: T1, artistId: ART, playedMs: 180_000, at: iso(start), source: 'offline' });
    expect(s.plays.map((x) => [x.seq, x.status, !!x.qualified_at])).toEqual([
      [1, 'ACCEPTED', true],
      [2, 'ACCEPTED', false],
    ]);
  });

  it('kiriman ulang batch yang sama → semua duplicate, tidak ada stream/agregat/event kedua', async () => {
    const a = await app();
    const body = { device_id: D1, plays: [p(1, NOW - 2 * DAY), p(2, NOW - 2 * DAY + 200_000), p(3, NOW - 2 * DAY - H, 120_000, { license_id: L3 })] };
    const first = (await send(a, body)).json();
    expect(first).toMatchObject({ accepted: 2, rejected: 1, qualified: 2 });
    const again = (await send(a, body)).json();
    expect(again).toMatchObject({ accepted: 0, duplicate: 2, rejected: 1, qualified: 0 });
    expect(again.results[0]).toEqual({ seq: 1, status: 'duplicate', original: 'accepted', reason: null });
    // Lisensi asing tidak disimpan → tetap rejected (deterministik), bukan duplicate.
    expect(again.results[2]).toEqual({ seq: 3, status: 'rejected', reason: 'license_not_found' });
    expect(s.qs).toHaveLength(2);
    expect(s.deltas.reduce((n, d) => n + d.streams, 0)).toBe(2);
    expect(s.events.filter((e) => e.topic === 'playback.stream.qualified')).toHaveLength(2);
  });

  it('seq ganda dalam satu batch → kemunculan kedua duplicate', async () => {
    const a = await app();
    const b = (await send(a, { device_id: D1, plays: [p(7, NOW - DAY), p(7, NOW - DAY + 10 * MIN)] })).json();
    expect(b.results.map((r: any) => r.status)).toEqual(['accepted', 'duplicate']);
    expect(s.qs).toHaveLength(1);
  });

  it('PARALEL: dua request identik dari perangkat yang sama → tepat satu set diterima, sisanya duplicate (kunci per pengguna)', async () => {
    const a = await app();
    const body = { device_id: D1, plays: Array.from({ length: 20 }, (_, i) => p(100 + i, NOW - 5 * DAY + i * 4 * MIN)) };
    const [r1, r2] = await Promise.all([send(a, body), send(a, body)]);
    const b = [r1.json(), r2.json()];
    expect(b.map((x) => x.accepted).sort()).toEqual([0, 20]);
    expect(b.map((x) => x.duplicate).sort()).toEqual([0, 20]);
    expect(s.plays).toHaveLength(20);
    expect(s.qs).toHaveLength(20);
    expect(s.deltas.reduce((n, d) => n + d.streams, 0)).toBe(20);
    expect(s.events.filter((e) => e.topic === 'playback.stream.qualified')).toHaveLength(20);
    // Kunci diambil per pengguna, sebelum membaca data.
    expect(s.lockLog).toEqual([U1, U1]);
    const firstRead = s.queries.findIndex((q) => q.startsWith('SELECT seq, status'));
    expect(firstRead).toBeGreaterThan(-1);
  });

  it('PARALEL: batch berbeda yang tumpang tindih dari dua request → hanya satu yang diterima', async () => {
    const a = await app();
    const start = NOW - 4 * DAY;
    const [r1, r2] = await Promise.all([send(a, { device_id: D1, plays: [p(1, start)] }), send(a, { device_id: D1, plays: [p(2, start + 60_000)] })]);
    const st = [r1.json().results[0], r2.json().results[0]].map((r) => r.status === 'rejected' ? r.reason : r.status).sort();
    expect(st).toEqual(['accepted', 'overlap']);
    expect(s.qs).toHaveLength(1);
  });

  it('lisensi: milik akun/perangkat lain → license_not_found (tidak disimpan), konten lain → license_mismatch, konten dihapus → content_not_found', async () => {
    const a = await app();
    const b = (
      await send(a, {
        device_id: D1,
        plays: [p(1, NOW - DAY, 60_000, { license_id: L3 }), p(2, NOW - DAY + H, 60_000, { track_id: T2 }), p(3, NOW - DAY + 2 * H, 60_000, { license_id: L6, track_id: T_GONE }), p(4, NOW - DAY + 3 * H, 60_000, { license_id: '0190a000-0000-7000-8000-0000000009ff' })],
      })
    ).json();
    expect(b.results.map((r: any) => r.reason)).toEqual(['license_not_found', 'license_mismatch', 'content_not_found', 'license_not_found']);
    expect(s.plays.map((x) => [x.seq, x.status, x.reject_reason])).toEqual([
      [2, 'REJECTED', 'license_mismatch'],
      [3, 'REJECTED', 'content_not_found'],
    ]);
    expect(s.qs).toHaveLength(0);
  });

  it('perangkat milik akun lain / tidak ada → 404 device_not_found', async () => {
    const a = await app();
    const r = await send(a, { device_id: D2, plays: [p(1, NOW - DAY, 60_000, { license_id: L3 })] });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe('device_not_found');
    expect(s.plays).toHaveLength(0);
  });

  it('jendela lisensi: sebelum terbit, setelah kedaluwarsa, setelah dicabut; sebelum pencabutan tetap sah', async () => {
    const a = await app();
    const b = (
      await send(a, {
        device_id: D1,
        plays: [
          p(1, NOW - 21 * DAY, 60_000), // L1 terbit NOW-20d
          p(2, NOW - 22 * DAY, 60_000, { license_id: L7 }), // L7 (EXPIRED) masih berlaku saat itu
          p(3, NOW - 20.5 * DAY, 60_000, { license_id: L7 }), // setelah L7 kedaluwarsa (NOW-21d)
          p(4, NOW - 4 * DAY, 60_000, { license_id: L2, track_id: T2 }), // sebelum L2 dicabut (NOW-3d) → sah
          p(5, NOW - 2.5 * DAY, 60_000, { license_id: L2, track_id: T2 }), // setelah dicabut
        ],
      })
    ).json();
    expect(b.results.map((r: any) => r.reason ?? r.status)).toEqual(['before_license', 'accepted', 'after_license', 'accepted', 'after_license']);
    expect(s.qs).toHaveLength(2);
  });

  it('perangkat dicabut: putar sebelum dicabut diterima; sesudahnya ditolak walau lisensi belum sempat dicabut konsumen', async () => {
    const a = await app();
    const b = (
      await send(a, {
        device_id: D3,
        plays: [p(1, NOW - 3 * DAY, 60_000, { license_id: L5 }), p(2, DEVICE_REVOKED_AT.getTime() + 30_000, 20_000, { license_id: L5 }), p(3, NOW - DAY, 60_000, { license_id: L5 })],
      })
    ).json();
    expect(b.results.map((r: any) => r.reason ?? r.status)).toEqual(['accepted', 'after_device_revoked', 'after_license']);
  });

  it('jam: masa depan > 5 menit → in_future (≤ 5 menit diterima); lebih tua dari download.report_max_age_days → too_old', async () => {
    const a = await app();
    const b = (
      await send(a, {
        device_id: D1,
        plays: [p(1, NOW + 10 * MIN, 1000), p(2, NOW + 2 * MIN, 1000), p(3, NOW - 10 * MIN, 30 * MIN), p(4, NOW - 36 * DAY, 60_000, { license_id: L7 })],
      })
    ).json();
    // seq 3: berakhir 20 menit di masa depan (played_ms dipangkas ke durasi 200 dtk + 5 dtk → berakhir di masa lalu).
    expect(b.results.map((r: any) => r.reason ?? r.status)).toEqual(['in_future', 'accepted', 'accepted', 'too_old']);
    expect(b.results[2].played_ms).toBe(205_000);
    settings.apply({ 'download.report_max_age_days': 7 });
    const c = (await send(a, { device_id: D1, plays: [p(9, NOW - 8 * DAY, 60_000)] })).json();
    expect(c.results[0].reason).toBe('too_old');
  });

  it('played_ms dipangkas ke durasi + 5 dtk; durasi 0 (tidak diketahui) tidak dipangkas', async () => {
    const a = await app(deps({ tracks: { [T1]: { artist_id: ART, duration_ms: 100_000 }, [T2]: { artist_id: ART, duration_ms: 0 } } }));
    const b = (await send(a, { device_id: D1, plays: [p(1, NOW - 5 * DAY, 999_999), p(2, NOW - 4 * DAY, 400_000, { license_id: L2, track_id: T2 })] })).json();
    expect(b.results.map((r: any) => r.played_ms)).toEqual([105_000, 400_000]);
    expect(s.plays.map((x) => [x.played_ms, x.reported_played_ms])).toEqual([
      [105_000, 999_999],
      [400_000, 400_000],
    ]);
  });

  it('tumpang tindih di satu perangkat: berurutan sah, beririsan → overlap — juga saat batch datang tidak berurutan', async () => {
    const a = await app();
    const t0 = NOW - 6 * DAY;
    // Batch "kemudian" tiba lebih dulu.
    const late = (await send(a, { device_id: D1, plays: [p(10, t0 + 10 * MIN)] })).json();
    expect(late.results[0].status).toBe('accepted');
    const early = (
      await send(a, {
        device_id: D1,
        plays: [
          p(1, t0, 180_000), // [t0, t0+3m)
          p(2, t0 + 180_000, 180_000), // tepat setelahnya → sah
          p(3, t0 + 300_000, 120_000), // [5m, 7m) beririsan dengan seq 2 [3m, 6m)
          p(4, t0 + 9 * MIN, 120_000), // [9m, 11m) beririsan dengan seq 10 [10m, 13m)
          p(5, t0 + 13 * MIN + 500, 60_000), // toleransi pembulatan 1 dtk → sah
        ],
      })
    ).json();
    expect(early.results.map((r: any) => r.reason ?? r.status)).toEqual(['accepted', 'accepted', 'overlap', 'overlap', 'accepted']);
  });

  it('batas harian WIB: total putar perangkat per hari > 24 jam → daily_limit', async () => {
    const a = await app(deps({ tracks: { [T1]: { artist_id: ART, duration_ms: 2 * H } } }));
    // Hari WIB 4 hari lalu, 00:00 WIB.
    const day0 = Date.parse(`${wibDate(NOW - 4 * DAY)}T00:00:00+07:00`);
    const plays = Array.from({ length: 23 }, (_, i) => p(i + 1, day0 + i * H, H)); // 23 jam
    plays.push(p(24, day0 + 23 * H, 2 * H)); // +2 jam → 25 jam di hari itu
    plays.push(p(25, day0 + 25 * H, H)); // hari berikutnya → sah
    const b = (await send(a, { device_id: D1, plays })).json();
    expect(b.accepted).toBe(24);
    expect(b.results[23]).toEqual({ seq: 24, status: 'rejected', reason: 'daily_limit' });
    expect(b.results[24].status).toBe('accepted');
  });

  it('fraudCheck sama dengan online: > batas per jam (menurut waktu dengar) → suspicious; sinkron banyak putar lintas hari tidak ditandai', async () => {
    settings.apply({ 'streaming.fraud_max_streams_per_hour': 10 });
    const a = await app(deps({ tracks: { [T1]: { artist_id: ART, duration_ms: 60_000 } } }));
    const spread = Array.from({ length: 30 }, (_, i) => p(i + 1, NOW - 10 * DAY + i * H, 60_000));
    const b1 = (await send(a, { device_id: D1, plays: spread })).json();
    expect(b1).toMatchObject({ accepted: 30, qualified: 30 });
    const burst = Array.from({ length: 12 }, (_, i) => p(100 + i, NOW - 5 * DAY + i * 61_000, 60_000));
    const b2 = (await send(a, { device_id: D1, plays: burst })).json();
    expect(b2).toMatchObject({ accepted: 12, qualified: 10 });
    expect(s.qs.filter((q) => q.suspicious).map((q) => q.fraud_reason)).toEqual(['RATE_LIMIT', 'RATE_LIMIT']);
    // Stream suspicious tidak masuk agregat.
    expect(s.deltas.reduce((n, d) => n + d.streams, 0)).toBe(40);
  });

  it('fraudCheck pola loop 31 detik berlaku untuk putar offline', async () => {
    const a = await app();
    const loop = Array.from({ length: 6 }, (_, i) => p(i + 1, NOW - 2 * DAY + i * MIN, 31_000));
    const b = (await send(a, { device_id: D1, plays: loop })).json();
    expect(b.qualified).toBe(5);
    expect(s.qs[5]).toMatchObject({ suspicious: true, fraud_reason: 'LOOP_31S' });
  });

  it('episode diterima tetapi bukan stream royalti lagu; download.enabled mati tetap menerima laporan', async () => {
    settings.apply({ 'download.enabled': false });
    const a = await app();
    const b = (await send(a, { device_id: D1, plays: [p(1, NOW - DAY, 600_000, { license_id: L4, track_id: undefined, episode_id: EP }), p(2, NOW - 2 * DAY, 90_000)] })).json();
    expect(b.results).toEqual([
      { seq: 1, status: 'accepted', qualified: false, played_ms: 600_000 },
      { seq: 2, status: 'accepted', qualified: true, played_ms: 90_000 },
    ]);
    expect(s.qs.map((q) => q.track_id)).toEqual([T1]);
  });
});
