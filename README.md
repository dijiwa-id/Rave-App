# GEMA — Platform Ekosistem Musik Indie & Off-Air

> Dengar gratis. Datang ke panggungnya. Dukung langsung.

Implementasi platform sesuai **GEMA_BRD_TDD_v2.0**: streaming musik gratis, podcast & audio fiksi, event & tiket, Artist Studio, Promotor Hub (EPK dinamis, kalender anti-bentrok, negosiasi, e-contract, escrow), dan Back Office.
UI mengikuti mockup di `../UI UX`; komponen animasi dari [React Bits](https://reactbits.dev).

## Stack

| Lapisan | Teknologi |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS v4, React Router, TanStack Query, Zustand, React Bits (Aurora, BlurText, RotatingText, LogoLoop, CountUp, SpotlightCard, TiltedCard, Stepper, CodeSlots, SlideCommit, HoldButton, PeekRating, TearTicket, AnimatedList, StatusMark, …) |
| Backend | Node.js + TypeScript, Fastify, Zod, `@gema/service-kit` |
| Microservices | gateway, iam, catalog, library, playback, booking, finance, ticketing, notification |
| Data | PostgreSQL (schema per service), event bus (outbox → Postgres log / Kafka-Redpanda) |
| Infra | Docker Compose, Dockerfile generik per service, GitHub Actions CI |

Detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · Kontrak API: [`docs/API.md`](docs/API.md) · Keputusan: [`docs/adr/`](docs/adr).

## Struktur

```
apps/web/            React app: landing, fan app (/app), Artist Studio (/studio), Promotor Hub (/promotor), Back Office (/admin)
services/gateway     API Gateway :8080 (routing, JWT di tepi, rate limit)
services/iam         :4001 akun, OTP, sesi, org & peran, KYC, consent, waitlist
services/catalog     :4002 artis, rilis, lagu, split hak, lirik, podcast/fiksi, pencarian, QC
services/library     :4003 like, follow, playlist, riwayat
services/playback    :4004 sesi & URL bertanda tangan, play events, qualified stream, anti-fraud, analitik
services/booking     :4005 EPK, rate card, kalender, inquiry/negosiasi, kontrak, rating, dispute
services/finance     :4006 invoice, webhook PG, ledger double-entry, escrow, wallet, payout, rekonsiliasi
services/ticketing   :4007 event, inventori atomik, order, e-ticket QR berputar, check-in
services/notification :4008 inbox in-app, preferensi, antrean push/email/WA
packages/service-kit bootstrap service bersama (DB, migrasi, auth, outbox/bus, idempotensi, audit, error RFC 9457)
packages/domain      aturan bisnis murni + unit test (state machine booking, pembatalan, split, ledger, QR, Audience Match, UCPS)
```

## Menjalankan (lokal, tanpa Docker)

Prasyarat: Node.js ≥ 20.19, PostgreSQL 16+ terpasang (binary `initdb`/`pg_ctl`).

```bash
npm install
npm run db:start      # cluster Postgres milik user di 127.0.0.1:55432 (data di ~/.gema/pgdata)
npm run seed          # migrasi + data demo untuk semua service
npm run dev           # 8 service + gateway (:8080) + web (:5173)
```

Buka http://localhost:5173. Dengan Docker: `docker compose up -d postgres redpanda` lalu set `BUS_DRIVER=kafka`, atau `docker compose up --build` untuk semuanya.

### Akun demo

Login memakai OTP email; di mode development kode OTP ditampilkan di layar login (tombol akun demo tersedia).

| Email | Peran | Untuk mencoba |
|---|---|---|
| `fan@gema.id` | Fan (Bandung) | streaming, playlist, lirik, beli tiket, QR tiket |
| `artis@gema.id` | Artis — Senja Kolektif | Artist Studio: rilis, split, analitik, EPK |
| `manajer@gema.id` | Manajemen — Nada Manajemen | inbox booking, offer, kontrak, kalender, wallet |
| `promotor@gema.id` | Promotor — Pensi Nusantara (KYC ✓) | cari artis, inquiry, bayar escrow, event & check-in |
| `admin@gema.id` | Admin | QC rilis, KYC, dispute, rekonsiliasi ledger, audit |

### Alur demo booking off-air
1. **Promotor** → Cari Artis → Senja Kolektif → kirim inquiry (hold 72 jam).
2. **Manajer** → Inbox Booking → kirim offer. **Promotor** → terima → kontrak otomatis terbit.
3. Kedua pihak tanda tangan (tahan tombol) → invoice DP & pelunasan terbit.
4. **Promotor** → Pembayaran → geser untuk bayar (PG sandbox) → status BOOKED, kontak dibuka → bayar pelunasan.
5. Kedua pihak "Show Done" → dana escrow dicairkan ke wallet artis (dipotong komisi & PPh) → SETTLED. `GEMA_FAST_CLOCK` (aktif di dev) mempercepat jendela waktu.

## Pengujian

```bash
npm run typecheck     # backend
npm test              # unit test domain & booking (vitest)
npm run e2e           # 50 skenario end-to-end lewat gateway (butuh `npm run dev:services`)
npm run build -w @gema/web
```

Catatan: OTP dibatasi 5 permintaan / 15 menit per alamat. Bila `npm run e2e` dijalankan berulang dan login ditolak, tunggu atau hapus `iam.otp_codes` di DB dev.

## Status terhadap roadmap BRD

Tercakup: Fase 0 (landing, waitlist, IAM), Fase 1 (streaming, lirik, playlist, pencarian, Artist Studio, EPK, rate card, kalender, inquiry), sebagian besar Fase 2 (escrow & split, e-contract, KYC, rating dua arah, dispute, ticketing + check-in) dan katalog podcast/fiksi premium dari Fase 3.

Belum: aplikasi mobile React Native & check-in offline, integrasi vendor nyata (payment gateway, PSrE/e-meterai, KYC, multi-DRM, WhatsApp/email/push), transcoding HLS/DASH, perhitungan & statement royalti bulanan, langganan Premium/Pro (billing), merchandise, rekomendasi ML, SSR untuk halaman SEO, Temporal untuk saga. Lihat tabel deviasi di `docs/ARCHITECTURE.md` §5.
