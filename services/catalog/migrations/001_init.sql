-- Catalog service (TDD §10.3): artis, rilis, rekaman, hak/split, lirik, podcast & fiksi, browse.
-- MVP memakai PostgreSQL (keputusan terbuka D-06: MongoDB vs JSONB) — metadata fleksibel di kolom jsonb.

CREATE TABLE artists (
  id                uuid PRIMARY KEY,
  org_id            uuid,
  slug              text NOT NULL UNIQUE,
  name              text NOT NULL,
  bio               text,
  image_url         text,
  cover_url         text,
  city              text,
  genres            text[] NOT NULL DEFAULT '{}',
  verified          boolean NOT NULL DEFAULT false,
  monthly_listeners int NOT NULL DEFAULT 0,
  listeners_base    int NOT NULL DEFAULT 0,  -- baseline impor/seed; monthly_listeners = base + unik 28 hari
  followers         int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artists_name_trgm ON artists USING gin (name gin_trgm_ops);
CREATE INDEX artists_org_idx ON artists (org_id);

CREATE TABLE releases (
  id            uuid PRIMARY KEY,
  artist_id     uuid NOT NULL REFERENCES artists(id),
  title         text NOT NULL,
  type          text NOT NULL CHECK (type IN ('SINGLE','EP','ALBUM')),
  status        text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','IN_REVIEW','SCHEDULED','LIVE','REJECTED','TAKEN_DOWN')),
  release_date  date NOT NULL,
  cover_url     text,
  label         text,
  genre         text,
  upc           text,
  explicit      boolean NOT NULL DEFAULT false,
  qc_reason     text,
  submitted_at  timestamptz,
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX releases_artist_idx ON releases (artist_id, release_date DESC);
CREATE INDEX releases_status_idx ON releases (status);
CREATE INDEX releases_title_trgm ON releases USING gin (title gin_trgm_ops);

CREATE TABLE tracks (
  id               uuid PRIMARY KEY,
  release_id       uuid NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  artist_id        uuid NOT NULL REFERENCES artists(id),
  title            text NOT NULL,
  track_number     int NOT NULL DEFAULT 1,
  duration_ms      int NOT NULL DEFAULT 0,
  explicit         boolean NOT NULL DEFAULT false,
  isrc             text,
  audio_url        text,
  loudness_gain_db numeric(5,2) NOT NULL DEFAULT 0,
  play_count       bigint NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tracks_release_idx ON tracks (release_id, track_number);
CREATE INDEX tracks_artist_idx ON tracks (artist_id);
CREATE INDEX tracks_title_trgm ON tracks USING gin (title gin_trgm_ops);

-- Split hak (REQ-STU-02, rights_shares TDD §11.1). Total per type harus 100%.
CREATE TABLE rights_shares (
  id           uuid PRIMARY KEY,
  track_id     uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  type         text NOT NULL CHECK (type IN ('MASTER','PUBLISHING')),
  party_name   text NOT NULL,
  email        text,
  pct          numeric(5,2) NOT NULL CHECK (pct > 0 AND pct <= 100),
  territory    text NOT NULL DEFAULT 'WW',
  invite_token text,
  approved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rights_shares_track_idx ON rights_shares (track_id);

-- Lirik tersinkron (REQ-STR-03). lines = [{time_ms, text}]
CREATE TABLE lyrics (
  track_id   uuid PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  synced     boolean NOT NULL DEFAULT true,
  lines      jsonb NOT NULL,
  plain      text NOT NULL
);
CREATE INDEX lyrics_plain_trgm ON lyrics USING gin (plain gin_trgm_ops);

-- Podcast & audio fiksi (REQ-POD-01, REQ-FIC-01)
CREATE TABLE shows (
  id              uuid PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('PODCAST','FICTION')),
  title           text NOT NULL,
  publisher       text NOT NULL,
  description     text NOT NULL DEFAULT '',
  cover_url       text,
  category        text NOT NULL,
  age_rating      text,
  content_warning text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shows_title_trgm ON shows USING gin (title gin_trgm_ops);

CREATE TABLE episodes (
  id             uuid PRIMARY KEY,
  show_id        uuid NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  title          text NOT NULL,
  description    text NOT NULL DEFAULT '',
  duration_ms    int NOT NULL,
  published_at   timestamptz NOT NULL DEFAULT now(),
  is_premium     boolean NOT NULL DEFAULT false,
  season         int,
  episode_number int,
  audio_url      text,
  cover_url      text
);
CREATE INDEX episodes_show_idx ON episodes (show_id, published_at DESC);
CREATE INDEX episodes_title_trgm ON episodes USING gin (title gin_trgm_ops);

CREATE TABLE categories (
  id        text PRIMARY KEY,
  name      text NOT NULL,
  color     text NOT NULL,
  image_url text,
  href      text NOT NULL,
  genres    text[] NOT NULL DEFAULT '{}',
  position  int NOT NULL DEFAULT 0
);

CREATE TABLE genres (
  id   text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE uploads (
  id           uuid PRIMARY KEY,
  user_id      uuid,
  kind         text NOT NULL CHECK (kind IN ('audio','artwork')),
  filename     text NOT NULL,
  content_type text NOT NULL,
  size         bigint NOT NULL,
  stored_name  text NOT NULL,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Pendengar unik 28 hari untuk monthly_listeners (dibangun dari playback.stream.qualified).
CREATE TABLE artist_listeners (
  artist_id uuid NOT NULL,
  user_id   uuid NOT NULL,
  last_at   timestamptz NOT NULL,
  PRIMARY KEY (artist_id, user_id)
);
