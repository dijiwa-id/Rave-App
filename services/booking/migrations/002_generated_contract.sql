-- Generated Contract (SPK) — skema berversi, e-sign native, rider berversi, profil legal.
-- ADITIF & kompatibel mundur: kolom `status` lama (SENT/SIGNED/VOID) tetap valid sampai kode booking dimigrasikan
-- ke status baru (Tahap 5); baris lama menjadi versi 1. Lihat docs/generated-contract.md.

-- ---- Kontrak berversi ----
ALTER TABLE contracts DROP CONSTRAINT contracts_booking_id_key;
ALTER TABLE contracts DROP CONSTRAINT contracts_status_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_status_check CHECK (status IN (
  'SENT','SIGNED','VOID',
  'CONTRACT_GENERATED','AWAITING_PROMOTOR_SIGN','AWAITING_MANAGEMENT_SIGN','AWAITING_ARTIST_ACK','ACTIVE','REJECTED','CANCELLED','EXPIRED'));
ALTER TABLE contracts
  ADD COLUMN version             int     NOT NULL DEFAULT 1 CHECK (version >= 1),
  ADD COLUMN contract_no         text,
  ADD COLUMN template_id         text,
  ADD COLUMN terms               jsonb,            -- variabel transaksi yang diedit (tervalidasi, whitelist)
  ADD COLUMN data_snapshot       jsonb,            -- seluruh variabel saat render, termasuk snapshot rider
  ADD COLUMN draft_key           text,             -- kunci storage PDF draf (privat, akses via signed URL)
  ADD COLUMN final_key           text,
  ADD COLUMN final_sha256        text,
  ADD COLUMN require_artist_ack  boolean NOT NULL DEFAULT false,
  ADD COLUMN supersedes_id       uuid REFERENCES contracts(id),
  ADD COLUMN reject_reason       text,
  ADD COLUMN expires_at          timestamptz;
ALTER TABLE contracts ADD CONSTRAINT contracts_booking_version_key UNIQUE (booking_id, version);
CREATE UNIQUE INDEX contracts_contract_no_key ON contracts (contract_no) WHERE contract_no IS NOT NULL;
-- Maksimal satu versi "hidup" per booking; versi lama (REJECTED/CANCELLED/EXPIRED/VOID) read-only.
CREATE UNIQUE INDEX contracts_one_live_per_booking ON contracts (booking_id)
  WHERE status NOT IN ('REJECTED','CANCELLED','EXPIRED','VOID');

-- Immutability: kontrak SIGNED/ACTIVE dan semua versi berakhir tidak boleh diubah isinya (perubahan = addendum).
CREATE OR REPLACE FUNCTION contracts_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('SIGNED','ACTIVE') AND (
       NEW.body_markdown <> OLD.body_markdown OR NEW.sha256 <> OLD.sha256
    OR NEW.terms IS DISTINCT FROM OLD.terms OR NEW.data_snapshot IS DISTINCT FROM OLD.data_snapshot
    OR NEW.version <> OLD.version OR NEW.template_id IS DISTINCT FROM OLD.template_id
    OR NEW.require_artist_ack <> OLD.require_artist_ack
    OR (OLD.final_sha256 IS NOT NULL AND NEW.final_sha256 IS DISTINCT FROM OLD.final_sha256)
    OR (OLD.final_key IS NOT NULL AND NEW.final_key IS DISTINCT FROM OLD.final_key)
    OR NEW.status IN ('SENT','CONTRACT_GENERATED','AWAITING_PROMOTOR_SIGN','AWAITING_MANAGEMENT_SIGN','AWAITING_ARTIST_ACK')) THEN
    RAISE EXCEPTION 'Kontrak yang sudah ditandatangani tidak dapat diubah (gunakan adendum)';
  END IF;
  IF OLD.status IN ('REJECTED','CANCELLED','EXPIRED','VOID') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Versi kontrak yang sudah berakhir bersifat read-only';
  END IF;
  RETURN NEW;
END $$;

-- ---- Tanda tangan multi-pihak, metode & jejak ----
ALTER TABLE signatures DROP CONSTRAINT signatures_party_check;
ALTER TABLE signatures ADD CONSTRAINT signatures_party_check CHECK (party IN ('promotor','management','artist'));
ALTER TABLE signatures
  ADD COLUMN method          text NOT NULL DEFAULT 'OTP_NATIVE' CHECK (method IN ('OTP_NATIVE','PRIVY','VIDA')),
  ADD COLUMN status          text NOT NULL DEFAULT 'SIGNED' CHECK (status IN ('PENDING','SIGNED','FAILED')),
  ADD COLUMN ip_address      text,
  ADD COLUMN user_agent      text,
  ADD COLUMN otp_verified_at timestamptz,
  ADD COLUMN doc_sha256      text;           -- hash dokumen yang ditandatangani

-- OTP tanda tangan: disimpan sebagai hash, berlaku singkat, sekali pakai.
CREATE TABLE signature_otps (
  id          uuid PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES contracts(id),
  party       text NOT NULL CHECK (party IN ('promotor','management','artist')),
  user_id     text NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('email','whatsapp')),
  code_hash   text NOT NULL,
  attempts    int  NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signature_otps_lookup_idx ON signature_otps (contract_id, party, user_id, created_at DESC);

-- ---- Jejak audit kontrak (append-only) — melengkapi audit_logs dengan user agent & aktor ----
CREATE TABLE contract_audit (
  id          bigserial PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES contracts(id),
  action      text NOT NULL,          -- view | generate | send | sign | reject | download | cancel | ack
  actor_id    text,
  actor_party text,
  ip_address  text,
  user_agent  text,
  data        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contract_audit_contract_idx ON contract_audit (contract_id, id);
CREATE TRIGGER contract_audit_append_only BEFORE UPDATE OR DELETE ON contract_audit FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---- Antrean render PDF / distribusi (pengganti BullMQ; polling dengan SKIP LOCKED) ----
CREATE TABLE contract_jobs (
  id          bigserial PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES contracts(id),
  kind        text NOT NULL CHECK (kind IN ('RENDER_DRAFT','RENDER_FINAL','DISTRIBUTE')),
  status      text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','DONE','FAILED')),
  attempts    int  NOT NULL DEFAULT 0,
  last_error  text,
  run_after   timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX contract_jobs_once ON contract_jobs (contract_id, kind) WHERE status IN ('PENDING','RUNNING');

-- ---- Addendum (struktur saja; UI menyusul) ----
CREATE TABLE contract_addenda (
  id          uuid PRIMARY KEY,
  contract_id uuid NOT NULL REFERENCES contracts(id),
  seq         int  NOT NULL,
  changes     jsonb NOT NULL,
  reason      text,
  status      text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','AWAITING_SIGN','ACTIVE','CANCELLED')),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, seq)
);

-- ---- Rider artis berversi: kontrak menyalin snapshot versi terbaru saat generate ----
CREATE TABLE rider_versions (
  artist_id  uuid NOT NULL REFERENCES artists(id),
  kind       text NOT NULL CHECK (kind IN ('hospitality','technical')),
  version    int  NOT NULL,
  content    jsonb NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (artist_id, kind, version)
);
CREATE TRIGGER rider_versions_no_update BEFORE UPDATE OR DELETE ON rider_versions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---- Profil legal pihak (data sensitif terenkripsi AES-256-GCM, di-mask di UI) ----
CREATE TABLE legal_profiles (
  org_id         uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('PROMOTOR','MANAGEMENT')),
  legal_name     text NOT NULL,
  rep_name       text NOT NULL,           -- PIC (promotor) / direktur-manajer (manajemen)
  rep_title      text,
  nik_enc        text, nik_mask   text,
  npwp_enc       text, npwp_mask  text,
  address        text,
  email          text,
  whatsapp       text,
  bank_name      text,                    -- manajemen
  bank_account_enc text, bank_account_mask text,
  bank_holder    text,
  mgmt_fee_pct   numeric(5,2) CHECK (mgmt_fee_pct IS NULL OR (mgmt_fee_pct >= 0 AND mgmt_fee_pct <= 100)),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind)
);
