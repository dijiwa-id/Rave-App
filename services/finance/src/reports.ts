import type { FastifyInstance } from 'fastify';
import { L, dailySql, fillDaily, type ServiceReport } from '@rave/domain/reports';
import { requireSuperAdmin, type ServiceContext } from '@rave/service-kit';

/** Ringkasan Payout (Super Admin). Persetujuan & transfer tetap di Keuangan → Finance (tidak diduplikasi). */
export async function reportRoutes(app: FastifyInstance, { db }: ServiceContext) {
  app.get('/v1/admin/reports/payout', { preHandler: requireSuperAdmin }, async (): Promise<ServiceReport> => {
    const k = await db.one(
      // Status payout (migrasi 006): PENDING_APPROVAL → REQUESTED (disetujui, antre transfer) → PROCESSING → COMPLETED | FAILED | REJECTED.
      `SELECT count(*) FILTER (WHERE status = 'PENDING_APPROVAL')::int AS requested,
              count(*) FILTER (WHERE status IN ('REQUESTED','PROCESSING'))::int AS processing,
              count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
              coalesce(sum(amount) FILTER (WHERE status IN ('PENDING_APPROVAL','REQUESTED','PROCESSING')), 0)::bigint AS pending_amount,
              coalesce(sum(amount) FILTER (WHERE status = 'COMPLETED' AND completed_at >= now() - interval '30 days'), 0)::bigint AS paid_30,
              count(*) FILTER (WHERE status = 'REJECTED' AND created_at >= now() - interval '30 days')::int AS rejected_30
         FROM payouts`,
    );
    const series = await db.query(dailySql('payouts', 'completed_at', 'coalesce(sum(amount), 0)', "status = 'COMPLETED'"));
    const rows = await db.query(
      `SELECT p.party_id, b.holder, p.amount, p.status, p.created_at, p.completed_at
         FROM payouts p LEFT JOIN bank_accounts b ON b.party_id = p.party_id ORDER BY p.created_at DESC LIMIT 10`,
    );
    return {
      kpis: [
        { label: L('Menunggu persetujuan', 'Awaiting approval'), value: k?.requested ?? 0, format: 'num', tone: (k?.requested ?? 0) > 0 ? 'warn' : 'good' },
        { label: L('Antre / diproses transfer', 'Queued / transferring'), value: k?.processing ?? 0, format: 'num' },
        { label: L('Transfer gagal', 'Failed transfers'), value: k?.failed ?? 0, format: 'num', tone: (k?.failed ?? 0) > 0 ? 'bad' : 'good' },
        { label: L('Nilai tertunda', 'Pending amount'), value: Number(k?.pending_amount ?? 0), format: 'idr' },
        { label: L('Dibayar (30 hari)', 'Paid out (30 days)'), value: Number(k?.paid_30 ?? 0), format: 'idr', tone: 'good' },
        { label: L('Ditolak (30 hari)', 'Rejected (30 days)'), value: k?.rejected_30 ?? 0, format: 'num' },
      ],
      series: { label: L('Payout dibayar per hari', 'Payouts paid per day'), format: 'idr', points: fillDaily(series) },
      table: {
        title: L('Permintaan terbaru', 'Latest requests'),
        columns: [
          { key: 'holder', label: L('Pemilik rekening', 'Account holder') },
          { key: 'amount', label: L('Nominal', 'Amount'), format: 'idr' },
          { key: 'status', label: L('Status', 'Status'), format: 'status' },
          { key: 'created_at', label: L('Diajukan', 'Requested'), format: 'datetime' },
          { key: 'completed_at', label: L('Selesai', 'Completed'), format: 'datetime' },
        ],
        rows: rows.map((r) => ({ ...r, holder: r.holder ?? r.party_id, amount: Number(r.amount) })),
        empty: L('Belum ada permintaan payout', 'No payout requests yet'),
        link: { label: L('Kelola di Finance', 'Manage in Finance'), href: '/admin/finance' },
      },
      generated_at: new Date().toISOString(),
    };
  });
}
