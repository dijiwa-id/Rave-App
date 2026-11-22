-- Unduhan offline (P-7, review keamanan L5): id kunci segel CEK per artefak. Bahan kunci (OFFLINE_KEY/KYC_KEY) berganti
-- → key_id tidak cocok → artefak dibangun ulang otomatis (bukan 500 saat membuka CEK). Kolom nullable tanpa default
-- = hanya metadata (aman untuk data produksi); baris lama NULL diperiksa dengan mencoba membuka CEK.
ALTER TABLE offline_artifacts ADD COLUMN IF NOT EXISTS key_id text;
