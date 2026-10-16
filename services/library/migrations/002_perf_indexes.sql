-- Indeks performa: statistik riwayat dengar per rentang waktu (append-only → BRIN).
CREATE INDEX IF NOT EXISTS listening_history_played_brin ON listening_history USING brin (played_at);
