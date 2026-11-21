-- RAVE Pro: status langganan org (proyeksi event finance.pro.changed) & take rate yang dikunci per booking saat kontrak dibuat.
-- Booking sebelum kontrak memakai tarif terkini; setelah kontrak, tarif di kontrak berlaku sampai pencairan.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS pro_plan text;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS pro_until timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS commission_promotor_pct numeric(5,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS commission_artist_pct numeric(5,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS commission_pro jsonb;
