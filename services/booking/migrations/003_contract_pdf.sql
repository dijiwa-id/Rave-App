-- Hash PDF draf (SHA-256 byte dokumen) dan waktu render.
ALTER TABLE contracts ADD COLUMN draft_sha256 text, ADD COLUMN draft_rendered_at timestamptz;
