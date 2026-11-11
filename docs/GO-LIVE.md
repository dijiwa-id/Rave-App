# Kesiapan go-live RAVE

Hasil audit 2026-11-10. Status: **infrastruktur siap, beberapa integrasi pihak ketiga masih blocker**.
Jalankan `npm run prod:preflight` sebelum setiap deploy; blocker di bawah juga muncul sebagai peringatan di sana.

## P0 — wajib sebelum menerima pengguna publik

| # | Item | Kondisi sekarang | Yang dibutuhkan |
| --- | --- | --- | --- |
| 1 | **Pengiriman OTP & notifikasi** | Login memakai OTP, tetapi `services/notification/src/delivery.ts` dan `iam` hanya mencatat ke log. Di produksi `dev_code` tidak dikembalikan → **tidak ada yang bisa login** | Pilih provider (email: SES/Resend/Mailgun; WA Business API) dan tulis adapter di `iam` (OTP) + `notification` (delivery) |
| 2 | **Payment gateway** | `PAYMENT_PROVIDER=sandbox` (tidak memindahkan uang). Escrow & tiket memakai QRIS tiruan | Adapter PG berizin (mis. Midtrans/Xendit) di `services/finance/src/providers.ts` + verifikasi signature webhook `/v1/webhooks/pg` |
| 3 | **E-sign kontrak** | `ESIGN_PROVIDER=OTP_NATIVE` — bergantung pada OTP (#1) | Setelah #1 berjalan; opsional Privy/Vida (Tahap 8) untuk tanda tangan tersertifikasi |
| 4 | **Data legal & identitas** | Placeholder: entitas "PT RAVE" di templat kontrak, kode registran ISRC `ID-GM1`, domain `rave.id` (URL problem RFC 9457, email dukungan `bantuan@rave.id`) | Isi nama badan hukum, kode registran ISRC resmi, domain & email nyata (`general.support_email` di Super Admin) |
| 5 | **Backup off-site** | `pg_dump` terjadwal hanya ke volume lokal | Salinan harian ke luar host + uji pemulihan (docs/DEPLOYMENT.md §Backup) |

## P1 — sangat disarankan (minggu pertama)

- **Object storage** untuk upload & HLS (sekarang volume lokal; gateway menerima body s.d. 2 GB). Target: presigned URL ke S3/GCS.
- **Monitoring & alert**: belum ada metrik Prometheus/OTel. Minimal: uptime check `GET /v1/status` (harus `ok: true`,
  `version_drift: []`), alert disk volume `storage` & Postgres, agregasi log JSON (Loki/CloudWatch).
- **JWT RS256 + JWKS** (sekarang HS256 dengan satu secret bersama — docs/ARCHITECTURE.md).
- **Rotasi secret** terdokumentasi (JWT/INTERNAL bisa dirotasi dengan restart; `KYC_KEY` tidak — data terenkripsi).
- **Uji beban** endpoint putar (`/v1/playback`, HLS live) dan checkout tiket sebelum event besar.
- Mengurangi 241 pemakaian `any` (log-development.md) dan menyatukan library ikon.

## Sudah siap (dikerjakan di audit ini)

- [x] Rebranding penuh GEMA → RAVE: paket `@rave/*`, token CSS `rave-*`, env `RAVE_*`, DB/role `rave`,
      issuer JWT `rave-iam`, kanal NOTIFY `rave_settings`/`rave_bus`, nomor kontrak `RAVE/SPK/...`, payload QR `RAVE1.`,
      skrip `./rave`. Data dev lama (`~/.gema`, DB `gema`) dimigrasikan otomatis oleh `scripts/dev-db.sh`.
- [x] Docker **development** (`docker-compose.yml`): hot reload, seed otomatis, satu image dev.
- [x] Docker **production** (`docker-compose.prod.yml`): image per service bertag versi, non-root (`node`), `tini`,
      HEALTHCHECK, `no-new-privileges`, rotasi log, Postgres tidak terekspos, nginx (cache aset, header keamanan,
      SPA fallback, proxy `/v1`), Caddy HTTPS opsional, Chromium untuk PDF kontrak, ffmpeg untuk live, pg_dump untuk backup.
- [x] **Preflight** produksi (`npm run prod:preflight`): secret wajib ≥ 32 karakter & unik, bukan nilai dev,
      password DB kuat, `PUBLIC_WEB_URL`, compose valid. Service juga menolak boot dengan konfigurasi dev.
- [x] **CORS** dibatasi di produksi (default hanya `PUBLIC_WEB_URL`; `CORS_ORIGINS` untuk tambahan).
- [x] **Versioning**: SemVer tunggal, `npm run release`, CHANGELOG otomatis, tag → image GHCR + GitHub Release,
      versi di `/healthz`, `/v1/version`, `/v1/status` (deteksi drift), dan dasbor Back Office (docs/VERSIONING.md).
- [x] **Operasional**: `scripts/prod.sh` (build/pull/up/rollback/smoke/logs), CI membangun image di setiap PR.

## Runbook hari-H

1. `git checkout vX.Y.Z` di server, `.env.production` terisi, `npm run prod:preflight` lolos tanpa BLOCKER.
2. `npm run prod:up` → smoke test lolos.
3. Super Admin pertama: daftar lewat OTP (butuh P0 #1), lalu promosikan satu kali via SQL:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production exec postgres \
     psql -U rave -d rave -c "UPDATE iam.users SET is_admin = true, admin_role = 'SUPER_ADMIN' WHERE email = '<email-anda>'"
   ```
   Lalu atur Platform → Pengaturan (email dukungan, modul aktif, komisi, kuota storage, jadwal backup).
4. Matikan pendaftaran publik (`general.registrations_open`) sampai siap, atau aktifkan mode pemeliharaan untuk soft launch.
5. Pantau `GET /v1/status` dan log 24 jam pertama; siapkan `scripts/prod.sh rollback <versi sebelumnya>`.
