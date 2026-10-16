-- Indeks performa: hitung/daftar notifikasi belum dibaca per pengguna (badge lonceng).
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
