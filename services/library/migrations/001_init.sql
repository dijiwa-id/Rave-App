-- Library & Playlist (REQ-STR-04)

CREATE TABLE likes (
  user_id    uuid NOT NULL,
  track_id   uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, track_id)
);
CREATE INDEX likes_user_idx ON likes (user_id, created_at DESC);

CREATE TABLE follows (
  user_id    uuid NOT NULL,
  artist_id  uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, artist_id)
);
CREATE INDEX follows_artist_idx ON follows (artist_id);

CREATE TABLE saved_releases (
  user_id    uuid NOT NULL,
  release_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, release_id)
);

CREATE TABLE playlists (
  id           uuid PRIMARY KEY,
  owner_id     text NOT NULL,                 -- user uuid, atau 'gema' untuk editorial
  owner_name   text NOT NULL,
  title        text NOT NULL,
  description  text,
  cover_url    text,
  visibility   text NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC','PRIVATE','COLLAB')),
  is_editorial boolean NOT NULL DEFAULT false,
  tags         text[] NOT NULL DEFAULT '{}',
  sort_order   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX playlists_owner_idx ON playlists (owner_id, updated_at DESC);
CREATE INDEX playlists_tags_idx ON playlists USING gin (tags);

-- Kolaborator playlist COLLAB
CREATE TABLE playlist_collaborators (
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  PRIMARY KEY (playlist_id, user_id)
);

-- Posisi fractional index (numeric): sisip di antara dua item tanpa renumber (TDD §11.1).
CREATE TABLE playlist_items (
  id          uuid PRIMARY KEY,
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id    uuid NOT NULL,
  position    numeric NOT NULL,
  added_by    text,
  added_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX playlist_items_pos_idx ON playlist_items (playlist_id, position);

CREATE TABLE listening_history (
  id        bigserial PRIMARY KEY,
  user_id   uuid NOT NULL,
  track_id  uuid NOT NULL,
  artist_id uuid,
  played_at timestamptz NOT NULL,
  event_id  uuid UNIQUE
);
CREATE INDEX listening_history_user_idx ON listening_history (user_id, played_at DESC);
