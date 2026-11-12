-- Ganti sampul rilis dari Artist Studio. Rilis yang sudah lolos QC (SCHEDULED/LIVE) tidak langsung berganti sampul:
-- sampul baru menunggu tinjauan QC (pending_cover_*) dan sampul lama tetap tayang sampai disetujui.
ALTER TABLE releases ADD COLUMN IF NOT EXISTS pending_cover_url text;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS pending_cover_at timestamptz;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS pending_cover_by text;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS cover_review_note text;
CREATE INDEX IF NOT EXISTS releases_pending_cover_idx ON releases (pending_cover_at) WHERE pending_cover_url IS NOT NULL;
