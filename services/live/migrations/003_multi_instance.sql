-- Multi-replika: registri instance (heartbeat) + kepemilikan siaran per instance.
-- Instance dianggap mati bila heartbeat_at > 15 dtk lalu; siarannya boleh diambil alih (UPDATE bersyarat).
CREATE TABLE IF NOT EXISTS instances (
  id            text PRIMARY KEY,
  internal_url  text NOT NULL,          -- alamat yang bisa dijangkau replika lain (LIVE_INTERNAL_URL)
  rtmp_port     int,
  rtmp_ok       boolean NOT NULL DEFAULT false,
  started_at    timestamptz NOT NULL DEFAULT now(),
  heartbeat_at  timestamptz NOT NULL DEFAULT now()
);

-- Instance yang memegang publisher (RTMP/browser) & transcoder siaran ini. NULL = belum/tidak ada (atau ENDED).
ALTER TABLE streams ADD COLUMN IF NOT EXISTS owner_instance text;
CREATE INDEX IF NOT EXISTS streams_owner_idx ON streams (owner_instance) WHERE owner_instance IS NOT NULL;
