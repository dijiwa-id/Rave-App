-- Login sosial (Google / Facebook / Apple, + provider simulasi di development).
-- oauth_flows: satu baris per percobaan login (state sekali pakai, PKCE verifier, nonce, pengikat browser).
CREATE TABLE IF NOT EXISTS oauth_flows (
  state_hash    text PRIMARY KEY,
  provider      text NOT NULL,
  verifier      text NOT NULL,
  nonce         text NOT NULL,
  bind_hash     text NOT NULL,          -- hash cookie rave_oauth: callback harus datang dari browser yang memulai (cegah login-CSRF)
  next_path     text,
  intent        text,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Kode sekali pakai (60 dtk) yang ditukar web menjadi token lewat POST /v1/auth/token (grant_type=oauth_code),
-- sehingga access/refresh token tidak pernah muncul di URL.
CREATE TABLE IF NOT EXISTS oauth_login_codes (
  code_hash     text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      text NOT NULL,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS identities_user_idx ON identities (user_id);
