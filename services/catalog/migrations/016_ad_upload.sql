-- Audio & gambar kampanye iklan diunggah dari komputer lewat /v1/studio/uploads dengan purpose 'ad'
-- (izin ads.manage; audio MP3/AAC/OGG/Opus ≤ batas durasi iklan, tanpa transcoding; gambar ≥ 300 px).
ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_purpose_check;
ALTER TABLE uploads ADD CONSTRAINT uploads_purpose_check CHECK (purpose IN ('release', 'playlist', 'category', 'podcast', 'ad'));
