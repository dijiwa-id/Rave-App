-- DISPATCHING = sewa (lease) selama refund sedang dikirim ke penyedia: jalur manual admin tidak boleh menyelesaikannya
-- bersamaan (refund ganda). Sewa kedaluwarsa (proses mati) → diambil ulang job; penyedia idempoten per id refund.
ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_status_check;
ALTER TABLE refunds ADD CONSTRAINT refunds_status_check CHECK (status IN ('REQUESTED','DISPATCHING','PENDING','COMPLETED','FAILED'));
DROP INDEX IF EXISTS refunds_dispatch_idx;
CREATE INDEX IF NOT EXISTS refunds_dispatch_idx ON refunds (next_attempt_at) WHERE status IN ('REQUESTED','DISPATCHING');
