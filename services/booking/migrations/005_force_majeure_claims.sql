-- Force majeure tidak lagi dapat dinyatakan sepihak (audit go-live B6): klaim membuka sengketa berjenis FORCE_MAJEURE
-- dengan bukti & biaya riil yang diklaim; mediator memutuskan (biaya riil ke artis, sisa refund ke promotor).
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'GENERAL';
DO $$ BEGIN
  ALTER TABLE disputes ADD CONSTRAINT disputes_kind_chk CHECK (kind IN ('GENERAL', 'FORCE_MAJEURE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS evidence text;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS claimed_costs bigint CHECK (claimed_costs IS NULL OR claimed_costs >= 0);
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS awarded_costs bigint CHECK (awarded_costs IS NULL OR awarded_costs >= 0);
