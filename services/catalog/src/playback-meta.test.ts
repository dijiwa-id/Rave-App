import { describe, expect, it } from 'vitest';
import { asService, authAs, fakeDb, testApp } from '@rave/service-kit/testing';
import { adminRoutes } from './admin.js';

const T1 = '0190a000-0000-7000-8000-0000000000d1';
const T_GONE = '0190a000-0000-7000-8000-0000000000d9';
const EP = '0190a000-0000-7000-8000-0000000000e1';
const ART = '0190a000-0000-7000-8000-0000000000d2';

describe('catalog: /internal/playback/meta (putar offline P-7 T6)', () => {
  const app = async () => {
    const f = fakeDb((sql, p) => {
      if (sql.startsWith('SELECT id, artist_id, duration_ms FROM tracks')) return p[0].includes(T1) ? [{ id: T1, artist_id: ART, duration_ms: 201_000 }] : [];
      if (sql.startsWith('SELECT id, duration_ms FROM episodes')) return p[0].includes(EP) ? [{ id: EP, duration_ms: null }] : [];
      return undefined;
    });
    // Tanpa filter status: konten yang sudah ditarik tetap dikembalikan (putar dari lisensi sah tetap dibayar).
    return { a: await testApp((x) => adminRoutes(x, { db: f.db } as any)), f };
  };

  it('khusus service; artis & durasi banyak konten, konten terhapus tidak ada di peta', async () => {
    const { a, f } = await app();
    expect((await a.inject({ method: 'POST', url: '/internal/playback/meta', headers: await authAs({ sub: ART }), payload: {} })).statusCode).toBe(403);
    const r = await a.inject({ method: 'POST', url: '/internal/playback/meta', headers: await asService(), payload: { tracks: [T1, T_GONE], episodes: [EP] } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ tracks: { [T1]: { artist_id: ART, duration_ms: 201_000 } }, episodes: { [EP]: { duration_ms: 0 } } });
    expect(f.queries.some((q) => /status|LIVE/.test(q) && q.includes('FROM tracks WHERE id = ANY'))).toBe(false);
  });
});
