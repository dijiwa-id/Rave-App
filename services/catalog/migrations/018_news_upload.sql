-- Foto utama artikel berita (Back Office → Berita, izin news.publish) diunggah lewat /v1/studio/uploads dengan
-- purpose 'news' (gambar saja, ≤ 8 MB, sisi pendek ≥ 600 px, disarankan 16:9).
ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_purpose_check;
ALTER TABLE uploads ADD CONSTRAINT uploads_purpose_check CHECK (purpose IN ('release', 'playlist', 'category', 'podcast', 'ad', 'avatar', 'news'));
