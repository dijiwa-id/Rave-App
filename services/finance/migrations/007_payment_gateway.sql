-- Payment gateway nyata (Midtrans). Invoice mengingat penyedia tempat ia dibayar agar refund lewat jalur yang sama
-- walaupun Super Admin mengganti penyedia aktif di kemudian hari.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'sandbox';
-- Sesi halaman bayar hosted (Snap): dipakai ulang selama belum kedaluwarsa (order_id Midtrans tidak boleh diulang).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS checkout_token text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS checkout_url text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS checkout_expires_at timestamptz;
