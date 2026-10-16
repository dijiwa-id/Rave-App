-- Fan-out notifikasi ke pengikut artis dikerjakan di luar transaksi consumer (artis populer = jutaan baris):
-- consumer hanya mencatat pekerjaan; job memproses per potongan keyset dalam transaksi pendek masing-masing.
CREATE TABLE IF NOT EXISTS fanout_jobs (
  id              bigserial PRIMARY KEY,
  source_event_id uuid NOT NULL UNIQUE,        -- satu pekerjaan per event (redelivery idempoten)
  artist_ids      uuid[] NOT NULL,
  by_city         boolean NOT NULL DEFAULT false,
  city            text,
  category        text NOT NULL,
  title           text NOT NULL,
  body            text NOT NULL,
  link            text,
  cursor_user     uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  done_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fanout_jobs_pending_idx ON fanout_jobs (created_at) WHERE done_at IS NULL;
-- Pengirim kanal luar mengambil PENDING terurut waktu.
CREATE INDEX IF NOT EXISTS deliveries_pending_idx ON deliveries (created_at) WHERE status = 'PENDING';
