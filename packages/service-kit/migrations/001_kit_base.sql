-- Tabel infrastruktur yang dimiliki SETIAP service (dibuat di schema service masing-masing).

-- Outbox pattern (TDD §10.1): event ditulis dalam transaksi yang sama dengan perubahan domain.
CREATE TABLE IF NOT EXISTS outbox (
  id            uuid PRIMARY KEY,
  topic         text NOT NULL,
  key           text NOT NULL,
  payload       jsonb NOT NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_unpublished_idx ON outbox (occurred_at) WHERE published_at IS NULL;

-- Idempotency-Key untuk semua POST yang membuat transaksi (TDD §11.2).
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope        text NOT NULL,
  key          text NOT NULL,
  status_code  int NOT NULL,
  response     jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

-- Audit log append-only (REQ-IAM-03, REQ-ADM-01). Produksi: di-ship ke storage WORM.
CREATE TABLE IF NOT EXISTS audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    text,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  data        jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only table'; END $$;
DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Dedupe konsumen (dipakai driver Kafka; driver pg memakai offset transaksional).
CREATE TABLE IF NOT EXISTS processed_events (
  event_id     uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- ---- Event bus berbasis Postgres (driver "pg", untuk lokal/tanpa Kafka) ----
CREATE SCHEMA IF NOT EXISTS bus;
CREATE TABLE IF NOT EXISTS bus.events (
  seq          bigserial PRIMARY KEY,
  id           uuid NOT NULL UNIQUE,
  topic        text NOT NULL,
  key          text NOT NULL,
  payload      jsonb NOT NULL,
  occurred_at  timestamptz NOT NULL,
  producer     text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bus_events_topic_seq_idx ON bus.events (topic, seq);
CREATE TABLE IF NOT EXISTS bus.consumer_offsets (
  group_id  text NOT NULL,
  topic     text NOT NULL,
  last_seq  bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, topic)
);
CREATE TABLE IF NOT EXISTS bus.dead_letters (
  group_id  text NOT NULL,
  event_id  uuid NOT NULL,
  topic     text NOT NULL,
  error     text NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, event_id)
);

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
