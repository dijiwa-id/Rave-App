# Changelog

Semua perubahan penting RAVE. Format: [Keep a Changelog](https://keepachangelog.com/id/1.1.0/), versi: [SemVer](https://semver.org/lang/id/).
Bagian rilis dibuat otomatis oleh `npm run release` (docs/VERSIONING.md); tulis catatan manual di bawah **Unreleased**.

## [Unreleased]

- Rebranding penuh GEMA → RAVE di kode, konfigurasi, skrip, dan dokumen (paket `@rave/*`, env `RAVE_*`, DB `rave`).
  **Breaking (dev):** sesi login lama tidak berlaku (issuer JWT & kunci localStorage berganti); `./gema` → `./rave`;
  `GEMA_PGPORT` → `RAVE_PGPORT`. Data dev lama dipindahkan otomatis oleh `scripts/dev-db.sh`.
- Docker development (`docker-compose.yml`) dan production (`docker-compose.prod.yml`, nginx, Caddy TLS opsional).
- Versioning: `npm run release`, CHANGELOG, workflow rilis GHCR, `/v1/version`, deteksi `version_drift` di `/v1/status`.
- Kesiapan go-live: `npm run prod:preflight`, validasi secret saat boot, CORS terbatas di produksi, docs/GO-LIVE.md.

### Ditambahkan
- **Kesiapan go-live (BRD v3.0 §15.1):**
  - **Pengirim OTP & notifikasi** (`@rave/service-kit` `messaging`): email `resend`/`mailgun`/`postmark`/`webhook`,
    WhatsApp `meta` (Cloud API, templat OTP)/`webhook` — dipilih lewat `EMAIL_PROVIDER`/`WHATSAPP_PROVIDER`, default
    `log`. Dipakai OTP login, OTP tanda tangan kontrak, dan worker notifikasi (klaim batch, retry backoff,
    SENT/FAILED/SKIPPED). Kode yang gagal terkirim dihapus agar tidak memakan kuota. Preflight memberi BLOCKER bila `log`.
  - **Kontrol payout**: dual control (penarikan > `payout.approval_threshold_idr` menunggu persetujuan admin lain, izin
    baru `finance.payout`), penolakan dengan jurnal pembalik + notifikasi, masa tunggu rekening yang baru diganti
    (`payout.bank_change_cooldown_hours`). Antrean di Back Office → Finance; riwayat & status penarikan di Studio.
  - **Backup off-site + uji pemulihan**: sidecar `backup-offsite` (rclone: `dir`/`s3`/`rclone`, `.sha256`, retensi),
    `npm run prod:backup`, `npm run prod:backup-verify` / `backup:verify` (restore ke DB sementara, cek skema & ledger).
- **Dasbor Super Admin → Integrasi**: atur pengirim email (Resend/Mailgun/Postmark/webhook) dan payment gateway
  (sandbox/**Midtrans**) tanpa deploy; API key terenkripsi AES-256-GCM, tidak pernah dikirim balik ke browser,
  email uji & uji koneksi, riwayat perubahan + audit, kembali ke env kapan saja.
- **Adapter Midtrans**: checkout Snap (redirect), notifikasi `/v1/webhooks/pg/midtrans` (signature SHA-512),
  `POST /v1/finance/invoices/:id/checkout` & `/sync`, refund API (kartu, GoPay, ShopeePay, QRIS). Invoice
  menyimpan penyedianya (`invoices.provider`).
- Halaman **lirik** baru (latar titik & piringan RAVE, ikuti-lirik), **mode karaoke layar penuh** (sapuan baris,
  hitung mundur jeda, equalizer, kontrol sendiri), **Tambah ke playlist** di setiap daftar lagu, onboarding fan baru.
- **Master audio multi-format** di Artist Studio: WAV, FLAC, AIFF, ALAC/AAC (M4A), MP3, OGG, Opus — divalidasi ffmpeg
  (codec, sample rate, bit depth, durasi). Worker transcoding (`audio-transcode`) membuat rendisi AAC 64/160/320 dan
  FLAC (≤ 24-bit/96 kHz, hanya dari master lossless); antrean di DB (`FOR UPDATE SKIP LOCKED`, 3× percobaan, pulih
  setelah restart). Badge format & status pengolahan per lagu di Studio.
- **AAC 320 & Lossless (FLAC) khusus Premium** (menggantikan D-03 "lossless gratis"): pemilihan rendisi di
  `@rave/domain/audio` (`resolvePlayback`), `quality_capped` di respons sesi, opsi terkunci di Pengaturan fan,
  berkas rendisi Premium hanya via URL bertanda tangan. Akun demo `premium@rave.id`.
- **Sampul playlist** unggahan pengguna (`purpose: "playlist"`, ≤ 8 MB, ≥ 300 px), `has_custom_cover`.
- Font primer kedua (Rubik Dirt) yang bisa dipilih di Branding & Tema; logo partner pita kuning dikelola di Editor
  Landing (tautan http/https), publikasi tanpa input alasan (alasan audit diisi otomatis).

### Diperbaiki / stabilitas
- Gateway menjawab **503 + Retry-After** (bukan 500) saat service upstream tidak terjangkau; 504 untuk timeout.
- `max_connections` Postgres dinaikkan (dev 300, prod 250) — dev + e2e terisolasi sempat kehabisan koneksi.
- `./rave restart-*` tidak lagi bergantung pada `fuser` dan tidak gagal diam-diam saat service sudah mati;
  Vite dijalankan `--strictPort`.
- Media catalog mendukung **Range (206)** untuk seek; deteksi file yatim memperhitungkan rendisi audio & sampul playlist.
- Dropdown menu pengguna dasbor tidak lagi tertimpa kartu.
- `e2e:isolated`: batas tunggu bisa diatur, pesan galat menyebut service yang belum siap, deteksi port "bad port"
  fetch; langkah PDF tidak lagi membuat suite crash.
- Dependensi: patch keamanan non-breaking (undici, fastify, body-parser, qs, vite, …).

### Dokumentasi
- BRD v3.0 & TDD v3.0 (Word, di luar repo: `RAVE Apps/RAVE_BRD_v3.0.docx`, `RAVE_TDD_v3.0.docx`) menggantikan
  `GEMA_BRD_TDD_v2.0.docx`; README (190 skenario e2e) & status Tahap 4 Generated Contract diperbarui.

## [0.1.0] — 2026-11-09

Baseline sebelum versioning: fondasi microservices, fan app, Artist Studio, Promotor Hub, Back Office, Super Admin,
live streaming, iklan, dan Generated Contract tahap 1–3.
