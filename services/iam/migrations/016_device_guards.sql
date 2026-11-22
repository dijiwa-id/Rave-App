-- Unduhan offline (P-7, review keamanan L3): laju pendaftaran perangkat per 24 jam & blokir daftar ulang kunci yang
-- baru dicabut membaca SEMUA perangkat akun (termasuk yang dicabut) — indeks parsial yang ada hanya baris aktif.
-- Tabel kecil (≤ puluhan baris per akun), CREATE INDEX biasa aman di dalam transaksi migrasi.
CREATE INDEX IF NOT EXISTS user_devices_user_created_idx ON user_devices (user_id, created_at);
