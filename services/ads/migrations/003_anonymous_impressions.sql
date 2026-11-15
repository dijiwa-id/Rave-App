-- Iklan untuk pengguna anonim (ads.anonymous_enabled): satu iklan setelah pratinjau 30 detik → impresi tanpa akun.
ALTER TABLE impressions ALTER COLUMN user_id DROP NOT NULL;
