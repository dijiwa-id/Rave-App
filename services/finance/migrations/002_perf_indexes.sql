-- Indeks performa: filter akun berprefiks (account LIKE 'x:%') — btree biasa tak dipakai di locale non-C.
CREATE INDEX IF NOT EXISTS ledger_entries_account_prefix_idx ON ledger_entries (account text_pattern_ops);
