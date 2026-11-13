-- Jenis member per akun (diatur Super Admin; billing langganan belum dibangun):
--   FREE | INDIVIDUAL | STUDENT | DUO (paket sama dengan pengaturan subscription.price_*_idr).
-- member_until NULL = tanpa batas waktu. users.premium tetap dipakai token (JWT) & diselaraskan saat member diubah;
-- nilai efektif dihitung di buildMe (member ≠ FREE dan belum kedaluwarsa).
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_type text NOT NULL DEFAULT 'FREE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_until timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_updated_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_updated_by uuid;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_member_type_chk CHECK (member_type IN ('FREE', 'INDIVIDUAL', 'STUDENT', 'DUO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Akun yang sudah Premium (seed/demo) → paket Individu.
UPDATE users SET member_type = 'INDIVIDUAL' WHERE premium AND member_type = 'FREE';
