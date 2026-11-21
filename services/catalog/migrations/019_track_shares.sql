-- Bagikan lagu ke media sosial (Instagram/X/Facebook) dari player web, desktop & mobile: satu baris per klik bagikan.
-- Hanya statistik (Super Admin → Pengaturan Layanan → Bagikan → Laporan); pengguna anonim boleh (user_id NULL).
CREATE TABLE IF NOT EXISTS track_shares (
  id         uuid PRIMARY KEY,
  track_id   uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  platform   text NOT NULL CHECK (platform IN ('instagram', 'x', 'facebook', 'copy', 'system')),
  client     text NOT NULL CHECK (client IN ('web', 'desktop', 'android', 'ios')),
  user_id    uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS track_shares_created_idx ON track_shares (created_at);
CREATE INDEX IF NOT EXISTS track_shares_track_idx ON track_shares (track_id, created_at);
