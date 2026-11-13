# Rencana Naik Server — VPS `rave.danantrex.my.id`

Status: **rencana** (13 Nov 2026). Melengkapi `docs/DEPLOYMENT.md` (cara deploy Docker) dan `docs/GO-LIVE.md`
(syarat bisnis/vendor). Dokumen ini menjawab: apa yang harus disiapkan agar RAVE berjalan di satu VPS dengan domain
`rave.danantrex.my.id`, dan urutan kerjanya.

## 0. Kondisi saat ini (diperiksa 13 Nov 2026)

| Hal | Temuan |
|---|---|
| DNS | `danantrex.my.id` memakai **Cloudflare** (AAAA 2606:4700:…). Subdomain `rave.danantrex.my.id` **belum punya record**. |
| Stack | Siap Docker: `docker-compose.prod.yml` (12 service + web nginx + Postgres + backup-offsite), profil `tls` (Caddy, Let's Encrypt otomatis). |
| Data | Prod-local (WSL) di `:8088` berisi data uji; dev (`./rave`) berisi data demo/seed — **bukan** untuk produksi. |
| Login | OTP-only. Produksi butuh adapter email/WA (Q-01) — tanpa itu tidak ada yang bisa masuk. |

## 1. Keputusan yang dibutuhkan dari pemilik (sebelum mulai)

1. **Spesifikasi & penyedia VPS** — minimum 4 vCPU / 8 GB RAM / 80 GB SSD (+ ruang unggahan audio; master FLAC ±30–60 MB
   per lagu). Region Jakarta/Singapura. Ubuntu 24.04 LTS.
2. **Cloudflare proxy (oranye) atau DNS-only (abu-abu)** untuk `rave.` — lihat §3. Rekomendasi: mulai **DNS-only**
   (paling sederhana, TLS oleh Caddy), aktifkan proxy setelah stabil.
3. **Data awal**: mulai bersih (migrasi saja, tanpa seed) — rekomendasi — atau memindahkan DB prod-local.
4. **Vendor** yang memblokir go-live publik: email/WA OTP (Q-01), payment gateway Midtrans produksi (Q-02), target backup
   off-site (S3/R2/B2).

## 2. DNS (Cloudflare)

| Record | Nilai | Proxy | Untuk |
|---|---|---|---|
| `A rave` | IP publik VPS | DNS-only dulu | Web + API (`/v1`) via Caddy :443 |
| `AAAA rave` | IPv6 VPS (bila ada) | sama | — |
| `A ingest.rave` | IP publik VPS | **selalu DNS-only** | RTMP :1935 (Cloudflare tidak meneruskan RTMP) |

Bila nanti memakai proxy oranye:
- SSL/TLS mode **Full (strict)**; Caddy tetap menerbitkan sertifikat (HTTP-01 lewat proxy berfungsi selama "Always Use
  HTTPS" tidak memblokir `/.well-known/acme-challenge`) — atau pakai Cloudflare Origin Certificate.
- **Batas unggah 100 MB per request (paket Free/Pro)** → unggah master audio besar akan gagal. Selesaikan dulu unggah
  chunked/resumable (CLIENT-APPS P-6) atau unggah lewat subdomain DNS-only.
- IP klien asli datang di `CF-Connecting-IP`; rantai trusted proxy wajib dibenahi (lihat §5 butir S2).

## 3. Konfigurasi `.env.production` di VPS

```env
PUBLIC_WEB_URL=https://rave.danantrex.my.id
RAVE_DOMAIN=rave.danantrex.my.id
ACME_EMAIL=<email ops>
WEB_BIND=127.0.0.1:8081            # port 80/443 dipegang Caddy
CORS_ORIGINS=                       # + tauri://localhost,http://tauri.localhost bila desktop dirilis
LIVE_RTMP_PUBLIC_URL=rtmp://ingest.rave.danantrex.my.id:1935/live
# secret: openssl rand -hex 32 untuk setiap secret (preflight menolak bawaan dev / duplikat)
```

Webhook Midtrans (dasbor Midtrans): `https://rave.danantrex.my.id/v1/webhooks/pg/midtrans`.

## 4. Langkah naik server

1. **Siapkan VPS**: user non-root + SSH key, nonaktifkan login password, `ufw allow 22,80,443,1935/tcp`, unattended
   upgrades, swap 2–4 GB, Docker Engine + Compose v2, zona waktu `Asia/Jakarta`.
2. **Kode**: `git clone https://github.com/dijiwa-id/Rave-App && git checkout v<versi>` (tag rilis, bukan `main`).
3. **Env**: salin `.env.production.example` → `.env.production`, isi §3 + secret + vendor. `npm run prod:preflight` wajib lolos.
4. **Build & jalan**: `npm run prod:build` lalu `PROFILES=tls npm run prod:up` (preflight → up → tunggu healthy → smoke).
5. **DNS**: buat record §2; tunggu Caddy menerbitkan sertifikat (`npm run prod:logs caddy`).
6. **Verifikasi**: `npm run prod:smoke`, `npm run monitor:prod`, buka `https://rave.danantrex.my.id/healthz`, login OTP,
   putar lagu, beli tiket sandbox, siaran uji OBS ke `ingest.`, `npm run prod:backup` + `prod:backup-verify`.
7. **Akun awal**: buat Super Admin, isi Platform → Legalitas, Integrasi (email/PG), Branding; matikan
   `live.demo_channel`.
8. **Klien**: build APK dengan `--dart-define=RAVE_API=https://rave.danantrex.my.id` lalu ubah
   `network_security_config.xml` → `cleartextTrafficPermitted="false"` (HTTPS saja). Preset "RAVE Cloud" sudah
   ada di build uji 13 Nov.
9. **Rollback**: tag image `rave-*:<versi>-pre`, dump `pg_dump` sebelum setiap deploy (lihat DEPLOYMENT.md §Rollback).

## 5. Wajib sebelum dibuka ke publik (hasil audit 13 Nov 2026)

Keamanan (dari audit keamanan/ops):
- **S1** OTP: kunci akumulatif per tujuan (mis. 10 gagal/24 jam) — kini 25 tebakan/15 mnt/IP tanpa penguncian akun.
- **S2** IP klien: nginx `X-Forwarded-For $remote_addr` / modul `realip` dari Caddy (+ rentang Cloudflare bila proxy),
  `TRUST_PROXY` = hop/IP persis. Tanpa ini rate limit bisa dipalsukan atau semua pengguna berbagi satu bucket.
- **S3** Satu `JWT_SECRET` HS256 di 12 service → pindah ke EdDSA (privat hanya di IAM).
- **S4** Semua container menerima semua secret (`env_file` bersama) → env per service; backup hanya `RCLONE_*`.
- **S5** Semua service memakai superuser Postgres → role per service.
- **S6** Refresh token di `localStorage` → cookie HttpOnly + CSP.
- Matikan webhook PG generik `/v1/webhooks/pg/:provider` di produksi (hanya Midtrans).

Uang & keandalan (dari audit stabilitas):
- Pembayaran DP yang datang setelah invoice FAILED/booking batal → refund otomatis, bukan nyangkut di escrow.
- Urutan event bus lintas topik & dead-letter terlalu cepat (3× < 0,5 dtk) → retry dengan backoff, offset tidak maju.
- Shutdown menunggu job/consumer yang berjalan; klaim ulang job kontrak RUNNING yang basi.
- Kunci wallet pada penagihan denda artis; batas tiket per akun di bawah advisory lock.

Performa:
- Checkout tiket p95 690–840 ms → pool `DB_POOL_MAX` per service (ticketing 20, finance 15), kurangi pengambilan
  koneksi per order 4→2, kunci baris `ticket_types` di akhir transaksi, insert tiket batch.
- Postgres: `shared_buffers` ±25% RAM, aktifkan `pg_stat_statements`, indeks yang diusulkan audit.

Sudah diperbaiki 13 Nov: input buruk Postgres (kelas 22, FK/check) → 400/409 bukan 500; timeout header upstream gateway
60 dtk; kanal demo live tidak lagi meng-encode terus (≈1,3 core → ≈0); font di-host sendiri (tanpa Google Fonts).
