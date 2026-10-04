-- Retry dead letter dari panel Super Admin: set retry_requested_at → konsumen group memproses ulang.
ALTER TABLE bus.dead_letters ADD COLUMN IF NOT EXISTS retry_requested_at timestamptz;
ALTER TABLE bus.dead_letters ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 1;
