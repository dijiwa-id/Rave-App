-- Editor playlist editorial (Back Office, izin library.curate): draf vs tayang.
-- Default true agar playlist editorial yang sudah ada tetap tampil di beranda.
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS playlists_editorial_idx ON playlists (sort_order, created_at) WHERE is_editorial;
