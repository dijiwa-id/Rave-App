-- Penomoran ISRC resmi per kode pendaftar & tahun (ISO 3901: CC-XXX-YY-NNNNN), menggantikan isrc_seq (CYCLE, kode palsu ID-GM1).
-- Nomor urut tidak pernah berputar ulang: melewati 99999 dalam satu tahun → galat (bukan duplikat).
-- isrc_seq lama dibiarkan (tidak dipakai lagi) agar migrasi lama tidak berubah.
CREATE TABLE IF NOT EXISTS isrc_counters (
  registrant  text NOT NULL,           -- CC-XXX
  year        int  NOT NULL,           -- tahun penuh (mis. 2026)
  last_n      int  NOT NULL CHECK (last_n BETWEEN 1 AND 99999),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (registrant, year)
);
