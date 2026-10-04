# ADR-0003: Representasi uang

- Status: Diterima — 2026-10-04
- Konteks: TDD §11.1: BIGINT sen Rupiah atau NUMERIC(18,2), tidak pernah float.
- Keputusan: BIGINT **rupiah utuh** di DB & API (`fee`, `amount`, `price`). Persentase dihitung dengan basis poin integer; alokasi split memakai largest remainder (`allocate`) sehingga total selalu tepat; ledger menolak transaksi tidak seimbang (`assertBalanced`).
- Konsekuensi: Tidak ada konversi ×100 di UI. Jika kelak perlu sen (mis. multi-mata uang), migrasi expand-contract ke kolom `amount_minor`.
