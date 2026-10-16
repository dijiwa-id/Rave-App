-- Indeks performa: statistik chat 24 jam (stats internal).
CREATE INDEX IF NOT EXISTS chat_messages_created_idx ON chat_messages (created_at);
