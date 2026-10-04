-- Event & Ticketing (REQ-EVT-01, REQ-TIX-01..05)

-- Read model nama artis (dari catalog.artist.upserted)
CREATE TABLE artists (
  id   uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL
);

CREATE TABLE events (
  id            uuid PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  org_id        uuid NOT NULL,
  booking_id    uuid,
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  city          text NOT NULL,
  venue_name    text NOT NULL,
  venue_address text NOT NULL DEFAULT '',
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  poster_url    text,
  artist_ids    uuid[] NOT NULL DEFAULT '{}',
  rules         text,
  status        text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','CANCELLED','COMPLETED')),
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  CHECK (ends_at > starts_at)
);
CREATE INDEX events_city_idx ON events (lower(city), starts_at) WHERE status = 'PUBLISHED';
CREATE INDEX events_artists_idx ON events USING gin (artist_ids);

-- Inventory per kategori: sold + reserved <= quota dijaga atomik (tanpa oversell)
CREATE TABLE ticket_types (
  id              uuid PRIMARY KEY,
  event_id        uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name            text NOT NULL,
  price           bigint NOT NULL CHECK (price >= 0),
  quota           int NOT NULL CHECK (quota > 0),
  sold            int NOT NULL DEFAULT 0,
  reserved        int NOT NULL DEFAULT 0,
  max_per_account int NOT NULL DEFAULT 4 CHECK (max_per_account > 0),
  sale_starts_at  timestamptz,
  presale         boolean NOT NULL DEFAULT false,
  sort_order      int NOT NULL DEFAULT 0,
  CHECK (sold >= 0 AND reserved >= 0 AND sold + reserved <= quota)
);

CREATE TABLE orders (
  id             uuid PRIMARY KEY,
  event_id       uuid NOT NULL REFERENCES events(id),
  user_id        uuid NOT NULL,
  holder_name    text NOT NULL,
  status         text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','PAID','EXPIRED','CANCELLED')),
  total          bigint NOT NULL,
  reserved_until timestamptz NOT NULL,
  invoice_id     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  paid_at        timestamptz
);
CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC);
CREATE INDEX orders_reserved_idx ON orders (reserved_until) WHERE status = 'RESERVED';

CREATE TABLE order_items (
  order_id       uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES ticket_types(id),
  quantity       int NOT NULL CHECK (quantity > 0),
  price          bigint NOT NULL,
  PRIMARY KEY (order_id, ticket_type_id)
);

CREATE TABLE tickets (
  id             uuid PRIMARY KEY,
  order_id       uuid NOT NULL REFERENCES orders(id),
  event_id       uuid NOT NULL REFERENCES events(id),
  ticket_type_id uuid NOT NULL REFERENCES ticket_types(id),
  user_id        uuid NOT NULL,
  holder_name    text NOT NULL,
  secret         text NOT NULL,             -- kunci QR berputar (TOTP-like)
  status         text NOT NULL DEFAULT 'VALID' CHECK (status IN ('VALID','CHECKED_IN','REFUNDED')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_user_idx ON tickets (user_id);
CREATE INDEX tickets_event_idx ON tickets (event_id);

-- Satu check-in per tiket (anti duplikasi multi-gate)
CREATE TABLE checkins (
  ticket_id     uuid PRIMARY KEY REFERENCES tickets(id),
  event_id      uuid NOT NULL,
  gate          text NOT NULL,
  scanned_by    uuid NOT NULL,
  checked_in_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checkins_event_idx ON checkins (event_id, gate);

-- Log semua upaya scan (termasuk gagal) untuk audit & dashboard
CREATE TABLE scan_attempts (
  id         bigserial PRIMARY KEY,
  event_id   uuid NOT NULL,
  ticket_id  uuid,
  gate       text NOT NULL,
  ok         boolean NOT NULL,
  reason     text,
  scanned_by uuid NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
