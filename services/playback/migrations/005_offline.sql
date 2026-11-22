-- Unduhan offline Premium (P-7, ADR-0004): lisensi per perangkat + log putar offline (diisi kemudian oleh rave-money, T6).
-- Tabel baru — tidak menyentuh data lama.

CREATE TABLE IF NOT EXISTS offline_licenses (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL,
  device_id     uuid NOT NULL,             -- iam.user_devices.id (lintas service: tanpa FK)
  track_id      uuid,
  episode_id    uuid,
  artifact_id   uuid NOT NULL,             -- catalog.offline_artifacts.id
  artifact      jsonb NOT NULL,            -- metadata artefak yang ditandatangani di payload (tanpa URL)
  wrapped_key   jsonb NOT NULL,            -- CEK terbungkus kunci publik perangkat (hanya perangkat itu yang bisa membuka)
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  issued_at     timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,
  recheck_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  revoke_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((track_id IS NULL) <> (episode_id IS NULL))
);
-- Satu lisensi aktif per perangkat + konten (permintaan ulang = perpanjang lisensi yang sama).
CREATE UNIQUE INDEX IF NOT EXISTS offline_licenses_active_uq ON offline_licenses (device_id, (coalesce(track_id, episode_id))) WHERE status = 'ACTIVE';
-- Rate limit lisensi baru per jam & daftar per pengguna.
CREATE INDEX IF NOT EXISTS offline_licenses_user_created_idx ON offline_licenses (user_id, created_at DESC);
-- Konsumen pencabutan (per perangkat / per konten) & kuota per perangkat & job kedaluwarsa — hanya baris ACTIVE.
CREATE INDEX IF NOT EXISTS offline_licenses_device_active_idx ON offline_licenses (device_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS offline_licenses_user_active_idx ON offline_licenses (user_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS offline_licenses_track_active_idx ON offline_licenses (track_id) WHERE status = 'ACTIVE' AND track_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS offline_licenses_episode_active_idx ON offline_licenses (episode_id) WHERE status = 'ACTIVE' AND episode_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS offline_licenses_expiry_idx ON offline_licenses (expires_at) WHERE status = 'ACTIVE';

-- Putar offline yang dilaporkan perangkat saat online lagi (T6, rave-money: validasi → qualified stream/royalti).
-- seq = penghitung monoton per perangkat (idempoten: kiriman ulang batch yang sama tidak tercatat dua kali).
CREATE TABLE IF NOT EXISTS offline_plays (
  id                uuid PRIMARY KEY,
  user_id           uuid NOT NULL,
  device_id         uuid NOT NULL,
  license_id        uuid NOT NULL REFERENCES offline_licenses(id),
  track_id          uuid,
  episode_id        uuid,
  seq               bigint NOT NULL CHECK (seq >= 0),
  started_at_client timestamptz NOT NULL,
  played_ms         int NOT NULL CHECK (played_ms >= 0),
  received_at       timestamptz NOT NULL DEFAULT now(),
  status            text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'ACCEPTED', 'REJECTED')),
  reject_reason     text,
  CHECK ((track_id IS NULL) <> (episode_id IS NULL)),
  UNIQUE (device_id, seq)
);
CREATE INDEX IF NOT EXISTS offline_plays_pending_idx ON offline_plays (received_at) WHERE status = 'RECEIVED';
CREATE INDEX IF NOT EXISTS offline_plays_license_idx ON offline_plays (license_id);
