# RAVE — Rolliemonkie Audio Visual Experiment

Platform ekosistem musik DIY & indie Indonesia (streaming, event & tiket, booking off-air).

> Dengar gratis. Datang ke panggungnya. Dukung langsung.

Implementasi platform sesuai **BRD/TDD v2.0**: streaming musik gratis, podcast & audio fiksi, event & tiket, Artist Studio, Promotor Hub (EPK dinamis, kalender anti-bentrok, negosiasi, e-contract, escrow), Back Office, dan panel Super Admin (pengaturan platform tanpa deploy, storage server, backup, event bus, tim admin).
UI mengikuti mockup di `../UI UX`; komponen animasi dari [React Bits](https://reactbits.dev).

## Stack

| Lapisan | Teknologi |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS v4, React Router, TanStack Query, Zustand, React Bits (AnimatedList, Aurora, CodeSlots, CountUp, HoldButton, LogoLoop, PeekRating, SlideCommit, SpotlightCard, StarBorder, StatusMark, Stepper, TearTicket) |
| Backend | Node.js + TypeScript, Fastify, Zod, `@rave/service-kit` |
| Microservices | gateway, iam, catalog, library, playback, booking, finance, ticketing, notification, platform, live, ads |
| Data | PostgreSQL (schema per service), event bus (outbox → Postgres log / Kafka-Redpanda) |
| Infra | Docker Compose (dev & prod), nginx, Caddy (TLS), GitHub Actions CI + rilis image GHCR |

Detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · Kontrak API: [`docs/API.md`](docs/API.md) · Keputusan: [`docs/adr/`](docs/adr)
· Deploy: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) · Go-live: [`docs/GO-LIVE.md`](docs/GO-LIVE.md) · Versi & rilis: [`docs/VERSIONING.md`](docs/VERSIONING.md) · [`CHANGELOG.md`](CHANGELOG.md)

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

## Menjalankan proyek

Ada dua cara menjalankan RAVE. Pilih sesuai kebutuhan:

| Mode | Untuk | Perintah utama | URL |
|---|---|---|---|
| **A. Development lokal** (tanpa Docker) | koding harian, paling ringan | `./rave start` | http://localhost:5173 |
| **B. Production** (Docker, satu host) | staging & server produksi | `npm run prod:up` | `PUBLIC_WEB_URL` (default port 80) |

### Port yang dipakai

| Komponen | Dev lokal (A) | Production (B) |
|---|---|---|
| Web (Vite / nginx) | 5173 | 80 (`WEB_BIND`), atau 80/443 via Caddy |
| API Gateway | 8080 | internal (diakses lewat web `/v1/*`) |
| Service iam … ads | 4001–4011 | internal |
| RTMP ingest (live) | 1935 | 1935 (`LIVE_RTMP_BIND`) |
| PostgreSQL | 55432 (`RAVE_PGPORT`) | 55442 (`DEV_PG_PORT`) | hanya `127.0.0.1:5432` (`PROD_PG_PORT`) |

---

### A. Development lokal (tanpa Docker)

**Prasyarat**

- Node.js ≥ 20.19 (disarankan 22 LTS) + npm.
- PostgreSQL 16+ — cukup binary-nya (`initdb`, `pg_ctl`, `psql`). Skrip mencari di `/usr/lib/postgresql/*/bin`; bila terpasang di lokasi lain, set `PGBIN=/path/ke/bin`.
- Opsional: Chromium untuk PDF kontrak (dicari di `CHROMIUM_PATH` → cache Puppeteer/Playwright → path sistem). ffmpeg sudah dibawa paket `ffmpeg-static` (override dengan `FFMPEG_PATH`).
- Di WSL: simpan data Postgres di filesystem Linux (default `~/.rave/pgdata`), bukan `/mnt/*`.

**Tahapan pertama kali**

```bash
# 1. Pasang dependensi workspace
npm install

# 2. (Opsional) konfigurasi lokal — tanpa .env, service memakai nilai default dev dari .env.example
cp .env.example .env          # ubah RAVE_PGPORT + DATABASE_URL bila port 55432 bentrok

# 3. Jalankan semuanya: Postgres → migrasi → seed demo (bila DB kosong) → 11 service + gateway + web
./rave dev                    # foreground + auto-reload (Ctrl+C untuk berhenti); atau `./rave start` di background

# 4. Cek kesehatan, lalu buka http://localhost:5173 dan login dengan akun demo (lihat di bawah)
./rave status
```

Langkah manual yang setara dengan `./rave start` (berguna untuk debugging):

```bash
npm run db:start      # cluster Postgres milik user di 127.0.0.1:55432 (data di ~/.rave/pgdata)
npm run seed          # migrasi + data demo untuk semua service (idempoten)
npm run dev           # 11 service + gateway (:8080) + web (:5173) di foreground; RTMP di :1935
```

**Perintah harian (`./rave`, alias `scripts/rave.sh`)**

`./rave` memuat `~/.rave/env.sh` (Node & PostgreSQL user-local) dengan sendirinya — tidak perlu `source` manual.

```bash
./rave dev              # foreground, log berwarna di terminal, auto-reload web + service (Ctrl+C untuk berhenti)
./rave start            # sama, di background (seed otomatis bila DB kosong)
./rave status           # cek Postgres, 11 service, gateway, web
./rave logs             # ikuti log (~/.rave/logs/rave.log)
./rave stop             # hentikan service + web (`stop --all` ikut mematikan Postgres)
./rave restart          # stop lalu start
./rave restart-web      # restart Vite saja (jarang perlu — lihat auto-reload)
./rave restart-svc iam  # restart satu service secara manual
./rave seed             # seed ulang data demo (idempoten)
```

`npm start`, `npm stop`, `npm run status` dan `npm run logs` memanggil perintah yang sama.
Reset total DB dev: `./rave stop --all && npm run db:reset && ./rave start`.

**Auto-reload** (aktif pada `./rave dev` dan `./rave start`):

| Bagian | Cara kerja | Pengaturan |
|---|---|---|
| Web (Vite) | HMR; di `/mnt/*` (drvfs WSL, tanpa inotify) otomatis memakai polling 500 ms | `CHOKIDAR_USEPOLLING=false` untuk mematikan polling |
| Service + gateway | `services/<nama>/src` atau `migrations` berubah → service itu di-restart; `packages/*/src` berubah → semua service di-restart | `RAVE_WATCH=0` mematikan, `RAVE_WATCH_INTERVAL=3000` memperlambat polling (ms) |

**Alur kerja pengembangan**

1. Ubah kode → simpan; web & service yang terdampak memuat ulang sendiri (lihat **Auto-reload**).
2. Migrasi baru di service → `npm run migrate` (juga otomatis saat service start).
3. Sebelum commit: `npm run typecheck && npm test`, lalu `npm run e2e:isolated` (lihat [Pengujian](#pengujian)).

---

### B. Production (Docker, satu host)

**Prasyarat server:** Linux dengan Docker Engine 24+ & Compose v2, minimum 4 vCPU / 8 GB RAM, SSD untuk volume `storage`,
port 80/443 (web) dan 1935 (RTMP) terbuka, serta domain yang mengarah ke server. Node.js hanya dibutuhkan untuk
menjalankan skrip `npm run prod:*` (atau panggil `bash scripts/prod.sh …` langsung).

> ⚠️ Sebelum menerima pengguna publik, selesaikan blocker **P0** di [`docs/GO-LIVE.md`](docs/GO-LIVE.md):
> pengiriman OTP (tanpa ini **tidak ada yang bisa login** di produksi), payment gateway nyata (default `sandbox`),
> data legal, dan backup off-site.

**Tahapan deploy pertama**

```bash
# 1. Ambil kode versi rilis
git clone <repo> rave && cd rave && git checkout vX.Y.Z

# 2. Siapkan konfigurasi produksi (JANGAN di-commit)
cp .env.production.example .env.production
#    isi semua nilai WAJIB: RAVE_VERSION, PUBLIC_WEB_URL, POSTGRES_PASSWORD,
#    JWT_SECRET, INTERNAL_SERVICE_SECRET, MEDIA_SIGNING_SECRET, PG_WEBHOOK_SECRET, KYC_KEY
#    buat secret acak per variabel: openssl rand -hex 32
#    KYC_KEY tidak boleh diganti setelah ada data (data KYC terenkripsi dengan kunci ini)

# 3. Validasi — harus lolos tanpa BLOCKER
npm run prod:preflight

# 4. Siapkan image: build di server …
npm run prod:build
#    … atau tarik dari registry hasil CI:  RAVE_REGISTRY=ghcr.io/<org> bash scripts/prod.sh pull

# 5. Jalankan: preflight → up -d → tunggu semua container healthy → smoke test
npm run prod:up
```

Produksi **tidak** memuat data demo — hanya migrasi (seed untuk staging: `RAVE_ALLOW_SEED=1`).
Service juga menolak boot bila memakai secret dev atau `RAVE_FAST_CLOCK=1`.

**HTTPS**

- **Caddy bawaan (Let's Encrypt):** isi `RAVE_DOMAIN`, `ACME_EMAIL`, set `WEB_BIND=127.0.0.1:8081`, lalu `PROFILES=tls npm run prod:up`.
- **TLS di luar** (load balancer / Cloudflare): arahkan ke port `WEB_BIND` (default 80).

**Setelah deploy pertama**

1. Daftar akun Super Admin lewat OTP, lalu promosikan sekali via SQL:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production exec postgres \
     psql -U rave -d rave -c "UPDATE iam.users SET is_admin = true, admin_role = 'SUPER_ADMIN' WHERE email = '<email-anda>'"
   ```
2. Atur Super Admin → Platform → Pengaturan: email dukungan, modul aktif, komisi, kuota storage, jadwal backup.
3. Tutup pendaftaran publik (`general.registrations_open`) atau aktifkan mode pemeliharaan sampai siap launch.
4. Jadwalkan salinan backup ke luar host (cron) — lihat [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#backup--pemulihan).

**Operasional**

```bash
npm run prod:status                     # status container
npm run prod:logs -- gateway            # log satu service (JSON pino)
npm run prod:smoke                      # cek /v1/version, /v1/status (semua sehat, versi seragam), web
npm run prod:down                       # hentikan stack (volume data tetap)
bash scripts/prod.sh rollback 0.1.0     # kembali ke image versi lama (migrasi DB tidak di-rollback)
```

**Update ke versi baru**

1. Mesin rilis: `npm run release -- auto && git push --follow-tags` → CI membangun & mendorong image ke GHCR.
2. Server: `git fetch --tags && git checkout vX.Y.Z`, ubah `RAVE_VERSION` di `.env.production`,
   `bash scripts/prod.sh pull` (atau `npm run prod:build`), lalu `npm run prod:up`. Migrasi berjalan otomatis saat service start.
3. `npm run prod:smoke` harus lolos tanpa `version_drift`. Bila gagal: `bash scripts/prod.sh rollback <versi sebelumnya>`.

Detail topologi, backup & pemulihan, dan skala: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

### Pemecahan masalah umum

| Gejala | Penyebab & solusi |
|---|---|
| `port 55432 sudah dipakai proses lain` | Set `RAVE_PGPORT` dan `DATABASE_URL` di `.env` ke port lain. |
| `PostgreSQL tidak ditemukan` | Pastikan `~/.rave/env.sh` ada (dimuat otomatis oleh `./rave`) atau set `PGBIN` ke folder berisi `initdb`/`pg_ctl`. |
| Perubahan web/service tidak muncul | Pastikan dijalankan lewat `./rave dev`/`./rave start` (polling aktif otomatis di `/mnt/*`); darurat: `./rave restart-web` / `./rave restart-svc <nama>`. |
| CPU tinggi saat idle | Polling di drvfs — naikkan `RAVE_WATCH_INTERVAL` atau set `RAVE_WATCH=0`. |
| Login ditolak setelah banyak percobaan | Batas OTP 5 permintaan / 15 menit per email; tunggu atau hapus `iam.otp_codes` di DB dev. |
| PDF kontrak gagal dibuat | Chromium tidak ditemukan — pasang Chromium atau set `CHROMIUM_PATH`. |
| `prod:preflight` gagal | Ikuti pesan BLOCKER: secret kosong/terlalu pendek/sama dengan nilai dev, password DB lemah, `PUBLIC_WEB_URL` belum diisi. |
| Smoke test `version_drift` | Ada container dengan image versi lain — samakan `RAVE_VERSION` lalu `npm run prod:up`. |

## Versi & rilis

Satu versi SemVer untuk seluruh platform (`package.json` root). `npm run release:dry` untuk pratinjau,
`npm run release -- auto` lalu `git push --follow-tags` untuk merilis (image GHCR + GitHub Release otomatis).
Versi berjalan: `GET /v1/version`. Lihat [`docs/VERSIONING.md`](docs/VERSIONING.md).

## Panduan demo

### Akun demo

Login memakai OTP email; di mode development kode OTP ditampilkan di layar login (tombol akun demo tersedia).

| Email | Peran | Untuk mencoba |
|---|---|---|
| `fan@rave.id` | Fan (Bandung) | streaming, playlist, lirik, beli tiket, QR tiket |
| `premium@rave.id` | Fan **Premium** (Yogyakarta) | AAC 320 & Lossless (FLAC), tanpa iklan |
| `artis@rave.id` | Artis — Senja Kolektif | Artist Studio: rilis, split, analitik, EPK |
| `manajer@rave.id` | Manajemen — Nada Manajemen | inbox booking, offer, kontrak, kalender, wallet |
| `promotor@rave.id` | Promotor — Pensi Nusantara (KYC ✓) | cari artis, inquiry, bayar escrow, event & check-in |
| `admin@rave.id` | Admin (Operasional) | QC rilis, KYC, dispute, rekonsiliasi ledger, audit; panel Platform hanya-baca |
| `superadmin@rave.id` | **Super Admin** | semua Back Office + `/admin/platform`: dasbor platform, pengaturan, storage server, backup, event bus, tim admin |

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
5. Kedua pihak "Show Done" → dana escrow dicairkan ke wallet artis (dipotong komisi & PPh) → SETTLED. `RAVE_FAST_CLOCK` (aktif di dev) mempercepat jendela waktu.

## Pengujian

```bash
npm run typecheck     # backend
npm test              # unit test domain & booking (vitest)
npm run e2e           # 190 skenario end-to-end terhadap stack yang sedang jalan (menulis data uji ke DB dev!)
npm run e2e:isolated  # sama, tetapi di stack terpisah: DB rave_test baru, port +1000 (atur E2E_PORT_OFFSET), storage sementara — aman saat aplikasi dipakai lewat gateway
npm run build -w @rave/web
```

Catatan: OTP dibatasi 5 permintaan / 15 menit per alamat. Bila `npm run e2e` dijalankan berulang dan login ditolak, tunggu atau hapus `iam.otp_codes` di DB dev.

## Status terhadap roadmap BRD

Tercakup: Fase 0 (landing, waitlist, IAM), Fase 1 (streaming, lirik, playlist, pencarian, Artist Studio, EPK, rate card, kalender, inquiry), sebagian besar Fase 2 (escrow & split, e-contract, KYC, rating dua arah, dispute, ticketing + check-in) dan katalog podcast/fiksi premium dari Fase 3.

Belum: aplikasi mobile (Flutter) & desktop (Tauri) — rencana di [`docs/CLIENT-APPS.md`](docs/CLIENT-APPS.md) — check-in offline, integrasi vendor nyata (payment gateway, PSrE/e-meterai, KYC, multi-DRM, WhatsApp/email/push), transcoding HLS/DASH, perhitungan & statement royalti bulanan, langganan Premium/Pro (billing), merchandise, rekomendasi ML, SSR untuk halaman SEO, Temporal untuk saga. Lihat tabel deviasi di `docs/ARCHITECTURE.md` §5.
