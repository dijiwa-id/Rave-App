-- Amplop spektrum per lagu untuk LCD pemutar (GET /v1/catalog/tracks/:id/spectrum).
-- Baris ini hanya status/antrean (ringan); bytenya berkas biner di <UPLOAD_DIR>/spectrum/<track_id>.v<version>.bin
-- (frames*bands uint8, frame-major) sehingga DB tidak menampung ±150 KB per lagu.
-- pending → processing → done | failed · unavailable: tidak ada sumber audio yang bisa didekode.
CREATE TABLE IF NOT EXISTS track_spectra (
  track_id     uuid PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  version      int NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed','unavailable')),
  fps          int,
  bands        int,
  frames       int,
  duration_ms  int,
  source       text,
  attempts     int NOT NULL DEFAULT 0,
  error        text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  done_at      timestamptz
);
-- Antrean (diklaim FOR UPDATE SKIP LOCKED, satu per instance).
CREATE INDEX IF NOT EXISTS track_spectra_queue_idx ON track_spectra (requested_at) WHERE status IN ('pending','processing');
