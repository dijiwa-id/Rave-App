-- Master audio multi-format (WAV/FLAC/AIFF/ALAC/MP3/AAC/OGG/Opus) + rendisi streaming hasil transcoding.
-- Metadata & rendisi melekat pada upload; lagu menemukannya lewat audio_url (= /v1/catalog/media/<stored_name>),
-- sehingga lagu lama/demo (URL eksternal) tetap berjalan tanpa migrasi data.
ALTER TABLE uploads
  ADD COLUMN IF NOT EXISTS audio_meta        jsonb,
  ADD COLUMN IF NOT EXISTS renditions        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- none: bukan audio / belum selesai diunggah · pending → processing → done | failed · skipped: transcoding dimatikan
  ADD COLUMN IF NOT EXISTS transcode_status  text NOT NULL DEFAULT 'none'
    CHECK (transcode_status IN ('none','pending','processing','done','failed','skipped')),
  ADD COLUMN IF NOT EXISTS transcode_error   text,
  ADD COLUMN IF NOT EXISTS transcode_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transcode_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS transcoded_at     timestamptz;

-- Antrean transcoding (diklaim dengan FOR UPDATE SKIP LOCKED).
CREATE INDEX IF NOT EXISTS uploads_transcode_queue_idx ON uploads (created_at) WHERE transcode_status IN ('pending','processing');
-- Resolusi lagu → upload lewat nama berkas.
CREATE UNIQUE INDEX IF NOT EXISTS uploads_stored_name_idx ON uploads (stored_name);
