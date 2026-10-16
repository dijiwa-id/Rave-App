-- Platform / Super Admin (REQ-ADM-01, BRD §12.3 "Konfigurasi Kebijakan", §9 durabilitas)

-- Nilai pengaturan yang menyimpang dari default registri (@gema/domain/settings). Kunci tanpa baris = default.
CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Versi monoton: naik setiap perubahan, dipakai service untuk mendeteksi snapshot basi.
CREATE TABLE settings_state (
  id       int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version  int NOT NULL DEFAULT 0
);
INSERT INTO settings_state (id, version) VALUES (1, 0);

CREATE TABLE settings_history (
  id          bigserial PRIMARY KEY,
  key         text NOT NULL,
  old_value   jsonb,
  new_value   jsonb,
  reason      text NOT NULL,
  by_user_id  text,
  by_name     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX settings_history_key_idx ON settings_history (key, id DESC);

-- Backup database (pg_dump terkompresi di bucket backups).
CREATE TABLE backups (
  id           uuid PRIMARY KEY,
  filename     text NOT NULL UNIQUE,
  status       text NOT NULL CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
  size_bytes   bigint NOT NULL DEFAULT 0,
  sha256       text,
  trigger      text NOT NULL CHECK (trigger IN ('manual','schedule')),
  note         text,
  error        text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  created_by   text
);
CREATE INDEX backups_started_idx ON backups (started_at DESC);

-- Sampel pemakaian storage untuk grafik tren.
CREATE TABLE storage_samples (
  at               timestamptz PRIMARY KEY DEFAULT now(),
  disk_used_bytes  bigint NOT NULL,
  db_bytes         bigint NOT NULL,
  uploads_bytes    bigint NOT NULL,
  backups_bytes    bigint NOT NULL
);
