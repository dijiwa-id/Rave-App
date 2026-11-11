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

## [0.1.0] — 2026-11-09

Baseline sebelum versioning: fondasi microservices, fan app, Artist Studio, Promotor Hub, Back Office, Super Admin,
live streaming, iklan, dan Generated Contract tahap 1–3.
