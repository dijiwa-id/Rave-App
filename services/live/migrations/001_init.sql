-- Live streaming (docs/API.md §10)

CREATE TABLE streams (
  id               uuid PRIMARY KEY,
  org_id           uuid NOT NULL,
  org_name         text NOT NULL,
  org_type         text NOT NULL,
  artist_id        uuid,
  artist_name      text,
  artist_slug      text,
  artist_image     text,
  title            text NOT NULL,
  description      text,
  cover_url        text,
  status           text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','LIVE','INTERRUPTED','ENDED')),
  access           text NOT NULL DEFAULT 'PUBLIC' CHECK (access IN ('PUBLIC','TICKET')),
  event_id         uuid,
  event_slug       text,
  event_title      text,
  event_city       text,
  event_starts_at  timestamptz,
  scheduled_at     timestamptz,
  started_at       timestamptz,
  interrupted_at   timestamptz,
  ended_at         timestamptz,
  ended_reason     text,
  stream_key_hash  text NOT NULL UNIQUE,   -- sha256(stream key); kunci asli hanya ditampilkan sekali
  key_hint         text NOT NULL,
  ingest           text CHECK (ingest IN ('rtmp','browser','demo')),
  peak_viewers     int NOT NULL DEFAULT 0,
  total_views      int NOT NULL DEFAULT 0,  -- penonton unik (bertambah saat heartbeat pertama)
  is_demo          boolean NOT NULL DEFAULT false,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (access = 'PUBLIC' OR event_id IS NOT NULL)
);
CREATE INDEX streams_status_idx ON streams (status, scheduled_at);
CREATE INDEX streams_org_idx ON streams (org_id, created_at DESC);
CREATE INDEX streams_artist_idx ON streams (artist_id) WHERE artist_id IS NOT NULL;
CREATE INDEX streams_event_idx ON streams (event_id) WHERE event_id IS NOT NULL;

-- Penonton (heartbeat). viewer_key = user id atau uuid anonim dari klien.
CREATE TABLE viewers (
  stream_id   uuid NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  viewer_key  text NOT NULL,
  user_id     uuid,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stream_id, viewer_key)
);
CREATE INDEX viewers_active_idx ON viewers (stream_id, last_seen);

CREATE TABLE chat_messages (
  id            bigserial PRIMARY KEY,
  stream_id     uuid NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  display_name  text NOT NULL,
  body          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  deleted_by    uuid
);
CREATE INDEX chat_stream_idx ON chat_messages (stream_id, id);
