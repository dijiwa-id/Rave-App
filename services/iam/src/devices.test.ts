import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settings } from '@rave/service-kit';
import { asService, authAs, fakeDb, testApp } from '@rave/service-kit/testing';
import { deviceRoutes } from './devices.js';

const U1 = '0190a000-0000-7000-8000-0000000000a1';
const U2 = '0190a000-0000-7000-8000-0000000000a2';
const pub = () => (generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64');

/** Tabel user_devices di memori. */
function store(user: Record<string, unknown> = {}) {
  const rows: any[] = [];
  const f = fakeDb((sql, p) => {
    if (sql.startsWith('UPDATE user_devices SET platform')) {
      const r = rows.find((d) => d.user_id === p[0] && d.key_fingerprint === p[1] && !d.revoked_at);
      if (!r) return [];
      Object.assign(r, { platform: p[2], name: p[3] });
      return [r];
    }
    if (sql.includes('FROM user_devices WHERE user_id = $1 AND revoked_at IS NULL')) return rows.filter((d) => d.user_id === p[0] && !d.revoked_at);
    if (sql.startsWith('INSERT INTO user_devices')) {
      const r = { id: p[0], user_id: p[1], platform: p[2], name: p[3], public_key: p[4], key_fingerprint: p[5], app_version: p[6], created_at: new Date(), last_seen_at: new Date(), revoked_at: null };
      rows.push(r);
      return [r];
    }
    if (sql.includes('FROM user_devices WHERE id = $1 AND user_id = $2 FOR UPDATE')) return rows.filter((d) => d.id === p[0] && d.user_id === p[1]);
    if (sql.startsWith('UPDATE user_devices SET revoked_at')) {
      const r = rows.find((d) => d.id === p[0])!;
      r.revoked_at = new Date();
      return [r];
    }
    if (sql.startsWith('SELECT id, member_type')) return p[0] === U1 ? [{ id: U1, member_type: 'INDIVIDUAL', member_until: null, premium: true, suspended_at: null, deleted_at: null, ...user }] : [];
    if (sql.startsWith('SELECT ceil(extract(epoch FROM (max(revoked_at)')) {
      const hit = rows.filter((d) => d.user_id === p[0] && d.key_fingerprint === p[1] && d.revoked_at && d.revoked_at.getTime() > Date.now() - p[2] * 86400_000);
      return [{ retry_s: hit.length ? Math.ceil((Math.max(...hit.map((d) => d.revoked_at.getTime())) + p[2] * 86400_000 - Date.now()) / 1000) : null }];
    }
    if (sql.startsWith('SELECT count(*)::int AS n, ceil(extract(epoch FROM (min(created_at)')) {
      const hit = rows.filter((d) => d.user_id === p[0] && d.created_at.getTime() > Date.now() - 86400_000);
      return [{ n: hit.length, retry_s: hit.length ? Math.ceil((Math.min(...hit.map((d) => d.created_at.getTime())) + 86400_000 - Date.now()) / 1000) : null }];
    }
    if (sql.startsWith('UPDATE user_devices SET last_seen_at')) return rows.filter((d) => d.id === p[0] && d.user_id === p[1]);
    return undefined;
  });
  return { ...f, rows };
}
const reg = async (a: any, user = U1, key = pub()) =>
  a.inject({ method: 'POST', url: '/v1/me/devices', headers: await authAs({ sub: user }), payload: { platform: 'android', name: 'HP', public_key: key } });

describe('iam: perangkat unduhan offline', () => {
  let s: ReturnType<typeof store>;
  const app = async () => testApp((a) => deviceRoutes(a, { db: s.db }));
  beforeEach(() => {
    s = store();
    settings.apply({ 'download.enabled': true, 'subscription.download_devices': 5 });
  });
  afterEach(() => settings.apply({ 'download.enabled': false }));

  it('tanpa token → 401', async () => {
    const a = await app();
    expect((await a.inject({ method: 'GET', url: '/v1/me/devices' })).statusCode).toBe(401);
    expect((await a.inject({ method: 'POST', url: '/v1/me/devices', payload: {} })).statusCode).toBe(401);
  });

  it('flag mati → 403 offline_disabled (melihat daftar tetap boleh)', async () => {
    settings.apply({ 'download.enabled': false });
    const a = await app();
    const h = await authAs({ sub: U1 });
    const r = await a.inject({ method: 'POST', url: '/v1/me/devices', headers: h, payload: { platform: 'desktop', name: 'Laptop', public_key: pub() } });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('offline_disabled');
    expect((await a.inject({ method: 'GET', url: '/v1/me/devices', headers: h })).statusCode).toBe(200);
  });

  it('input tidak valid → 400; kunci bukan P-256 → 422', async () => {
    const a = await app();
    const h = await authAs({ sub: U1 });
    expect((await a.inject({ method: 'POST', url: '/v1/me/devices', headers: h, payload: { platform: 'tv', name: 'x', public_key: pub() } })).statusCode).toBe(400);
    const ed = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64') + 'A'.repeat(40);
    const r = await a.inject({ method: 'POST', url: '/v1/me/devices', headers: h, payload: { platform: 'web', name: 'x', public_key: ed } });
    expect(r.statusCode).toBe(422);
  });

  it('daftar → 201; kunci sama lagi → 200 (upsert, bukan perangkat baru)', async () => {
    const a = await app();
    const h = await authAs({ sub: U1 });
    const key = pub();
    const r1 = await a.inject({ method: 'POST', url: '/v1/me/devices', headers: h, payload: { platform: 'android', name: 'HP', public_key: key } });
    expect(r1.statusCode).toBe(201);
    const r2 = await a.inject({ method: 'POST', url: '/v1/me/devices', headers: h, payload: { platform: 'android', name: 'HP baru', public_key: key } });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().id).toBe(r1.json().id);
    expect(r2.json().name).toBe('HP baru');
    expect(s.rows).toHaveLength(1);
  });

  it('perangkat ke-6 → 409 device_limit beserta daftar perangkat aktif', async () => {
    const a = await app();
    const h = await authAs({ sub: U1 });
    for (let i = 0; i < 5; i++) expect((await a.inject({ method: 'POST', url: '/v1/me/devices', headers: h, payload: { platform: 'ios', name: `P${i}`, public_key: pub() } })).statusCode).toBe(201);
    const r = await a.inject({ method: 'POST', url: '/v1/me/devices', headers: h, payload: { platform: 'ios', name: 'P6', public_key: pub() } });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ code: 'device_limit', limit: 5 });
    expect(r.json().devices).toHaveLength(5);
    // Pesan EN via Accept-Language
    const en = await a.inject({ method: 'POST', url: '/v1/me/devices', headers: { ...h, 'accept-language': 'en' }, payload: { platform: 'ios', name: 'P6', public_key: pub() } });
    expect(en.json().detail).toMatch(/device limit/i);
  });

  it('cabut perangkat sendiri → event iam.device.revoked sekali (idempoten); milik orang lain → 404 tanpa event', async () => {
    const a = await app();
    const h1 = await authAs({ sub: U1 });
    const d = (await a.inject({ method: 'POST', url: '/v1/me/devices', headers: h1, payload: { platform: 'desktop', name: 'PC', public_key: pub() } })).json();
    const other = await a.inject({ method: 'DELETE', url: `/v1/me/devices/${d.id}`, headers: await authAs({ sub: U2 }) });
    expect(other.statusCode).toBe(404);
    expect(s.events).toHaveLength(0);
    const r = await a.inject({ method: 'DELETE', url: `/v1/me/devices/${d.id}`, headers: h1 });
    expect(r.statusCode).toBe(200);
    expect(r.json().revoked_at).toBeTruthy();
    await a.inject({ method: 'DELETE', url: `/v1/me/devices/${d.id}`, headers: h1 });
    expect(s.events).toEqual([{ topic: 'iam.device.revoked', key: U1, payload: { deviceId: d.id, userId: U1, reason: 'USER' } }]);
  });

  it('internal entitlement: hanya token service; perangkat orang lain → null', async () => {
    const a = await app();
    const d = (await a.inject({ method: 'POST', url: '/v1/me/devices', headers: await authAs({ sub: U1 }), payload: { platform: 'desktop', name: 'PC', public_key: pub() } })).json();
    expect((await a.inject({ method: 'GET', url: `/internal/offline/entitlement?user_id=${U1}`, headers: await authAs({ sub: U1 }) })).statusCode).toBe(403);
    const ok = await a.inject({ method: 'GET', url: `/internal/offline/entitlement?user_id=${U1}&device_id=${d.id}`, headers: await asService() });
    expect(ok.json().user).toMatchObject({ premium_active: true, member_type: 'INDIVIDUAL', suspended: false });
    expect(ok.json().device.id).toBe(d.id);
  });

  // ---------------- Review keamanan P-7 ----------------
  it.each([
    ['Gratis', { member_type: 'FREE', premium: false }, 403, 'premium_required'],
    ['Premium kedaluwarsa', { member_until: new Date(Date.now() - 1000) }, 403, 'premium_required'],
    ['ditangguhkan', { suspended_at: new Date() }, 403, 'account_suspended'],
  ])('L3: akun %s tidak bisa mendaftarkan perangkat → %i %s', async (_n, user, status, code) => {
    s = store(user);
    const r = await reg(await app());
    expect([r.statusCode, r.json().code]).toEqual([status, code]);
    expect(s.rows).toHaveLength(0);
  });

  it('L3: paket di luar download.tiers / di luar rollout → 403', async () => {
    settings.apply({ 'download.tiers': ['DUO'] });
    expect((await reg(await app())).json().code).toBe('tier_not_allowed');
    settings.apply({ 'download.tiers': ['INDIVIDUAL', 'STUDENT', 'DUO'], 'download.allow_user_ids': [U2] });
    expect((await reg(await app())).json().code).toBe('rollout_not_included');
    settings.apply({ 'download.allow_user_ids': [] });
  });

  it('L3: > download.devices_per_day pendaftaran per 24 jam (termasuk yang dicabut) → 429 device_rate_limited', async () => {
    settings.apply({ 'download.devices_per_day': 2 });
    const a = await app();
    const h = await authAs({ sub: U1 });
    const d1 = (await reg(a)).json();
    await a.inject({ method: 'DELETE', url: `/v1/me/devices/${d1.id}`, headers: h });
    expect((await reg(a)).statusCode).toBe(201);
    const r = await reg(a);
    expect([r.statusCode, r.json().code]).toEqual([429, 'device_rate_limited']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    settings.apply({ 'download.devices_per_day': 10 });
  });

  it('L3: kunci yang baru dicabut tidak bisa didaftarkan ulang (403 device_revoked + retry_after_s); blokir 0 hari → boleh', async () => {
    const a = await app();
    const key = pub();
    const d = (await reg(a, U1, key)).json();
    await a.inject({ method: 'DELETE', url: `/v1/me/devices/${d.id}`, headers: await authAs({ sub: U1 }) });
    const r = await reg(a, U1, key);
    expect([r.statusCode, r.json().code]).toEqual([403, 'device_revoked']);
    expect(r.json().retry_after_s).toBeGreaterThan(6 * 86400);
    settings.apply({ 'download.device_reregister_block_days': 0 });
    expect((await reg(a, U1, key)).statusCode).toBe(201);
    settings.apply({ 'download.device_reregister_block_days': 7 });
  });

  it('L7: entitlement internal menolak Super Admin (403 + audit internal.denied)', async () => {
    const a = await app();
    const r = await a.inject({ method: 'GET', url: `/internal/offline/entitlement?user_id=${U1}`, headers: await authAs({ sub: U2, roles: ['superadmin', 'admin'] as any }) });
    expect(r.statusCode).toBe(403);
    expect(s.queries.some((q) => q.startsWith('INSERT INTO audit_logs'))).toBe(true);
    expect(s.queries.some((q) => q.startsWith('SELECT id, member_type'))).toBe(false);
  });
});
