-- PDF FINAL kontrak (job RENDER_FINAL): waktu render. Kolom final_key/final_sha256 sudah ada sejak 002 dan dikunci
-- trigger contracts_immutable setelah terisi (hanya boleh diisi sekali saat kontrak ACTIVE).
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS final_rendered_at timestamptz;

-- Kontrak yang sudah ACTIVE sebelum fitur ini: antrekan render final (idempoten; dilewati bila antrean sudah ada).
INSERT INTO contract_jobs (contract_id, kind)
SELECT id, 'RENDER_FINAL' FROM contracts
 WHERE status = 'ACTIVE' AND final_key IS NULL AND data_snapshot IS NOT NULL
ON CONFLICT DO NOTHING;
