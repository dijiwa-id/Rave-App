-- Refund ke pembeli (REQ-TIX-05). Satu refund per invoice: idempoten terhadap event yang dikirim ulang.
-- Sandbox: dana dianggap langsung kembali lewat mitra escrow (COMPLETED); produksi: PENDING → callback disbursement PG.
CREATE TABLE IF NOT EXISTS refunds (
  id             uuid PRIMARY KEY,
  invoice_id     uuid NOT NULL UNIQUE REFERENCES invoices(id),
  purpose        text NOT NULL,
  reference_id   text NOT NULL,
  payer_user_id  uuid NOT NULL,
  escrow_amount  bigint NOT NULL CHECK (escrow_amount >= 0),
  fee_amount     bigint NOT NULL CHECK (fee_amount >= 0),
  amount         bigint NOT NULL CHECK (amount >= 0),
  escrow_pct     numeric(5,2) NOT NULL,
  reason         text NOT NULL,
  status         text NOT NULL CHECK (status IN ('COMPLETED','FAILED')),
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refunds_reference_idx ON refunds (reference_id);
CREATE INDEX IF NOT EXISTS refunds_payer_idx ON refunds (payer_user_id, created_at DESC);
