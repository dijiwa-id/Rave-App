-- Perangkat pengguna untuk unduhan offline Premium (P-7, ADR-0004). Kunci publik ECDH P-256 dari perangkat dipakai
-- playback/catalog untuk membungkus content key; kunci privat tidak pernah meninggalkan perangkat.
-- Tabel baru (tidak menyentuh data lama). Kolom push (P-3) dapat ditambahkan kemudian secara aditif.
CREATE TABLE IF NOT EXISTS user_devices (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform        text NOT NULL CHECK (platform IN ('desktop', 'android', 'ios', 'web')),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  public_key      text NOT NULL,           -- SPKI DER (base64) kunci publik ECDH P-256
  key_fingerprint text NOT NULL,           -- SHA-256 hex titik publik mentah (65 byte)
  app_version     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  revoked_by      uuid
);
-- Satu kunci = satu perangkat aktif per akun (daftar ulang kunci yang sama = upsert, bukan perangkat baru).
CREATE UNIQUE INDEX IF NOT EXISTS user_devices_active_key_uq ON user_devices (user_id, key_fingerprint) WHERE revoked_at IS NULL;
-- Daftar & hitung perangkat aktif per akun.
CREATE INDEX IF NOT EXISTS user_devices_user_active_idx ON user_devices (user_id, created_at) WHERE revoked_at IS NULL;
