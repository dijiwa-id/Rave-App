import { generateKeyPairSync, randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// UPLOAD_DIR dibaca saat modul dimuat → set sebelum import dinamis.
const DIR = mkdtempSync(join(tmpdir(), 'rave-ofl-'));
process.env.UPLOAD_DIR = DIR;
const { settings, decryptOfl, unwrapCek, wrapAad, sealCek, openCek, cekKeyId } = await import('@rave/service-kit');
const { asService, authAs, fakeDb, testApp } = await import('@rave/service-kit/testing');
const { buildArtifact, offlineArtifactJob, offlineRoutes, publishOfflineRevoked } = await import('./offline.js');

const TRACK = '0190a000-0000-7000-8000-0000000000c1';
const dev = () => {
  const kp = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { priv: kp.privateKey, pub: (kp.publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64') };
};

type Row = { offline_allowed: boolean; visible: boolean; uploaded: boolean; renditions: any; transcode_status: string };

function catalogDb(content: Row | null, extraQueued = 0) {
  const artifacts: any[] = [];
  const f = fakeDb((sql, p) => {
    if (sql.startsWith('SELECT t.offline_allowed') || sql.startsWith('SELECT e.offline_allowed')) return content ? [content] : [];
    if (sql.startsWith('SELECT count(*)::int AS n FROM offline_artifacts')) return [{ n: artifacts.filter((a) => a.status === 'pending' || a.status === 'processing').length + extraQueued }];
    if (sql.startsWith('SELECT * FROM offline_artifacts')) return artifacts.filter((a) => a.content_kind === p[0] && a.content_id === p[1] && a.rendition === p[2]);
    if (sql.startsWith('INSERT INTO offline_artifacts')) {
      artifacts.push({ id: p[0], content_kind: p[1], content_id: p[2], rendition: p[3], source_file: p[4], codec_label: p[5], status: 'pending', version: 1, attempts: 0, updated_at: new Date() });
      return [];
    }
    if (sql.startsWith("UPDATE offline_artifacts SET status = 'processing'")) {
      const a = artifacts.find((x) => x.status === 'pending');
      if (!a) return [];
      a.status = 'processing';
      a.attempts++;
      return [{ ...a }];
    }
    if (sql.startsWith("UPDATE offline_artifacts SET status = 'ready'")) {
      const a = artifacts.find((x) => x.id === p[0] && x.status === 'processing' && x.attempts === p[8]);
      if (!a) return [];
      Object.assign(a, { status: 'ready', path: p[1], cek_encrypted: p[2], iv: p[3], size: p[4], plain_size: p[5], sha256: p[6], key_id: p[7] });
      return [{ id: a.id }];
    }
    if (sql.startsWith('UPDATE offline_artifacts SET status = $2')) {
      const a = artifacts.find((x) => x.id === p[0] && x.status === 'processing' && x.attempts === p[3]);
      if (a) Object.assign(a, { status: p[1], error: p[2] });
      return [];
    }
    if (sql.startsWith("UPDATE offline_artifacts SET status = 'pending'")) {
      const a = artifacts.find((x) => x.id === p[0] && ['ready', 'failed'].includes(x.status));
      if (a) Object.assign(a, { status: 'pending', attempts: 0, error: null, source_file: p[1], codec_label: p[3], version: a.version + (p[2] ? 1 : 0) });
      return [];
    }
    if (sql.startsWith('SELECT t.id FROM tracks')) return p[0].filter((id: string) => id === TRACK && content?.offline_allowed && content.visible).map((id: string) => ({ id }));
    if (sql.startsWith('SELECT e.id FROM episodes')) return [];
    return undefined;
  });
  return { ...f, artifacts };
}

const LIVE: Row = { offline_allowed: true, visible: true, uploaded: true, renditions: { normal: { url: '/v1/catalog/media/abc.normal.m4a', codec_label: 'AAC 160 kbps' } }, transcode_status: 'done' };
const log = { info() {}, error() {}, warn() {} } as any;

describe('catalog: artefak offline & kunci terbungkus', () => {
  beforeAll(() => writeFileSync(join(DIR, 'abc.normal.m4a'), randomBytes(200_000)));
  beforeEach(() => settings.apply({ 'download.enabled': true, 'download.quality': 'normal' }));
  afterAll(() => settings.apply({ 'download.enabled': false }));

  const call = async (db: any, body: object, headers?: Record<string, string>) => {
    const app = await testApp((a) => offlineRoutes(a, { db }));
    return app.inject({ method: 'POST', url: '/internal/offline/key', headers: headers ?? (await asService()), payload: body });
  };

  it('hanya token service (pengguna biasa → 403)', async () => {
    const s = catalogDb(LIVE);
    const r = await call(s.db, { kind: 'track', id: TRACK, device_public_key: dev().pub }, await authAs({ sub: TRACK }));
    expect(r.statusCode).toBe(403);
  });

  it('flag mati → 403 offline_disabled', async () => {
    settings.apply({ 'download.enabled': false });
    const r = await call(catalogDb(LIVE).db, { kind: 'track', id: TRACK, device_public_key: dev().pub });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('offline_disabled');
  });

  it('rilis tidak LIVE / tidak ada → 404; offline_allowed false → 403; tanpa rendisi → 409', async () => {
    expect((await call(catalogDb({ ...LIVE, visible: false }).db, { kind: 'track', id: TRACK, device_public_key: dev().pub })).statusCode).toBe(404);
    expect((await call(catalogDb(null).db, { kind: 'track', id: TRACK, device_public_key: dev().pub })).statusCode).toBe(404);
    const na = await call(catalogDb({ ...LIVE, offline_allowed: false }).db, { kind: 'track', id: TRACK, device_public_key: dev().pub });
    expect(na.statusCode).toBe(403);
    expect(na.json().code).toBe('content_not_allowed');
    const nr = await call(catalogDb({ ...LIVE, renditions: {}, transcode_status: 'skipped' }).db, { kind: 'track', id: TRACK, device_public_key: dev().pub });
    expect(nr.statusCode).toBe(409);
    expect((await call(catalogDb({ ...LIVE, renditions: {}, transcode_status: 'processing' }).db, { kind: 'track', id: TRACK, device_public_key: dev().pub })).statusCode).toBe(202);
  });

  it('lazy: permintaan pertama → 202 + antre; job konkurensi 1 membuat artefak; berikutnya → kunci terbungkus yang membuka berkas', async () => {
    const s = catalogDb(LIVE);
    const d = dev();
    const r1 = await call(s.db, { kind: 'track', id: TRACK, device_public_key: d.pub });
    expect(r1.statusCode).toBe(202);
    expect(r1.json()).toMatchObject({ status: 'preparing' });
    expect(s.queries.some((q) => q.includes('pg_notify'))).toBe(true);
    // Permintaan paralel tidak membuat artefak kedua.
    await call(s.db, { kind: 'track', id: TRACK, device_public_key: d.pub });
    expect(s.artifacts).toHaveLength(1);

    await offlineArtifactJob.run({ db: s.db, log } as any);
    const a = s.artifacts[0];
    expect(a.status).toBe('ready');
    expect(a.path).toMatch(/^ofl-.+-v1-[0-9a-f]{8}\.rofl$/);
    expect(a.key_id).toBe(cekKeyId());
    expect(a.cek_encrypted).toBeTruthy();

    const r2 = await call(s.db, { kind: 'track', id: TRACK, device_public_key: d.pub });
    expect(r2.statusCode).toBe(200);
    const body = r2.json();
    expect(body.artifact).toMatchObject({ format: 'RAVEOFL1', rendition: 'normal', codec_label: 'AAC 160 kbps', plain_size: 200_000, url: `/v1/catalog/media/${a.path}` });
    const file = readFileSync(join(DIR, a.path));
    expect(createHash('sha256').update(file).digest('hex')).toBe(body.artifact.sha256);
    const cek = unwrapCek(body.wrapped_key, d.priv, wrapAad('track', TRACK));
    expect(decryptOfl(file, cek).equals(readFileSync(join(DIR, 'abc.normal.m4a')))).toBe(true);
    // Kunci perangkat lain tidak bisa membuka
    expect(() => unwrapCek(body.wrapped_key, dev().priv, wrapAad('track', TRACK))).toThrow();
  });

  it('sumber hilang → job menandai gagal & dicoba ulang (tidak melempar)', async () => {
    const s = catalogDb({ ...LIVE, renditions: { normal: { url: '/v1/catalog/media/hilang.normal.m4a' } } });
    await call(s.db, { kind: 'track', id: TRACK, device_public_key: dev().pub });
    await offlineArtifactJob.run({ db: s.db, log } as any);
    expect(s.artifacts[0]).toMatchObject({ status: 'pending' });
    expect(s.artifacts[0].error).toMatch(/tidak ditemukan/);
  });

  it('status batch untuk recheck', async () => {
    const s = catalogDb(LIVE);
    const app = await testApp((a) => offlineRoutes(a, { db: s.db }));
    const other = '0190a000-0000-7000-8000-0000000000c9';
    const r = await app.inject({ method: 'POST', url: '/internal/offline/status', headers: await asService(), payload: { tracks: [TRACK, other] } });
    expect(r.json().available).toEqual({ [TRACK]: true, [other]: false });
  });

  it('buildArtifact streaming: .part tidak tertinggal; CEK at-rest tersegel', async () => {
    const src = join(DIR, 'x.normal.m4a');
    writeFileSync(src, randomBytes(70_000));
    const r = await buildArtifact(src, join(DIR, 'out.rofl'));
    expect(readdirSync(DIR).filter((f) => f.endsWith('.part'))).toEqual([]);
    expect(openCek(sealCek(r.cek)).equals(r.cek)).toBe(true);
    expect(decryptOfl(readFileSync(join(DIR, 'out.rofl')), r.cek).length).toBe(70_000);
  });

  // ---- Review keamanan P-7 ----
  it('L7: Super Admin tidak boleh memanggil /internal/offline/key (403 + audit internal.denied); tanpa token 401', async () => {
    const s = catalogDb(LIVE);
    const r = await call(s.db, { kind: 'track', id: TRACK, device_public_key: dev().pub }, await authAs({ sub: '0190a000-0000-7000-8000-0000000000c7', roles: ['superadmin', 'admin'] as any }));
    expect(r.statusCode).toBe(403);
    expect(s.queries.some((q) => q.startsWith('INSERT INTO audit_logs'))).toBe(true);
    expect(s.artifacts).toHaveLength(0);
    expect((await call(s.db, { kind: 'track', id: TRACK, device_public_key: dev().pub }, {})).statusCode).toBe(401);
  });

  it('M2: antrean global penuh → 503 queue_full + Retry-After, tanpa menambah antrean; artefak siap tetap dilayani', async () => {
    settings.apply({ 'download.queue_max': 10 });
    try {
      const s = catalogDb(LIVE, 10);
      const r = await call(s.db, { kind: 'track', id: TRACK, device_public_key: dev().pub });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ code: 'queue_full', retry_after_s: 60 });
      expect(r.headers['retry-after']).toBe('60');
      expect(s.artifacts).toHaveLength(0);
      expect(s.queries.some((q) => q.includes('pg_notify'))).toBe(false);
      // Antrean lega → masuk antrean, diproses; kemudian antrean penuh lagi tidak menghalangi artefak yang sudah siap.
      const ok = catalogDb(LIVE);
      await call(ok.db, { kind: 'track', id: TRACK, device_public_key: dev().pub });
      await offlineArtifactJob.run({ db: ok.db, log } as any);
      settings.apply({ 'download.queue_max': 0 });
      expect((await call(ok.db, { kind: 'track', id: TRACK, device_public_key: dev().pub })).statusCode).toBe(200);
    } finally {
      settings.apply({ 'download.queue_max': 200 });
    }
  });

  it('L5: kunci segel berganti (key_id beda / CEK tak bisa dibuka) → artefak dibangun ulang (202), bukan 500', async () => {
    const s = catalogDb(LIVE);
    const d = dev();
    await call(s.db, { kind: 'track', id: TRACK, device_public_key: d.pub });
    await offlineArtifactJob.run({ db: s.db, log } as any);
    const a = s.artifacts[0];
    a.key_id = 'ffffffffffffffff';
    const r1 = await call(s.db, { kind: 'track', id: TRACK, device_public_key: d.pub });
    expect(r1.statusCode).toBe(202);
    expect(a).toMatchObject({ status: 'pending', version: 2 });
    await offlineArtifactJob.run({ db: s.db, log } as any);
    expect(a.key_id).toBe(cekKeyId());
    // Baris lama tanpa key_id yang tersegel kunci lain
    a.key_id = null;
    a.cek_encrypted = Buffer.alloc(60, 1).toString('base64');
    const r2 = await call(s.db, { kind: 'track', id: TRACK, device_public_key: d.pub });
    expect(r2.statusCode).toBe(202);
    expect(a).toMatchObject({ status: 'pending', version: 3 });
  });

  it('L4: klaim basi diambil worker lain selama enkripsi → hasil worker lama dibuang (guard attempts), berkas tidak tertinggal', async () => {
    const s = catalogDb(LIVE);
    await call(s.db, { kind: 'track', id: TRACK, device_public_key: dev().pub });
    const before = new Set(readdirSync(DIR));
    // Simulasikan: setelah klaim, worker lain mengklaim ulang (attempts naik) sebelum UPDATE akhir.
    const orig = s.db.one;
    (s.db as any).one = async (sql: string, p?: any[]) => {
      const out = await orig(sql, p);
      if (sql.startsWith("UPDATE offline_artifacts SET status = 'processing'")) s.artifacts[0].attempts++;
      return out;
    };
    await offlineArtifactJob.run({ db: s.db, log } as any);
    (s.db as any).one = orig;
    expect(s.artifacts[0]).toMatchObject({ status: 'processing' });
    expect(s.artifacts[0].path).toBeUndefined();
    const added = readdirSync(DIR).filter((f) => !before.has(f));
    expect(added).toEqual([]);
  });

  it('publishOfflineRevoked: no-op bila kosong, dipecah per 500 id', async () => {
    const { db, events } = fakeDb(() => []);
    await db.tx(async (tx: any) => {
      await publishOfflineRevoked(tx, 'track', [], 'TAKEN_DOWN');
      await publishOfflineRevoked(tx, 'episode', Array.from({ length: 501 }, (_, i) => `id-${i}`), 'DELETED');
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ topic: 'catalog.offline.revoked', payload: { contentKind: 'episode', reason: 'DELETED' } });
    expect(events[0].payload.contentIds).toHaveLength(500);
  });
});
