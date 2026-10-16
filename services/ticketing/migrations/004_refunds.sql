-- Refund tiket (REQ-TIX-05): pembatalan event, perubahan jadwal, permintaan pembeli, pembayaran terlambat.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('RESERVED','PAID','EXPIRED','CANCELLED','REFUNDED'));

-- Jejak refund per order. PENDING = tiket sudah dibatalkan, menunggu finance; REVIEW = pembayaran terlambat menunggu admin.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_status text CHECK (refund_status IN ('PENDING','COMPLETED','FAILED','REVIEW'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_reason text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_pct numeric(5,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_amount bigint;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_note text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_requested_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
CREATE INDEX IF NOT EXISTS orders_refund_idx ON orders (refund_status, refund_requested_at) WHERE refund_status IS NOT NULL;

ALTER TABLE events ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE events ADD COLUMN IF NOT EXISTS cancel_reason text;
-- Perubahan jadwal/venue setelah publish → membuka masa refund penuh (refund.reschedule_opt_out_days).
ALTER TABLE events ADD COLUMN IF NOT EXISTS rescheduled_at timestamptz;
