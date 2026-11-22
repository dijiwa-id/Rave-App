// Laporan Unduhan offline (P-7) untuk Super Admin → Pengaturan Layanan → Unduhan → tab Laporan.
// Data tersebar di 3 service; playback (pemilik lisensi & putar offline) mengagregasi: query lokal + satu panggilan
// internal ke iam (hitungan perangkat) + satu ke catalog (artefak & judul). Hulu gagal → KPI terkait `null`
// (laporan tetap valid), bukan 5xx. Tidak bergantung pada `download.enabled`: flag mati tetap mengembalikan laporan.
import type { FastifyInstance } from 'fastify';
import type { OfflineRevokeReason } from '@rave/domain/offline';
import type { OfflinePlayReject } from '@rave/domain/offline-plays';
import { L, dailySql, fillDaily, type L10n, type ReportKpi, type ServiceReport } from '@rave/domain/reports';
import { callService, requireSuperAdmin, type Db, type ServiceContext } from '@rave/service-kit';

/** Baris tabel dibatasi (VPS 2 GB; laporan bukan ekspor). */
export const REPORT_TOP_LIMIT = 10;

export interface IamDeviceStats {
  devices: { active: number; revoked_30d: number };
}
export interface CatalogDownloadStats {
  artifacts: { ready: number; processing: number; failed: number; bytes: number };
  failed: { content_kind: 'track' | 'episode'; content_id: string; title: string | null; subtitle: string | null; rendition: string; attempts: number; error: string | null; updated_at: string }[];
  content: Record<string, { title: string | null; subtitle: string | null; artifact: 'ready' | 'processing' | 'failed' | null }>;
}
export interface OfflineReportDeps {
  iamStats: () => Promise<IamDeviceStats>;
  catalogStats: (tracks: string[], episodes: string[]) => Promise<CatalogDownloadStats>;
}

export function reportServiceDeps(name: string): OfflineReportDeps {
  return {
    iamStats: () => callService<IamDeviceStats>(name, 'iam', '/internal/reports/downloads'),
    catalogStats: (tracks, episodes) => callService<CatalogDownloadStats>(name, 'catalog', '/internal/reports/downloads', { method: 'POST', body: { tracks, episodes } }),
  };
}

export const REVOKE_LABELS: Record<OfflineRevokeReason, L10n> = {
  MEMBERSHIP: L('Dicabut: keanggotaan', 'Revoked: membership'),
  DEVICE_REVOKED: L('Dicabut: perangkat dicabut', 'Revoked: device revoked'),
  CONTENT_WITHDRAWN: L('Dicabut: konten ditarik', 'Revoked: content withdrawn'),
  ACCOUNT_SUSPENDED: L('Dicabut: akun ditangguhkan', 'Revoked: account suspended'),
  USER_REMOVED: L('Dihapus pengguna', 'Removed by user'),
};
const REJECT_LABELS: Record<OfflinePlayReject, string> = {
  license_not_found: 'lisensi tidak ada',
  license_mismatch: 'lisensi beda konten',
  content_not_found: 'konten dihapus',
  before_license: 'sebelum lisensi',
  after_license: 'setelah lisensi',
  after_device_revoked: 'perangkat dicabut',
  in_future: 'waktu di masa depan',
  too_old: 'terlalu lama',
  overlap: 'tumpang tindih',
  daily_limit: 'batas harian',
};
const REJECT_LABELS_EN: Record<OfflinePlayReject, string> = {
  license_not_found: 'license not found',
  license_mismatch: 'license mismatch',
  content_not_found: 'content removed',
  before_license: 'before license',
  after_license: 'after license',
  after_device_revoked: 'device revoked',
  in_future: 'in the future',
  too_old: 'too old',
  overlap: 'overlap',
  daily_limit: 'daily limit',
};

const short = (id: string) => `${id.slice(0, 8)}…`;
const UNAVAILABLE = (svc: string) => L(`Data ${svc} tidak tersedia`, `${svc} data unavailable`);

/** Susun laporan (dipisah dari route agar teruji tanpa HTTP). */
export async function buildDownloadsReport(db: Db, deps: OfflineReportDeps, log?: { warn: (o: object, m: string) => void }): Promise<ServiceReport> {
  // Semua query lokal memakai indeks (migrasi 005/007/008): parsial ACTIVE/REVOKED/EXPIRED, BRIN created_at/received_at,
  // offline_requests_created_idx. Tidak ada pemindaian seluruh tabel.
  const [lic, revoked, plays, rejects, licSeries, playSeries, top] = await Promise.all([
    db.one(
      `SELECT (SELECT count(*) FROM offline_licenses WHERE status = 'ACTIVE' AND expires_at > now())::int AS active,
              (SELECT count(*) FROM offline_licenses WHERE status = 'EXPIRED' AND updated_at >= now() - interval '30 days')::int AS expired_30d,
              (SELECT count(*) FROM offline_licenses WHERE created_at >= now() - interval '30 days')::int AS issued_30d,
              (SELECT count(*) FROM offline_requests WHERE created_at > now() - interval '1 hour')::int AS pending`,
    ),
    db.query(
      `SELECT revoke_reason AS reason, count(*)::int AS n FROM offline_licenses
        WHERE status = 'REVOKED' AND revoked_at >= now() - interval '30 days' GROUP BY 1`,
    ),
    db.one(
      `SELECT count(*) FILTER (WHERE status = 'ACCEPTED')::int AS accepted, count(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
              count(*) FILTER (WHERE qualified_at IS NOT NULL)::int AS qualified
         FROM offline_plays WHERE received_at >= now() - interval '30 days'`,
    ),
    db.query(
      `SELECT reject_reason AS reason, count(*)::int AS n FROM offline_plays
        WHERE received_at >= now() - interval '30 days' AND status = 'REJECTED' GROUP BY 1 ORDER BY 2 DESC`,
    ),
    db.query(dailySql('offline_licenses', 'created_at')),
    db.query(dailySql('offline_plays', 'received_at', 'count(*)', `status = 'ACCEPTED'`)),
    db.query(
      `SELECT track_id, episode_id, count(*)::int AS licenses, count(DISTINCT user_id)::int AS users, count(*) FILTER (WHERE status = 'ACTIVE')::int AS active
         FROM offline_licenses WHERE created_at >= now() - interval '30 days'
        GROUP BY 1, 2 ORDER BY 3 DESC, 4 DESC LIMIT ${REPORT_TOP_LIMIT}`,
    ),
  ]);

  const topTracks = top.filter((r) => r.track_id).map((r) => r.track_id as string);
  const topEpisodes = top.filter((r) => r.episode_id).map((r) => r.episode_id as string);
  const [iam, cat] = await Promise.all([
    deps.iamStats().catch((e) => {
      log?.warn({ err: (e as Error).message }, 'laporan unduhan: statistik perangkat iam gagal');
      return null;
    }),
    deps.catalogStats(topTracks, topEpisodes).catch((e) => {
      log?.warn({ err: (e as Error).message }, 'laporan unduhan: statistik artefak catalog gagal');
      return null;
    }),
  ]);

  const revokedBy = new Map(revoked.map((r) => [String(r.reason), Number(r.n)]));
  const revokedTotal = revoked.reduce((a, r) => a + Number(r.n), 0);
  const rejected = plays?.rejected ?? 0;
  const topRejects = rejects.slice(0, 3).filter((r) => r.reason);
  const rejectHint = topRejects.length
    ? L(
        topRejects.map((r) => `${REJECT_LABELS[r.reason as OfflinePlayReject] ?? r.reason} ${r.n}`).join(' · '),
        topRejects.map((r) => `${REJECT_LABELS_EN[r.reason as OfflinePlayReject] ?? r.reason} ${r.n}`).join(' · '),
      )
    : undefined;
  const failedArtifacts = cat?.artifacts.failed ?? null;
  const lastError = cat?.failed[0]?.error;

  const kpis: ReportKpi[] = [
    { label: L('Perangkat aktif', 'Active devices'), value: iam?.devices.active ?? null, format: 'num', hint: iam ? undefined : UNAVAILABLE('iam') },
    { label: L('Perangkat dicabut (30 hari)', 'Devices revoked (30 days)'), value: iam?.devices.revoked_30d ?? null, format: 'num', hint: iam ? undefined : UNAVAILABLE('iam') },
    { label: L('Lisensi aktif', 'Active licenses'), value: lic?.active ?? 0, format: 'num', tone: 'good' },
    { label: L('Lisensi baru (30 hari)', 'New licenses (30 days)'), value: lic?.issued_30d ?? 0, format: 'num' },
    { label: L('Lisensi dicabut (30 hari)', 'Licenses revoked (30 days)'), value: revokedTotal, format: 'num' },
    ...(Object.keys(REVOKE_LABELS) as OfflineRevokeReason[]).map((k): ReportKpi => ({ label: REVOKE_LABELS[k], value: revokedBy.get(k) ?? 0, format: 'num', hint: L('30 hari', '30 days') })),
    { label: L('Lisensi kedaluwarsa (30 hari)', 'Licenses expired (30 days)'), value: lic?.expired_30d ?? 0, format: 'num' },
    { label: L('Artefak siap', 'Artifacts ready'), value: cat?.artifacts.ready ?? null, format: 'num', hint: cat ? undefined : UNAVAILABLE('catalog') },
    {
      label: L('Artefak diproses', 'Artifacts processing'),
      value: cat?.artifacts.processing ?? null,
      format: 'num',
      tone: (cat?.artifacts.processing ?? 0) > 20 ? 'warn' : 'neutral',
      hint: cat ? undefined : UNAVAILABLE('catalog'),
    },
    {
      label: L('Artefak gagal', 'Artifacts failed'),
      value: failedArtifacts,
      format: 'num',
      tone: failedArtifacts == null ? 'neutral' : failedArtifacts > 0 ? 'bad' : 'good',
      hint: !cat ? UNAVAILABLE('catalog') : lastError ? L(`Terakhir: ${lastError}`, `Latest: ${lastError}`) : undefined,
    },
    { label: L('Ukuran artefak siap', 'Ready artifact size'), value: cat?.artifacts.bytes ?? null, format: 'bytes', hint: cat ? undefined : UNAVAILABLE('catalog') },
    { label: L('Putar offline diterima (30 hari)', 'Offline plays accepted (30 days)'), value: plays?.accepted ?? 0, format: 'num', tone: 'good' },
    { label: L('Putar offline ditolak (30 hari)', 'Offline plays rejected (30 days)'), value: rejected, format: 'num', tone: rejected > 0 ? 'warn' : 'neutral', hint: rejectHint },
    { label: L('Putar offline qualified (30 hari)', 'Qualified offline plays (30 days)'), value: plays?.qualified ?? 0, format: 'num', hint: L('Dasar royalti', 'Royalty basis') },
    { label: L('Permintaan menunggu artefak', 'Requests awaiting artifact'), value: lic?.pending ?? 0, format: 'num', hint: L('1 jam terakhir', 'Last hour') },
  ];

  const content = cat?.content ?? {};
  const kindLabel = (episode: boolean) => (episode ? 'Episode' : 'Lagu');
  const label = (id: string, c?: { title: string | null; subtitle: string | null }) => (c?.title ? (c.subtitle ? `${c.title} — ${c.subtitle}` : c.title) : short(id));

  return {
    kpis,
    series: { label: L('Lisensi baru per hari', 'New licenses per day'), points: fillDaily(licSeries) },
    extra_series: [{ label: L('Putar offline diterima per hari', 'Offline plays accepted per day'), points: fillDaily(playSeries) }],
    table: {
      title: L('Konten paling banyak diunduh — 30 hari', 'Most downloaded content — 30 days'),
      columns: [
        { key: 'content', label: L('Konten', 'Content') },
        { key: 'kind', label: L('Jenis', 'Type') },
        { key: 'licenses', label: L('Lisensi baru', 'New licenses'), format: 'num' },
        { key: 'users', label: L('Pengguna', 'Users'), format: 'num' },
        { key: 'active', label: L('Masih aktif', 'Still active'), format: 'num' },
        { key: 'artifact', label: L('Artefak', 'Artifact'), format: 'status' },
      ],
      rows: top.map((r) => {
        const id = (r.track_id ?? r.episode_id) as string;
        return { content: label(id, content[id]), kind: kindLabel(!r.track_id), licenses: r.licenses, users: r.users, active: r.active, artifact: content[id]?.artifact?.toUpperCase() ?? null };
      }),
      empty: L('Belum ada unduhan dalam 30 hari', 'No downloads in the last 30 days'),
    },
    extra_tables: [
      {
        title: L('Artefak gagal terbaru', 'Latest failed artifacts'),
        columns: [
          { key: 'content', label: L('Konten', 'Content') },
          { key: 'kind', label: L('Jenis', 'Type') },
          { key: 'rendition', label: L('Rendisi', 'Rendition') },
          { key: 'attempts', label: L('Percobaan', 'Attempts'), format: 'num' },
          { key: 'error', label: L('Galat', 'Error') },
          { key: 'updated_at', label: L('Waktu', 'Time'), format: 'datetime' },
        ],
        rows: (cat?.failed ?? []).slice(0, REPORT_TOP_LIMIT).map((f) => ({
          content: label(f.content_id, f),
          kind: kindLabel(f.content_kind === 'episode'),
          rendition: f.rendition,
          attempts: f.attempts,
          error: f.error,
          updated_at: f.updated_at,
        })),
        empty: cat ? L('Tidak ada artefak gagal', 'No failed artifacts') : UNAVAILABLE('catalog'),
      },
    ],
    generated_at: new Date().toISOString(),
  };
}

export async function offlineReportRoutes(app: FastifyInstance, { db, name }: Pick<ServiceContext, 'db' | 'name'>, deps: OfflineReportDeps = reportServiceDeps(name)) {
  app.get('/v1/admin/reports/downloads', { preHandler: requireSuperAdmin }, async (req): Promise<ServiceReport> => buildDownloadsReport(db, deps, req.log));
}
