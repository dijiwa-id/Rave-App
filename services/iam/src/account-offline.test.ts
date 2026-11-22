// L1 (review keamanan P-7): tangguhkan / hapus akun → event untuk playback (cabut lisensi offline) & data perangkat
// dibersihkan (UU PDP).
import { describe, expect, it } from 'vitest';
import { authAs, fakeDb, testApp } from '@rave/service-kit/testing';
import { adminRoutes } from './admin.js';
import { anonymizeUser } from './core.js';

const ADMIN = '0190a000-0000-7000-8000-0000000000b1';
const USER = '0190a000-0000-7000-8000-0000000000b2';

describe('akun ditangguhkan / dihapus → lisensi offline dicabut', () => {
  it('anonymizeUser: perangkat dicabut & dikosongkan (nama, versi, kunci publik, sidik jari) + event iam.user.deleted', async () => {
    const f = fakeDb(() => []);
    await f.db.tx((tx: any) => anonymizeUser(tx, USER));
    const q = f.queries.find((x) => x.startsWith('UPDATE user_devices SET revoked_at'));
    expect(q).toMatch(/name = 'Perangkat dihapus', app_version = NULL, public_key = '', key_fingerprint = ''/);
    expect(q).toMatch(/WHERE user_id = \$1$/);
    expect(f.events).toEqual([{ topic: 'iam.user.deleted', key: USER, payload: { userId: USER } }]);
  });

  it('Super Admin menangguhkan → event iam.user.suspended sekali; mencabut penangguhan → tanpa event', async () => {
    const user: any = { id: USER, suspended_at: null, admin_role: null, is_admin: false, member_type: 'INDIVIDUAL', deleted_at: null };
    const f = fakeDb((sql, p) => {
      if (sql.startsWith('SELECT * FROM users')) return [user];
      if (sql.startsWith('UPDATE users SET suspended_at')) return (user.suspended_at = sql.includes('now()') ? new Date() : null), [];
      return [];
    });
    const app = await testApp((a) => adminRoutes(a, { db: f.db } as any));
    const h = await authAs({ sub: ADMIN, roles: ['superadmin', 'admin'] as any, admin_role: 'SUPER_ADMIN' } as any);
    const patch = (suspended: boolean) => app.inject({ method: 'PATCH', url: `/v1/admin/iam/users/${USER}`, headers: h, payload: { suspended, reason: 'pelanggaran ketentuan' } });
    expect((await patch(true)).statusCode).toBe(200);
    expect(f.events.filter((e) => e.topic === 'iam.user.suspended')).toEqual([{ topic: 'iam.user.suspended', key: USER, payload: { userId: USER } }]);
    expect((await patch(false)).statusCode).toBe(200);
    expect(f.events.filter((e) => e.topic === 'iam.user.suspended')).toHaveLength(1);
  });

  it('Super Admin menghapus akun → event iam.user.deleted', async () => {
    const f = fakeDb((sql) => (sql.startsWith('SELECT * FROM users') ? [{ id: USER, admin_role: null, is_admin: false, email: 'x@y.id' }] : []));
    const app = await testApp((a) => adminRoutes(a, { db: f.db } as any));
    const h = await authAs({ sub: ADMIN, roles: ['superadmin', 'admin'] as any, admin_role: 'SUPER_ADMIN' } as any);
    const r = await app.inject({ method: 'DELETE', url: `/v1/admin/iam/users/${USER}`, headers: h, payload: { reason: 'permintaan pengguna' } });
    expect(r.statusCode).toBe(200);
    expect(f.events.map((e) => e.topic)).toContain('iam.user.deleted');
  });
});
