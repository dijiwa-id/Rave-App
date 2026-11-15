-- Kebijakan kualitas (Free vs Premium): versi Lossless (FLAC) dibuat sesuai permintaan Premium (transcoding.lossless_mode).
-- lossless_requested_at = ada pelanggan Premium yang meminta Lossless untuk master ini → worker membuat rendisi FLAC
-- (hanya yang belum ada; rendisi lain tidak di-encode ulang).
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS lossless_requested_at timestamptz;
