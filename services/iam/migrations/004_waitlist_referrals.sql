-- Hitungan referral waitlist per pendaftar (dipanggil di setiap POST /v1/waitlist) tanpa scan seluruh tabel.
CREATE INDEX IF NOT EXISTS waitlist_referred_by_idx ON waitlist (referred_by) WHERE referred_by IS NOT NULL;
