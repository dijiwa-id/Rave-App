# Log Development — GEMA

## 2026-10-15

Ringkasan: audit basecode, audit responsivitas pemutar musik, lalu perbaikan pemutar (mobile, stabilitas, aksesibilitas).

### 1. Audit basecode (kebersihan, stabilitas, performa)

**Pemeriksaan**
- `npm run typecheck`: 1 error di gateway.
- `vitest`: 27 test lolos.
- `vite build`: sukses (±2,5 menit; lambat karena I/O NTFS lewat WSL).
- 13 service + Postgres sehat (`./gema status`).
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
- Screenshot Chromium pada 390, 820, dan 1280 px lewat stack uji terisolasi (DB `gema_test`, Vite uji :6173): tidak ada page error; pemutaran berjalan; ukuran tombol terukur sesuai target.
- Stack uji dan Vite uji dimatikan; file sementara `vite.test.config.ts` dihapus. Vite dev :5173 di-restart (`./gema restart-web`). Data dev tidak disentuh.

**Belum diuji**
- Buffering di jaringan lambat, pemulihan stream kedaluwarsa, Media Session di OS/layar kunci, dan perangkat iOS/Android sungguhan.
- `npm run e2e:isolated` tidak dijalankan.

### 5. Status dan tindak lanjut

- Semua perubahan di atas **belum di-commit**; working tree juga memuat ±217 file perubahan lain dari pekerjaan sebelumnya (live, ads, platform). Disarankan dipecah menjadi commit terstruktur.
- Uji manual di HP: matikan Wi-Fi saat lagu berjalan untuk mencoba pemulihan stream, dan periksa kontrol layar kunci.
- Opsional berikutnya: reorder/hapus item di Antrean, penyatuan library ikon, penggantian `any` dengan tipe row eksplisit.
