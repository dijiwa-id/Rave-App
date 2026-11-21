-- Onboarding hanya untuk login pertama: `last_login_at` mencatat sesi login terakhir (bukan refresh token).
-- Akun yang sudah pernah login (punya jejak sesi) tidak dipaksa onboarding lagi walau dulu tidak menyelesaikannya.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

UPDATE users u
   SET last_login_at = r.last_at
  FROM (SELECT user_id, max(created_at) AS last_at FROM refresh_tokens GROUP BY user_id) r
 WHERE r.user_id = u.id AND u.last_login_at IS NULL;

UPDATE users SET onboarded = true, updated_at = now() WHERE onboarded = false AND last_login_at IS NOT NULL;
