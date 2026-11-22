import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settings } from '@rave/service-kit';
import { asService, authAs, fakeDb, testApp } from '@rave/service-kit/testing';
import { deviceRoutes } from './devices.js';

const U1 = '0190a000-0000-7000-8000-0000000000a1';
const U2 = '0190a000-0000-7000-8000-0000000000a2';
const pub = () => (generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64');

/** Tabel user_devices di memori. */
function store() {
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
    if (sql.startsWith('SELECT id, member_type')) return p[0] === U1 ? [{ id: U1, member_type: 'INDIVIDUAL', member_until: null, premium: true, suspended_at: null, deleted_at: null }] : [];
    if (sql.startsWith('UPDATE user_devices SET last_seen_at')) return rows.filter((d) => d.id === p[0] && d.user_id === p[1]);
    return undefined;
  });
  return { ...f, rows };
}

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
});
