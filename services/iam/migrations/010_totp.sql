-- Aplikasi authenticator (TOTP, RFC 6238) — masuk dengan email + kode 6 digit dari ponsel sebagai alternatif OTP email.
-- Secret disimpan terenkripsi (AES-256-GCM, kunci yang sama dengan kolom KYC). `totp_pending_enc` = secret yang sedang
-- didaftarkan (belum dikonfirmasi dengan kode). `totp_last_step` mencegah pemakaian ulang kode yang sama.
-- `totp_failures` + `totp_locked_until` membatasi tebakan kode (terkunci sementara setelah terlalu banyak salah).
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_enc text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_enc text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step bigint NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_failures integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_locked_until timestamptz;
