-- RAVE Pro: proyeksi status langganan org dari finance (event finance.pro.changed) — untuk /v1/me (badge & gating di klien)
-- dan batas roster multi-roster manajemen/label. Sumber kebenaran tetap finance.pro_subscriptions.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS pro_plan text;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS pro_status text;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS pro_until timestamptz;
