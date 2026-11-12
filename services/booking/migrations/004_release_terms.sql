-- Syarat pencairan dibekukan saat kontrak aktif (audit go-live B4): split penerima, tarif PPh, dan komisi platform
-- diambil dari kontrak yang ditandatangani — bukan dari `fee_splits` terkini (bisa diubah manajer setelah tanda
-- tangan) atau tarif yang di-hardcode. Format: {"splits":[{"partyId","pct"}],"tax_pct":2,"tax_kind":"PPH23","commission_pct":7}
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS release_terms jsonb;
