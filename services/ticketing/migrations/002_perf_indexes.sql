-- Indeks performa: cek kepemilikan tiket (internal), inventori per event, statistik order, batas per akun.
CREATE INDEX IF NOT EXISTS tickets_event_user_idx ON tickets (event_id, user_id);
CREATE INDEX IF NOT EXISTS ticket_types_event_idx ON ticket_types (event_id);
CREATE INDEX IF NOT EXISTS orders_event_status_idx ON orders (event_id, status);
CREATE INDEX IF NOT EXISTS order_items_type_idx ON order_items (ticket_type_id);
