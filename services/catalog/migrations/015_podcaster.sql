-- Podcaster: acara & episode buatan kreator (Artist Studio / Podcaster Studio), moderasi Back Office, embed iframe.
-- Data lama (seed katalog RAVE) tidak berpemilik org dan tetap tayang: shows.status ACTIVE, episodes.status PUBLISHED.

ALTER TABLE shows
  ADD COLUMN IF NOT EXISTS org_id uuid,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS hidden_reason text,
  ADD COLUMN IF NOT EXISTS explicit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE shows DROP CONSTRAINT IF EXISTS shows_status_check;
ALTER TABLE shows ADD CONSTRAINT shows_status_check CHECK (status IN ('ACTIVE', 'HIDDEN'));
CREATE INDEX IF NOT EXISTS shows_org_idx ON shows (org_id, created_at DESC) WHERE org_id IS NOT NULL;

ALTER TABLE episodes
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'PUBLISHED',
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS embed_provider text,
  ADD COLUMN IF NOT EXISTS embed_url text,
  ADD COLUMN IF NOT EXISTS embed_kind text,
  ADD COLUMN IF NOT EXISTS embed_height int,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_status_check;
ALTER TABLE episodes ADD CONSTRAINT episodes_status_check CHECK (status IN ('DRAFT', 'PENDING', 'PUBLISHED', 'REJECTED', 'HIDDEN'));
ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_source_check;
ALTER TABLE episodes ADD CONSTRAINT episodes_source_check CHECK (
  (source = 'upload' AND embed_url IS NULL) OR (source = 'embed' AND embed_url IS NOT NULL AND embed_provider IS NOT NULL AND NOT is_premium)
);
CREATE INDEX IF NOT EXISTS episodes_pending_idx ON episodes (submitted_at) WHERE status = 'PENDING';

-- Upload audio episode & sampul acara: purpose 'podcast' (batas upload.podcast_max_mb, tanpa standar master lagu).
ALTER TABLE uploads DROP CONSTRAINT IF EXISTS uploads_purpose_check;
ALTER TABLE uploads ADD CONSTRAINT uploads_purpose_check CHECK (purpose IN ('release', 'playlist', 'category', 'podcast'));
CREATE INDEX IF NOT EXISTS uploads_user_created_idx ON uploads (user_id, created_at DESC);
