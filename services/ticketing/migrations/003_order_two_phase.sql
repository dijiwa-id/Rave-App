-- Order dua fase: reservasi (tx pendek) → invoice finance (di luar tx) → tempel invoice_id (tx pendek).
-- Idempotency-Key dicatat di baris order agar retry/duplikat paralel melanjutkan order yang sama, bukan reservasi ganda.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_user_idem_uq ON orders (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- Job pemulihan: order RESERVED yang belum punya invoice (proses mati di antara fase).
CREATE INDEX IF NOT EXISTS orders_pending_invoice_idx ON orders (created_at) WHERE status = 'RESERVED' AND invoice_id IS NULL;
