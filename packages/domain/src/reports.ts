// Kontrak laporan sub-layanan (Super Admin → Pengaturan Layanan → tab Laporan).
// Tiap service pemilik data menyajikan `GET /v1/admin/reports/<layanan>` dengan bentuk yang sama; web merender satu komponen.

/** Teks dua bahasa (label dirender sesuai bahasa admin). */
export type L10n = { id: string; en: string };
export const L = (id: string, en: string): L10n => ({ id, en });

export type ReportFormat = 'num' | 'idr' | 'pct' | 'bytes' | 'date' | 'datetime' | 'text' | 'status';

export interface ReportKpi {
  label: L10n;
  value: number | null;
  format?: Exclude<ReportFormat, 'date' | 'datetime' | 'text' | 'status'>;
  hint?: L10n;
  /** Warna penekanan: warn/bad untuk antrean bermasalah. */
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}

export interface ReportColumn {
  key: string;
  label: L10n;
  format?: ReportFormat;
}

export interface ServiceReport {
  kpis: ReportKpi[];
  /** Tren harian (hari tanpa data = 0), urut menaik. */
  series?: { label: L10n; format?: 'num' | 'idr'; points: { date: string; value: number }[] };
  table: { title: L10n; columns: ReportColumn[]; rows: Record<string, unknown>[]; empty?: L10n; link?: { label: L10n; href: string } };
  generated_at: string;
}

export const REPORT_SERIES_DAYS = 14;

/** Lengkapi deret harian `days` hari terakhir (WIB) — tanggal tanpa baris diisi 0. */
export function fillDaily(rows: { date: string | Date; value: number | string }[], days = REPORT_SERIES_DAYS): { date: string; value: number }[] {
  const byDate = new Map(rows.map((r) => [typeof r.date === 'string' ? r.date.slice(0, 10) : r.date.toISOString().slice(0, 10), Number(r.value) || 0]));
  const out: { date: string; value: number }[] = [];
  const today = new Date(Date.now() + 7 * 3600_000); // WIB
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date: d, value: byDate.get(d) ?? 0 });
  }
  return out;
}

/** SQL deret harian WIB untuk kolom waktu `col` (hasil: date, value) — dipakai bersama `fillDaily`. */
export const dailySql = (table: string, col: string, value = 'count(*)', where = 'true') =>
  `SELECT to_char((${col} AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD') AS date, ${value} AS value FROM ${table}
    WHERE ${col} >= now() - interval '${REPORT_SERIES_DAYS} days' AND ${where} GROUP BY 1`;
