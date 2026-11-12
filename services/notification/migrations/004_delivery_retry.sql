-- Worker pengiriman nyata (GO-LIVE P0 #1): baris diklaim (SENDING) sebelum memanggil provider agar koneksi DB tidak
-- tertahan selama panggilan HTTP; gagal sementara dijadwalkan ulang dengan backoff.
-- Status: PENDING | SENDING | SENT | FAILED | SKIPPED (push belum ada provider/perangkat, kontak tidak tersedia).
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS provider_ref text;
CREATE INDEX IF NOT EXISTS deliveries_sending_idx ON deliveries (claimed_at) WHERE status = 'SENDING';
