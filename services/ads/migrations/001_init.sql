-- Iklan tier Gratis (docs/API.md §11)

CREATE TABLE campaigns (
  id               uuid PRIMARY KEY,
  advertiser       text NOT NULL,
  name             text NOT NULL,
  category         text NOT NULL,
  license_ref      text,
  type             text NOT NULL CHECK (type IN ('audio','display')),
  title            text NOT NULL,
  body             text,
  image_url        text,
  audio_url        text,
  click_url        text,
  cta_label        text,
  theme_color      text,
  duration_s       int NOT NULL CHECK (duration_s BETWEEN 3 AND 120),
  target_genres    text[] NOT NULL DEFAULT '{}',
  target_cities    text[] NOT NULL DEFAULT '{}',
  start_at         timestamptz NOT NULL DEFAULT now(),
  end_at           timestamptz,
  max_impressions  int,
  priority         int NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  is_house         boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_REVIEW','APPROVED','REJECTED','PAUSED','ENDED')),
  review_note      text,
  reviewed_by      uuid,
  reviewed_by_name text,
  reviewed_at      timestamptz,
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campaigns_status_idx ON campaigns (status, start_at);

-- Satu baris per iklan yang disajikan dalam sebuah jeda.
CREATE TABLE impressions (
  id            uuid PRIMARY KEY,
  break_id      uuid NOT NULL,
  campaign_id   uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  placement     text NOT NULL,
  served_at     timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  completed_at  timestamptz,
  skipped_at    timestamptz,
  clicked_at    timestamptz
);
CREATE INDEX impressions_user_idx ON impressions (user_id, served_at DESC);
CREATE INDEX impressions_campaign_idx ON impressions (campaign_id, served_at);

-- Status pendengar per hari (WIB) dari event playback.stream.qualified — sumber hitungan "lagu".
CREATE TABLE listener_state (
  user_id              uuid PRIMARY KEY,
  day                  date NOT NULL,
  streams_today        int NOT NULL DEFAULT 0,
  streams_since_break  int NOT NULL DEFAULT 0,
  last_break_at        timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Hasil keputusan jeda per hari (fill rate & alasan tidak tayang).
CREATE TABLE break_outcomes (
  day      date NOT NULL,
  outcome  text NOT NULL,
  n        int NOT NULL DEFAULT 0,
  PRIMARY KEY (day, outcome)
);
