-- Cerita utama: draf boleh ditandai tanpa menggeser cerita utama yang sedang tayang. Keunikan kini hanya berlaku di
-- antara artikel berstatus published (tayang/terjadwal); penanda draf mengambil alih saat artikelnya terbit.
DROP INDEX IF EXISTS news_articles_one_featured;
CREATE UNIQUE INDEX IF NOT EXISTS news_articles_one_featured_live ON news_articles (featured) WHERE featured AND status = 'published';
