// Statistik perangkat untuk laporan Unduhan offline (P-7): hanya token service; Super Admin pun ditolak (403 + audit).
import { describe, expect, it } from 'vitest';
import { asService, authAs, fakeDb, testApp } from '@rave/service-kit/testing';
import { reportRoutes } from './reports.js';

const SA = '0190a000-0000-7000-8000-0000000000d1';

async function app() {
  const f = fakeDb((sql) => (sql.startsWith('SELECT (SELECT count(*) FROM user_devices WHERE revoked_at IS NULL)') ? [{ active: 3, revoked_30d: 2 }] : undefined));
  return { ...f, a: await testApp((x) => reportRoutes(x, { db: f.db } as any)) };
}

describe('GET /internal/reports/downloads (iam)', () => {
  it('token service → hitungan perangkat', async () => {
    const { a } = await app();
    const r = await a.inject({ method: 'GET', url: '/internal/reports/downloads', headers: await asService() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ devices: { active: 3, revoked_30d: 2 } });
  });
  it('tanpa token 401; pengguna & Super Admin 403 (dicatat audit)', async () => {
    const { a, queries } = await app();
    expect((await a.inject({ method: 'GET', url: '/internal/reports/downloads' })).statusCode).toBe(401);
    expect((await a.inject({ method: 'GET', url: '/internal/reports/downloads', headers: await authAs({ sub: SA }) })).statusCode).toBe(403);
    expect((await a.inject({ method: 'GET', url: '/internal/reports/downloads', headers: await authAs({ sub: SA, roles: ['superadmin', 'admin'] as any }) })).statusCode).toBe(403);
    expect(queries.filter((q) => q.startsWith('INSERT INTO audit_logs')).length).toBe(2);
  });
});
