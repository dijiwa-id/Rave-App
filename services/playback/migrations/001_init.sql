-- Playback & analytics (TDD §11.3, §11.4). Media plane dipisah dari control plane;
-- tabel agregat harian di sini adalah pengganti ClickHouse untuk MVP (materialized view per hari/kota/usia).

CREATE TABLE sessions (
  id            uuid PRIMARY KEY,
  user_id       uuid,
  track_id      uuid,
  episode_id    uuid,
  artist_id     uuid,
  quality       text NOT NULL,
  codec_label   text NOT NULL,
  city          text,
  source        text NOT NULL DEFAULT 'library',
  preview_only  boolean NOT NULL DEFAULT false,
  audio_url     text NOT NULL,
  duration_ms   int NOT NULL DEFAULT 0,
  max_played_ms int NOT NULL DEFAULT 0,
  qualified_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  CHECK (track_id IS NOT NULL OR episode_id IS NOT NULL)
);
CREATE INDEX sessions_user_idx ON sessions (user_id, created_at DESC);

-- Play events mentah (retensi sesuai kebijakan; produksi → Kafka → ClickHouse).
CREATE TABLE play_events (
  id           bigserial PRIMARY KEY,
  session_id   uuid NOT NULL,
  user_id      uuid,
  track_id     uuid,
  episode_id   uuid,
  type         text NOT NULL CHECK (type IN ('start','progress','complete','skip')),
  position_ms  int NOT NULL DEFAULT 0,
  played_ms    int NOT NULL DEFAULT 0,
  client_at    timestamptz,
  received_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX play_events_session_idx ON play_events (session_id);

-- Qualified streams (≥30 dtk) — dasar royalti & EPK. suspicious = dikeluarkan dari royalti (REQ-ADM-03).
CREATE TABLE qualified_streams (
  session_id   uuid PRIMARY KEY,
  user_id      uuid NOT NULL,
  track_id     uuid NOT NULL,
  artist_id    uuid NOT NULL,
  city         text,
  played_ms    int NOT NULL,
  at           timestamptz NOT NULL,
  suspicious   boolean NOT NULL DEFAULT false,
  fraud_reason text
);
CREATE INDEX qualified_user_at_idx ON qualified_streams (user_id, at DESC);
CREATE INDEX qualified_artist_at_idx ON qualified_streams (artist_id, at DESC);

-- Peta track → artist (read model dari sesi) untuk event library.
CREATE TABLE track_artists (
  track_id  uuid PRIMARY KEY,
  artist_id uuid NOT NULL
);

-- ---------------- Agregat harian ----------------
CREATE TABLE agg_artist_daily (
  artist_id        uuid NOT NULL,
  date             date NOT NULL,
  streams          int NOT NULL DEFAULT 0,
  listeners        int NOT NULL DEFAULT 0,   -- unik per hari
  starts           int NOT NULL DEFAULT 0,
  skips            int NOT NULL DEFAULT 0,
  completes        int NOT NULL DEFAULT 0,
  saves            int NOT NULL DEFAULT 0,
  followers_gained int NOT NULL DEFAULT 0,
  PRIMARY KEY (artist_id, date)
);

CREATE TABLE agg_track_daily (
  artist_id uuid NOT NULL,
  track_id  uuid NOT NULL,
  date      date NOT NULL,
  streams   int NOT NULL DEFAULT 0,
  PRIMARY KEY (track_id, date)
);
CREATE INDEX agg_track_artist_idx ON agg_track_daily (artist_id, date);

CREATE TABLE agg_city_daily (
  artist_id uuid NOT NULL,
  date      date NOT NULL,
  city      text NOT NULL,
  listeners int NOT NULL DEFAULT 0,
  streams   int NOT NULL DEFAULT 0,
  PRIMARY KEY (artist_id, date, city)
);
CREATE INDEX agg_city_city_idx ON agg_city_daily (city, date);

CREATE TABLE agg_age_daily (
  artist_id uuid NOT NULL,
  date      date NOT NULL,
  age_group text NOT NULL,
  streams   int NOT NULL DEFAULT 0,
  PRIMARY KEY (artist_id, date, age_group)
);

CREATE TABLE agg_source_daily (
  artist_id uuid NOT NULL,
  date      date NOT NULL,
  source    text NOT NULL,
  streams   int NOT NULL DEFAULT 0,
  PRIMARY KEY (artist_id, date, source)
);

-- Pendengar unik per hari (real) untuk deduplikasi.
CREATE TABLE daily_listeners (
  artist_id uuid NOT NULL,
  date      date NOT NULL,
  user_id   uuid NOT NULL,
  city      text,
  PRIMARY KEY (artist_id, date, user_id)
);

-- Snapshot pendengar unik 28 hari bergulir per artis per hari: base (impor/sintetis) + real (dihitung job).
CREATE TABLE agg_uniques_28d (
  artist_id uuid NOT NULL,
  date      date NOT NULL,
  base      int NOT NULL DEFAULT 0,
  real      int NOT NULL DEFAULT 0,
  PRIMARY KEY (artist_id, date)
);
