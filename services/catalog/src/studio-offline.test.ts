import { describe, expect, it } from 'vitest';
import { authAs, fakeDb, testApp } from '@rave/service-kit/testing';
import { studioRoutes } from './studio.js';

const TRACK = '0190a000-0000-7000-8000-0000000000d1';
const ARTIST = '0190a000-0000-7000-8000-0000000000d2';
const OWNER = { sub: '0190a000-0000-7000-8000-0000000000d3', roles: ['artist' as const], orgs: [{ id: 'o1', type: 'ARTIST' as const, role: 'OWNER' as const, artistId: ARTIST }] };

function db(releaseStatus = 'LIVE') {
  const track = { id: TRACK, artist_id: ARTIST, release_id: 'r1', release_status: releaseStatus, offline_allowed: true };
  const f = fakeDb((sql, p) => {
    if (sql.startsWith('SELECT t.*, r.status AS release_status')) return p[0] === TRACK ? [track] : [];
    if (sql.startsWith('SELECT offline_allowed FROM tracks')) return [{ offline_allowed: track.offline_allowed }];
    if (sql.startsWith('UPDATE tracks SET offline_allowed')) return (track.offline_allowed = p[1]), [];
    if (sql.startsWith('SELECT id FROM tracks WHERE release_id')) return [];
    if (sql.includes('FROM releases r JOIN artists a')) return [{ id: 'r1', artist_id: ARTIST, title: 'R' }];
    if (sql.includes('FROM tracks t JOIN releases r ON r.id = t.release_id JOIN artists a')) return [{ id: TRACK, offline_allowed: track.offline_allowed }];
    return undefined;
  });
  return { ...f, track };
}

describe('studio: offline_allowed per lagu (P-7)', () => {
  const patch = async (d: ReturnType<typeof db>, body: object, user = OWNER) => {
    const app = await testApp((a) => studioRoutes(a, { db: d.db } as any));
    return app.inject({ method: 'PATCH', url: `/v1/studio/tracks/${TRACK}`, headers: await authAs(user), payload: body });
  };

  it('pemilik mematikan di rilis LIVE → 200 + event catalog.offline.revoked; menyalakan lagi → tanpa event', async () => {
    const d = db('LIVE');
    const r = await patch(d, { offline_allowed: false });
    expect(r.statusCode).toBe(200);
    expect(d.track.offline_allowed).toBe(false);
    expect(d.events).toEqual([{ topic: 'catalog.offline.revoked', key: TRACK, payload: { contentKind: 'track', contentIds: [TRACK], reason: 'OFFLINE_DISABLED' } }]);
    await patch(d, { offline_allowed: true });
    expect(d.track.offline_allowed).toBe(true);
    expect(d.events).toHaveLength(1);
  });

  it('bukan pengelola artis → 403; bidang lain di rilis LIVE tetap 409', async () => {
    const d = db('LIVE');
    expect((await patch(d, { offline_allowed: false }, { sub: 'x', roles: ['artist'], orgs: [] } as any)).statusCode).toBe(403);
    expect((await patch(d, { offline_allowed: false, title: 'baru' })).statusCode).toBe(409);
    expect(d.events).toHaveLength(0);
  });

  it('nilai bukan boolean → 400', async () => {
    expect((await patch(db(), { offline_allowed: 'tidak' })).statusCode).toBe(400);
  });
});
