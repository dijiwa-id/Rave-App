-- Peran internal back office & penangguhan akun (REQ-ADM-01, docs/API.md §9).
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_role text
  CHECK (admin_role IN ('SUPER_ADMIN','OPS','CONTENT_QC','FINANCE','LEGAL','SUPPORT','EDITORIAL'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
-- Admin lama → Operasional. is_admin tetap disinkronkan: admin_role IS NOT NULL ⇔ is_admin.
UPDATE users SET admin_role = 'OPS' WHERE is_admin AND admin_role IS NULL;
