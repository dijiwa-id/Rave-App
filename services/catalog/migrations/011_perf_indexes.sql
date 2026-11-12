-- Audit performa 2026-11-12: cek keunikan ISRC (studio) & sinyal duplikasi QC (admin) sebelumnya seq scan tracks.
CREATE INDEX IF NOT EXISTS tracks_isrc_idx ON tracks (isrc) WHERE isrc IS NOT NULL;
CREATE INDEX IF NOT EXISTS tracks_title_lower_idx ON tracks (lower(title));
-- Daftar rilis Studio per artis (ORDER BY created_at DESC).
CREATE INDEX IF NOT EXISTS releases_artist_created_idx ON releases (artist_id, created_at DESC);
