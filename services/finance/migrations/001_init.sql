-- Finance (service terisolasi) — REQ-B2B-04, REQ-PAY-01..05, TDD §11.1 & §7.2.
-- Prinsip: RAVE tidak menampung dana di rekening operasional; semua dana pihak ketiga
-- direpresentasikan sebagai liabilitas escrow di mitra berizin (asset:escrow_bank:<mitra>).

-- Tagihan / payment intent (DP, pelunasan, order tiket)
CREATE TABLE invoices (
  id            uuid PRIMARY KEY,
  purpose       text NOT NULL CHECK (purpose IN ('BOOKING_DP','BOOKING_SETTLEMENT','TICKET_ORDER','SUBSCRIPTION','TIP')),
  reference_id  text NOT NULL,                 -- bookingId / orderId
  amount        bigint NOT NULL CHECK (amount > 0),
  escrow_amount bigint NOT NULL CHECK (escrow_amount >= 0),   -- bagian yang masuk escrow
  fee_amount    bigint NOT NULL DEFAULT 0 CHECK (fee_amount >= 0), -- service fee platform
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','EXPIRED','FAILED')),
  due_at        timestamptz NOT NULL,
  paid_at       timestamptz,
  payer_user_id uuid NOT NULL,
  payer_org_id  uuid,
  description   text NOT NULL,
  va_number     text,
  qris_payload  text,
  depends_on    uuid REFERENCES invoices(id),   -- pelunasan menunggu DP
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (escrow_amount + fee_amount = amount),
  UNIQUE (purpose, reference_id)
);
CREATE INDEX invoices_payer_idx ON invoices (payer_user_id, created_at DESC);
CREATE INDEX invoices_ref_idx ON invoices (reference_id);

-- Webhook PG masuk: dedupe per event_id (idempoten)
CREATE TABLE pg_webhook_events (
  event_id    text PRIMARY KEY,
  provider    text NOT NULL,
  invoice_id  uuid,
  status      text NOT NULL,
  payload     jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- Ledger double-entry append-only
CREATE TABLE ledger_transactions (
  id              uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  kind            text NOT NULL,
  reference_id    text,
  description     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ledger_entries (
  id         bigserial PRIMARY KEY,
  txn_id     uuid NOT NULL REFERENCES ledger_transactions(id),
  account    text NOT NULL,
  side       text NOT NULL CHECK (side IN ('DEBIT','CREDIT')),
  amount     bigint NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_account_idx ON ledger_entries (account);
CREATE INDEX ledger_entries_txn_idx ON ledger_entries (txn_id);

CREATE TRIGGER ledger_txn_append_only BEFORE UPDATE OR DELETE ON ledger_transactions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Pertahanan berlapis: debit = kredit per transaksi dicek DB saat COMMIT.
CREATE OR REPLACE FUNCTION ledger_check_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE diff bigint;
BEGIN
  SELECT coalesce(sum(CASE side WHEN 'DEBIT' THEN amount ELSE -amount END), 0) INTO diff FROM ledger_entries WHERE txn_id = NEW.txn_id;
  IF diff <> 0 THEN RAISE EXCEPTION 'Ledger tidak seimbang untuk transaksi % (selisih %)', NEW.txn_id, diff; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_balance();

-- Escrow per referensi (booking atau event tiket)
CREATE TABLE escrow_holds (
  reference_id        text PRIMARY KEY,
  kind                text NOT NULL CHECK (kind IN ('BOOKING','EVENT')),
  artist_id           uuid,
  artist_org_id       uuid,
  management_org_id   uuid,
  promotor_org_id     uuid,
  promotor_user_id    uuid,
  fee                 bigint NOT NULL DEFAULT 0,
  held                bigint NOT NULL DEFAULT 0,
  released            bigint NOT NULL DEFAULT 0,
  refunded            bigint NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'AWAITING_DP',
  frozen              boolean NOT NULL DEFAULT false,
  release_at          timestamptz,
  release_payload     jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX escrow_release_idx ON escrow_holds (release_at) WHERE release_at IS NOT NULL AND status = 'PAID_IN_FULL';

CREATE TABLE disbursements (
  id           uuid PRIMARY KEY,
  reference_id text NOT NULL,
  party_id     text NOT NULL,
  gross        bigint NOT NULL,
  tax          bigint NOT NULL,
  net          bigint NOT NULL,
  source       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Rekening penerima (nomor disimpan masked + hash; produksi: enkripsi kolom via KMS)
CREATE TABLE bank_accounts (
  party_id      text PRIMARY KEY,
  bank          text NOT NULL,
  number_masked text NOT NULL,
  number_hash   text NOT NULL,
  holder        text NOT NULL,
  verified_at   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
  id            uuid PRIMARY KEY,
  party_id      text NOT NULL,
  amount        bigint NOT NULL CHECK (amount > 0),
  status        text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','PROCESSING','COMPLETED','FAILED')),
  bank_snapshot jsonb NOT NULL,
  requested_by  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE TABLE reconciliation_runs (
  id           bigserial PRIMARY KEY,
  run_at       timestamptz NOT NULL DEFAULT now(),
  balanced     boolean NOT NULL,
  total_debit  bigint NOT NULL,
  total_credit bigint NOT NULL,
  details      jsonb NOT NULL
);
