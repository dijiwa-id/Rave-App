-- Unduhan offline Premium (P-7, ADR-0004).
-- 1) Izin per konten, dapat dimatikan artis/label/kreator. ADD COLUMN dengan default konstan = hanya metadata
--    (tanpa rewrite tabel, aman untuk data produksi).
ALTER TABLE tracks   ADD COLUMN IF NOT EXISTS offline_allowed boolean NOT NULL DEFAULT true;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS offline_allowed boolean NOT NULL DEFAULT true;

-- 2) Artefak terenkripsi: rendisi AAC (bukan master/lossless) dienkripsi SEKALI per konten+rendisi dengan content key
--    (CEK) acak, dibuat lazy saat lisensi pertama diminta, oleh antrean konkurensi 1 (job offline-artifacts).
--    cek_encrypted = CEK tersegel AES-256-GCM (kunci turunan OFFLINE_KEY/KYC_KEY) — tidak pernah disimpan polos.
CREATE TABLE IF NOT EXISTS offline_artifacts (
  id            uuid PRIMARY KEY,
  content_kind  text NOT NULL CHECK (content_kind IN ('track', 'episode')),
  content_id    uuid NOT NULL,
  rendition     text NOT NULL CHECK (rendition IN ('low', 'normal')),
  source_file   text NOT NULL,            -- berkas rendisi sumber di bucket uploads
  version       int  NOT NULL DEFAULT 1,  -- naik bila sumber berganti (berkas & CEK baru)
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  path          text,                     -- nama berkas RAVEOFL1 di bucket uploads (disajikan lewat URL bertanda tangan)
  cek_encrypted text,
  iv            text,                     -- nonce prefix 8 byte (hex) — juga tertulis di header berkas
  size          bigint,                   -- byte berkas terenkripsi
  plain_size    bigint,
  sha256        text,                     -- hex SHA-256 berkas terenkripsi
  codec_label   text,
  attempts      int  NOT NULL DEFAULT 0,
  error         text,
  started_at    timestamptz,
  ready_at      timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_kind, content_id, rendition)
);
-- Antrean (klaim FOR UPDATE SKIP LOCKED).
CREATE INDEX IF NOT EXISTS offline_artifacts_queue_idx ON offline_artifacts (created_at) WHERE status IN ('pending', 'processing');
