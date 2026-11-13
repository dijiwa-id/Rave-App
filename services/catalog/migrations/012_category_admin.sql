-- Kelola kategori Jelajahi dari dashboard Super Admin (tambah/ubah/hapus/urutkan + unggah gambar sampul).
-- Gambar sampul kategori diunggah lewat /v1/studio/uploads dengan purpose 'category' (≥ 300 px, ≤ 8 MB, seperti sampul playlist).
ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_purpose_check;
ALTER TABLE uploads ADD CONSTRAINT uploads_purpose_check CHECK (purpose IN ('release', 'playlist', 'category'));
ALTER TABLE categories ADD COLUMN IF NOT EXISTS updated_at timestamptz;
