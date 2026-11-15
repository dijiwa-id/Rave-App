-- Login sosial (Google / Facebook / Apple) sebagai jenis integrasi ketiga — kredensial OAuth diatur Super Admin.
ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_kind_check;
ALTER TABLE integrations ADD CONSTRAINT integrations_kind_check CHECK (kind IN ('email', 'payment', 'social'));
