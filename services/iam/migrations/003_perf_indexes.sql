-- Indeks performa: pencarian pengguna back office (ILIKE '%q%'). pg_trgm ada di schema public (search_path).
CREATE INDEX IF NOT EXISTS users_email_trgm ON users USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS users_display_name_trgm ON users USING gin (display_name gin_trgm_ops);
