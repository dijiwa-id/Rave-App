# Log Development — RAVE

## 2026-11-12

Ringkasan: penyempurnaan UI fan (onboarding, lirik/karaoke, tambah ke playlist) dan pekerjaan kesiapan go-live
berdasarkan BRD v3.0 §15.1 yang bisa diselesaikan tanpa kontrak vendor.

- Eksperimen login password + MFA di IAM dibatalkan atas permintaan; IAM dikembalikan ke alur OTP semula.
- Go-live: adapter pengirim OTP/notifikasi (env, tanpa dependency), kontrol payout dual control + masa tunggu
  rekening, backup off-site + uji pemulihan otomatis, preflight diperluas.
- Verifikasi: typecheck bersih, unit 71/71 (8 baru untuk messaging), e2e terisolasi 204/204 (13 cek payout baru)
  dengan `EMAIL_PROVIDER=webhook` ke penerima lokal: 69 email terkirim, 0 tanda tangan HMAC salah.
- Catatan lingkungan: Vite di /mnt/d tidak hot-reload → `./rave restart-web`; Google Fonts kadang gagal dari WSL
  sehingga screenshot headless kosong teks (bukan bug aplikasi).
- Sisa blocker go-live = keputusan/kontrak: vendor email/WA (Q-01), PG berizin (Q-02), data legal/ISRC/domain,
  tujuan off-site, PSrE/KYC, pentest, PSE.

## 2026-11-11

Ringkasan: lingkungan WSL baru dibangun ulang (tanpa sudo), audit stabilitas FE/BE, fitur audio multi-format +
HQ/Lossless khusus Premium, sampul playlist, penyempurnaan landing & branding.

- Toolchain user-local: Node 22 (`~/.local/node`), PostgreSQL 18 & library Chromium dari paket Kali (`~/.local/pgsql`,
  `~/.local/chromelibs`), shim `docker` → `docker.exe`. Semua di `~/.rave/env.sh` (source sebelum `./rave`/`npm`).
- Temuan lingkungan: port loopback 5004 tidak bisa dihubungi di WSL ini (mirrored networking) → `e2e:isolated` dengan
  `E2E_PORT_OFFSET=3000` (offset 2000 menghasilkan port 10080 yang diblokir fetch).
- Stabilitas: gateway 503/504 untuk upstream mati, `max_connections` Postgres, perbaikan `rave.sh` (fuser/pipefail),
  Range media, file yatim, z-index dropdown dasbor.
- Fitur: master WAV/FLAC/AIFF/ALAC/MP3/AAC/OGG/Opus + transcoding ffmpeg; AAC 320 & FLAC khusus Premium (URL rendisi
  bertanda tangan); sampul playlist; font primer 2 (Rubik Dirt); logo partner di Editor Landing.
- Verifikasi: typecheck bersih, unit 63/63, e2e terisolasi 190/190, crawler UI 48 halaman tanpa galat, stack produksi
  Docker sehat + smoke test.
- Rilis: commit `8b2bf40` di-push ke https://github.com/dijiwa-id/Rave-App (remote `rave`, branch `main`); remote
  `origin` (Gema-Apps) tidak diubah. Stack produksi Docker lokal (:8088) dibangun ulang dari kode yang sama.
- Dokumen: **BRD v3.0** & **TDD v3.0** (Word) dibuat di folder `RAVE Apps/` (`RAVE_BRD_v3.0.docx`, `RAVE_TDD_v3.0.docx`),
  diperbarui dari `GEMA_BRD_TDD_v2.0.docx` + kondisi kode: BRD 15 bab / 130 kebutuhan berstatus (74 Tersedia,
  38 Sebagian, 18 Belum); TDD 18 bab, arsitektur terverifikasi dari kode + 25 deviasi dari v2.0. Belum ditinjau visual
  di Word (otomasi Word dari WSL ditolak) — buka & "Update Field" untuk daftar isi. Angka bisnis (komisi, harga
  Premium, royalti) masih default kode, menunggu pengesahan; kolom nama persetujuan kosong.
- Temuan dari penyusunan TDD: **dual control payout belum ditegakkan** (`payout.approval_threshold_idr` &
  `payout.bank_change_cooldown_hours` tidak dibaca service finance) → prioritas P0; `loudness_gain_db` belum dihitung;
  paginasi memakai offset yang dikodekan sebagai cursor; `DB_POOL_MAX` default kode 6 vs contoh prod 10.
- Belum: dual control payout (P0), upgrade mayor `zod` 4 & `puppeteer-core` 25 (sisa temuan `npm audit`),
  normalisasi loudness saat transcoding (`transcoding.loudness_target_lufs` masih "Disiapkan"), DRM untuk rendisi
  Premium (saat ini URL bertanda tangan), adapter vendor nyata (OTP email/WA, payment gateway, PSrE, KYC).
- **Task berikutnya — aplikasi klien** (rencana lengkap: `docs/CLIENT-APPS.md`): mobile **Flutter** (Android/iOS; MVP
  dengar + tiket QR + live + scanner check-in offline) dan desktop **Tauri v2** (membungkus `apps/web`; media keys,
  tray, auto-update). Menggantikan rencana React Native di BRD/TDD v2.0. Prasyarat backend: OpenAPI + klien ter-generate,
  adapter OTP, registrasi perangkat & push, versi minimum aplikasi, CORS origin Tauri, upload resumable, unduhan offline
  Premium (DRM). Keputusan bisnis terbuka: billing langganan Premium lewat App Store/Play vs web.
- Perubahan setelah commit `8b2bf40` (README, CHANGELOG, docs/generated-contract.md, docs/ARCHITECTURE.md,
  docs/CLIENT-APPS.md, log ini) belum di-commit.

## 2026-11-10

Ringkasan: rebranding penuh GEMA → RAVE, Docker dev & prod, versioning, dan audit kesiapan go-live (docs/GO-LIVE.md).

- Rename case-preserving di 215 file (+ `./gema` → `./rave`, `scripts/rave.sh`, `RaveLogo.tsx`); dikecualikan kata
  Indonesia "gemar"/"penggemar" dan judul lagu demo "Gema Lembah". Token `rave-purple` ganda dihapus.
- `scripts/dev-db.sh`: migrasi otomatis `~/.gema/pgdata` → `~/.rave/pgdata`, DB/role `gema` → `rave` (data dipertahankan,
  diuji: 6 user tetap ada). Perintah admin psql kini lewat socket Unix.
- Docker: `infra/docker/` (Dockerfile.service target dev/runtime, Dockerfile.web nginx, Caddyfile, healthcheck),
  `docker-compose.yml` (dev) dan `docker-compose.prod.yml` (prod), `scripts/prod.sh`, `scripts/prod-preflight.sh`.
- Versioning: `BUILD_INFO` di service-kit, `/v1/version`, `version_drift` di `/v1/status`, versi di dasbor admin,
  `scripts/release.ts`, `CHANGELOG.md`, `.github/workflows/release.yml`.
- Catatan lingkungan: test PDF Chromium (2) timeout di host WSL ini — puppeteer-core menggantung saat launch
  headless-shell Playwright, padahal binary berjalan normal. Loopback TCP WSL (`networkingMode=mirrored`) sempat
  timeout setelah Docker Desktop menyala.

## 2026-10-15

Ringkasan: audit basecode, audit responsivitas pemutar musik, lalu perbaikan pemutar (mobile, stabilitas, aksesibilitas).

### 1. Audit basecode (kebersihan, stabilitas, performa)

**Pemeriksaan**
- `npm run typecheck`: 1 error di gateway.
- `vitest`: 27 test lolos.
- `vite build`: sukses (±2,5 menit; lambat karena I/O NTFS lewat WSL).
- 13 service + Postgres sehat (`./rave status`).
- Pencarian sampah: tidak ada `console.log` sisa, TODO/FIXME, atau file yatim. `storage/` sudah di-gitignore. Komponen `reactbits` yang tak terpakai sudah terhapus di working tree.
- Stabilitas yang sudah ada: handler `unhandledRejection`/`uncaughtException`, graceful shutdown SIGTERM, `bodyLimit` per rute, retry query tidak mengulang 4xx, migrasi `perf_indexes` di hampir semua service, timer 1 detik terisolasi ke komponen kecil.
- Bundle terbesar: hls.js 359 kB (lazy, hanya saat live), react 308 kB, motion 150 kB, Landing 93 kB.

**Perubahan**
- `services/gateway/src/index.ts`: opsi `trustProxy` di-cast ke `boolean | string`. Tipe Fastify tidak memuat `number` (jumlah hop), padahal runtime mendukungnya. Typecheck kini bersih.

**Belum dikerjakan (saran lanjutan)**
- 241 pemakaian `any` (terbanyak: `scripts/e2e.ts` 35, `ticketing/routes.ts` 18, `service-kit/bus.ts` 14).
- Dua library ikon (`@hugeicons` hanya di 3 komponen reactbits, selebihnya `lucide-react`).
- `bodyLimit` gateway 2 GB (untuk dev); produksi sebaiknya presigned URL ke object storage.
- Repo di `/mnt/d` membuat build/typecheck lambat; pindah ke filesystem WSL akan mempercepat.

### 2. Audit responsivitas pemutar musik

Temuan (dari pembacaan kode):
1. Lirik, Antrean, Volume, Mute, dan badge kualitas tersembunyi di < 768px, tanpa jalur lain ke Antrean.
2. Acak dan Ulangi hilang di < 640px.
3. Target sentuh terlalu kecil (ikon 16–20px tanpa padding).
4. Slider progres 12px, thumb hanya muncul saat hover, tanpa umpan balik di layar sentuh.
5. Bar 90px kaku, tanpa mini-player/tampilan penuh.
6. Tidak ada Media Session API.
7. Tidak ada pintasan keyboard.
8. Tidak ada status buffering/loading.
9. Slider volume sulit disentuh; volume tidak bisa diatur di iOS.
10. `stream_url` kedaluwarsa tidak dipulihkan.
11. Tidak ada safe-area iOS dan `dvh`.
12. Aksesibilitas: label mute statis, slider tanpa `aria-valuetext`.
13. Antrean tanpa reorder/hapus (tidak dikerjakan).

### 3. Perbaikan pemutar (butir 1–5)

**Mini-player dan sheet "Sedang Diputar" (mobile)**
- < 768px: mini-player ringkas (sampul, judul, suka, putar/jeda, garis progres). Ketuk membuka sheet penuh berisi sampul besar, seek, acak, ulang, volume, kualitas, tautan Lirik dan Antrean. Sheet menutup via Escape atau pindah halaman.
- ≥ 768px: bar desktop 3 kolom; Lirik/Antrean/volume tampil mulai 768px.

**Target sentuh dan slider**
- Semua tombol ≥ 44px di layar sentuh (36px di desktop); tombol play di sheet 64px.
- Slider: area sentuh 32px, thumb selalu terlihat di layar sentuh, nilai ditahan lokal saat digeser dan satu seek dikirim saat dilepas.
- Tombol suka diperbesar ke 44px di mobile (belum diukur ulang setelah perubahan).

**Media Session dan keyboard** (`lib/playerControls.ts`)
- Kontrol layar kunci/headset, metadata OS (judul, artis, sampul), posisi.
- Pintasan: Spasi, ←/→ (5 dtk), Shift+←/→ (sebelumnya/berikutnya), M. Panah ↑/↓ sengaja tidak dipakai agar scroll halaman tidak terganggu.

**Buffering dan pemulihan stream** (`stores/player.ts`)
- State `buffering`; spinner di tombol play.
- Galat stream → sesi baru otomatis dan lanjut dari posisi terakhir (maks. 2×); gagal → pesan dengan tombol "Coba lagi"; jaringan kembali → lanjut otomatis.
- Aksi baru: `seekBy`, `retry`.

**Safe-area, dvh, aksesibilitas**
- `viewport-fit=cover`, `env(safe-area-inset-bottom)` pada navigasi bawah, `#root` memakai `100dvh`.
- `aria-valuetext` pada slider, label mute dinamis + `aria-pressed`, label Ulangi membedakan satu/semua.
- Kontrol volume disembunyikan di iOS.

**File**
- Baru: `apps/web/src/layouts/playerParts.tsx`, `apps/web/src/layouts/NowPlaying.tsx`, `apps/web/src/lib/playerControls.ts`
- Diubah: `apps/web/src/layouts/PlayerBar.tsx`, `apps/web/src/layouts/FanLayout.tsx`, `apps/web/src/stores/player.ts`, `apps/web/index.html`, `apps/web/src/index.css`, `services/gateway/src/index.ts`

### 4. Verifikasi

- `tsc` web dan root: bersih.
- Screenshot Chromium pada 390, 820, dan 1280 px lewat stack uji terisolasi (DB `rave_test`, Vite uji :6173): tidak ada page error; pemutaran berjalan; ukuran tombol terukur sesuai target.
- Stack uji dan Vite uji dimatikan; file sementara `vite.test.config.ts` dihapus. Vite dev :5173 di-restart (`./rave restart-web`). Data dev tidak disentuh.

**Belum diuji**
- Buffering di jaringan lambat, pemulihan stream kedaluwarsa, Media Session di OS/layar kunci, dan perangkat iOS/Android sungguhan.
- `npm run e2e:isolated` tidak dijalankan.

### 5. Status dan tindak lanjut

- Semua perubahan di atas **belum di-commit**; working tree juga memuat ±217 file perubahan lain dari pekerjaan sebelumnya (live, ads, platform). Disarankan dipecah menjadi commit terstruktur.
- Uji manual di HP: matikan Wi-Fi saat lagu berjalan untuk mencoba pemulihan stream, dan periksa kontrol layar kunci.
- Opsional berikutnya: reorder/hapus item di Antrean, penyatuan library ikon, penggantian `any` dengan tipe row eksplisit.
