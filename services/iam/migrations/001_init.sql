-- IAM (REQ-IAM-01..06, REQ-WEB-02)

CREATE TABLE users (
  id            uuid PRIMARY KEY,
  email         text UNIQUE,
  phone         text UNIQUE,
  display_name  text NOT NULL,
  avatar_url    text,
  city          text,
  genres        text[] NOT NULL DEFAULT '{}',
  onboarded     boolean NOT NULL DEFAULT false,
  is_admin      boolean NOT NULL DEFAULT false,
  premium       boolean NOT NULL DEFAULT false,
  mfa_enabled   boolean NOT NULL DEFAULT false,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Identitas login (email / whatsapp / google / apple)
CREATE TABLE identities (
  provider     text NOT NULL,          -- email | whatsapp | google | apple
  subject      text NOT NULL,          -- alamat email / nomor / sub OIDC
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);

CREATE TABLE otp_codes (
  id           bigserial PRIMARY KEY,
  destination  text NOT NULL,
  channel      text NOT NULL,
  code_hash    text NOT NULL,
  attempts     int NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_dest_idx ON otp_codes (destination, created_at DESC);

CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id    uuid NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  rotated_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE orgs (
  id          uuid PRIMARY KEY,
  type        text NOT NULL CHECK (type IN ('ARTIST','MANAGEMENT','LABEL','PROMOTOR','VENUE','CREATOR')),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  city        text,
  genres      text[] NOT NULL DEFAULT '{}',
  verified    boolean NOT NULL DEFAULT false,
  artist_id   uuid UNIQUE,              -- hanya org ARTIST
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('OWNER','ADMIN','FINANCE','MEMBER','VIEWER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

-- Relasi manajemen ↔ artis (REQ-IAM-03: satu manajemen banyak artis)
CREATE TABLE management_artists (
  management_org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  artist_org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  valid_from        date NOT NULL DEFAULT current_date,
  valid_to          date,
  PRIMARY KEY (management_org_id, artist_org_id)
);

-- KYC: nomor identitas terenkripsi AES-256-GCM (TDD §11.5 enkripsi tingkat kolom)
CREATE TABLE kyc_submissions (
  id               uuid PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users(id),
  org_id           uuid REFERENCES orgs(id),
  level            text NOT NULL CHECK (level IN ('INDIVIDUAL','BUSINESS')),
  full_name        text NOT NULL,
  id_number_enc    text NOT NULL,
  id_number_masked text NOT NULL,
  business_name    text,
  nib              text,
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','REJECTED')),
  reason           text,
  decided_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz
);
CREATE INDEX kyc_status_idx ON kyc_submissions (status, created_at);

CREATE TABLE consents (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose        text NOT NULL,
  policy_version text NOT NULL,
  granted        boolean NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, purpose)
);

CREATE TABLE waitlist (
  id                bigserial PRIMARY KEY,
  email             text NOT NULL UNIQUE,
  name              text,
  segment           text NOT NULL,
  city              text,
  consent_marketing boolean NOT NULL,
  referral_code     text NOT NULL UNIQUE,
  referred_by       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
