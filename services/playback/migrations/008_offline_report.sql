-- Laporan Unduhan offline (Super Admin, P-7): hitungan per rentang waktu tanpa memindai seluruh tabel.
-- offline_licenses/offline_plays adalah tabel baru P-7 (masih kecil saat rilis) — aman di dalam transaksi migrasi.
-- BRIN untuk kolom waktu yang naik bersama urutan sisip (deret harian & konten teratas 30 hari). autosummarize: rentang
-- blok baru diringkas segera oleh autovacuum — tanpa itu rentang belum-diringkas selalu ikut dipindai (lossy).
CREATE INDEX IF NOT EXISTS offline_licenses_created_brin ON offline_licenses USING brin (created_at) WITH (autosummarize = on);
CREATE INDEX IF NOT EXISTS offline_plays_received_brin ON offline_plays USING brin (received_at) WITH (autosummarize = on);
-- Lisensi dicabut / kedaluwarsa 30 hari terakhir (parsial: hanya baris berstatus itu).
CREATE INDEX IF NOT EXISTS offline_licenses_revoked_idx ON offline_licenses (revoked_at) WHERE status = 'REVOKED';
CREATE INDEX IF NOT EXISTS offline_licenses_expired_idx ON offline_licenses (updated_at) WHERE status = 'EXPIRED';
