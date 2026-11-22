-- Laporan Unduhan offline (Super Admin, P-7): artefak gagal terbaru tanpa memindai seluruh offline_artifacts.
-- Indeks parsial kecil (hanya baris failed) di tabel baru P-7 — aman di dalam transaksi migrasi.
CREATE INDEX IF NOT EXISTS offline_artifacts_failed_idx ON offline_artifacts (updated_at DESC) WHERE status = 'failed';
