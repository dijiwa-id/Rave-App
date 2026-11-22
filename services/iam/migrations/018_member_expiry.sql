-- S1 (P-7): masa Premium yang berakhir alami diumumkan sekali lewat `iam.user.member_changed` (job `member-expiry`).
-- Penanda = nilai member_until yang sudah diumumkan; perpanjangan oleh Super Admin mengganti member_until sehingga
-- masa berikutnya diumumkan lagi saat berakhir. Kolom nullable tanpa default → instan, tanpa backfill.
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_expiry_announced_until timestamptz;
-- Indeks parsial hanya berisi akun berbayar ber-tanggal yang belum diumumkan (kecil; baris keluar setelah diumumkan).
-- Predikat harus sama persis dengan query job (services/iam/src/member-expiry.ts).
CREATE INDEX IF NOT EXISTS users_member_expiry_due_idx ON users (member_until)
  WHERE member_until IS NOT NULL AND member_type <> 'FREE' AND deleted_at IS NULL
    AND member_expiry_announced_until IS DISTINCT FROM member_until;
