-- Indeks performa: statistik stream per rentang waktu (append-only → BRIN) & sesi aktif.
CREATE INDEX IF NOT EXISTS qualified_streams_at_brin ON qualified_streams USING brin (at);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);
