-- Ruang berita RAVE (/berita) dikelola dari Back Office → Konten → Berita (izin news.publish).
-- Teks dwibahasa disimpan per bahasa di `content` ({ id: {...}, en: {...} }); Bahasa Indonesia wajib, Inggris opsional
-- (fallback ke Indonesia). Status: draft → published (published_at ≤ now() tayang; > now() = terjadwal) → archived.
CREATE TABLE IF NOT EXISTS news_articles (
  id           uuid PRIMARY KEY,
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 120),
  category     text NOT NULL CHECK (category IN ('Rilis', 'Scene', 'Produk', 'Event', 'Wawancara')),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  content      jsonb NOT NULL,
  image_url    text,
  author       text NOT NULL,
  featured     boolean NOT NULL DEFAULT false,
  read_min     int NOT NULL DEFAULT 1,
  published_at timestamptz,
  created_by   text,
  updated_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS news_articles_public_idx ON news_articles (published_at DESC) WHERE status = 'published';
-- Paling banyak satu cerita utama.
CREATE UNIQUE INDEX IF NOT EXISTS news_articles_one_featured ON news_articles (featured) WHERE featured;
