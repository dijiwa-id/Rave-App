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

## 1. Keputusan pemilik (13 Nov 2026)

| Hal | Keputusan |
|---|---|
| VPS | **Server demo sementara: 2 vCPU / 2 GB RAM / 40 GB disk.** Stack idle terukur ±554 MiB (12 service ±30 MiB, Postgres ±126 MiB, live ±70 MiB); lonjakan dari transcoding audio (catalog), PDF kontrak Chromium (booking) dan live → **swap 4 GB wajib** (`scripts/vps.sh setup`). Image TIDAK dibangun di VPS (RAM tidak cukup) — dibangun di PC lalu dikirim. Konfigurasi: pool DB 5/service, `max_connections` 100, batas memori per container (lihat `storage/vps/.env.production`). |
| Cloudflare | **DNS-only** (awan abu-abu) untuk `rave` & `ingest.rave` — TLS oleh Caddy, IP klien asli langsung terlihat. |
| Data | **Pindahkan dari prod-lokal** (8 artis, 16 rilis LIVE, 40 lagu, 6 event, 8 akun) — dump DB + volume storage via `scripts/vps.sh bundle`. Secret (`KYC_KEY`, kunci integrasi, dll.) disalin apa adanya agar data terenkripsi tetap terbaca. |
| OTP | **Resend (gratis 100 email/hari)**. Karena login butuh OTP, server pertama memakai env (`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`) — setelah bisa masuk, boleh dipindah ke Super Admin → Integrasi. WhatsApp menyusul. |

### Resend — langkah pemilik (±15 menit)
1. Daftar di resend.com → **Domains → Add domain** `danantrex.my.id` (atau `mail.danantrex.my.id`).
2. Tambahkan record DNS yang diberikan Resend di Cloudflare (DKIM `TXT`, SPF `MX` + `TXT` di subdomain `send`), **DNS-only**. Tunggu status *Verified*.
3. **API Keys → Create** (izin *Sending access*). Kirim kuncinya lewat jalur aman, lalu isi di `storage/vps/.env.production`:
   `EMAIL_PROVIDER=resend`, `RESEND_API_KEY=re_…`, `EMAIL_FROM=RAVE <no-reply@danantrex.my.id>`.

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

## 4. Langkah naik server (VPS demo)

Dari PC (WSL, repo `Development`, Docker Desktop menyala):

```bash
npm run prod:build                              # image rave/*:<versi> untuk commit saat ini
scripts/vps.sh bundle                           # → storage/vps/bundle (image, dump DB, storage, kode)
scripts/vps.sh setup  <user>@<IP-VPS>           # sekali: swap 4 GB, ufw 22/80/443/1935, Docker, /opt/rave
scripts/vps.sh ship   <user>@<IP-VPS>           # kirim → docker load → pulihkan data (bila DB kosong) → up profil tls
scripts/vps.sh status <user>@<IP-VPS>
```

Sebelum `ship`: record DNS §2 sudah mengarah ke IP VPS (Caddy butuh itu untuk menerbitkan sertifikat), Resend §1
sudah terisi. Setelah naik: login Super Admin, matikan `live.demo_channel` bila CPU perlu dihemat, build APK dengan
`RAVE_API=https://rave.danantrex.my.id` + `cleartextTrafficPermitted="false"`.

Pembaruan berikutnya: `npm run prod:build && scripts/vps.sh bundle && scripts/vps.sh ship …` (data tidak ditimpa
bila DB VPS sudah berisi). Cadangan VPS: `ENV_FILE=.env.production bash scripts/prod.sh backup` di server; atur
`BACKUP_OFFSITE` (S3/R2) sebelum dipakai sungguhan.

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
