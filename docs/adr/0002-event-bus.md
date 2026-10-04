# ADR-0002: Outbox + event bus dengan dua driver

- Status: Diterima — 2026-10-04
- Konteks: TDD memakai Kafka/Redpanda. Lingkungan dev tidak selalu punya Docker.
- Keputusan: Semua event ditulis ke tabel `outbox` milik service di transaksi domain. Relay memublikasikan ke driver:
  - `pg` (default lokal): log append-only `bus.events` + `LISTEN/NOTIFY`; offset per consumer group di `bus.consumer_offsets` dan efek handler di-commit dalam transaksi yang sama (exactly-once dalam DB). Gagal → `bus.dead_letters`.
  - `kafka`: kafkajs producer idempoten; konsumen dedupe via `processed_events`.
- Konsekuensi: Kode domain tidak bergantung pada broker. Replay (royalti, read model) mungkin di kedua driver.
