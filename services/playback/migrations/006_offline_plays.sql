-- Pelaporan putar offline (P-7 T6, ADR-0004 §Putar offline & royalti). Aditif & aman untuk data produksi:
-- kolom baru ber-default konstan (tanpa rewrite tabel di PG ≥ 11); CHECK origin NOT VALID (berlaku untuk tulisan baru,
-- tanpa memindai baris lama — semuanya bernilai default 'online').

-- qualified_streams: asal stream + waktu dengar. `at` TETAP = waktu stream diakui server (online: saat qualified;
-- offline: saat laporan DITERIMA) → dasar periode royalti (cutoff received_at, periode tertutup tidak dibuka ulang).
-- played_at = waktu dengar sebenarnya (offline: started_at perangkat); baris lama NULL → pakai `at`.
ALTER TABLE qualified_streams ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'online';
ALTER TABLE qualified_streams ADD COLUMN IF NOT EXISTS played_at timestamptz;
DO $$ BEGIN
  ALTER TABLE qualified_streams ADD CONSTRAINT qualified_streams_origin_chk CHECK (origin IN ('online', 'offline')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- fraudCheck (batas stream per jam) dihitung menurut waktu dengar, agar sinkronisasi batch offline tidak menandai
-- stream online berikutnya sebagai RATE_LIMIT.
CREATE INDEX IF NOT EXISTS qualified_user_played_idx ON qualified_streams (user_id, (coalesce(played_at, at)) DESC);

-- offline_plays: nilai played_ms asli dari perangkat (audit; kolom played_ms = nilai yang diakui setelah dipangkas)
-- dan penanda qualified (pola loop fraudCheck seperti sessions.qualified_at).
ALTER TABLE offline_plays ADD COLUMN IF NOT EXISTS reported_played_ms int;
ALTER TABLE offline_plays ADD COLUMN IF NOT EXISTS qualified_at timestamptz;
-- Tumpang tindih & batas harian per perangkat: hanya putar yang diterima.
CREATE INDEX IF NOT EXISTS offline_plays_device_started_idx ON offline_plays (device_id, started_at_client) WHERE status = 'ACCEPTED';
CREATE INDEX IF NOT EXISTS offline_plays_user_qualified_idx ON offline_plays (user_id, started_at_client DESC) WHERE qualified_at IS NOT NULL;
