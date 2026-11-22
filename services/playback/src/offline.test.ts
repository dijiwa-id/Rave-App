import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fromB64u, settings, unwrapCek, verifyLicense, verifyMediaSig, wrapAad, wrapCek } from '@rave/service-kit';
import { authAs, fakeDb, testApp } from '@rave/service-kit/testing';
import { HttpError, offlineDeny } from '@rave/service-kit';
import { mapIamUpstream, mapUpstream, offlineConsumers, offlineExpireJob, offlineRoutes, type Entitlement, type KeyResult, type OfflineDeps } from './offline.js';

const U1 = '0190a000-0000-7000-8000-0000000000e1';
const U2 = '0190a000-0000-7000-8000-0000000000e2';
const D1 = '0190a000-0000-7000-8000-0000000000f1';
const D2 = '0190a000-0000-7000-8000-0000000000f2'; // milik U2
const T1 = '0190a000-0000-7000-8000-0000000000a1';
const T2 = '0190a000-0000-7000-8000-0000000000a2';
const EP = '0190a000-0000-7000-8000-0000000000b1';

const kp = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PUB = (kp.publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64');
const CEK = randomBytes(32);

/** Tabel offline_licenses di memori — mencukupi SQL yang dipakai offline.ts. */
function licenseDb() {
  const rows: any[] = [];
  const reqs: { user_id: string; content_id: string; created_at: Date }[] = [];
  const revs = new Map<string, Date>();
  const rate = new Map<string, { w: number; n: number }>();
  const now = () => Date.now();
  const where = (sql: string, p: any[]) => {
    const w = sql.split("WHERE status = 'ACTIVE' AND ")[1].replace(/ RETURNING id$/, '');
    if (w === 'id = $2') return (r: any) => r.id === p[1];
    if (w === 'device_id = $2') return (r: any) => r.device_id === p[1];
    if (w === 'user_id = $2') return (r: any) => r.user_id === p[1];
    if (w === 'id = ANY($2::uuid[])') return (r: any) => p[1].includes(r.id);
    if (w === 'track_id = ANY($2::uuid[])') return (r: any) => p[1].includes(r.track_id);
    if (w === 'episode_id = ANY($2::uuid[])') return (r: any) => p[1].includes(r.episode_id);
    throw new Error('where tidak dikenal: ' + w);
  };
  const f = fakeDb((sql, p) => {
    if (sql.startsWith('SELECT (SELECT count(*) FROM offline_licenses')) {
      return [
        {
          active: rows.filter((r) => r.device_id === p[0] && r.status === 'ACTIVE').length,
          recent: rows.filter((r) => r.user_id === p[1] && r.created_at.getTime() > now() - 3600_000).length,
          pending: reqs.filter((q) => q.user_id === p[1] && q.content_id !== p[2] && q.created_at.getTime() > now() - 3600_000).length,
          mine_pending: reqs.some((q) => q.user_id === p[1] && q.content_id === p[2] && q.created_at.getTime() > now() - 3600_000),
          existing: rows.find((r) => r.device_id === p[0] && (r.track_id ?? r.episode_id) === p[2] && r.status === 'ACTIVE')?.id ?? null,
        },
      ];
    }
    if (sql.startsWith('INSERT INTO offline_requests')) {
      if (reqs.some((q) => q.user_id === p[0] && q.content_id === p[1])) return [{ inserted: false }];
      reqs.push({ user_id: p[0], content_id: p[1], created_at: new Date() });
      return [{ inserted: true }];
    }
    if (sql.startsWith('DELETE FROM offline_requests WHERE user_id')) {
      for (let i = reqs.length - 1; i >= 0; i--) if (reqs[i].user_id === p[0] && reqs[i].content_id === p[1]) reqs.splice(i, 1);
      return [];
    }
    if (sql.startsWith('INSERT INTO offline_revocations')) {
      for (const id of p[1]) revs.set(`${p[0]}:${id}`, new Date());
      return [];
    }
    if (sql.startsWith('SELECT 1 FROM offline_revocations')) {
      const since = (p[4] as Date).getTime();
      const keys = [`user:${p[0]}`, `device:${p[1]}`, `${p[2]}:${p[3]}`];
      return keys.some((k) => (revs.get(k)?.getTime() ?? 0) >= since) ? [{ '?column?': 1 }] : [];
    }
    if (sql.startsWith('INSERT INTO offline_rate')) {
      const w = Math.floor(now() / 60_000);
      const cur = rate.get(p[0]);
      const n = cur && cur.w === w ? cur.n + 1 : 1;
      rate.set(p[0], { w, n });
      return [{ n }];
    }
    if (sql.startsWith('DELETE FROM offline_')) return [];
    if (sql.startsWith('INSERT INTO offline_licenses')) {
      const r = { id: p[0], user_id: p[1], device_id: p[2], track_id: p[3], episode_id: p[4], artifact_id: p[5], artifact: JSON.parse(p[6]), wrapped_key: JSON.parse(p[7]), issued_at: p[8], expires_at: p[9], recheck_at: p[10], status: 'ACTIVE', created_at: new Date(), revoked_at: null, revoke_reason: null };
      rows.push(r);
      return [r];
    }
    if (sql.startsWith('UPDATE offline_licenses SET artifact_id')) {
      const r = rows.find((x) => x.id === p[0]);
      Object.assign(r, { artifact_id: p[1], artifact: JSON.parse(p[2]), wrapped_key: JSON.parse(p[3]), issued_at: p[4], expires_at: p[5], recheck_at: p[6] });
      return [r];
    }
    if (sql.startsWith("UPDATE offline_licenses SET status = 'REVOKED'")) {
      const m = where(sql, p);
      return rows.filter((r) => r.status === 'ACTIVE' && m(r)).map((r) => (Object.assign(r, { status: 'REVOKED', revoked_at: new Date(), revoke_reason: p[0] }), { id: r.id }));
    }
    if (sql.startsWith("UPDATE offline_licenses SET status = 'EXPIRED', updated_at = now() WHERE id = ANY")) {
      rows.filter((r) => p[0].includes(r.id) && r.user_id === p[1] && r.status === 'ACTIVE' && new Date(r.expires_at).getTime() <= now()).forEach((r) => (r.status = 'EXPIRED'));
      return [];
    }
    if (sql.startsWith("UPDATE offline_licenses SET status = 'EXPIRED', updated_at = now() WHERE id IN")) {
      return rows.filter((r) => r.status === 'ACTIVE' && new Date(r.expires_at).getTime() <= now()).map((r) => ((r.status = 'EXPIRED'), { id: r.id }));
    }
    if (sql.startsWith('SELECT * FROM offline_licenses WHERE id = ANY')) return rows.filter((r) => p[0].includes(r.id) && r.user_id === p[1] && r.device_id === p[2]);
    if (sql.startsWith('UPDATE offline_licenses SET expires_at')) return rows.filter((r) => p[0].includes(r.id) && r.status === 'ACTIVE').map((r) => Object.assign(r, { expires_at: p[1], recheck_at: p[2] }));
    if (sql.startsWith('SELECT * FROM offline_licenses WHERE id = $1 AND user_id = $2')) return rows.filter((r) => r.id === p[0] && r.user_id === p[1]);
    if (sql.startsWith('SELECT * FROM offline_licenses WHERE id = $1')) return rows.filter((r) => r.id === p[0]);
    if (sql.startsWith('SELECT * FROM offline_licenses WHERE user_id = $1')) return rows.filter((r) => r.user_id === p[0] && (!p[1] || r.device_id === p[1]) && (p[2] === 'all' || r.status === p[2]));
    return undefined;
  });
  return { ...f, rows, reqs, revs, rate };
}

const artifact = (id: string) => ({ id: `art-${id}`, version: 1, format: 'RAVEOFL1' as const, rendition: 'normal', codec_label: 'AAC 160 kbps', mime: 'audio/mp4', size: 1000, plain_size: 900, sha256: 'ab'.repeat(32), url: `/v1/catalog/media/ofl-${id}-v1.rofl` });

function deps(over: Partial<{ member: Partial<Entitlement['user']>; devices: Record<string, Entitlement['device']>; key: (id: string) => KeyResult; available: Record<string, boolean> }> = {}) {
  const calls = { key: 0 };
  const d: OfflineDeps = {
    entitlement: async (userId, deviceId) => ({
      user: { id: userId, member_type: 'INDIVIDUAL', member_until: null, premium_active: true, suspended: false, ...over.member },
      device: (over.devices ?? { [D1]: { id: D1, user_id: U1, platform: 'desktop', public_key: PUB, revoked_at: null }, [D2]: { id: D2, user_id: U2, platform: 'android', public_key: PUB, revoked_at: null } })[deviceId] ?? null,
    }),
    contentKey: async (_kind, id, pk) => {
      calls.key++;
      return over.key ? over.key(id) : { status: 'ready', artifact: artifact(id), wrapped_key: wrapCek(CEK, pk, wrapAad(_kind, id)) };
    },
    contentStatus: async (tracks, episodes) => Object.fromEntries([...tracks, ...episodes].map((id) => [id, over.available?.[id] ?? true])),
  };
  return { d, calls };
}

const ON = { 'download.enabled': true, 'download.allow_user_ids': [], 'download.tiers': ['INDIVIDUAL', 'STUDENT', 'DUO'], 'download.max_tracks_per_device': 500, 'download.rate_per_user_hour': 60, 'download.license_ttl_days': 30, 'download.recheck_hours': 72, 'download.podcast_enabled': true };

describe('playback: lisensi unduhan offline', () => {
  let s: ReturnType<typeof licenseDb>;
  beforeEach(() => {
    s = licenseDb();
    settings.apply(ON);
  });
  afterEach(() => settings.apply({ 'download.enabled': false }));
  const app = (dep = deps().d) => testApp((a) => offlineRoutes(a, { db: s.db, name: 'playback' }, dep));
  const issue = async (a: any, body: object, user = U1, extra: Record<string, string> = {}) =>
    a.inject({ method: 'POST', url: '/v1/offline/licenses', headers: { ...(await authAs({ sub: user })), ...extra }, payload: body });

  it('tanpa token → 401; pubkey publik tanpa token', async () => {
    const a = await app();
    expect((await a.inject({ method: 'POST', url: '/v1/offline/licenses', payload: {} })).statusCode).toBe(401);
    const pk = await a.inject({ method: 'GET', url: '/v1/offline/pubkey' });
    expect(pk.statusCode).toBe(200);
    expect(pk.json()).toMatchObject({ alg: 'Ed25519' });
  });

  it('berhak → 201: lisensi terverifikasi, kunci dibuka perangkat, URL unduhan bertanda tangan', async () => {
    const a = await app();
    const r = await issue(a, { device_id: D1, track_id: T1 });
    expect(r.statusCode).toBe(201);
    const b = r.json();
    expect(b.status).toBe('ACTIVE');
    const payload = verifyLicense<any>(b.license, fromB64u((await a.inject({ method: 'GET', url: '/v1/offline/pubkey' })).json().public_key))!;
    expect(payload).toMatchObject({ v: 1, typ: 'rave.offline.license', license_id: b.id, user_id: U1, device_id: D1, track_id: T1, episode_id: null });
    expect(new Date(payload.expires_at).getTime() - new Date(payload.issued_at).getTime()).toBe(30 * 86400_000);
    expect(new Date(payload.recheck_at).getTime() - new Date(payload.issued_at).getTime()).toBe(72 * 3600_000);
    expect(unwrapCek(payload.key, kp.privateKey, wrapAad('track', T1)).equals(CEK)).toBe(true);
    const u = new URL(b.download.url, 'http://x');
    expect(verifyMediaSig(u.pathname, u.searchParams.get('exp'), u.searchParams.get('sig'))).toBe(true);
    expect(payload.artifact.url).toBeUndefined(); // URL tidak masuk payload bertanda tangan
    expect(r.headers['cache-control']).toBe('private, no-store');
  });

  it('idempoten: permintaan ulang konten+perangkat yang sama → 200, lisensi sama (diperbarui), tidak dihitung rate', async () => {
    const a = await app();
    const r1 = (await issue(a, { device_id: D1, track_id: T1 })).json();
    const r2 = await issue(a, { device_id: D1, track_id: T1 });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().id).toBe(r1.id);
    expect(s.rows).toHaveLength(1);
  });

  it.each([
    ['flag mati', { 'download.enabled': false }, {}, 403, 'offline_disabled'],
    ['di luar allowlist rollout', { 'download.allow_user_ids': [U2] }, {}, 403, 'rollout_not_included'],
    ['pengguna Gratis', {}, { member_type: 'FREE', premium_active: false }, 403, 'premium_required'],
    ['Premium kedaluwarsa', {}, { member_type: 'INDIVIDUAL', premium_active: false }, 403, 'premium_required'],
    ['paket tidak diizinkan', { 'download.tiers': ['DUO'] }, {}, 403, 'tier_not_allowed'],
    ['akun ditangguhkan', {}, { suspended: true }, 403, 'account_suspended'],
  ])('%s → %i %s', async (_n, st, member, status, code) => {
    settings.apply(st);
    const { d, calls } = deps({ member });
    const r = await issue(await app(d), { device_id: D1, track_id: T1 });
    expect(r.statusCode).toBe(status);
    expect(r.json().code).toBe(code);
    expect(calls.key).toBe(0);
    expect(s.rows).toHaveLength(0);
  });

  it('perangkat milik orang lain / tidak ada → 404; perangkat dicabut → 403', async () => {
    expect((await issue(await app(), { device_id: D2, track_id: T1 })).statusCode).toBe(404);
    expect((await issue(await app(), { device_id: '0190a000-0000-7000-8000-0000000000ff', track_id: T1 })).statusCode).toBe(404);
    const { d } = deps({ devices: { [D1]: { id: D1, user_id: U1, platform: 'ios', public_key: PUB, revoked_at: new Date().toISOString() } } });
    const r = await issue(await app(d), { device_id: D1, track_id: T1 });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('device_revoked');
  });

  it('konten: offline_allowed false → 403, rilis tidak LIVE → 404, artefak disiapkan → 202 tanpa lisensi', async () => {
    const { offlineDeny } = await import('@rave/service-kit');
    const mk = (code: any) => deps({ key: () => { throw offlineDeny(code); } }).d;
    const na = await issue(await app(mk('content_not_allowed')), { device_id: D1, track_id: T1 });
    expect([na.statusCode, na.json().code]).toEqual([403, 'content_not_allowed']);
    const nf = await issue(await app(mk('content_not_found')), { device_id: D1, track_id: T1 });
    expect([nf.statusCode, nf.json().code]).toEqual([404, 'content_not_found']);
    const prep = await issue(await app(deps({ key: () => ({ status: 'preparing', retry_after_s: 15 }) }).d), { device_id: D1, track_id: T1 });
    expect(prep.statusCode).toBe(202);
    expect(prep.headers['retry-after']).toBe('15');
    expect(s.rows).toHaveLength(0);
  });

  it('podcast dimatikan → episode 403, lagu tetap boleh; input ganda → 400', async () => {
    settings.apply({ 'download.podcast_enabled': false });
    const a = await app();
    expect((await issue(a, { device_id: D1, episode_id: EP })).json().code).toBe('podcast_disabled');
    expect((await issue(a, { device_id: D1, track_id: T1 })).statusCode).toBe(201);
    expect((await issue(a, { device_id: D1, track_id: T1, episode_id: EP })).statusCode).toBe(400);
  });

  it('batas lagu per perangkat → 409 device_full (perpanjangan tetap boleh)', async () => {
    settings.apply({ 'download.max_tracks_per_device': 1 });
    const a = await app();
    expect((await issue(a, { device_id: D1, track_id: T1 })).statusCode).toBe(201);
    const full = await issue(a, { device_id: D1, track_id: T2 });
    expect([full.statusCode, full.json().code, full.json().limit]).toEqual([409, 'device_full', 1]);
    expect((await issue(a, { device_id: D1, track_id: T1 })).statusCode).toBe(200);
  });

  it('rate limit lisensi baru per jam → 429 rate_limited (pesan EN tersedia)', async () => {
    settings.apply({ 'download.rate_per_user_hour': 2 });
    const a = await app();
    expect((await issue(a, { device_id: D1, track_id: T1 })).statusCode).toBe(201);
    expect((await issue(a, { device_id: D1, track_id: T2 })).statusCode).toBe(201);
    const r = await issue(a, { device_id: D1, episode_id: EP }, U1, { 'accept-language': 'en' });
    expect(r.statusCode).toBe(429);
    expect(r.json().code).toBe('rate_limited');
    expect(r.json().detail).toMatch(/Too many new downloads/);
  });

  it('daftar & hapus hanya milik sendiri (orang lain → 404), hapus idempoten', async () => {
    const a = await app();
    const lic = (await issue(a, { device_id: D1, track_id: T1 })).json();
    const list = await a.inject({ method: 'GET', url: `/v1/offline/licenses?device_id=${D1}`, headers: await authAs({ sub: U1 }) });
    expect(list.json().data.map((x: any) => x.id)).toEqual([lic.id]);
    const other = await a.inject({ method: 'GET', url: '/v1/offline/licenses', headers: await authAs({ sub: U2 }) });
    expect(other.json().data).toEqual([]);
    expect((await a.inject({ method: 'DELETE', url: `/v1/offline/licenses/${lic.id}`, headers: await authAs({ sub: U2 }) })).statusCode).toBe(404);
    const del = await a.inject({ method: 'DELETE', url: `/v1/offline/licenses/${lic.id}`, headers: await authAs({ sub: U1 }) });
    expect(del.json()).toMatchObject({ status: 'REVOKED', revoke_reason: 'USER_REMOVED', license: null });
    expect((await a.inject({ method: 'DELETE', url: `/v1/offline/licenses/${lic.id}`, headers: await authAs({ sub: U1 }) })).statusCode).toBe(200);
  });

  describe('recheck', () => {
    const recheck = async (a: any, ids: string[], device = D1, user = U1) =>
      a.inject({ method: 'POST', url: '/v1/offline/recheck', headers: await authAs({ sub: user }), payload: { device_id: device, license_ids: ids } });

    it('memperpanjang yang berhak, mencabut konten yang ditarik, melaporkan kedaluwarsa & tidak dikenal', async () => {
      const a = await app();
      const l1 = (await issue(a, { device_id: D1, track_id: T1 })).json();
      const l2 = (await issue(a, { device_id: D1, track_id: T2 })).json();
      const l3 = (await issue(a, { device_id: D1, episode_id: EP })).json();
      s.rows.find((r) => r.id === l3.id).expires_at = new Date(Date.now() - 1000);
      for (const r of s.rows) r.recheck_at = new Date(Date.now() - 1000); // sudah waktunya cek ulang
      const unknown = '0190a000-0000-7000-8000-00000000dead';
      const r = await recheck(await app(deps({ available: { [T2]: false } }).d), [l1.id, l2.id, l3.id, unknown]);
      expect(r.statusCode).toBe(200);
      const b = r.json();
      expect(b.renewed.map((x: any) => x.license_id)).toEqual([l1.id]);
      expect(verifyLicense<any>(b.renewed[0].license)!.license_id).toBe(l1.id);
      expect(b.revoked).toEqual([{ license_id: l2.id, reason: 'CONTENT_WITHDRAWN' }]);
      expect(b.expired).toEqual([l3.id]);
      expect(b.unknown).toEqual([unknown]);
    });

    it('bukan Premium lagi → semua lisensi pengguna dicabut (MEMBERSHIP)', async () => {
      const a = await app();
      const l1 = (await issue(a, { device_id: D1, track_id: T1 })).json();
      const r = await recheck(await app(deps({ member: { member_type: 'FREE', premium_active: false } }).d), [l1.id]);
      expect(r.json().revoked).toEqual([{ license_id: l1.id, reason: 'MEMBERSHIP' }]);
      expect(r.json().renewed).toEqual([]);
    });

    it('perangkat dicabut → DEVICE_REVOKED; perangkat orang lain → 404; lisensi orang lain → unknown', async () => {
      const a = await app();
      const l1 = (await issue(a, { device_id: D1, track_id: T1 })).json();
      expect((await recheck(a, [l1.id], D2)).statusCode).toBe(404);
      const u2 = await recheck(await app(deps({ devices: { [D1]: { id: D1, user_id: U2, platform: 'web', public_key: PUB, revoked_at: null } } }).d), [l1.id], D1, U2);
      expect(u2.json().unknown).toEqual([l1.id]);
      const rv = await recheck(await app(deps({ devices: { [D1]: { id: D1, user_id: U1, platform: 'web', public_key: PUB, revoked_at: new Date().toISOString() } } }).d), [l1.id]);
      expect(rv.json().revoked).toEqual([{ license_id: l1.id, reason: 'DEVICE_REVOKED' }]);
    });

    it('flag mati → 403 (lisensi tidak diubah; berlaku sampai kedaluwarsa)', async () => {
      const a = await app();
      const l1 = (await issue(a, { device_id: D1, track_id: T1 })).json();
      settings.apply({ 'download.enabled': false });
      expect((await recheck(a, [l1.id])).statusCode).toBe(403);
      expect(s.rows[0].status).toBe('ACTIVE');
    });
  });

  describe('konsumen pencabutan (idempoten, di tx handler)', () => {
    const evt = (topic: string, payload: any) => ({ id: 'e', topic, key: 'k', payload, occurredAt: new Date().toISOString(), producer: 't' }) as any;
    const seed = async () => {
      const a = await app();
      await issue(a, { device_id: D1, track_id: T1 });
      await issue(a, { device_id: D1, episode_id: EP });
    };
    const run = async (topic: string, payload: any) => {
      const h = (offlineConsumers() as any)[topic];
      await s.db.tx((tx) => h(evt(topic, payload), tx));
      await s.db.tx((tx) => h(evt(topic, payload), tx)); // event datang ulang
    };

    it('iam.user.member_changed ke FREE → MEMBERSHIP; tetap Premium → tidak berubah', async () => {
      await seed();
      await run('iam.user.member_changed', { userId: U1, memberType: 'DUO', memberUntil: null, premium: true });
      expect(s.rows.every((r) => r.status === 'ACTIVE')).toBe(true);
      await run('iam.user.member_changed', { userId: U1, memberType: 'FREE', memberUntil: null, premium: false });
      expect(s.rows.map((r) => [r.status, r.revoke_reason])).toEqual([['REVOKED', 'MEMBERSHIP'], ['REVOKED', 'MEMBERSHIP']]);
    });

    it('iam.device.revoked → semua lisensi perangkat itu DEVICE_REVOKED', async () => {
      await seed();
      await run('iam.device.revoked', { deviceId: D1, userId: U1, reason: 'USER' });
      expect(s.rows.every((r) => r.status === 'REVOKED' && r.revoke_reason === 'DEVICE_REVOKED')).toBe(true);
    });

    it('catalog.offline.revoked (lagu) → hanya lisensi lagu itu CONTENT_WITHDRAWN', async () => {
      await seed();
      await run('catalog.offline.revoked', { contentKind: 'track', contentIds: [T1], reason: 'TAKEN_DOWN' });
      expect(s.rows.find((r) => r.track_id === T1)).toMatchObject({ status: 'REVOKED', revoke_reason: 'CONTENT_WITHDRAWN' });
      expect(s.rows.find((r) => r.episode_id === EP).status).toBe('ACTIVE');
      await run('catalog.offline.revoked', { contentKind: 'episode', contentIds: [EP], reason: 'UNPUBLISHED' });
      expect(s.rows.find((r) => r.episode_id === EP).status).toBe('REVOKED');
    });

    it('job kedaluwarsa menandai EXPIRED', async () => {
      await seed();
      s.rows[0].expires_at = new Date(Date.now() - 1);
      await offlineExpireJob.run({ db: s.db, log: { info() {} } } as any);
      expect(s.rows.map((r) => r.status)).toEqual(['EXPIRED', 'ACTIVE']);
    });
  });
  // ---------------- Review keamanan P-7 ----------------
  describe('M2: banjir artefak lewat jalur 202', () => {
    const uuid = (i: number) => `0190a000-0000-7000-8000-${String(i).padStart(12, '0')}`;
    const preparing = () => deps({ key: () => ({ status: 'preparing', retry_after_s: 15 }) });

    it('N permintaan 202 untuk konten berbeda → setelah download.pending_per_user → 429 rate_limited, catalog tidak dipanggil lagi', async () => {
      settings.apply({ 'download.pending_per_user': 3 });
      const { d, calls } = preparing();
      const a = await app(d);
      for (let i = 1; i <= 3; i++) expect((await issue(a, { device_id: D1, track_id: uuid(i) })).statusCode).toBe(202);
      const r = await issue(a, { device_id: D1, track_id: uuid(4) });
      expect(r.statusCode).toBe(429);
      expect(r.json()).toMatchObject({ code: 'rate_limited', retry_after_s: 60 });
      expect(r.headers['retry-after']).toBe('60');
      expect(calls.key).toBe(3);
      // Polling konten yang SAMA tidak menambah hitungan & tetap dilayani.
      expect((await issue(a, { device_id: D1, track_id: uuid(2) })).statusCode).toBe(202);
      expect(s.reqs).toHaveLength(3);
      settings.apply({ 'download.pending_per_user': 20 });
    });

    it('permintaan menunggu ikut dihitung ke rate_per_user_hour; lisensi terbit menggantikan reservasinya (tidak dihitung dua kali)', async () => {
      settings.apply({ 'download.rate_per_user_hour': 3 });
      const a = await app(preparing().d);
      expect((await issue(a, { device_id: D1, track_id: T1 })).statusCode).toBe(202);
      expect((await issue(a, { device_id: D1, track_id: T2 })).statusCode).toBe(202);
      const ready = await app(); // artefak T1 siap
      expect((await issue(ready, { device_id: D1, track_id: T1 })).statusCode).toBe(201);
      expect(s.reqs.map((q) => q.content_id)).toEqual([T2]);
      // 1 lisensi + 1 menunggu = 2 < 3 → konten ketiga boleh; keempat ditolak.
      expect((await issue(a, { device_id: D1, episode_id: EP })).statusCode).toBe(202);
      const r = await issue(a, { device_id: D1, track_id: uuid(9) });
      expect([r.statusCode, r.json().code, r.json().retry_after_s]).toEqual([429, 'rate_limited', 3600]);
    });

    it('antrean catalog penuh (503 queue_full, tiba sebagai 502 dari callService) → 503 + Retry-After, reservasi dilepas', async () => {
      const upstream = new HttpError(502, 'Upstream error', 'Antrean penyiapan unduhan sedang penuh. Coba lagi beberapa saat lagi');
      const { d } = deps({ key: () => mapUpstream(upstream) });
      const r = await issue(await app(d), { device_id: D1, track_id: T1 });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ code: 'queue_full', retry_after_s: 60 });
      expect(r.headers['retry-after']).toBe('60');
      expect(s.reqs).toHaveLength(0);
      expect(s.rows).toHaveLength(0);
    });

    it('konten ditolak final (403 content_not_allowed) → reservasi dilepas', async () => {
      const { d } = deps({ key: () => { throw offlineDeny('content_not_allowed'); } });
      expect((await issue(await app(d), { device_id: D1, track_id: T1 })).statusCode).toBe(403);
      expect(s.reqs).toHaveLength(0);
    });
  });

  describe('L2: pencabutan bersamaan dengan penerbitan', () => {
    it('perangkat dicabut saat artefak diminta → hak diperiksa ulang → 403 device_revoked, tidak ada lisensi ACTIVE', async () => {
      let revoked = false;
      const base = deps().d;
      const d: OfflineDeps = {
        ...base,
        entitlement: async (u, dev) => {
          const e = await base.entitlement(u, dev);
          return revoked && e.device ? { ...e, device: { ...e.device, revoked_at: new Date().toISOString() } } : e;
        },
        contentKey: async (kind, id, pk) => {
          const out = await base.contentKey(kind, id, pk);
          // Event iam.device.revoked dikonsumsi di antara pemeriksaan hak & transaksi penerbitan.
          revoked = true;
          await s.db.tx((tx) => (offlineConsumers() as any)['iam.device.revoked']({ payload: { deviceId: D1, userId: U1, reason: 'USER' } }, tx));
          return out;
        },
      };
      const r = await issue(await app(d), { device_id: D1, track_id: T1 });
      expect([r.statusCode, r.json().code]).toEqual([403, 'device_revoked']);
      expect(s.rows).toHaveLength(0);
    });

    it('konten ditarik saat penerbitan → tidak terbit (409 content_unavailable bila sumber masih menjawab siap)', async () => {
      const base = deps().d;
      const d: OfflineDeps = {
        ...base,
        contentKey: async (kind, id, pk) => {
          const out = await base.contentKey(kind, id, pk);
          await s.db.tx((tx) => (offlineConsumers() as any)['catalog.offline.revoked']({ payload: { contentKind: 'track', contentIds: [T1], reason: 'OFFLINE_DISABLED' } }, tx));
          return out;
        },
      };
      const r = await issue(await app(d), { device_id: D1, track_id: T1 });
      expect([r.statusCode, r.json().code]).toEqual([409, 'content_unavailable']);
      expect(s.rows.filter((x) => x.status === 'ACTIVE')).toHaveLength(0);
      expect(s.queries.some((q) => q.includes("hashtext('playback.offline.rev')"))).toBe(true);
    });
  });

  describe('L1: akun ditangguhkan / dihapus', () => {
    it.each(['iam.user.suspended', 'iam.user.deleted'])('%s → semua lisensi pengguna REVOKED (ACCOUNT_SUSPENDED), idempoten', async (topic) => {
      const a = await app();
      await issue(a, { device_id: D1, track_id: T1 });
      await issue(a, { device_id: D1, episode_id: EP });
      const h = (offlineConsumers() as any)[topic];
      await s.db.tx((tx) => h({ payload: { userId: U1 } }, tx));
      await s.db.tx((tx) => h({ payload: { userId: U1 } }, tx));
      expect(s.rows.map((r) => [r.status, r.revoke_reason])).toEqual([['REVOKED', 'ACCOUNT_SUSPENDED'], ['REVOKED', 'ACCOUNT_SUSPENDED']]);
      expect(s.revs.has(`user:${U1}`)).toBe(true);
    });
  });

  describe('L6: recheck', () => {
    const recheck = async (a: any, ids: string[]) => a.inject({ method: 'POST', url: '/v1/offline/recheck', headers: await authAs({ sub: U1 }), payload: { device_id: D1, license_ids: ids } });

    it('lisensi yang belum waktunya → unchanged (tidak ditandatangani ulang / ditulis ulang)', async () => {
      const a = await app();
      const l1 = (await issue(a, { device_id: D1, track_id: T1 })).json();
      const before = s.rows[0].expires_at;
      const b = (await recheck(a, [l1.id])).json();
      expect(b).toMatchObject({ renewed: [], revoked: [], expired: [], unknown: [], unchanged: [l1.id] });
      expect(s.rows[0].expires_at).toBe(before);
    });

    it('> download.recheck_per_minute per akun → 429 + Retry-After', async () => {
      settings.apply({ 'download.recheck_per_minute': 2 });
      const a = await app();
      expect((await recheck(a, [])).statusCode).toBe(200);
      expect((await recheck(a, [])).statusCode).toBe(200);
      const r = await recheck(a, []);
      expect(r.statusCode).toBe(429);
      expect(r.headers['retry-after']).toBe('60');
      settings.apply({ 'download.recheck_per_minute': 6 });
    });
  });

  describe('L8: galat hulu', () => {
    const codeOf = (fn: () => never) => {
      try {
        fn();
      } catch (e) {
        return [(e as HttpError).status, (e as HttpError).extra?.code, (e as HttpError).detail];
      }
    };
    it('4xx catalog tanpa padanan §12 → 502 generik (detail internal tidak bocor); 404/409 dipetakan; 5xx diteruskan', () => {
      expect(codeOf(() => mapUpstream(new HttpError(403, 'Upstream error', 'Khusus antar-service')))?.slice(0, 2)).toEqual([502, 'upstream_error']);
      expect(codeOf(() => mapUpstream(new HttpError(422, 'Upstream error', 'Kunci publik perangkat tidak valid')))?.[2]).not.toMatch(/Kunci/);
      expect(codeOf(() => mapUpstream(new HttpError(404, 'Upstream error', 'x')))?.slice(0, 2)).toEqual([404, 'content_not_found']);
      expect(codeOf(() => mapUpstream(new HttpError(403, 'Upstream error', 'Pemilik konten tidak mengizinkan unduhan offline')))?.slice(0, 2)).toEqual([403, 'content_not_allowed']);
      expect(codeOf(() => mapUpstream(new HttpError(504, 'Gateway Timeout', 'catalog tidak merespons')))?.[0]).toBe(504);
      expect(codeOf(() => mapIamUpstream(new HttpError(404, 'Upstream error', 'Pengguna tidak ditemukan')))?.slice(0, 2)).toEqual([403, 'account_suspended']);
      expect(codeOf(() => mapIamUpstream(new HttpError(400, 'Upstream error', 'x')))?.slice(0, 2)).toEqual([502, 'upstream_error']);
    });
  });
});
