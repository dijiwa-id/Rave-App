-- Royalti streaming bulanan (BRD §4.3, §6.9 REQ-ROY-02..04, §7.5; TDD §11.4).
-- Satu baris per periode (bulan WIB). DRAFT dapat dihitung ulang; APPROVED (dua orang) → PUBLISHED (jurnal + statement).
CREATE TABLE IF NOT EXISTS royalty_periods (
  period                 text PRIMARY KEY CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status                 text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'PUBLISHED')),
  model                  text NOT NULL,
  rightsholder_share_pct numeric(5,2) NOT NULL,
  publishing_share_pct   numeric(5,2) NOT NULL,
  reserve_pct            numeric(5,2) NOT NULL,
  withholding_pct        numeric(5,2) NOT NULL,
  min_payable            bigint NOT NULL,
  hybrid_floor           bigint NOT NULL,
  premium_revenue_auto   bigint NOT NULL DEFAULT 0,
  premium_revenue        bigint NOT NULL DEFAULT 0,
  premium_override       boolean NOT NULL DEFAULT false,
  ad_revenue             bigint NOT NULL DEFAULT 0,
  attributed_revenue     bigint NOT NULL DEFAULT 0,
  rightsholder_pool      bigint NOT NULL DEFAULT 0,
  distributed            bigint NOT NULL DEFAULT 0,
  held                   bigint NOT NULL DEFAULT 0,
  unclaimed              bigint NOT NULL DEFAULT 0,
  released_held          bigint NOT NULL DEFAULT 0,
  streams                int NOT NULL DEFAULT 0,
  listeners              int NOT NULL DEFAULT 0,
  listeners_direct       int NOT NULL DEFAULT 0,
  listeners_pooled       int NOT NULL DEFAULT 0,
  premium_listeners      int NOT NULL DEFAULT 0,
  excluded_streams       int NOT NULL DEFAULT 0,
  excluded_listeners     int NOT NULL DEFAULT 0,
  tracks                 int NOT NULL DEFAULT 0,
  parties                int NOT NULL DEFAULT 0,
  anomalies              jsonb NOT NULL DEFAULT '[]'::jsonb,
  note                   text,
  computed_at            timestamptz,
  computed_by            uuid,
  computed_by_name       text,
  approved_at            timestamptz,
  approved_by            uuid,
  approved_by_name       text,
  published_at           timestamptz,
  published_by           uuid,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- Per lagu per periode: dasar perhitungan yang dapat ditelusuri (stream, pendengar, per sumber, per kota).
CREATE TABLE IF NOT EXISTS royalty_tracks (
  period        text NOT NULL REFERENCES royalty_periods(period) ON DELETE CASCADE,
  track_id      uuid NOT NULL,
  title         text NOT NULL,
  isrc          text,
  release_title text,
  upc           text,
  artist_id     uuid,
  artist_name   text,
  artist_org_id uuid,
  streams       int NOT NULL,
  listeners     int NOT NULL,
  premium       bigint NOT NULL DEFAULT 0,
  ads           bigint NOT NULL DEFAULT 0,
  pool          bigint NOT NULL DEFAULT 0,
  total         bigint NOT NULL DEFAULT 0,
  cities        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Royalti lagu ditahan: split belum disetujui / belum ada registri hak / artis tanpa org penerima.
  held_reason   text CHECK (held_reason IN ('SPLIT_PENDING', 'NO_RIGHTS', 'NO_PAYEE')),
  released_in   text,
  PRIMARY KEY (period, track_id)
);
CREATE INDEX IF NOT EXISTS royalty_tracks_held_idx ON royalty_tracks (held_reason) WHERE held_reason IS NOT NULL AND released_in IS NULL;
CREATE INDEX IF NOT EXISTS royalty_tracks_artist_idx ON royalty_tracks (artist_id, period);

-- Per lagu × pihak penerima. source_period ≠ period → royalti tertahan/tak bertuan periode lama yang dilepas periode ini.
CREATE TABLE IF NOT EXISTS royalty_lines (
  id            uuid PRIMARY KEY,
  period        text NOT NULL REFERENCES royalty_periods(period) ON DELETE CASCADE,
  source_period text NOT NULL,
  track_id      uuid NOT NULL,
  party_key     text NOT NULL,
  party_type    text NOT NULL CHECK (party_type IN ('org', 'user', 'unclaimed')),
  party_id      uuid,
  party_email   text,
  party_name    text NOT NULL,
  type          text NOT NULL CHECK (type IN ('MASTER', 'PUBLISHING')),
  pct           numeric(5,2) NOT NULL,
  premium       bigint NOT NULL DEFAULT 0,
  ads           bigint NOT NULL DEFAULT 0,
  pool          bigint NOT NULL DEFAULT 0,
  total         bigint NOT NULL,
  claimed_in    text
);
CREATE INDEX IF NOT EXISTS royalty_lines_party_idx ON royalty_lines (party_key, period);
CREATE INDEX IF NOT EXISTS royalty_lines_period_idx ON royalty_lines (period, track_id);
CREATE INDEX IF NOT EXISTS royalty_lines_unclaimed_idx ON royalty_lines (party_email) WHERE party_type = 'unclaimed' AND claimed_in IS NULL;

-- Statement per pihak per periode (REQ-ROY-03).
CREATE TABLE IF NOT EXISTS royalty_statements (
  period      text NOT NULL REFERENCES royalty_periods(period) ON DELETE CASCADE,
  party_key   text NOT NULL,
  party_type  text NOT NULL CHECK (party_type IN ('org', 'user')),
  party_id    uuid NOT NULL,
  party_name  text NOT NULL,
  gross       bigint NOT NULL,
  reserve     bigint NOT NULL,
  withholding bigint NOT NULL,
  carry_in    bigint NOT NULL,
  payable     bigint NOT NULL,
  carry_out   bigint NOT NULL,
  tracks      int NOT NULL,
  streams     int NOT NULL,
  issued_at   timestamptz,
  PRIMARY KEY (period, party_key)
);
CREATE INDEX IF NOT EXISTS royalty_statements_party_idx ON royalty_statements (party_id, period DESC);

-- Cadangan koreksi per pihak, dilepas ke wallet setelah masa cadangan (BRD §7.5 "+3 bulan").
CREATE TABLE IF NOT EXISTS royalty_reserves (
  period       text NOT NULL,
  party_key    text NOT NULL,
  party_type   text NOT NULL,
  party_id     uuid NOT NULL,
  amount       bigint NOT NULL,
  release_at   timestamptz NOT NULL,
  released_at  timestamptz,
  withholding  bigint,
  payable      bigint,
  PRIMARY KEY (period, party_key)
);
CREATE INDEX IF NOT EXISTS royalty_reserves_due_idx ON royalty_reserves (release_at) WHERE released_at IS NULL;
