# Arsitektur RAVE — Implementasi v0.1

Acuan: **BRD/TDD v2.0** (Bab 9–11). Dokumen ini mencatat bagaimana desain di TDD diwujudkan di repositori ini, dan di mana implementasi saat ini sengaja berbeda (dengan alasan + jalur migrasi).

## 1. Gambaran

```
                    ┌────────────────────────────────────────────┐
  Browser ──HTTPS──▶│ apps/web (React 19 + Vite + React Bits)     │
                    │  Landing · Fan App · Studio · Promotor · BO │
                    └───────────────┬────────────────────────────┘
                                    │ /v1/*
                    ┌───────────────▼────────────────┐
                    │ services/gateway  :8080         │  JWT verify di tepi, rate limit,
                    │ (Fastify + http-proxy)          │  request-id, blokir /internal/*
                    └───┬────┬────┬────┬────┬────┬───┘
        ┌───────────────┘    │    │    │    │    └──────────────────┐
   ┌────▼───┐ ┌──────┐ ┌─────▼──┐ ┌▼───────┐ ┌▼───────┐ ┌────────┐ ┌▼──────────┐ ┌────────────┐
   │ iam    │ │catalog│ │library │ │playback│ │booking │ │finance │ │ticketing  │ │notification│
   │ :4001  │ │ :4002 │ │ :4003  │ │ :4004  │ │ :4005  │ │ :4006  │ │ :4007     │ │ :4008      │
   └───┬────┘ └───┬───┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └────┬──────┘ └────┬───────┘
       │ outbox   │         │          │          │          │           │             │
       └──────────┴─────────┴────┬─────┴──────────┴──────────┴───────────┴─────────────┘
                                 ▼
                   Event bus: Kafka/Redpanda (prod) │ Postgres log `bus.events` (lokal)
                                 │
                   PostgreSQL — satu schema per service (iam, catalog, library, playback,
                                booking, finance, ticketing, notify) + schema `bus`
```

## 2. Prinsip TDD §10.1 → implementasi

| Prinsip | Implementasi |
|---|---|
| Pisahkan lalu lintas konsumen & transaksi | `playback` (media plane) dan `finance` adalah service terpisah dengan pool DB sendiri; lonjakan streaming tidak menyentuh booking/finance. |
| Modular monolith → microservices | Atas permintaan proyek, langsung **microservices** dengan bounded context TDD §10.3. Risiko kompleksitas (§17) dimitigasi dengan `@rave/service-kit` (bootstrap seragam) & satu monorepo. |
| Event-driven, outbox | Setiap service menulis event ke tabel `outbox` di transaksi domain yang sama (`publish(tx, …)`); relay memublikasikan ke bus. Konsumen idempoten (offset transaksional di driver pg; tabel `processed_events` di driver Kafka). Event gagal → `bus.dead_letters`. |
| Uang & kontrak adalah kode | State machine booking, matriks pembatalan, alokasi split, ledger double-entry ada di `packages/domain` (murni, ter-unit-test). Bukan di n8n. |
| TypeScript end-to-end | Backend, frontend, domain bersama. Kontrak API: `docs/API.md` (langkah berikut: OpenAPI 3.1 ter-generate). |
| Secure by design | JWT 15 mnt + refresh berotasi (deteksi reuse), RBAC + ABAC kepemilikan org, Idempotency-Key, audit log append-only (trigger), enkripsi kolom KYC, URL stream bertanda tangan HMAC, webhook PG ber-HMAC, rate limit di gateway. |

## 3. Bounded context (TDD §10.3)

| Service | Tanggung jawab | Data | Event keluar |
|---|---|---|---|
| iam | Akun, OTP, sesi, org & peran, KYC, consent, waitlist | `iam` | `iam.user.*`, `iam.org.*`, `iam.kyc.verified`, `iam.waitlist.joined` |
| catalog | Artis, rilis, lagu, split hak, lirik, podcast/fiksi, pencarian (pg_trgm), QC | `catalog` | `catalog.release.*`, `catalog.artist.upserted` |
| library | Like, follow, playlist (fractional index), riwayat | `library` | `library.*` |
| playback | Entitlement, sesi & URL bertanda tangan, play events, qualified stream, fraud dasar, analitik agregat | `playback` | `playback.stream.qualified` |
| booking | EPK dinamis, rate card, kalender (exclusion constraint), inquiry/negosiasi, kontrak, rating, dispute | `booking` | `booking.*` |
| finance | Invoice, webhook PG, ledger double-entry, escrow hold/release, wallet, payout, rekonsiliasi | `finance` (SERIALIZABLE) | `finance.*` |
| ticketing | Event, inventori atomik, order + reservasi 10 mnt, e-ticket QR berputar, check-in | `ticketing` | `ticketing.*` |
| notification | Inbox in-app, preferensi, antrean push/email/WA | `notify` | – |

Komunikasi sinkron antar-service dibatasi (`callService`, token role `service`, endpoint `/internal/*` yang diblokir gateway): katalog → playback (entitlement), library → katalog (hidrasi), booking → playback (statistik EPK), ticketing → finance (invoice).

## 4. Saga booking (TDD §7.1, §10.6)

```
promotor ──inquiry──▶ booking[INQUIRY] ──offer/counter──▶ [NEGOTIATING] ──accept──▶ [AGREED]
   ──sistem: kontrak booking-v1 + sha256──▶ [CONTRACT_SENT] ──tanda tangan semua pihak──▶ [SIGNED]
        └─ event booking.contract.signed ─▶ finance: invoice DP & pelunasan
promotor bayar ─▶ PG webhook (HMAC, idempoten) ─▶ ledger escrow_hold ─▶ finance.payment.succeeded
   ─▶ booking [BOOKED] (kontak dibuka) ─▶ pelunasan ─▶ [BOOKED_AND_SECURED] ─▶ hari-H [SHOW_DAY]
   ─▶ show-done kedua pihak ─▶ [COMPLETED] ─▶ booking.completed ─▶ finance: release split − komisi − PPh
   ─▶ finance.escrow.released ─▶ booking [SETTLED]
```

Kalender dijaga **exclusion constraint** PostgreSQL (`btree_gist`) sehingga dua status eksklusif tidak pernah tumpang tindih, bahkan dalam race condition.

## 5. Deviasi yang disengaja (MVP) & jalur migrasi

| TDD | Saat ini | Alasan | Migrasi |
|---|---|---|---|
| Next.js (SSR/ISR) untuk web | React + Vite SPA | Permintaan stack "React"; satu app untuk semua permukaan | Pindahkan `pages/public` (landing, `/a/:slug`, `/e/:slug`) ke Next.js App Router untuk SEO (REQ-WEB-03); fan app & dasbor tetap SPA. |
| NestJS | Fastify + Zod via `service-kit` | Lebih ringan per microservice; TDD sendiri menyebut adapter Fastify & Zod | Dapat dibungkus NestJS per service bila tim membutuhkan DI/decorator. |
| Kafka/Redpanda | Driver `pg` (bus.events + LISTEN/NOTIFY) default lokal; driver `kafka` tersedia (`BUS_DRIVER=kafka`) | Tanpa Docker di mesin dev | `docker compose up` menyalakan Redpanda; set `BUS_DRIVER=kafka`. |
| Temporal (saga) | State machine di DB + job berkala + event | Infrastruktur minimal | Pindahkan transisi berbasis waktu (hold, H-7, H+1) ke workflow Temporal; aturan domain tetap di `packages/domain`. |
| MongoDB (katalog) | PostgreSQL JSONB | Keputusan terbuka D-06 — satu DB relasional untuk MVP | – |
| ClickHouse | Tabel agregat harian di schema `playback` | Volume demo | Event `playback.*` ke Kafka → ClickHouse materialized views. |
| OpenSearch | `pg_trgm` | Volume demo | Indexer konsumen event katalog. |
| HLS/DASH + multi-DRM | Redirect bertanda tangan ke file MP3 demo | Belum ada vendor DRM (§11.9) | Pipeline transcoding (FFmpeg/Shaka Packager) + license proxy di `playback`. |
| PG, PSrE, KYC, WA | Adapter sandbox/mock | Vendor belum dipilih (Bab 18) | Implementasi adapter per provider di service terkait. |
| Uang BIGINT sen | BIGINT rupiah utuh | IDR tidak memakai pecahan; mengurangi bug konversi ×100 | Lihat `docs/adr/0003-money.md`. |
| Mobile (Flutter) & Desktop (Tauri) & Check-in app | Belum; check-in tersedia di web Promotor Hub | Fokus Fase 0–1 web; teknologi klien diputuskan ulang 2026-11-11 (React Native → Flutter, tambah Tauri) | Rencana & prasyarat backend: `docs/CLIENT-APPS.md` |

## 6. Menjalankan beberapa replika per service

Semua service boleh dijalankan >1 replika di belakang load balancer biasa — **sticky session tidak diperlukan**.

| Aspek | Mekanisme |
|---|---|
| Identitas | `INSTANCE_ID` (`host-pid-acak`, bisa di-override env) muncul di log (`instance`) dan `GET /internal/stats`. |
| Pengaturan platform | `applyChanges` mengirim `pg_notify('rave_settings', versi)` di transaksi yang sama; **setiap** replika (termasuk platform & gateway) LISTEN dan me-refresh ≤ ~1 dtk. Event `platform.settings.updated` (consumer group → satu replika per service) & refresh berkala (60 dtk service, 30 dtk gateway) tetap ada sebagai jaring pengaman; snapshot berversi sehingga jalur yang datang belakangan tidak menimpa versi lebih baru. |
| Event bus | Driver `pg`: consumer group = nama service, offset dikunci `FOR UPDATE SKIP LOCKED` → tiap event diproses sekali per service. Driver `kafka`: groupId = nama service → Kafka membagi partisi antar-replika; idempotensi via `processed_events`. Relay outbox aman paralel (`SKIP LOCKED`). |
| Rate limit gateway | `RATE_LIMIT_STORE=pg` → hitungan fixed window bersama di tabel UNLOGGED `gateway.rate_limits` (dibuat saat start, satu upsert atomik per permintaan, pool kecil, timeout pendek). DB bermasalah → **fail open** (diizinkan + log warn dibatasi). Default `memory` (per replika, dev). |
| Live | Registri `live.instances` (heartbeat 5 dtk, mati bila > 15 dtk). `streams.owner_instance` = replika yang memegang publisher & transcoder; watchdog hanya mengurus siaran miliknya atau mengambil alih (UPDATE bersyarat) siaran yang pemiliknya mati. `live.max_concurrent` dihitung global di DB. Potongan ingest browser yang mendarat di replika lain diteruskan ke `LIVE_INTERNAL_URL` pemilik (token service) atau 409 bila pemilik mati. Kanal demo hanya di satu replika (kunci advisory sesi `rave.live.demo`). |

Syarat deploy:
- **`LIVE_DIR` harus volume bersama** (NFS/EFS/RWX PVC) untuk semua replika live — segmen HLS ditulis pemilik dan dilayani replika mana pun. (Produksi besar: ganti dengan object storage + CDN.)
- Setiap replika live butuh `LIVE_INTERNAL_URL` yang bisa dijangkau replika lain (mis. IP pod: `http://$(POD_IP):4010`; default `http://127.0.0.1:$LIVE_PORT` hanya cocok untuk satu host) dan port RTMP sendiri bila satu host (`LIVE_RTMP_PORT`). RTMP di belakang LB TCP (L4) cukup; encoder yang menyambung ulang ke replika lain mengambil alih siaran INTERRUPTED.
- Gateway: set `RATE_LIMIT_STORE=pg` (sudah di `docker-compose.prod.yml`).
- Koneksi Postgres per replika ≈ `DB_POOL_MAX` + 1 LISTEN bus + 1 LISTEN pengaturan (+ 5 pool rate limit di gateway, + 1 kunci demo di live). Hitung terhadap `max_connections` (atau pasang PgBouncer mode session untuk koneksi LISTEN).
- Job berkala (`jobs`) berjalan di setiap replika; job yang ada idempoten/aman paralel (kunci baris / `SKIP LOCKED` / UPDATE bersyarat).
