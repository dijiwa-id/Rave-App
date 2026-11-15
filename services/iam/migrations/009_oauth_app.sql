-- Login sosial dari aplikasi desktop/mobile (gaya device flow): aplikasi membuat "peluncuran", membuka browser sistem,
-- lalu polling POST /v1/auth/token {grant_type:'oauth_poll'} sampai pengguna selesai masuk di browser.
CREATE TABLE IF NOT EXISTS oauth_app_launches (
  launch_hash   text PRIMARY KEY,          -- token di URL browser (start?app=…)
  poll_hash     text NOT NULL UNIQUE,      -- rahasia yang hanya dipegang aplikasi
  provider      text NOT NULL,
  client        text NOT NULL,             -- desktop | mobile
  user_code     text NOT NULL,             -- kode pencocokan yang tampil di aplikasi & browser
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'error', 'consumed')),
  user_id       uuid REFERENCES users(id) ON DELETE CASCADE,
  error         text,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE oauth_flows ADD COLUMN IF NOT EXISTS app_launch text;
