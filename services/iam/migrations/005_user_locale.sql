-- Bahasa antarmuka pilihan pengguna (i18n). NULL = ikuti perangkat / bahasa default platform (general.default_locale).
ALTER TABLE users ADD COLUMN IF NOT EXISTS locale text;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_locale_chk CHECK (locale IS NULL OR locale IN ('id', 'en'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
