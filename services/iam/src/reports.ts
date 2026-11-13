import type { FastifyInstance } from 'fastify';
import { L, dailySql, fillDaily, type ServiceReport } from '@rave/domain/reports';
import { requireSuperAdmin, type ServiceContext } from '@rave/service-kit';

const ACTIVE = `member_type <> 'FREE' AND (member_until IS NULL OR member_until > now())`;

/** Laporan Langganan Premium & RAVE Pro (Super Admin). Jenis member diubah di Pengguna → Pengguna. */
export async function reportRoutes(app: FastifyInstance, { db }: ServiceContext) {
  app.get('/v1/admin/reports/subscription', { preHandler: requireSuperAdmin }, async (): Promise<ServiceReport> => {
    const k = await db.one(
      `SELECT count(*)::int AS users, count(*) FILTER (WHERE ${ACTIVE})::int AS premium,
              count(*) FILTER (WHERE ${ACTIVE} AND member_type = 'INDIVIDUAL')::int AS individual,
              count(*) FILTER (WHERE ${ACTIVE} AND member_type = 'STUDENT')::int AS student,
              count(*) FILTER (WHERE ${ACTIVE} AND member_type = 'DUO')::int AS duo,
              count(*) FILTER (WHERE ${ACTIVE} AND member_until < now() + interval '30 days')::int AS expiring
         FROM users WHERE deleted_at IS NULL`,
    );
    const series = await db.query(dailySql('users', 'created_at', 'count(*)', 'deleted_at IS NULL'));
    const rows = await db.query(
      `SELECT display_name, email, member_type, member_until, member_updated_at FROM users
        WHERE deleted_at IS NULL AND member_type <> 'FREE' ORDER BY member_updated_at DESC NULLS LAST, created_at DESC LIMIT 50`,
    );
    const pct = k?.users ? ((k.premium ?? 0) * 100) / k.users : 0;
    return {
      kpis: [
        { label: L('Premium aktif', 'Active Premium'), value: k?.premium ?? 0, format: 'num', hint: L(`${pct.toFixed(1)}% dari ${k?.users ?? 0} akun`, `${pct.toFixed(1)}% of ${k?.users ?? 0} accounts`) },
        { label: L('Individu', 'Individual'), value: k?.individual ?? 0, format: 'num' },
        { label: L('Pelajar', 'Student'), value: k?.student ?? 0, format: 'num' },
        { label: L('Duo', 'Duo'), value: k?.duo ?? 0, format: 'num' },
        { label: L('Berakhir ≤ 30 hari', 'Ending ≤ 30 days'), value: k?.expiring ?? 0, format: 'num', tone: (k?.expiring ?? 0) > 0 ? 'warn' : 'neutral' },
      ],
      series: { label: L('Akun baru per hari', 'New accounts per day'), points: fillDaily(series) },
      table: {
        title: L('Member berbayar', 'Paid members'),
        columns: [
          { key: 'display_name', label: L('Nama', 'Name') },
          { key: 'email', label: L('Email', 'Email') },
          { key: 'member_type', label: L('Jenis', 'Type'), format: 'status' },
          { key: 'member_until', label: L('Berlaku sampai', 'Valid until'), format: 'date' },
          { key: 'member_updated_at', label: L('Diubah', 'Changed'), format: 'datetime' },
        ],
        rows,
        empty: L('Belum ada member berbayar', 'No paid members yet'),
        link: { label: L('Ubah jenis member', 'Change member type'), href: '/admin/users' },
      },
      generated_at: new Date().toISOString(),
    };
  });

  // RAVE Pro belum bisa dibeli: tampilkan calon pelanggan (organisasi promotor, artis, manajemen, label).
  app.get('/v1/admin/reports/pro', { preHandler: requireSuperAdmin }, async (): Promise<ServiceReport> => {
    const k = await db.one(
      `SELECT count(*) FILTER (WHERE type IN ('PROMOTOR','VENUE'))::int AS promotors, count(*) FILTER (WHERE type = 'ARTIST')::int AS artists,
              count(*) FILTER (WHERE type IN ('MANAGEMENT','LABEL'))::int AS mgmt, count(*) FILTER (WHERE verified)::int AS verified FROM orgs`,
    );
    const rows = await db.query(`SELECT name, type, city, verified, created_at FROM orgs ORDER BY verified DESC, created_at DESC LIMIT 50`);
    return {
      kpis: [
        { label: L('Promotor & venue', 'Promoters & venues'), value: k?.promotors ?? 0, format: 'num' },
        { label: L('Artis', 'Artists'), value: k?.artists ?? 0, format: 'num' },
        { label: L('Manajemen & label', 'Management & labels'), value: k?.mgmt ?? 0, format: 'num' },
        { label: L('Terverifikasi (KYB)', 'Verified (KYB)'), value: k?.verified ?? 0, format: 'num', tone: 'good' },
      ],
      table: {
        title: L('Calon pelanggan RAVE Pro (organisasi)', 'Prospective RAVE Pro customers (organizations)'),
        columns: [
          { key: 'name', label: L('Organisasi', 'Organization') },
          { key: 'type', label: L('Jenis', 'Type'), format: 'status' },
          { key: 'city', label: L('Kota', 'City') },
          { key: 'verified', label: L('Terverifikasi', 'Verified'), format: 'status' },
          { key: 'created_at', label: L('Bergabung', 'Joined'), format: 'date' },
        ],
        rows: rows.map((r) => ({ ...r, verified: r.verified ? 'YES' : 'NO' })),
        empty: L('Belum ada organisasi', 'No organizations yet'),
      },
      generated_at: new Date().toISOString(),
    };
  });
}
