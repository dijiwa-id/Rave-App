-- Nomor urut kode desainasi ISRC untuk rekaman yang ISRC-nya didaftarkan RAVE (REQ-STU-01).
-- Mulai 10000 agar tidak bertabrakan dengan katalog impor/seed.
CREATE SEQUENCE IF NOT EXISTS isrc_seq START 10000 MAXVALUE 99999 CYCLE;
