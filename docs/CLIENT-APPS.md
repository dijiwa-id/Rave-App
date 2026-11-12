# Rencana Aplikasi Klien — Mobile (Flutter) & Desktop (Tauri)

Status: **rencana / task berikutnya** (dicatat 2026-11-11). Menggantikan rencana awal "mobile React Native (Expo)"
di BRD/TDD v2.0 dan `docs/ARCHITECTURE.md` §5 — keputusan teknologi: **Flutter** untuk mobile, **Tauri** untuk desktop.
Backend (gateway `/v1`, kontrak di `docs/API.md`) dipakai bersama; aplikasi klien tidak mengakses service secara langsung.

## 1. Prasyarat lintas klien (backend & kontrak) — kerjakan lebih dulu

| # | Task | Alasan | Prioritas |
|---|---|---|---|
| P-1 | **Spesifikasi OpenAPI** dari skema Zod (gateway / per service) + generator klien Dart & TypeScript | `docs/API.md` saat ini prosa; klien Flutter butuh model & klien HTTP yang ter-generate agar tidak drift | P0 |
| P-2 | **Adapter pengiriman OTP** (email/WA) — sudah blocker go-live | Login produksi mustahil tanpa ini (kode OTP tidak dikirim/dilog di produksi) | P0 |
| P-3 | **Registrasi perangkat & push** (`POST /v1/me/devices` {platform, push_token, app_version}) + adapter FCM/APNs di service notification | Notifikasi native (presale, live mulai, booking) | P1 |
| P-4 | **Versi minimum aplikasi** (pengaturan platform `apps.min_version_*` + header `X-App-Version` di gateway → 426 Upgrade Required) | Paksa update bila kontrak API berubah | P1 |
| P-5 | **CORS/origin klien desktop** (`tauri://localhost`, `http://tauri.localhost`) di `CORS_ORIGINS` produksi | Tauri memuat UI dari origin lokal, API absolut | P1 |
| P-6 | **Upload resumable / chunked** untuk master audio besar (saat ini satu `PUT` biner) | Studio desktop & mobile di jaringan tidak stabil | P2 |
| P-7 | **Unduhan offline Premium** (lisensi per perangkat, batas 5 perangkat dari pengaturan, berkas terenkripsi, kedaluwarsa) — butuh keputusan DRM | Fitur Premium; rendisi Premium saat ini hanya URL bertanda tangan | P2 |
| P-8 | **Deep link & universal link** (`rave.id/app/...` ↔ `rave://`) + `assetlinks.json` / `apple-app-site-association` | Bagikan lagu/playlist/event, tautan e-ticket | P2 |

Catatan entitlement yang sudah berlaku dan wajib dihormati klien: `POST /v1/playback/sessions` mengembalikan
`quality`, `codec_label`, `quality_capped` (AAC 320 & FLAC khusus Premium); URL rendisi Premium bertanda tangan dan
kedaluwarsa bersama sesi → klien meminta sesi baru saat 403/kedaluwarsa (lihat logika pemulihan di `apps/web/src/stores/player.ts`).

## 2. Mobile — Flutter (Android & iOS)

**Lokasi kode (usulan):** `apps/mobile/` di monorepo agar kontrak & CI satu tempat (folder `../RAVE-mobile-apps` saat ini kosong — putuskan salah satu).

### 2.1 Cakupan MVP (fase 1)
- Login OTP + refresh token (rotasi) di secure storage; onboarding kota & genre.
- Aplikasi dengar: beranda, cari, artis, album, playlist (termasuk sampul kustom), lirik tersinkron, Liked, riwayat.
- Pemutar latar belakang: notifikasi media, layar kunci, kontrol headset/Bluetooth, antrean, pemulihan sesi stream,
  pilihan kualitas (terkunci untuk non-Premium seperti web), jeda iklan tier Gratis (`stores/ads` di web sebagai acuan).
- Live: daftar & tonton HLS (akses tiket), chat.
- Tiket: beli (redirect PG), dompet e-ticket dengan **QR berputar** (offline-friendly), notifikasi event.
- Promotor: **scanner check-in** dengan antrean offline & sinkronisasi (BRD: check-in offline — belum ada di web).
- Bahasa ID/EN mengikuti locale akun; tema & branding dari `GET /v1/platform/config`.

Di luar MVP: Artist Studio penuh & Promotor Hub penuh (tetap di web/desktop), unduhan offline (menunggu P-7).

### 2.2 Teknologi (usulan, verifikasi versi saat mulai)
| Kebutuhan | Paket |
|---|---|
| State & DI | riverpod |
| Routing & deep link | go_router |
| HTTP | dio (+ klien hasil generate OpenAPI) |
| Audio & latar belakang | just_audio + audio_service (+ audio_session) — AAC/M4A & FLAC didukung ExoPlayer/AVPlayer |
| Live HLS | video_player (ExoPlayer/AVPlayer) |
| Penyimpanan aman | flutter_secure_storage (refresh token) |
| QR scan / tampil | mobile_scanner / qr_flutter |
| Data lokal (antrean check-in, cache) | drift (SQLite) |
| Push | firebase_messaging (+ APNs) — setelah P-3 |
| Pembayaran | in-app browser / deeplink kembali dari PG |

### 2.3 Hal bisnis & store yang harus diputuskan
- **Langganan Premium di iOS/Android**: aturan App Store/Play mewajibkan billing in-app untuk konten digital
  (komisi 15–30%) — putuskan: IAP di aplikasi vs. pembelian hanya di web (dengan batasan anti-steering). Berdampak ke
  harga, rekonsiliasi finance, dan entitlement `premium` di IAM (perlu webhook App Store Server Notifications / RTDN).
- Akun developer (Apple, Google), rating konten, kebijakan privasi & formulir data (UU PDP), izin kamera (scanner),
  notifikasi, dan latar belakang audio.
- Tiket fisik vs digital: aturan store untuk penjualan tiket event (barang/jasa fisik — boleh PG eksternal).

### 2.4 Kualitas & rilis
- Test widget & golden untuk komponen inti; integration test alur login → putar → beli tiket terhadap stack e2e
  terisolasi (`E2E_PORT_OFFSET`).
- CI: build Android (AAB) & iOS (runner macOS), flavor dev/staging/prod (base URL API), crash reporting.
- Target: cold start < 2 dtk, TTFA (time-to-first-audio) p95 < 1 dtk, crash-free ≥ 99,5% (selaras NFR BRD v3.0).

## 3. Desktop — Tauri (Windows, macOS, Linux)

**Pendekatan:** bungkus aplikasi web yang ada (`apps/web`, React + Vite) dengan **Tauri v2** — satu basis kode UI,
menambah kemampuan native. Lokasi usulan: `apps/desktop/` (src-tauri) yang mem-build `apps/web` sebagai frontend.

### 3.1 Cakupan
- Semua area web: aplikasi dengar, Artist Studio, Promotor Hub, Back Office/Super Admin (sesuai peran).
- Native: tombol media keyboard & kontrol media OS, mini-player di tray, notifikasi sistem, auto-start opsional,
  deep link `rave://`, drag & drop master audio ke Studio (didukung P-6 untuk berkas besar).
- Auto-update (Tauri updater, kunci tanda tangan update disimpan aman di CI).

### 3.2 Penyesuaian di `apps/web` yang dibutuhkan
- Base URL API dapat dikonfigurasi (saat ini relatif `/v1` lewat proxy Vite/nginx) → env build `VITE_API_BASE`.
- Penyimpanan token: tetap localStorage atau pindah ke keychain OS via plugin Tauri (lebih aman untuk desktop).
- Deteksi lingkungan Tauri untuk fitur native (tray, media keys) tanpa memecah build web.
- Service worker/PWA dinonaktifkan di build desktop.

### 3.3 Distribusi
- Penandatanganan kode: Windows (sertifikat code signing/EV), macOS (Developer ID + notarization), Linux (AppImage/deb).
- CI matrix 3 OS; kanal rilis stable/beta; versi mengikuti SemVer platform (`docs/VERSIONING.md`).

## 4. Urutan kerja yang disarankan
1. P-1 OpenAPI + P-2 OTP adapter (membuka login produksi untuk semua klien).
2. Desktop Tauri (paling cepat: memakai ulang web) + P-5 CORS + P-4 versi minimum.
3. Mobile Flutter MVP (dengar + tiket + live) + P-3 push.
4. Scanner check-in offline (Promotor) di mobile.
5. Keputusan billing store & P-7 unduhan offline Premium (DRM).

## 5. Dokumen yang perlu diperbarui saat task dimulai
BRD v3.0 (REQ-IAM/STR/TIX terkait klien native, keputusan billing store), TDD v3.0 (§3 arsitektur klien, §17 deviasi:
React Native → Flutter, tambah Tauri), `docs/API.md` (endpoint P-3/P-4/P-6/P-7), `docs/ARCHITECTURE.md` §5.
