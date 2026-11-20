-- Verifikasi 2 langkah (2FA) dengan aplikasi authenticator (TOTP, RFC 6238).
-- Secret disimpan terenkripsi (AES-256-GCM, kunci yang sama dengan kolom KYC). `totp_pending_enc` = secret yang sedang
-- didaftarkan (belum dikonfirmasi dengan kode). `totp_last_step` mencegah pemakaian ulang kode yang sama.
-- `totp_failures` + `totp_locked_until` membatasi tebakan kode per akun (terkunci sementara setelah terlalu banyak salah).
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_enc text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_enc text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step bigint NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_failures integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_locked_until timestamptz;

-- Verifikasi 2 langkah: setelah faktor pertama (OTP email / login sosial) berhasil, akun ber-2FA menerima challenge
-- sekali pakai (hash token, berlaku singkat) yang harus diselesaikan dengan kode authenticator atau kode pemulihan.
CREATE TABLE IF NOT EXISTS mfa_challenges (
  id          bigserial PRIMARY KEY,
  token_hash  text NOT NULL UNIQUE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempts    integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mfa_challenges_user_idx ON mfa_challenges (user_id, created_at DESC);

-- Kode pemulihan sekali pakai (ponsel hilang). Hanya hash yang disimpan; teks asli ditampilkan sekali saat dibuat.
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mfa_recovery_codes_user_idx ON mfa_recovery_codes (user_id) WHERE used_at IS NULL;
