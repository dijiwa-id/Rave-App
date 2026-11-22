// Statistik artefak & judul untuk laporan Unduhan offline (P-7): hanya token service, input dibatasi, satu kali jalan.
import { describe, expect, it } from 'vitest';
import { asService, authAs, fakeDb, testApp } from '@rave/service-kit/testing';
import { reportRoutes } from './reports.js';

const SA = '0190a000-0000-7000-8000-0000000000d1';
const T1 = '0190a000-0000-7000-8000-0000000000a1';
const EP = '0190a000-0000-7000-8000-0000000000b1';
const url = '/internal/reports/downloads';

async function app() {
  const f = fakeDb((sql) => {
    if (sql.startsWith("SELECT count(*) FILTER (WHERE status = 'ready')")) return [{ ready: 5, processing: 1, failed: 1, bytes: '2048' }];
    if (sql.startsWith('SELECT a.content_kind')) {
      expect(sql).toContain("WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 10");
      return [{ content_kind: 'track', content_id: T1, rendition: 'normal', attempts: 3, error: 'ffmpeg exited 1', updated_at: '2026-11-22T00:00:00Z', title: 'Lagu', subtitle: 'Artis' }];
    }
    if (sql.startsWith('SELECT t.id, t.title')) return [{ id: T1, title: 'Lagu', subtitle: 'Artis' }, { id: EP, title: 'Ep', subtitle: 'Acara' }];
    if (sql.startsWith('SELECT content_id, CASE')) return [{ content_id: T1, status: 'ready' }];
    return undefined;
  });
  return { ...f, a: await testApp((x) => reportRoutes(x, { db: f.db } as any)) };
}

describe('POST /internal/reports/downloads (catalog)', () => {
  it('token service → artefak, gagal terbaru, judul & status konten', async () => {
    const { a } = await app();
    const r = await a.inject({ method: 'POST', url, headers: await asService(), payload: { tracks: [T1], episodes: [EP] } });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.artifacts).toEqual({ ready: 5, processing: 1, failed: 1, bytes: 2048 });
    expect(b.failed[0]).toMatchObject({ content_id: T1, title: 'Lagu', error: 'ffmpeg exited 1', attempts: 3 });
    expect(b.content).toEqual({ [T1]: { title: 'Lagu', subtitle: 'Artis', artifact: 'ready' }, [EP]: { title: 'Ep', subtitle: 'Acara', artifact: null } });
  });
  it('tanpa konten → tanpa query judul/status', async () => {
    const { a, queries } = await app();
    const r = await a.inject({ method: 'POST', url, headers: await asService(), payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().content).toEqual({});
    expect(queries.some((q) => q.startsWith('SELECT t.id'))).toBe(false);
  });
  it('lebih dari 50 id → 400', async () => {
    const { a } = await app();
    const many = Array.from({ length: 51 }, (_, i) => `0190a000-0000-7000-8000-${String(i).padStart(12, '0')}`);
    expect((await a.inject({ method: 'POST', url, headers: await asService(), payload: { tracks: many } })).statusCode).toBe(400);
  });
  it('tanpa token 401; pengguna & Super Admin 403', async () => {
    const { a } = await app();
    expect((await a.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(401);
    expect((await a.inject({ method: 'POST', url, headers: await authAs({ sub: SA }), payload: {} })).statusCode).toBe(403);
    expect((await a.inject({ method: 'POST', url, headers: await authAs({ sub: SA, roles: ['superadmin', 'admin'] as any }), payload: {} })).statusCode).toBe(403);
  });
});
