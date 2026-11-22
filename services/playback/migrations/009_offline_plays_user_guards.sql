-- Putar offline (P-7) — perbaikan review keamanan. Hanya indeks baru pada offline_plays (tabel P-7, masih kecil saat
-- rilis → aman di dalam transaksi migrasi). Tidak mengubah/menghapus data.

-- Tumpang tindih & batas harian kini per PENGGUNA (semua perangkat akun), hanya putar yang diterima.
-- Indeks lama offline_plays_device_started_idx (006) sengaja dipertahankan agar rollback ke versi sebelumnya tetap cepat;
-- boleh di-DROP pada rilis berikutnya.
CREATE INDEX IF NOT EXISTS offline_plays_user_started_idx ON offline_plays (user_id, started_at_client) WHERE status = 'ACCEPTED';

-- Kuota baris REJECTED per perangkat per hari (waktu diterima). Pembersihan REJECTED lama memakai BRIN received_at (008).
CREATE INDEX IF NOT EXISTS offline_plays_device_rejected_idx ON offline_plays (device_id, received_at) WHERE status = 'REJECTED';
