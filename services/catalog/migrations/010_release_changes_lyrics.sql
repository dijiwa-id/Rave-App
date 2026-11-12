-- Edit rilis yang sudah lolos QC (SCHEDULED/LIVE) dari Artist Studio: perubahan metadata rilis & lagu tidak langsung
-- berlaku — disimpan sebagai pengajuan (pending_changes) dan ditinjau QC; data lama tetap tayang sampai disetujui.
-- Bentuk: {"release": {"title": …, "genre": …}, "tracks": {"<track_id>": {"title": …, "explicit": …}}}
ALTER TABLE releases ADD COLUMN IF NOT EXISTS pending_changes jsonb;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS pending_changes_at timestamptz;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS pending_changes_by text;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS changes_review_note text;
CREATE INDEX IF NOT EXISTS releases_pending_changes_idx ON releases (pending_changes_at) WHERE pending_changes IS NOT NULL;

-- Lirik dikelola artis dari Studio (teks biasa / LRC tersinkron): jejak perubahan & bahasa.
ALTER TABLE lyrics ADD COLUMN IF NOT EXISTS language text;
ALTER TABLE lyrics ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE lyrics ADD COLUMN IF NOT EXISTS updated_by text;
