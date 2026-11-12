-- Integrasi pihak ketiga yang diatur Super Admin (Platform → Integrasi): email & payment gateway.
-- Rahasia (API key) disimpan terenkripsi AES-256-GCM (secrets_enc); `config` hanya nilai non-rahasia.
CREATE TABLE IF NOT EXISTS integrations (
  kind            text PRIMARY KEY CHECK (kind IN ('email', 'payment')),
  provider        text NOT NULL,
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  secrets_enc     text,
  updated_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_test_at    timestamptz,
  last_test_ok    boolean,
  last_test_message text
);

-- Riwayat perubahan (tanpa nilai rahasia) untuk audit.
CREATE TABLE IF NOT EXISTS integration_history (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,
  provider    text NOT NULL,
  changed     text[] NOT NULL DEFAULT '{}',
  reason      text NOT NULL,
  actor_id    text,
  actor_name  text,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integration_history_kind_idx ON integration_history (kind, at DESC);
