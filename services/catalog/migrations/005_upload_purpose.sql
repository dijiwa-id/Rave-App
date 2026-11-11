-- Tujuan upload gambar: 'release' (artwork rilis, standar 3000 px) atau 'playlist' (sampul playlist pengguna, ringan).
-- Menentukan aturan validasi & batas ukuran; playlist dimiliki service library (lihat /internal/media/references di sana).
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'release' CHECK (purpose IN ('release','playlist'));
