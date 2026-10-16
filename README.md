# GEMA — Platform Ekosistem Musik Indie & Off-Air

> Dengar gratis. Datang ke panggungnya. Dukung langsung.

Implementasi platform sesuai **GEMA_BRD_TDD_v2.0**: streaming musik gratis, podcast & audio fiksi, event & tiket, Artist Studio, Promotor Hub (EPK dinamis, kalender anti-bentrok, negosiasi, e-contract, escrow), Back Office, dan panel Super Admin (pengaturan platform tanpa deploy, storage server, backup, event bus, tim admin).
UI mengikuti mockup di `../UI UX`; komponen animasi dari [React Bits](https://reactbits.dev).

## Stack

| Lapisan | Teknologi |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS v4, React Router, TanStack Query, Zustand, React Bits (AnimatedList, Aurora, CodeSlots, CountUp, HoldButton, LogoLoop, PeekRating, SlideCommit, SpotlightCard, StarBorder, StatusMark, Stepper, TearTicket) |
| Backend | Node.js + TypeScript, Fastify, Zod, `@gema/service-kit` |
| Microservices | gateway, iam, catalog, library, playback, booking, finance, ticketing, notification, platform, live, ads |
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
services/ads         :4011 iklan tier Gratis: keputusan jeda (kebijakan), kampanye & peninjauan, simulator
services/live        :4010 live streaming: ingest RTMP :1935 (OBS/Larix) & browser → ffmpeg → HLS, chat, penonton, akses tiket
services/platform    :4009 Super Admin: pengaturan platform (feature flag, komisi, keamanan, retensi), storage, backup pg_dump, event bus
packages/service-kit bootstrap service bersama (DB, migrasi, auth, outbox/bus, idempotensi, audit, error RFC 9457)
packages/domain      aturan bisnis murni + unit test (state machine booking, pembatalan, split, ledger, QR, Audience Match, UCPS)
```

## Menjalankan (lokal, tanpa Docker)

Prasyarat: Node.js ≥ 20.19, PostgreSQL 16+ terpasang (binary `initdb`/`pg_ctl`).

```bash
npm install
npm run db:start      # cluster Postgres milik user di 127.0.0.1:55432 (data di ~/.gema/pgdata)
npm run seed          # migrasi + data demo untuk semua service
npm run dev           # 11 service + gateway (:8080) + web (:5173); RTMP ingest di :1935
```

Atau dengan satu perintah (`scripts/gema.sh`, pintasan `./gema`):

```bash
./gema start            # Postgres → migrasi (seed otomatis bila DB kosong) → semua service + web di background
./gema status           # cek Postgres, 11 service, gateway, web
./gema logs             # ikuti log (~/.gema/logs/gema.log)
./gema stop             # hentikan service + web (`stop --all` ikut mematikan Postgres)
./gema restart          # stop lalu start
./gema dev              # seperti start, tetapi di foreground (Ctrl+C untuk berhenti)
./gema restart-web      # restart Vite saja — di /mnt/* Vite tidak hot-reload
./gema restart-svc iam  # restart satu service setelah mengedit kodenya
./gema seed             # seed ulang data demo (idempoten)
```

`npm start`, `npm stop`, `npm run status` dan `npm run logs` memanggil perintah yang sama.

Buka http://localhost:5173. Dengan Docker: `docker compose up -d postgres redpanda` lalu set `BUS_DRIVER=kafka`, atau `docker compose up --build` untuk semuanya.

### Akun demo

Login memakai OTP email; di mode development kode OTP ditampilkan di layar login (tombol akun demo tersedia).

| Email | Peran | Untuk mencoba |
|---|---|---|
| `fan@gema.id` | Fan (Bandung) | streaming, playlist, lirik, beli tiket, QR tiket |
| `artis@gema.id` | Artis — Senja Kolektif | Artist Studio: rilis, split, analitik, EPK |
| `manajer@gema.id` | Manajemen — Nada Manajemen | inbox booking, offer, kontrak, kalender, wallet |
| `promotor@gema.id` | Promotor — Pensi Nusantara (KYC ✓) | cari artis, inquiry, bayar escrow, event & check-in |
| `admin@gema.id` | Admin (Operasional) | QC rilis, KYC, dispute, rekonsiliasi ledger, audit; panel Platform hanya-baca |
| `superadmin@gema.id` | **Super Admin** | semua Back Office + `/admin/platform`: dasbor platform, pengaturan, storage server, backup, event bus, tim admin |

### Panel Super Admin (`/admin/platform`)
- **Dasbor Platform** — KPI lintas service, kesehatan & metrik tiap service, peringatan (disk, dead letter, backup, maintenance), ringkasan storage & event bus.
- **Pengaturan** — registri `packages/domain/src/settings.ts`: umum & pengumuman, mode pemeliharaan, feature flag modul, komisi, parameter booking, streaming/anti-fraud, keamanan (OTP, rate limit), storage & retensi. Setiap perubahan wajib alasan, tercatat di riwayat & audit log, dan diterapkan ke semua service tanpa restart (event `platform.settings.updated`; gateway LISTEN + polling 30 dtk).
- **Storage** — disk server, bucket `uploads`/`backups` (kuota, jenis file, file browser, unduh/hapus), file yatim (scan & bersihkan), ukuran database per schema & tabel terbesar, log event bus, perawatan (`prune_bus`, `prune_idempotency`, `VACUUM ANALYZE`, snapshot), tren pemakaian.
- **Branding & Tema** (di Pengaturan) — unggah logo latar terang/gelap dan ikon/favicon (SVG atau PNG; SVG disaring dari skrip & tautan eksternal), plus tema dasbor terang/gelap/ikuti sistem dan izin pengguna memilih tema sendiri. Logo & ikon langsung dipakai di landing, login, aplikasi dengar, semua dasbor, dan favicon.
- **Backup** — `pg_dump` + gzip + sha256 ke `storage/backups`, terjadwal (interval/retensi dari pengaturan) atau manual; unduh & hapus.
- **Event Bus** — topik, lag consumer group, dead letter (retry/hapus). **Tim Admin** — atur peran admin & tangguhkan akun.

Admin non-super dapat melihat semua halaman platform tetapi tidak dapat mengubah apa pun.

### Iklan (tier Gratis)
Super Admin → **Iklan** (`/admin/ads`): ringkasan (impresi, fill rate, CTR, alasan jeda tidak tayang), kampanye dengan alur **tinjauan empat mata**, matriks kategori, dan **simulator kebijakan**. Parameter (jeda minimum, ad load per jam, masa bebas iklan harian, frequency cap, kapan bisa dilewati, kategori terbatas yang diblokir, pre-roll podcast, keamanan merek) diatur di Pengaturan → Iklan.
Aturan tetap (kepatuhan): Premium bebas iklan; iklan hanya di antara lagu; label "Iklan" wajib (EPI); penargetan kota hanya dengan persetujuan (UU PDP); kategori terlarang selalu ditolak; kategori terbatas wajib nomor izin (OJK/BPOM/Bappebti).

### Live streaming
- **Fan:** menu **Live** (titik merah bila ada yang siaran) → tonton (`/app/live/:id`) dengan chat. Kanal demo *Senja Kolektif — Live Session* selalu siaran (sinyal uji server; matikan di Pengaturan → Live Streaming → Kanal demo).
- **Artis/Promotor:** Studio/Promotor Hub → **Live** → *Buat siaran* → siarkan dari **OBS** (Server `rtmp://localhost:1935/live`, Stream Key ditampilkan sekali) atau **langsung dari browser** (kamera & mikrofon). Panel kesehatan menampilkan transcoder, bitrate, dan umur segmen.
- **Siaran bertiket:** akses `TICKET` terkait event ticketing — hanya pemegang tiket yang bisa menonton.
- **Stabilitas:** putus sinyal → `INTERRUPTED` dan otomatis tersambung lagi dalam masa tunggu (default 90 dtk); transcoder ffmpeg diawasi & di-restart otomatis; pemutar hls.js memulihkan error jaringan/media sendiri; token pemutaran berotasi tanpa memutus video.
- ffmpeg berasal dari paket `ffmpeg-static` (atau `FFMPEG_PATH`).

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
npm run e2e           # 127 skenario end-to-end terhadap stack yang sedang jalan (menulis data uji ke DB dev!)
npm run e2e:isolated  # sama, tetapi di stack terpisah: DB gema_test baru, port +1000, storage sementara — aman saat aplikasi dipakai lewat gateway (butuh `npm run dev:services`)
npm run build -w @gema/web
```

Catatan: OTP dibatasi 5 permintaan / 15 menit per alamat. Bila `npm run e2e` dijalankan berulang dan login ditolak, tunggu atau hapus `iam.otp_codes` di DB dev.

## Status terhadap roadmap BRD

Tercakup: Fase 0 (landing, waitlist, IAM), Fase 1 (streaming, lirik, playlist, pencarian, Artist Studio, EPK, rate card, kalender, inquiry), sebagian besar Fase 2 (escrow & split, e-contract, KYC, rating dua arah, dispute, ticketing + check-in) dan katalog podcast/fiksi premium dari Fase 3.

Belum: aplikasi mobile React Native & check-in offline, integrasi vendor nyata (payment gateway, PSrE/e-meterai, KYC, multi-DRM, WhatsApp/email/push), transcoding HLS/DASH, perhitungan & statement royalti bulanan, langganan Premium/Pro (billing), merchandise, rekomendasi ML, SSR untuk halaman SEO, Temporal untuk saga. Lihat tabel deviasi di `docs/ARCHITECTURE.md` §5.
