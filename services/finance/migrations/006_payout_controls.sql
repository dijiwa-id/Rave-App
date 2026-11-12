-- Kontrol payout (BRD §11.5 / GO-LIVE): dual control untuk penarikan besar + masa tunggu rekening yang baru diganti.
-- PENDING_APPROVAL = menunggu persetujuan tim finance (nominal > payout.approval_threshold_idr);
-- REJECTED = ditolak admin, dana dikembalikan ke wallet (jurnal pembalik).
-- REQUESTED dengan hold_until di masa depan = antre, baru diproses setelah masa tunggu rekening lewat.
ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_status_check;
ALTER TABLE payouts ADD CONSTRAINT payouts_status_check
  CHECK (status IN ('PENDING_APPROVAL', 'REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED'));
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS approval_required boolean NOT NULL DEFAULT false;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS hold_until timestamptz;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS decided_by text;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS decision_note text;
CREATE INDEX IF NOT EXISTS payouts_status_created_idx ON payouts (status, created_at);

-- Kapan nomor rekening terakhir DIGANTI (bukan pendaftaran pertama). NULL = belum pernah diganti.
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS changed_at timestamptz;
