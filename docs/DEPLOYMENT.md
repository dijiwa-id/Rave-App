# Deployment RAVE (Docker)

Docker hanya dipakai untuk **production** (`docker-compose.prod.yml` + `.env.production`, Dockerfile di `infra/docker/`).
Development berjalan langsung di host tanpa Docker: `./rave start` (lihat README).

| | Production |
| --- | --- |
| Image | `rave-<service>:<versi>` (target `runtime`, per service) + `rave-web:<versi>` (nginx) |
| Kode | dibekukan di image |
| Data | tanpa seed; migrasi saja |
| Port terbuka | web 80 (atau Caddy 80/443), RTMP 1935; Postgres hanya 127.0.0.1 |
| Secret | wajib, divalidasi `prod:preflight` + saat boot (`service-kit/config.ts`) |

## Production (satu host Docker)

Prasyarat server: Docker Engine 24+ dengan Compose v2, 4 vCPU / 8 GB RAM (minimum), disk SSD untuk volume `storage`.

```bash
git clone <repo> && cd <repo> && git checkout vX.Y.Z
cp .env.production.example .env.production   # isi secret: openssl rand -hex 32
npm run prod:preflight                       # WAJIB lolos
npm run prod:build                           # atau: RAVE_REGISTRY=ghcr.io/<org> scripts/prod.sh pull
npm run prod:up                              # preflight → up -d → tunggu healthy → smoke test
```

HTTPS:

- **Caddy bawaan** — set `RAVE_DOMAIN`, `ACME_EMAIL`, `WEB_BIND=127.0.0.1:8081`, lalu `PROFILES=tls npm run prod:up`.
- **TLS di luar** (load balancer / Cloudflare) — arahkan ke port `WEB_BIND` (default 80).

Topologi:

```
internet ─► [Caddy :443] ─► web (nginx :8080) ─┬─ /            aset SPA (cache immutable untuk /assets)
                                               └─ /v1/*  ─► gateway :8080 ─► iam, catalog, ... (jaringan internal)
OBS/Larix ─► live :1935 (RTMP)                     Postgres :5432 (internal) · volume storage (/data)
```

### Operasional

```bash
npm run prod:status              # docker compose ps
npm run prod:logs -- gateway     # log satu service (JSON pino)
npm run prod:smoke               # /v1/version, /v1/status (semua service sehat & versi seragam), web
scripts/prod.sh rollback 0.1.0   # kembali ke image versi lama
```

### Update versi (rolling di satu host)

1. Di mesin rilis: `npm run release -- auto && git push --follow-tags` → CI mendorong image (docs/VERSIONING.md).
2. Di server: ubah `RAVE_VERSION` di `.env.production`, `scripts/prod.sh pull`, `npm run prod:up`.
   Compose hanya membuat ulang container yang image-nya berubah; migrasi berjalan otomatis saat service start.
3. `npm run prod:smoke` harus lolos (tanpa `version_drift`).

### Rollback

`scripts/prod.sh rollback <versi>` menjalankan image lama. **Migrasi DB tidak di-rollback** — aman selama rilis
mengikuti pola expand → contract (docs/VERSIONING.md). Bila rilis membawa migrasi destruktif, pulihkan dari backup.

### Backup & pemulihan

Target go-live (docs/GO-LIVE.md §P0 #5): salinan **harian ke luar host** + **uji pemulihan** rutin.
RPO granular (≤ 1 jam umum / ≤ 5 menit ledger, WAL archiving/PITR) belum dicakup di sini.

**Alur**

1. Service `platform` menjalankan `pg_dump | gzip` terjadwal (Platform → Pengaturan: `storage.backup_enabled`,
   `storage.backup_interval_hours` default 24, `storage.backup_keep` default 7) ke volume `storage`
   (`/data/backups/rave-<stamp>-<id>.sql.gz`, sha256 tercatat di tabel `platform.backups`). Manual: Super Admin → Platform → Backup.
2. Service `backup-offsite` (image `rclone/rclone`, ikut `prod:up`) membaca volume itu **read-only** dan tiap
   `BACKUP_OFFSITE_INTERVAL_HOURS` jam menyalin dump yang belum ada di tujuan, masing-masing dengan `<file>.sha256`
   (diuji `gzip -t` sebelum dikirim; mode `dir` memverifikasi ulang checksum di tujuan). Lalu retensi off-site.
   Gagal → baris log `[backup-offsite] GAGAL: …` dan coba lagi 30 menit kemudian. Skrip: `infra/docker/backup/offsite.sh`.
3. `npm run prod:backup-verify` memulihkan dump ke database sementara dan memeriksa isinya (lihat *Uji pemulihan*).

**Konfigurasi** (`.env.production`; contoh lengkap di `.env.production.example`)

| Variabel | Default | Arti |
| --- | --- | --- |
| `BACKUP_OFFSITE` | `none` | `none` \| `dir` \| `s3` \| `rclone`. `none` = peringatan BLOCKER di preflight & log |
| `BACKUP_OFFSITE_DIR` | — | `dir`: path host disk kedua / mount NAS (dipasang ke `/offsite`). Harus disk lain dari volume Docker |
| `BACKUP_S3_URI` | — | `s3`: `s3://bucket/prefix`. Kredensial `RCLONE_S3_PROVIDER`, `RCLONE_S3_ACCESS_KEY_ID`, `RCLONE_S3_SECRET_ACCESS_KEY`, `RCLONE_S3_REGION`, `RCLONE_S3_ENDPOINT` (R2/Wasabi/MinIO/GCS) |
| `BACKUP_RCLONE_REMOTE` | — | `rclone`: `remote:path`, remote didefinisikan lewat env `RCLONE_CONFIG_<NAMA>_TYPE=…` (B2, SFTP, Drive, dst.) |
| `BACKUP_OFFSITE_KEEP_DAYS` | `30` | hapus salinan off-site lebih tua dari N hari (`0` = tidak pernah). Hanya dijalankan bila sinkron sukses & dump segar |
| `BACKUP_OFFSITE_INTERVAL_HOURS` | `6` | jeda antar-sinkron (hanya menyalin file baru, jadi murah) |
| `BACKUP_MAX_AGE_HOURS` | `30` | dump terbaru lebih tua dari ini = GAGAL (jadwal platform macet) |

Saran bucket: aktifkan *object lock*/versioning dan buat kunci akses khusus yang hanya boleh `PutObject/GetObject/List/Delete`
pada prefix backup — server yang dibobol tidak boleh bisa menghapus semua salinan. Bila retensi diserahkan ke
*lifecycle rule* bucket, set `BACKUP_OFFSITE_KEEP_DAYS=0`.

```bash
npm run prod:preflight          # BACKUP_OFFSITE=none → peringatan BLOCKER; konfigurasi tidak lengkap → kesalahan
npm run prod:backup             # sinkron sekali sekarang; keluar ≠ 0 bila gagal (cocok untuk cron/monitoring)
npm run prod:logs -- backup-offsite
```

Tanpa sidecar (mis. cron host): `docker compose -f docker-compose.prod.yml --env-file .env.production run --rm --no-deps -T backup-offsite once`.

**Uji pemulihan** (`scripts/backup-verify.sh`)

Memulihkan dump ke database sementara `rave_restore_test_<waktu>` di server target (DB `rave` tidak disentuh),
lalu memeriksa: sha256 cocok dengan `.sha256` di sebelahnya, `gzip -t`, umur dump, restore dalam satu transaksi
dengan `ON_ERROR_STOP`, semua schema service ada beserta `_migrations`, jumlah baris tabel kunci, dan **ledger seimbang**
(total debit = kredit, tidak ada transaksi timpang/entri yatim). DB sementara dihapus di akhir (juga saat gagal).

```bash
npm run prod:backup-verify                                         # dump terbaru di volume storage → container postgres
bash scripts/prod.sh backup-verify --file /srv/offsite/rave-<stamp>-<id>.sql.gz   # salinan off-site
bash scripts/backup-verify.sh --url postgres://…@staging:5432/rave --file …        # server uji terpisah (disarankan untuk DB besar)
npm run backup:verify                                              # dev: dump terbaru di storage/backups → DATABASE_URL (.env)
npm run backup:verify -- --fresh                                   # dev: pg_dump baru lalu uji
BACKUP_VERIFY_NONEMPTY="iam.users catalog.tracks" npm run prod:backup-verify   # tabel yang wajib berisi
```

Opsi: `--keep` (DB sementara dibiarkan untuk diperiksa), `BACKUP_VERIFY_SCHEMAS`, `BACKUP_VERIFY_MAX_AGE_HOURS`.
Restore uji butuh ruang disk ± ukuran DB di server target; untuk DB besar arahkan `--url` ke server staging.

**Drill pemulihan (runbook)** — minimal bulanan dan setelah mengubah konfigurasi backup; catat hasilnya.

1. Ambil salinan **off-site** terbaru (bukan dari volume lokal) ke mesin uji, sertakan `.sha256`-nya.
2. `bash scripts/prod.sh backup-verify --file <salinan>` (atau `--url` ke staging) → harus `Uji pemulihan LOLOS`.
3. Catat tanggal, nama file, durasi restore, dan jumlah baris tabel kunci dari laporan.
4. Gagal → perlakukan sebagai insiden P1: backup dianggap tidak ada sampai drill lolos.

**Pemulihan sungguhan** (bencana / migrasi destruktif)

1. `scripts/prod.sh down` lalu `docker compose -f docker-compose.prod.yml --env-file .env.production up -d postgres`.
2. Verifikasi dump dulu: `sha256sum -c rave-<stamp>-<id>.sql.gz.sha256` (atau `backup-verify.sh --file … --keep`).
3. Kosongkan DB lalu restore:
   ```bash
   dc() { docker compose -f docker-compose.prod.yml --env-file .env.production "$@"; }
   dc exec -T postgres psql -U rave -d postgres -c 'DROP DATABASE rave WITH (FORCE)' -c 'CREATE DATABASE rave'
   gunzip -c rave-<stamp>-<id>.sql.gz | dc exec -T postgres psql -X -v ON_ERROR_STOP=1 --single-transaction -U rave -d rave
   ```
4. `npm run prod:up` (migrasi yang lebih baru dari dump dijalankan otomatis saat service start) → `npm run prod:smoke`.

Catatan: backup-offsite hanya menyalin **dump database**. File di volume `storage` (upload audio, kontrak PDF,
branding) tidak ikut tersalin off-site — cadangkan terpisah (mis. `rclone sync` volume `storage` kecuali `live/` dan
`backups/`) atau pindahkan bucket ke object storage dengan replikasi.

### Skala

- Service stateless dapat direplikasi (`docker compose up -d --scale catalog=2`); rate limit & pengaturan sudah
  berbagi state lewat Postgres. Live butuh `LIVE_DIR` bersama + `LIVE_INTERNAL_URL` per replika (docs/ARCHITECTURE.md §6).
- Melampaui satu host: image yang sama dapat dipakai di Kubernetes (probe `/healthz` & `/readyz`, SIGTERM graceful).
