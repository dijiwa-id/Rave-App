-- Eksekusi payout (audit go-live B2). Sebelumnya nomor rekening hanya disimpan hash+masked sehingga dana tidak
-- dapat ditransfer, dan job menandai COMPLETED tanpa transfer. Kini:
--  * nomor rekening disimpan terenkripsi AES-256-GCM (rekening aktif + snapshot per payout);
--  * di produksi payout menunggu transfer oleh Finance (atau adapter disbursement kelak) dan baru COMPLETED
--    setelah Finance mencatat nomor referensi transfer; di development tetap otomatis (sandbox).
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS number_enc text;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS bank_number_enc text;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS transfer_ref text;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS completed_by text;
