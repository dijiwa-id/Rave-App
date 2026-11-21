-- Foto profil pengguna (verifikasi akun) diunggah lewat /v1/studio/uploads dengan purpose 'avatar'
-- (gambar saja, ≤ 8 MB, ≥ 300 px — sama dengan sampul playlist).
ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_purpose_check;
ALTER TABLE uploads ADD CONSTRAINT uploads_purpose_check CHECK (purpose IN ('release', 'playlist', 'category', 'podcast', 'ad', 'avatar'));
