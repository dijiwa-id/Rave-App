-- Indeks performa: rentang waktu impresi (overview/retensi) & frekuensi per pengguna per kampanye.
CREATE INDEX IF NOT EXISTS impressions_served_brin ON impressions USING brin (served_at);
CREATE INDEX IF NOT EXISTS impressions_user_campaign_idx ON impressions (user_id, campaign_id, served_at);
