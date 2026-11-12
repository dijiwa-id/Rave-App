-- Tautan sosial & streaming artis (Instagram, TikTok, YouTube, Spotify, Apple Music, situs web, …) dari Artist Studio →
-- Profil artis. Format: [{"platform": "instagram", "url": "https://instagram.com/…"}], maks. 8, divalidasi di service
-- (https saja, host sesuai platform). Ditampilkan sebagai tombol ikon di halaman artis publik.
ALTER TABLE artists ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '[]'::jsonb;
