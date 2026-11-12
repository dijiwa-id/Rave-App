# Kesiapan go-live RAVE

Hasil audit 2026-11-10, diperbarui 2026-11-12 terhadap BRD v3.0 §15.1. Status: **kode & infrastruktur siap; sisa blocker adalah keputusan/kontrak vendor dan data legal**.
Jalankan `npm run prod:preflight` sebelum setiap deploy; blocker di bawah juga muncul sebagai peringatan di sana.

> **Audit ulang 12 Nov 2026 (BRD/TDD v3.0): lihat [`docs/GO-LIVE-AUDIT.md`](GO-LIVE-AUDIT.md)** — menemukan P0 tambahan
> di keamanan (hak admin, kebocoran master audio), alur uang (refund booking, eksekusi payout, pajak/split, pembatalan),
> kontrak final, dan klaim produk. Tabel di bawah hanya mencakup blocker integrasi vendor.

## P0 — wajib sebelum menerima pengguna publik

| # | Item | Kondisi sekarang | Yang dibutuhkan |
| --- | --- | --- | --- |
| 1 | **Pengiriman OTP & notifikasi** | **Adapter siap** (`packages/service-kit/src/messaging.ts`): email `resend`/`mailgun`/`postmark`/`webhook`, WhatsApp `meta` (Cloud API, templat OTP)/`webhook`. Dipakai OTP login (`iam`), OTP tanda tangan kontrak (`booking`), dan worker notifikasi (retry + backoff, status SENT/FAILED/SKIPPED). Default `log` → preflight memberi BLOCKER | Pilih vendor (Q-01), lalu atur di **dasbor Super Admin → Platform → Integrasi** (provider, API key terenkripsi, alamat pengirim dengan SPF/DKIM) dan klik *Kirim email uji*; alternatif env `EMAIL_PROVIDER`. WA (env): templat autentikasi `rave_otp` disetujui Meta |
| 2 | **Payment gateway** | **Adapter Midtrans siap** (Snap redirect, notifikasi diverifikasi `signature_key` SHA-512, tarik status saat pengguna kembali, refund API untuk kartu/GoPay/ShopeePay/QRIS; VA → transfer manual Finance). Diatur di dasbor Super Admin → Integrasi (mode sandbox/produksi, server key terenkripsi, uji koneksi). Invoice mengingat penyedianya sehingga refund lewat jalur yang sama | Kontrak Midtrans (Q-02) + struktur escrow (D-01); isi kunci di dasbor, pasang Notification URL di dasbor Midtrans, uji checkout sandbox end-to-end dengan kunci sandbox asli, lalu ganti ke mode produksi |
| 3 | **E-sign kontrak** | `ESIGN_PROVIDER=OTP_NATIVE` — bergantung pada OTP (#1) | Setelah #1 berjalan; opsional Privy/Vida (Tahap 8) untuk tanda tangan tersertifikasi |
| 4 | **Data legal & identitas** | Placeholder: entitas "PT RAVE" di templat kontrak, kode registran ISRC `ID-GM1`, domain `rave.id` (URL problem RFC 9457, email dukungan `bantuan@rave.id`) | Isi nama badan hukum, kode registran ISRC resmi, domain & email nyata (`general.support_email` di Super Admin) |
| 5 | **Backup off-site** | **Mekanisme siap**: sidecar `backup-offsite` (rclone; `dir`/`s3`/`rclone`) menyalin dump + `.sha256`, retensi, gagal bila dump basi; uji pemulihan otomatis `npm run prod:backup-verify` (sha256, restore transaksional, skema, ledger seimbang) — lulus di dev & prod lokal | Pilih tujuan off-site (bucket dengan versioning/object lock atau NAS) → isi `BACKUP_OFFSITE*`; jadwalkan drill bulanan (docs/DEPLOYMENT.md §Backup & pemulihan). File unggahan (audio, PDF kontrak) belum ikut — butuh keputusan object storage |

| 6 | **Kontrol payout (dual control & masa tunggu rekening)** | **Selesai**: penarikan > `payout.approval_threshold_idr` menunggu persetujuan admin lain (izin baru `finance.payout`, pemohon/anggota wallet tidak bisa memutuskan), penolakan membalik jurnal ke wallet + notifikasi; penarikan ke rekening yang baru diganti ditahan `payout.bank_change_cooldown_hours`. Antrean di Back Office → Finance, riwayat & status di Studio → Keuangan. Diuji e2e | Tetapkan ambang & masa tunggu final bersama Finance |

## P1 — sangat disarankan (minggu pertama)

- **Object storage** untuk upload & HLS (sekarang volume lokal; gateway menerima body s.d. 2 GB). Target: presigned URL ke S3/GCS.
- **Monitoring & alert** — *alat siap*: `npm run monitor:prod` (status/versi, koneksi & ukuran Postgres, outbox,
  dead letter, disk volume `storage` & data Postgres, umur backup) dengan alert ke `ALERT_WEBHOOK_URL` (Slack/Discord,
  de-duplikasi). Sisa: pasang cron/systemd timer + uptime check eksternal (docs/OPERATIONS.md); metrik
  Prometheus/OTel & agregasi log JSON masih belum.
- **JWT RS256 + JWKS** (sekarang HS256 dengan satu secret bersama — docs/ARCHITECTURE.md).
- **Rotasi secret** terdokumentasi (JWT/INTERNAL bisa dirotasi dengan restart; `KYC_KEY` tidak — data terenkripsi).
- **Uji beban** — *alat siap & diukur di dev* (`npm run loadtest:*`, docs/OPERATIONS.md): playback 30 VU p95 sesi
  175 ms / TTFA 278 ms (lolos); checkout tanpa oversell & idempotensi utuh, **tetapi `POST /v1/ticketing/orders`
  p95 690–840 ms saat 30 pembeli berebut satu jenis tiket** (target < 500 ms) — antre di kunci baris `ticket_types` +
  panggilan invoice sinkron ke finance. Perlu optimasi + uji ulang di server produksi sebelum event besar.
  Batas order tiket gateway (30/menit/akun) masih tetap di kode, belum pengaturan Super Admin.
- Mengurangi 241 pemakaian `any` (log-development.md) dan menyatukan library ikon.

## Sudah siap (dikerjakan di audit ini)

- [x] Rebranding penuh GEMA → RAVE: paket `@rave/*`, token CSS `rave-*`, env `RAVE_*`, DB/role `rave`,
      issuer JWT `rave-iam`, kanal NOTIFY `rave_settings`/`rave_bus`, nomor kontrak `RAVE/SPK/...`, payload QR `RAVE1.`,
      skrip `./rave`. Data dev lama (`~/.gema`, DB `gema`) dimigrasikan otomatis oleh `scripts/dev-db.sh`.
- [x] Docker **development** dihapus (2026-11-12, konsumsi CPU tinggi) — development memakai `./rave start` tanpa Docker.
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
