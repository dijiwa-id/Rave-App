-- Satu verifikasi: verifikasi akun kini sekaligus KYC identitas (NIK). NIK disimpan terenkripsi AES-256-GCM di profil
-- (dipakai saat pengajuan & KYB organisasi); hanya versi tersamar yang dikirim ke klien.
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_number_enc text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_number_masked text;
