-- Akun terverifikasi (badge "Verified") — murni penanda identitas/kepercayaan, TIDAK mengubah tier atau fitur.
-- Pengguna melengkapi data profil (nama lengkap, tanggal lahir, gender, bio, media sosial, foto, kota, email &
-- WhatsApp terverifikasi OTP), mengajukan, lalu admin berizin `users.verify` menyetujui/menolak.
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS socials jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_by uuid;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_gender_chk CHECK (gender IS NULL OR gender IN ('male', 'female', 'other', 'undisclosed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS verification_requests (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REVOKED')),
  -- Salinan data saat diajukan (yang ditinjau admin), bukan data terkini.
  snapshot    jsonb NOT NULL,
  reason      text,
  decided_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz
);
-- Satu pengajuan menunggu per pengguna.
CREATE UNIQUE INDEX IF NOT EXISTS verification_one_pending ON verification_requests (user_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS verification_status_idx ON verification_requests (status, created_at);
CREATE INDEX IF NOT EXISTS users_verified_idx ON users (verified_at) WHERE verified_at IS NOT NULL;
