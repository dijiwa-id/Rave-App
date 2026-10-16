-- Audit performa: pendengar bulanan per artis & beranda/feed.
-- (artist_id, last_at) → hitung pendengar 28 hari & pruning tanpa memindai semua pendengar artis.
CREATE INDEX IF NOT EXISTS artist_listeners_artist_last_idx ON artist_listeners (artist_id, last_at);
CREATE INDEX IF NOT EXISTS artist_listeners_last_idx ON artist_listeners (last_at);
-- Beranda: artis terpopuler, artis per kota, episode terbaru.
CREATE INDEX IF NOT EXISTS artists_monthly_listeners_idx ON artists (monthly_listeners DESC);
CREATE INDEX IF NOT EXISTS artists_city_lower_idx ON artists (lower(city));
CREATE INDEX IF NOT EXISTS episodes_published_idx ON episodes (published_at DESC);
