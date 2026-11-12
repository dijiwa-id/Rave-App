-- Audit performa 2026-11-12: playlist kolaboratif per pengguna (ringkasan Library) sebelumnya tanpa index user_id.
CREATE INDEX IF NOT EXISTS playlist_collaborators_user_idx ON playlist_collaborators (user_id);
