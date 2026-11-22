// Laporan Unduhan offline (P-7): izin Super Admin, agregasi 3 service, hulu gagal & data kosong tetap laporan valid.
import { describe, expect, it } from 'vitest';
import type { ServiceReport } from '@rave/domain/reports';
import { authAs, fakeDb, testApp } from '@rave/service-kit/testing';
import { offlineReportRoutes, REPORT_ERROR_MAX, REPORT_TOP_LIMIT, sanitizeArtifactError, type CatalogDownloadStats, type OfflineReportDeps } from './offline-report.js';

const SA = '0190a000-0000-7000-8000-0000000000d1';
const T1 = '0190a000-0000-7000-8000-0000000000a1';
const EP = '0190a000-0000-7000-8000-0000000000b1';
const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/** Db tiruan: `full` = data contoh, selain itu tabel kosong. */
function reportDb(full: boolean) {
  return fakeDb((sql) => {
    if (sql.startsWith('SELECT (SELECT count(*) FROM offline_licenses WHERE status = \'ACTIVE\'')) return [full ? { active: 7, expired_30d: 2, issued_30d: 12, pending: 1 } : { active: 0, expired_30d: 0, issued_30d: 0, pending: 0 }];
    if (sql.startsWith('SELECT revoke_reason AS reason')) return full ? [{ reason: 'DEVICE_REVOKED', n: 3 }, { reason: 'CONTENT_WITHDRAWN', n: 1 }] : [];
    if (sql.startsWith('SELECT count(*) FILTER (WHERE status = \'ACCEPTED\')')) return [full ? { accepted: 40, rejected: 5, qualified: 31 } : { accepted: 0, rejected: 0, qualified: 0 }];
    if (sql.startsWith('SELECT reject_reason AS reason')) return full ? [{ reason: 'overlap', n: 4 }, { reason: 'too_old', n: 1 }] : [];
    if (sql.includes('FROM offline_licenses WHERE created_at >= now() - interval \'14 days\'')) return full ? [{ date: today, value: 12 }] : [];
    if (sql.includes('FROM offline_plays WHERE received_at >= now() - interval \'14 days\'')) return full ? [{ date: today, value: 40 }] : [];
    if (sql.startsWith('SELECT track_id, episode_id, count(*)::int AS licenses')) {
      expect(sql).toContain(`LIMIT ${REPORT_TOP_LIMIT}`);
      return full
        ? [
            { track_id: T1, episode_id: null, licenses: 9, users: 6, active: 5 },
            { track_id: null, episode_id: EP, licenses: 3, users: 3, active: 2 },
          ]
        : [];
    }
    return undefined;
  });
}

const catalogFull: CatalogDownloadStats = {
  artifacts: { ready: 10, processing: 2, failed: 1, bytes: 123_456_789 },
  failed: [{ content_kind: 'track', content_id: T1, title: 'Lagu Satu', subtitle: 'Artis A', rendition: 'normal', attempts: 3, error: 'ffmpeg exited 1', updated_at: new Date().toISOString() }],
  content: { [T1]: { title: 'Lagu Satu', subtitle: 'Artis A', artifact: 'ready' }, [EP]: { title: 'Episode 1', subtitle: 'Acara B', artifact: null } },
};

async function app(full: boolean, deps: Partial<OfflineReportDeps> = {}) {
  const calls: { tracks: string[]; episodes: string[] }[] = [];
  const d: OfflineReportDeps = {
    iamStats: async () => ({ devices: full ? { active: 4, revoked_30d: 1 } : { active: 0, revoked_30d: 0 } }),
    catalogStats: async (tracks, episodes) => {
      calls.push({ tracks, episodes });
      return full ? catalogFull : { artifacts: { ready: 0, processing: 0, failed: 0, bytes: 0 }, failed: [], content: {} };
    },
    ...deps,
  };
  const { db } = reportDb(full);
  const a = await testApp((x) => offlineReportRoutes(x, { db, name: 'playback' }, d));
  return { a, calls };
}
const get = async (a: Awaited<ReturnType<typeof testApp>>, headers?: Record<string, string>) => a.inject({ method: 'GET', url: '/v1/admin/reports/downloads', headers });
const kpi = (r: ServiceReport, id: string) => r.kpis.find((k) => k.label.id === id)?.value;
const SUPER = () => authAs({ sub: SA, roles: ['superadmin', 'admin'] as any });

describe('GET /v1/admin/reports/downloads — izin', () => {
  it('tanpa token → 401', async () => {
    const { a } = await app(true);
    expect((await get(a)).statusCode).toBe(401);
  });
  it('pengguna biasa & admin non-Super → 403', async () => {
    const { a } = await app(true);
    expect((await get(a, await authAs({ sub: SA }))).statusCode).toBe(403);
    expect((await get(a, await authAs({ sub: SA, roles: ['admin'] as any }))).statusCode).toBe(403);
  });
});

describe('GET /v1/admin/reports/downloads — agregasi', () => {
  it('menggabungkan playback + iam + catalog', async () => {
    const { a, calls } = await app(true);
    const res = await get(a, await SUPER());
    expect(res.statusCode).toBe(200);
    const r = res.json() as ServiceReport;
    expect(kpi(r, 'Perangkat aktif')).toBe(4);
    expect(kpi(r, 'Perangkat dicabut (30 hari)')).toBe(1);
    expect(kpi(r, 'Lisensi aktif')).toBe(7);
    expect(kpi(r, 'Lisensi dicabut (30 hari)')).toBe(4);
    expect(kpi(r, 'Dicabut: perangkat dicabut')).toBe(3);
    expect(kpi(r, 'Dicabut: konten ditarik')).toBe(1);
    expect(kpi(r, 'Dicabut: keanggotaan')).toBe(0);
    expect(kpi(r, 'Lisensi kedaluwarsa (30 hari)')).toBe(2);
    expect(kpi(r, 'Artefak siap')).toBe(10);
    expect(kpi(r, 'Artefak diproses')).toBe(2);
    expect(kpi(r, 'Artefak gagal')).toBe(1);
    expect(kpi(r, 'Ukuran artefak siap')).toBe(123_456_789);
    expect(kpi(r, 'Putar offline diterima (30 hari)')).toBe(40);
    expect(kpi(r, 'Putar offline ditolak (30 hari)')).toBe(5);
    expect(r.kpis.find((k) => k.label.id === 'Putar offline ditolak (30 hari)')?.hint?.id).toBe('tumpang tindih 4 · terlalu lama 1');
    expect(kpi(r, 'Putar offline qualified (30 hari)')).toBe(31);
    expect(kpi(r, 'Permintaan menunggu artefak')).toBe(1);
    // Label KPI unik (kunci React di web).
    expect(new Set(r.kpis.map((k) => k.label.id)).size).toBe(r.kpis.length);
    // Satu panggilan catalog dengan id konten teratas (bukan N).
    expect(calls).toEqual([{ tracks: [T1], episodes: [EP] }]);
    expect(r.series?.points).toHaveLength(14);
    expect(r.series?.points.at(-1)).toEqual({ date: today, value: 12 });
    expect(r.extra_series?.[0]?.points.at(-1)).toEqual({ date: today, value: 40 });
    expect(r.table.rows).toEqual([
      { content: 'Lagu Satu — Artis A', kind: 'Lagu', licenses: 9, users: 6, active: 5, artifact: 'READY' },
      { content: 'Episode 1 — Acara B', kind: 'Episode', licenses: 3, users: 3, active: 2, artifact: null },
    ]);
    expect(r.extra_tables?.[0]?.rows[0]).toMatchObject({ content: 'Lagu Satu — Artis A', rendition: 'normal', attempts: 3, error: 'ffmpeg exited 1' });
    expect(r.kpis.find((k) => k.label.id === 'Artefak gagal')).toMatchObject({ tone: 'bad', hint: { id: 'Terakhir: ffmpeg exited 1' } });
  });

  it('data kosong → laporan valid berangka 0 (flag mati tidak memengaruhi)', async () => {
    const { a, calls } = await app(false);
    const r = (await get(a, await SUPER())).json() as ServiceReport;
    expect(r.kpis.every((k) => k.value === 0)).toBe(true);
    expect(r.series?.points).toHaveLength(14);
    expect(r.series?.points.every((p) => p.value === 0)).toBe(true);
    expect(r.table.rows).toEqual([]);
    expect(r.extra_tables?.[0]?.rows).toEqual([]);
    expect(calls).toEqual([{ tracks: [], episodes: [] }]);
    expect(typeof r.generated_at).toBe('string');
  });

  it('iam/catalog gagal → KPI terkait null + petunjuk, bukan 5xx', async () => {
    const boom = async () => {
      throw new Error('ECONNREFUSED');
    };
    const { a } = await app(true, { iamStats: boom, catalogStats: boom });
    const res = await get(a, await SUPER());
    expect(res.statusCode).toBe(200);
    const r = res.json() as ServiceReport;
    expect(kpi(r, 'Perangkat aktif')).toBeNull();
    expect(kpi(r, 'Artefak siap')).toBeNull();
    expect(r.kpis.find((k) => k.label.id === 'Artefak siap')?.hint?.id).toBe('Data catalog tidak tersedia');
    expect(kpi(r, 'Lisensi aktif')).toBe(7);
    // Judul tidak tersedia → id singkat.
    expect(r.table.rows[0]).toMatchObject({ content: `${T1.slice(0, 8)}…`, artifact: null });
  });
});

describe('S5: galat artefak disanitasi sebelum tampil ke Super Admin', () => {
  it('path absolut/nama berkas/URL internal → …; kode galat tetap; spasi diringkas; dibatasi panjang', () => {
    expect(sanitizeArtifactError("ENOENT: no such file or directory, open '/var/lib/rave/media/0190a000/normal.m4a'")).toBe(
      "ENOENT: no such file or directory, open '…'",
    );
    expect(sanitizeArtifactError('EACCES: permission denied, mkdir C:\\rave\\offline\\tmp')).toBe('EACCES: permission denied, mkdir …');
    expect(sanitizeArtifactError('fetch failed http://minio:9000/rave-media/x.flac?X-Amz-Signature=abc (status 403)')).toBe('fetch failed … (status 403)');
    expect(sanitizeArtifactError('ffmpeg exited 1')).toBe('ffmpeg exited 1');
    expect(sanitizeArtifactError('Error: boom\n    at run (/app/services/catalog/dist/offline.js:10:5)\n    at x (node:internal/process:1:1)')).toBe('Error: boom at run (…) at x (…)');
    expect(sanitizeArtifactError(null)).toBeNull();
    expect(sanitizeArtifactError('   ')).toBeNull();
    const long = sanitizeArtifactError('x'.repeat(500))!;
    expect(long).toHaveLength(REPORT_ERROR_MAX);
    expect(long.endsWith('…')).toBe(true);
  });

  it('tabel artefak gagal & petunjuk KPI memakai galat tersanitasi', async () => {
    const raw = "ENOENT: no such file or directory, open '/srv/rave/offline/0190a000-secret/normal.m4a'";
    const cat: CatalogDownloadStats = { ...catalogFull, failed: [{ ...catalogFull.failed[0]!, error: raw }] };
    const { a } = await app(true, { catalogStats: async () => cat });
    const r = (await get(a, await SUPER())).json() as ServiceReport;
    const body = JSON.stringify(r);
    expect(body).not.toContain('/srv/rave');
    expect(body).not.toContain('normal.m4a');
    expect(r.extra_tables?.[0]?.rows[0]?.error).toBe("ENOENT: no such file or directory, open '…'");
    expect(r.kpis.find((k) => k.label.id === 'Artefak gagal')?.hint?.id).toBe("Terakhir: ENOENT: no such file or directory, open '…'");
  });
});
