-- Laporan Unduhan offline (Super Admin, P-7): perangkat dicabut per rentang waktu. Indeks parsial (hanya baris dicabut)
-- di tabel kecil user_devices — aman di dalam transaksi migrasi.
CREATE INDEX IF NOT EXISTS user_devices_revoked_idx ON user_devices (revoked_at) WHERE revoked_at IS NOT NULL;
