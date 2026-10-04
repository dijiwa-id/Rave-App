-- Booking (Off-Air) — REQ-B2B-01..13, TDD §11.1.

-- Read model artis (dari catalog.artist.upserted + seed) & org (dari iam.org.created).
CREATE TABLE artists (
  id         uuid PRIMARY KEY,
  org_id     uuid,
  name       text NOT NULL,
  slug       text NOT NULL,
  city       text,
  genres     text[] NOT NULL DEFAULT '{}',
  image_url  text,
  verified   boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE orgs (
  id       uuid PRIMARY KEY,
  type     text NOT NULL,
  name     text NOT NULL,
  verified boolean NOT NULL DEFAULT false
);

-- EPK dinamis (konten statis; metrik digabung saat dibaca)
CREATE TABLE epk (
  artist_id  uuid PRIMARY KEY REFERENCES artists(id),
  content    jsonb NOT NULL,
  contact    jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE epk_share_links (
  token      text PRIMARY KEY,
  artist_id  uuid NOT NULL REFERENCES artists(id),
  expires_at timestamptz NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Rate card bertingkat (REQ-B2B-03)
CREATE TABLE rate_cards (
  artist_id  uuid PRIMARY KEY REFERENCES artists(id),
  visibility text NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC','VERIFIED_PROMOTOR','BY_REQUEST')),
  valid_from date,
  valid_to   date,
  floor_fee  bigint,                       -- batas bawah dari label (opsional)
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE rate_card_items (
  id                        bigserial PRIMARY KEY,
  artist_id                 uuid NOT NULL REFERENCES rate_cards(artist_id) ON DELETE CASCADE,
  category                  text NOT NULL,
  format                    text NOT NULL,
  zone                      text NOT NULL,
  duration_min              int NOT NULL,
  fee                       bigint NOT NULL CHECK (fee >= 0),
  rider_estimate            bigint NOT NULL DEFAULT 0,
  accommodation_by_promotor boolean NOT NULL DEFAULT true,
  transport_by_promotor     boolean NOT NULL DEFAULT true
);
CREATE INDEX rate_card_items_artist_idx ON rate_card_items (artist_id);

-- Split fee internal band & kru (REQ-B2B-13)
CREATE TABLE fee_splits (
  artist_id uuid NOT NULL REFERENCES artists(id),
  position  int NOT NULL,
  label     text NOT NULL,
  party_id  uuid,                          -- null = org artis
  pct       numeric(5,2) NOT NULL CHECK (pct > 0 AND pct <= 100),
  PRIMARY KEY (artist_id, position)
);

CREATE TABLE bookings (
  id                     uuid PRIMARY KEY,
  artist_id              uuid NOT NULL REFERENCES artists(id),
  artist_org_id          uuid,
  promotor_org_id        uuid NOT NULL,
  promotor_user_id       uuid NOT NULL,
  promotor_contact       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                 text NOT NULL,
  prev_status            text,             -- status sebelum DISPUTED
  event_name             text NOT NULL,
  event_date             date NOT NULL,
  start_time             text NOT NULL,
  duration_min           int NOT NULL,
  city                   text NOT NULL,
  venue                  text NOT NULL,
  capacity               int NOT NULL,
  category               text NOT NULL,
  format                 text NOT NULL,
  budget                 bigint NOT NULL,
  notes                  text,
  hold_expires_at        timestamptz,
  latest_offer_id        uuid,
  latest_fee             bigint,
  agreed_fee             bigint,
  dp_pct                 int NOT NULL DEFAULT 50,
  settlement_days_before int NOT NULL DEFAULT 7,
  dp_paid                bigint NOT NULL DEFAULT 0,
  settlement_paid        bigint NOT NULL DEFAULT 0,
  show_done_promotor     boolean NOT NULL DEFAULT false,
  show_done_management   boolean NOT NULL DEFAULT false,
  show_day_at            timestamptz,
  completed_at           timestamptz,
  cancellation           jsonb,
  source                 text NOT NULL DEFAULT 'app',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bookings_artist_idx ON bookings (artist_id, event_date);
CREATE INDEX bookings_promotor_idx ON bookings (promotor_org_id, updated_at DESC);
CREATE INDEX bookings_status_idx ON bookings (status);

CREATE TABLE offers (
  id                     uuid PRIMARY KEY,
  booking_id             uuid NOT NULL REFERENCES bookings(id),
  by_party               text NOT NULL CHECK (by_party IN ('promotor','management')),
  author_id              text NOT NULL,
  fee                    bigint NOT NULL CHECK (fee > 0),
  dp_pct                 int NOT NULL,
  settlement_days_before int NOT NULL,
  rider_notes            text,
  message                text,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offers_booking_idx ON offers (booking_id, created_at);

CREATE TABLE messages (
  id          uuid PRIMARY KEY,
  booking_id  uuid NOT NULL REFERENCES bookings(id),
  by_party    text NOT NULL,
  author_id   text NOT NULL,
  author_name text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_booking_idx ON messages (booking_id, created_at);

-- Timeline transisi (juga jejak audit state machine §7.1)
CREATE TABLE booking_events (
  id          bigserial PRIMARY KEY,
  booking_id  uuid NOT NULL REFERENCES bookings(id),
  from_status text,
  to_status   text NOT NULL,
  actor       text NOT NULL,
  actor_id    text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_events_booking_idx ON booking_events (booking_id, id);

-- Kalender anti double booking (contoh TDD §11.1). period = rentang tanggal inklusif buffer travel.
CREATE TABLE calendar_slots (
  id          uuid PRIMARY KEY,
  artist_id   uuid NOT NULL REFERENCES artists(id),
  period      daterange NOT NULL,
  status      text NOT NULL CHECK (status IN ('HOLD_1','HOLD_2','PENDING_CONTRACT','BOOKED','BOOKED_AND_SECURED','BLOCKED','TRAVEL')),
  booking_id  uuid UNIQUE REFERENCES bookings(id),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  EXCLUDE USING gist (artist_id WITH =, period WITH &&)
    WHERE (status IN ('PENDING_CONTRACT','BOOKED','BOOKED_AND_SECURED','BLOCKED'))
);
CREATE INDEX calendar_slots_artist_idx ON calendar_slots USING gist (artist_id, period);

-- Kontrak berversi (REQ-B2B-05); immutable setelah SIGNED.
CREATE TABLE contracts (
  id               uuid PRIMARY KEY,
  booking_id       uuid NOT NULL UNIQUE REFERENCES bookings(id),
  template_version text NOT NULL,
  body_markdown    text NOT NULL,
  sha256           text NOT NULL,
  status           text NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT','SIGNED','VOID')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  signed_at        timestamptz
);
CREATE OR REPLACE FUNCTION contracts_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'SIGNED' AND (NEW.body_markdown <> OLD.body_markdown OR NEW.sha256 <> OLD.sha256 OR NEW.status = 'SENT') THEN
    RAISE EXCEPTION 'Kontrak yang sudah ditandatangani tidak dapat diubah (gunakan adendum)';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contracts_immutable_trg BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION contracts_immutable();
CREATE TRIGGER contracts_no_delete BEFORE DELETE ON contracts FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE signatures (
  contract_id    uuid NOT NULL REFERENCES contracts(id),
  party          text NOT NULL CHECK (party IN ('promotor','management')),
  signer_name    text NOT NULL,
  signer_user_id text NOT NULL,
  provider_ref   text NOT NULL,           -- referensi PSrE (mock)
  signed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_id, party)
);

-- Rating dua arah double-blind (REQ-B2B-06)
CREATE TABLE ratings (
  booking_id uuid NOT NULL REFERENCES bookings(id),
  by_party   text NOT NULL CHECK (by_party IN ('promotor','management')),
  author_id  text NOT NULL,
  scores     jsonb NOT NULL,
  overall    numeric(3,2) NOT NULL,
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, by_party)
);

CREATE TABLE disputes (
  id          uuid PRIMARY KEY,
  booking_id  uuid NOT NULL REFERENCES bookings(id),
  by_party    text NOT NULL,
  author_id   text NOT NULL,
  reason      text NOT NULL,
  status      text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  outcome     text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX disputes_one_open ON disputes (booking_id) WHERE status = 'OPEN';
