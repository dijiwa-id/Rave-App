-- Unduhan offline (P-7) — perbaikan review keamanan. Tabel baru kecil saja (tidak menyentuh data lama).

-- M2: permintaan lisensi yang masih menunggu artefak (202 preparing) dihitung ke kuota per akun. Satu baris per
-- akun+konten (polling ulang konten yang sama tidak menambah hitungan); dihapus saat lisensi terbit, dibersihkan job
-- offline-expire setelah 1 jam.
CREATE TABLE IF NOT EXISTS offline_requests (
  user_id      uuid NOT NULL,
  content_id   uuid NOT NULL,
  content_kind text NOT NULL CHECK (content_kind IN ('track', 'episode')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, content_id)
);
CREATE INDEX IF NOT EXISTS offline_requests_created_idx ON offline_requests (created_at);

-- L2: watermark pencabutan per pengguna/perangkat/konten — ditulis konsumen pencabutan, dicek di transaksi penerbitan
-- agar lisensi yang hak/kontennya dicabut bersamaan tidak terbit ACTIVE. Hanya perlu menutup jendela detik antara
-- pemeriksaan hak & commit; dibersihkan job offline-expire setelah 1 jam.
CREATE TABLE IF NOT EXISTS offline_revocations (
  scope      text NOT NULL CHECK (scope IN ('user', 'device', 'track', 'episode')),
  id         uuid NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, id)
);
CREATE INDEX IF NOT EXISTS offline_revocations_at_idx ON offline_revocations (revoked_at);

-- L6: ember laju per kunci (mis. recheck per akun per menit) — tahan multi-replika, satu baris per kunci.
CREATE TABLE IF NOT EXISTS offline_rate (
  key          text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  n            int NOT NULL
);
CREATE INDEX IF NOT EXISTS offline_rate_window_idx ON offline_rate (window_start);
