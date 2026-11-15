-- Tema aplikasi dengar pilihan pengguna (web, desktop, mobile ikut akun). NULL = ikuti default platform
-- (appearance.player_theme). 'system' = ikuti preferensi terang/gelap OS.
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme text;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_theme_chk CHECK (theme IS NULL OR theme IN ('light', 'dark', 'system'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
