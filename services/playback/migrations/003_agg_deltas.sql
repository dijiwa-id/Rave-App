-- Agregasi play-count dipindah dari jalur request: ingest menulis delta append-only (tanpa baris panas),
-- job `agg-flush` mengklaim batch (FOR UPDATE SKIP LOCKED + DELETE), menjumlahkan per kunci, lalu upsert
-- ke tabel agg_* dalam satu statement (exactly-once). Satu baris = satu kejadian; kolom dimensi NULL bila
-- tidak relevan (mis. start/skip hanya menyentuh agg_artist_daily).
CREATE TABLE agg_deltas (
  id               bigserial PRIMARY KEY,
  artist_id        uuid NOT NULL,
  date             date NOT NULL,
  track_id         uuid,   -- → agg_track_daily (streams)
  city             text,   -- → agg_city_daily (listeners, streams)
  age_group        text,   -- → agg_age_daily (streams)
  source           text,   -- → agg_source_daily (streams)
  streams          int NOT NULL DEFAULT 0,
  listeners        int NOT NULL DEFAULT 0,
  starts           int NOT NULL DEFAULT 0,
  skips            int NOT NULL DEFAULT 0,
  completes        int NOT NULL DEFAULT 0,
  saves            int NOT NULL DEFAULT 0,
  followers_gained int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Artis yang punya pendengar harian baru sejak run uniques-28d terakhir (rekomputasi inkremental).
CREATE TABLE agg_uniques_dirty (
  artist_id uuid PRIMARY KEY
);

-- Rekomputasi penuh uniques & retensi memfilter per tanggal.
CREATE INDEX IF NOT EXISTS daily_listeners_date_idx ON daily_listeners (date);

-- fraudCheck pola loop: sesi qualified terakhir per user tanpa memindai sesi yang tidak qualified.
CREATE INDEX IF NOT EXISTS sessions_user_qualified_idx ON sessions (user_id, created_at DESC) WHERE qualified_at IS NOT NULL;
