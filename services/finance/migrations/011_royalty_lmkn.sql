-- Laporan penggunaan LMKN (REQ-ROY-04): snapshot metadata lagu & log harian per periode agar laporan dapat dibuat ulang
-- persis sama seperti saat periode dihitung (audit), walau katalog berubah kemudian.
ALTER TABLE royalty_tracks ADD COLUMN IF NOT EXISTS duration_ms int;
ALTER TABLE royalty_tracks ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE royalty_tracks ADD COLUMN IF NOT EXISTS composers text;
ALTER TABLE royalty_tracks ADD COLUMN IF NOT EXISTS producers text;

CREATE TABLE IF NOT EXISTS royalty_usage (
  period      text NOT NULL REFERENCES royalty_periods(period) ON DELETE CASCADE,
  day         date NOT NULL,
  track_id    uuid NOT NULL,
  first_time  text NOT NULL,
  plays       int NOT NULL,
  listeners   int NOT NULL,
  PRIMARY KEY (period, day, track_id)
);
