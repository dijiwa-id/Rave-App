// Regresi M3 (review keamanan P-7): anggota org MANAGEMENT tidak lagi otomatis ADMIN di org ARTIST kelolaan —
// klaim org artis mengikuti peran di manajemen (iam loadOrgs/managedRole: OWNER/ADMIN→ADMIN, MEMBER→MEMBER,
// FINANCE/VIEWER→VIEWER). Pengelolaan RAVE Pro org artis hanya untuk klaim OWNER/ADMIN.
import { describe, expect, it } from 'vitest';
import { authAs, fakeDb, testApp } from '@rave/service-kit/testing';
import { proRoutes } from './pro.js';

const ARTIST_ORG = '0190a000-0000-7000-8000-0000000000f1';
const MGMT_ORG = '0190a000-0000-7000-8000-0000000000f2';

const manager = (mgmtRole: string, artistRole: string) => ({
  sub: '0190a000-0000-7000-8000-0000000000f3',
  roles: ['manager' as const],
  orgs: [
    { id: MGMT_ORG, type: 'MANAGEMENT' as const, role: mgmtRole, artistId: null },
    { id: ARTIST_ORG, type: 'ARTIST' as const, role: artistRole, artistId: '0190a000-0000-7000-8000-0000000000f4' },
  ],
});

function setup() {
  const f = fakeDb((sql) => {
    if (sql.startsWith('UPDATE pro_subscriptions SET next_plan=NULL')) return [];
    if (sql.startsWith('SELECT * FROM pro_subscriptions')) return [];
    if (sql.startsWith('SELECT o.*, row_to_json(i) AS inv FROM pro_orders')) return [];
    return undefined;
  });
  return f;
}

describe('RAVE Pro org artis lewat jalur manajemen (M3)', () => {
  const run = async (f: ReturnType<typeof setup>, user: any, method: 'DELETE' | 'POST', path: string, payload?: object) => {
    const app = await testApp((a) => proRoutes(a, { db: f.db } as any));
    return app.inject({ method, url: `/v1/pro/orgs/${ARTIST_ORG}${path}`, headers: await authAs(user), payload });
  };

  it.each([
    ['VIEWER', 'VIEWER'],
    ['FINANCE', 'VIEWER'],
    ['MEMBER', 'MEMBER'],
  ])('anggota %s manajemen (klaim %s) → 403 untuk aksi pengelolaan, tanpa perubahan', async (m, a) => {
    const f = setup();
    for (const [method, path, body] of [
      ['DELETE', '/scheduled-change', undefined],
      ['POST', '/resume', undefined],
      ['POST', '/cancel', { reason: 'uji' }],
      ['POST', '/checkout', { plan: 'PRO', cycle: 'MONTHLY' }],
    ] as const) {
      const r = await run(f, manager(m, a), method, path, body);
      expect(r.statusCode, `${method} ${path}`).toBe(403);
    }
    expect(f.queries.filter((q) => q.startsWith('UPDATE'))).toHaveLength(0);
    expect(f.events).toHaveLength(0);
  });

  it('anggota manajemen tetap dapat melihat status (can_manage=false untuk klaim VIEWER)', async () => {
    const app = await testApp((a) => proRoutes(a, { db: setup().db } as any));
    const g = await app.inject({ method: 'GET', url: `/v1/pro/orgs/${ARTIST_ORG}`, headers: await authAs(manager('FINANCE', 'VIEWER') as any) });
    expect(g.statusCode).toBe(200);
    expect(g.json().can_manage).toBe(false);
  });

  it.each(['OWNER', 'ADMIN'])('anggota %s manajemen (klaim ADMIN) → 200', async (m) => {
    const f = setup();
    const r = await run(f, manager(m, 'ADMIN'), 'DELETE', '/scheduled-change');
    expect(r.statusCode).toBe(200);
    expect(f.queries.some((q) => q.startsWith('UPDATE pro_subscriptions SET next_plan=NULL'))).toBe(true);
    const app = await testApp((a) => proRoutes(a, { db: setup().db } as any));
    const g = await app.inject({ method: 'GET', url: `/v1/pro/orgs/${ARTIST_ORG}`, headers: await authAs(manager(m, 'ADMIN') as any) });
    expect(g.json().can_manage).toBe(true);
  });
});
