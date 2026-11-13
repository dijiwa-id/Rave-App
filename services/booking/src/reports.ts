import type { FastifyInstance } from 'fastify';
import { TERMINAL_STATUSES } from '@rave/domain/booking';
import { L, dailySql, fillDaily, type ServiceReport } from '@rave/domain/reports';
import { requireSuperAdmin, type ServiceContext } from '@rave/service-kit';

// Status akhir booking (domain) + COMPLETED (acara selesai, menunggu pelunasan escrow) — bukan "berjalan".
const DONE = `(${[...new Set([...TERMINAL_STATUSES, 'COMPLETED'])].map((s) => `'${s}'`).join(',')})`;
// Kontrak: alur baru berakhir ACTIVE; SIGNED = nilai lama.
const SIGNED = `('SIGNED','ACTIVE')`;
const WAITING = `('SENT','CONTRACT_GENERATED','AWAITING_PROMOTOR_SIGN','AWAITING_MANAGEMENT_SIGN','AWAITING_ARTIST_ACK')`;

/** Laporan Booking Off-Air & Kontrak (Super Admin → Pengaturan Layanan). */
export async function reportRoutes(app: FastifyInstance, { db }: ServiceContext) {
  app.get('/v1/admin/reports/booking', { preHandler: requireSuperAdmin }, async (): Promise<ServiceReport> => {
    const k = await db.one(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE status NOT IN ${DONE})::int AS active,
              count(*) FILTER (WHERE status IN ('COMPLETED','SETTLED'))::int AS done,
              coalesce(sum(agreed_fee) FILTER (WHERE agreed_fee IS NOT NULL AND created_at >= now() - interval '30 days'), 0)::bigint AS gmv,
              (SELECT count(*) FROM disputes WHERE status = 'OPEN')::int AS disputes
         FROM bookings`,
    );
    const series = await db.query(dailySql('bookings', 'created_at'));
    const rows = await db.query(
      `SELECT b.event_name, a.name AS artist, b.city, to_char(b.event_date, 'YYYY-MM-DD') AS event_date, b.status, coalesce(b.agreed_fee, b.latest_fee, b.budget) AS fee, b.created_at
         FROM bookings b LEFT JOIN artists a ON a.id = b.artist_id ORDER BY b.created_at DESC LIMIT 30`,
    );
    return {
      kpis: [
        { label: L('Total booking', 'Total bookings'), value: k?.total ?? 0, format: 'num' },
        { label: L('Berjalan', 'In progress'), value: k?.active ?? 0, format: 'num' },
        { label: L('Selesai', 'Completed'), value: k?.done ?? 0, format: 'num', tone: 'good' },
        { label: L('Nilai disepakati (30 hari)', 'Agreed value (30 days)'), value: Number(k?.gmv ?? 0), format: 'idr' },
        { label: L('Dispute terbuka', 'Open disputes'), value: k?.disputes ?? 0, format: 'num', tone: (k?.disputes ?? 0) > 0 ? 'warn' : 'good' },
      ],
      series: { label: L('Booking baru per hari', 'New bookings per day'), points: fillDaily(series) },
      table: {
        title: L('Booking terbaru', 'Latest bookings'),
        columns: [
          { key: 'event_name', label: L('Acara', 'Event') },
          { key: 'artist', label: L('Artis', 'Artist') },
          { key: 'city', label: L('Kota', 'City') },
          { key: 'event_date', label: L('Tanggal acara', 'Event date'), format: 'date' },
          { key: 'status', label: L('Status', 'Status'), format: 'status' },
          { key: 'fee', label: L('Fee', 'Fee'), format: 'idr' },
        ],
        rows,
        empty: L('Belum ada booking', 'No bookings yet'),
        link: { label: L('Mediasi dispute', 'Mediate disputes'), href: '/admin/disputes' },
      },
      generated_at: new Date().toISOString(),
    };
  });

  app.get('/v1/admin/reports/contract', { preHandler: requireSuperAdmin }, async (): Promise<ServiceReport> => {
    const k = await db.one(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ${SIGNED})::int AS signed,
              count(*) FILTER (WHERE status IN ${WAITING})::int AS waiting,
              count(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
              count(*) FILTER (WHERE signed_at >= now() - interval '30 days')::int AS signed_30
         FROM contracts`,
    );
    const series = await db.query(dailySql('contracts', 'signed_at', 'count(*)', 'signed_at IS NOT NULL'));
    const rows = await db.query(
      `SELECT c.contract_no, b.event_name, c.version, c.status, c.created_at, c.signed_at
         FROM contracts c LEFT JOIN bookings b ON b.id = c.booking_id ORDER BY c.created_at DESC LIMIT 30`,
    );
    return {
      kpis: [
        { label: L('Total kontrak', 'Total contracts'), value: k?.total ?? 0, format: 'num' },
        { label: L('Ditandatangani', 'Signed'), value: k?.signed ?? 0, format: 'num', tone: 'good' },
        { label: L('Menunggu tanda tangan', 'Awaiting signature'), value: k?.waiting ?? 0, format: 'num', tone: (k?.waiting ?? 0) > 0 ? 'warn' : 'neutral' },
        { label: L('Ditolak', 'Rejected'), value: k?.rejected ?? 0, format: 'num' },
        { label: L('Ditandatangani (30 hari)', 'Signed (30 days)'), value: k?.signed_30 ?? 0, format: 'num' },
      ],
      series: { label: L('Kontrak ditandatangani per hari', 'Contracts signed per day'), points: fillDaily(series) },
      table: {
        title: L('Kontrak terbaru', 'Latest contracts'),
        columns: [
          { key: 'contract_no', label: L('No. kontrak', 'Contract no.') },
          { key: 'event_name', label: L('Acara', 'Event') },
          { key: 'version', label: L('Versi', 'Version'), format: 'num' },
          { key: 'status', label: L('Status', 'Status'), format: 'status' },
          { key: 'created_at', label: L('Dibuat', 'Created'), format: 'datetime' },
          { key: 'signed_at', label: L('Ditandatangani', 'Signed'), format: 'datetime' },
        ],
        rows,
        empty: L('Belum ada kontrak', 'No contracts yet'),
      },
      generated_at: new Date().toISOString(),
    };
  });
}
