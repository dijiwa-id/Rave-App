-- Notification service (REQ-NTF-01/02): inbox in-app + read model penerima.

CREATE TABLE notifications (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL,
  category    text NOT NULL,            -- booking | payment | event | release | system | social
  title       text NOT NULL,
  body        text NOT NULL,
  link        text,
  source_event_id uuid,                 -- dedupe per event per user
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_event_id)
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE preferences (
  user_id     uuid NOT NULL,
  category    text NOT NULL,
  push        boolean NOT NULL DEFAULT true,
  email       boolean NOT NULL DEFAULT true,
  whatsapp    boolean NOT NULL DEFAULT false,
  in_app      boolean NOT NULL DEFAULT true,
  quiet_start smallint,                 -- jam tenang (0-23, WIB)
  quiet_end   smallint,
  PRIMARY KEY (user_id, category)
);

-- Read model (dibangun dari event IAM/Library): siapa yang menerima notifikasi untuk artis/org.
CREATE TABLE org_members (
  org_id     uuid NOT NULL,
  user_id    uuid NOT NULL,
  org_type   text NOT NULL,
  artist_id  uuid,
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX org_members_artist_idx ON org_members (artist_id);

CREATE TABLE artist_followers (
  artist_id  uuid NOT NULL,
  user_id    uuid NOT NULL,
  PRIMARY KEY (artist_id, user_id)
);

CREATE TABLE user_cities (
  user_id uuid PRIMARY KEY,
  city    text NOT NULL
);

-- Antrean kanal luar (push/email/WA). Worker pengirim memakai adapter per provider.
CREATE TABLE deliveries (
  id              bigserial PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES notifications(id),
  channel         text NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING',  -- PENDING | SENT | FAILED | SKIPPED
  attempts        int NOT NULL DEFAULT 0,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX deliveries_pending_idx ON deliveries (created_at) WHERE status = 'PENDING';
