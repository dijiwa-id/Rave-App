-- Refund lewat penyedia pembayaran (adapter): REQUESTED → (dispatch ke PG) PENDING → COMPLETED | FAILED.
-- Jurnal: saat diminta, escrow → liability:refund:<payer> (utang ke pembeli); saat penyedia mengonfirmasi, utang → kas escrow keluar.
ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_status_check;
ALTER TABLE refunds ADD CONSTRAINT refunds_status_check CHECK (status IN ('REQUESTED','PENDING','COMPLETED','FAILED'));
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS provider_ref text;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS settled_by text;          -- 'provider' | 'manual:<admin id>'
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS manual_ref text;          -- no. transfer bila diselesaikan manual
CREATE UNIQUE INDEX IF NOT EXISTS refunds_provider_ref_uq ON refunds (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS refunds_dispatch_idx ON refunds (next_attempt_at) WHERE status = 'REQUESTED';
CREATE INDEX IF NOT EXISTS refunds_pending_idx ON refunds (dispatched_at) WHERE status = 'PENDING';
