// M3 (review keamanan P-7): peran anggota org MANAGEMENT di org ARTIST kelolaan tidak boleh otomatis ADMIN.
import { describe, expect, it } from 'vitest';
import { fakeDb } from '@rave/service-kit/testing';
import { loadOrgs, managedRole } from './core.js';

const USER = '0190a000-0000-7000-8000-0000000000e1';
const ARTIST_ORG = '0190a000-0000-7000-8000-0000000000e2';
const ARTIST_ORG_2 = '0190a000-0000-7000-8000-0000000000e3';
const MGMT_ORG = '0190a000-0000-7000-8000-0000000000e4';

const artist = (id = ARTIST_ORG, management_role: string) => ({
  id,
  type: 'ARTIST',
  name: `Artis ${id.slice(-2)}`,
  management_role,
  artist_id: `art-${id.slice(-2)}`,
  pro_plan: null,
  pro_status: null,
  pro_until: null,
});

const direct = (role: string) => {
  const { management_role: _, ...r } = artist(ARTIST_ORG, '');
  return { ...r, role, direct: true };
};

function load(direct: any[], managed: any[]) {
  const f = fakeDb((sql, p) => {
    expect(p).toEqual([USER]);
    if (sql.startsWith('SELECT o.id, o.type, o.name, m.role')) return direct;
    if (sql.startsWith('SELECT a.id, a.type, a.name, m.role AS management_role')) return managed;
    return undefined;
  });
  return loadOrgs({ query: async (s, p) => ({ rows: await f.db.query(s, p), rowCount: 0 }) }, USER);
}

const roleOf = (rows: any[], id = ARTIST_ORG) => rows.find((r) => r.id === id)?.role;

describe('managedRole', () => {
  it.each([
    ['OWNER', 'ADMIN'],
    ['ADMIN', 'ADMIN'],
    ['MEMBER', 'MEMBER'],
    ['FINANCE', 'VIEWER'],
    ['VIEWER', 'VIEWER'],
    ['TIDAK_DIKENAL', 'VIEWER'],
  ])('%s manajemen → %s di org artis', (m, want) => expect(managedRole(m)).toBe(want));
});

describe('loadOrgs: org artis kelolaan (M3)', () => {
  it.each([
    ['OWNER', 'ADMIN'],
    ['ADMIN', 'ADMIN'],
    ['MEMBER', 'MEMBER'],
    ['FINANCE', 'VIEWER'],
    ['VIEWER', 'VIEWER'],
  ])('anggota %s manajemen → klaim %s (bukan selalu ADMIN), direct=false', async (m, want) => {
    const mgmt = { id: MGMT_ORG, type: 'MANAGEMENT', name: 'M', role: m, artist_id: null, direct: true };
    const rows = await load([mgmt], [artist(ARTIST_ORG, m)]);
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.id === ARTIST_ORG)!;
    expect(a).toMatchObject({ role: want, direct: false, type: 'ARTIST', artist_id: 'art-e2' });
    expect(a).not.toHaveProperty('management_role');
  });

  it('beberapa org manajemen mengelola artis yang sama → peran tertinggi, satu baris per artis', async () => {
    const rows = await load([], [artist(ARTIST_ORG, 'VIEWER'), artist(ARTIST_ORG, 'ADMIN'), artist(ARTIST_ORG, 'FINANCE'), artist(ARTIST_ORG_2, 'FINANCE'), artist(ARTIST_ORG_2, 'MEMBER')]);
    expect(rows).toHaveLength(2);
    expect(roleOf(rows)).toBe('ADMIN');
    expect(roleOf(rows, ARTIST_ORG_2)).toBe('MEMBER');
  });

  it('urutan baris tidak memengaruhi hasil', async () => {
    const rows = await load([], [artist(ARTIST_ORG, 'OWNER'), artist(ARTIST_ORG, 'VIEWER')]);
    expect(roleOf(rows)).toBe('ADMIN');
  });

  it('keanggotaan langsung OWNER/FINANCE tidak ditimpa jalur manajemen', async () => {
    for (const d of ['OWNER', 'FINANCE']) {
      const rows = await load([direct(d)], [artist(ARTIST_ORG, 'ADMIN')]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ role: d, direct: true });
    }
  });

  it('keanggotaan langsung lebih tinggi tidak diturunkan (ADMIN langsung + VIEWER manajemen → ADMIN)', async () => {
    const rows = await load([direct('ADMIN')], [artist(ARTIST_ORG, 'VIEWER')]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: 'ADMIN', direct: true });
  });

  it('keanggotaan langsung VIEWER/MEMBER dinaikkan ke peran manajemen yang lebih tinggi, tetap direct=true', async () => {
    const rows = await load([direct('VIEWER')], [artist(ARTIST_ORG, 'MEMBER')]);
    expect(rows).toEqual([expect.objectContaining({ id: ARTIST_ORG, role: 'MEMBER', direct: true })]);
    const rows2 = await load([direct('MEMBER')], [artist(ARTIST_ORG, 'OWNER')]);
    expect(rows2).toEqual([expect.objectContaining({ id: ARTIST_ORG, role: 'ADMIN', direct: true })]);
  });
});
