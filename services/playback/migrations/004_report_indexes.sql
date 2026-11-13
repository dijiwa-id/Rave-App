-- Laporan Streaming (Super Admin): hitungan sesi per rentang waktu tanpa memindai seluruh tabel sessions.
CREATE INDEX IF NOT EXISTS sessions_created_brin ON sessions USING brin (created_at);
