# ADR-0001: Microservices dengan service-kit bersama

- Status: Diterima — 2026-10-04
- Konteks: TDD §10.1 merekomendasikan modular monolith lebih dulu; arahan proyek meminta platform microservices. Tim kecil berisiko terbebani boilerplate & inkonsistensi antar-service (§17).
- Keputusan: Bounded context TDD §10.3 menjadi service terpisah sejak awal, tetapi semuanya dibangun di atas `@gema/service-kit` (bootstrap Fastify, schema DB per service, migrasi, JWT, outbox + bus, idempotensi, audit, error RFC 9457) dan `@gema/domain` (aturan bisnis murni).
- Konsekuensi: + skalabilitas & isolasi beban (playback/finance) sejak hari pertama; + tiap service mudah dibaca karena polanya identik. − Operasional lebih banyak proses; − konsistensi lintas service eventual (dimitigasi outbox + konsumen idempoten).
