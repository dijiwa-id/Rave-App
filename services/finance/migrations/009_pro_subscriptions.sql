-- RAVE Pro (B2B SaaS, BRD §4.1 / REQ-PAY-03): satu langganan berjalan per organisasi + riwayat pesanan (checkout, perpanjangan,
-- upgrade) yang masing-masing ditagih lewat invoice purpose SUBSCRIPTION (penyedia pembayaran aktif: sandbox/Midtrans).
CREATE TABLE IF NOT EXISTS pro_subscriptions (
  org_id               uuid PRIMARY KEY,
  org_type             text NOT NULL,
  org_name             text NOT NULL,
  plan                 text NOT NULL CHECK (plan IN ('STARTER', 'PRO', 'LABEL')),
  cycle                text NOT NULL CHECK (cycle IN ('MONTHLY', 'YEARLY')),
  status               text NOT NULL CHECK (status IN ('ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED')),
  source               text NOT NULL DEFAULT 'PAID' CHECK (source IN ('PAID', 'COMPLIMENTARY')),
  current_period_start timestamptz NOT NULL,
  current_period_end   timestamptz NOT NULL,
  grace_until          timestamptz,
  auto_renew           boolean NOT NULL DEFAULT true,
  -- Downgrade / ganti siklus berlaku di perpanjangan berikutnya (tidak ada pengembalian dana di tengah periode).
  next_plan            text CHECK (next_plan IN ('STARTER', 'PRO', 'LABEL')),
  next_cycle           text CHECK (next_cycle IN ('MONTHLY', 'YEARLY')),
  -- Harga dasar (tanpa PPN) periode berjalan — basis kredit prorata saat upgrade.
  paid_subtotal        bigint NOT NULL DEFAULT 0,
  started_at           timestamptz NOT NULL DEFAULT now(),
  cancelled_at         timestamptz,
  cancel_reason        text,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pro_subscriptions_due_idx ON pro_subscriptions (status, current_period_end);

CREATE TABLE IF NOT EXISTS pro_orders (
  id            uuid PRIMARY KEY,
  org_id        uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('NEW', 'RENEWAL', 'UPGRADE', 'COMPLIMENTARY')),
  plan          text NOT NULL CHECK (plan IN ('STARTER', 'PRO', 'LABEL')),
  cycle         text NOT NULL CHECK (cycle IN ('MONTHLY', 'YEARLY')),
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'EXPIRED', 'VOID')),
  subtotal      bigint NOT NULL,
  credit        bigint NOT NULL DEFAULT 0,
  ppn_pct       numeric(5,2) NOT NULL DEFAULT 0,
  ppn           bigint NOT NULL DEFAULT 0,
  total         bigint NOT NULL,
  invoice_id    uuid,
  period_start  timestamptz,
  period_end    timestamptz,
  created_by    uuid,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  paid_at       timestamptz
);
CREATE INDEX IF NOT EXISTS pro_orders_org_idx ON pro_orders (org_id, created_at DESC);
-- Paling banyak satu pesanan menunggu pembayaran per organisasi (checkout baru membatalkan yang lama).
CREATE UNIQUE INDEX IF NOT EXISTS pro_orders_one_pending ON pro_orders (org_id) WHERE status = 'PENDING';
