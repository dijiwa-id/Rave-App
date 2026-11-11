# RAVE: panduan identitas merek

> **RAVE: Rolliemonkie Audio Visual Experiment.** Musik DIY & indie Indonesia, dari kamar ke panggung.
> Dokumen ini mengunci tampilan hasil iterasi desain (landing, app pendengar, Back Office) sebagai standar.
> Sumber kebenaran ada di kode. Tiap bagian menunjuk file yang harus diubah jika aturan berubah.

## 1. Karakter

Estetika **zine punk / flyer gig fotokopi**: kertas kusut, halftone kasar, stiker, selotip, cap, huruf poster.
Semua efek itu dipakai **terkendali**. Konten (judul, cover, tombol) selalu lebih menonjol daripada tekstur.

| Ya | Tidak |
| --- | --- |
| Sudut tegas (`rounded-none`), garis tinta tebal, bayangan sablon | Sudut membulat besar, glassmorphism, gradien neon |
| Satu aksen mustard per area | Banyak warna aksen bersaing |
| Tekstur tipis di latar belakang | Tekstur di atas teks paragraf |
| Bahasa Indonesia santai dan lugas | Jargon korporat |

## 2. Logo

- **Lockup resmi**: wordmark RAVE / garis miring / `ROLLIEMONKIE · AUDIO VISUAL · EXPERIMENT` (3 baris, Space Mono).
  Komponen: `RaveLockup` di `apps/web/src/components/ui/RaveLogo.tsx`, rasio 410:100.
- **Ikon**: stiker piringan hitam "V" (`assets/brand/rave-icon.svg`, `RaveMark`). Super Admin dapat menggantinya lewat `branding.icon_url`.
- Varian: `rave-logo.webp` (di latar gelap), `rave-logo-dark.webp` (di latar terang). Jangan diwarnai ulang atau diberi efek.
- Ruang kosong minimal di sekeliling logo = tinggi huruf "R". Tinggi minimal 24px (ikon) atau 32px (lockup).

## 3. Warna

Token didefinisikan di `apps/web/src/index.css` (`@theme`).

| Token | Hex | Peran |
| --- | --- | --- |
| `rave-ink` | `#181818` | Kanvas utama, teks di atas mustard/paper |
| `rave-paper` | `#EDEDED` | Teks di atas gelap, permukaan "kertas" |
| `rave-mustard` / `rave-primary` | `#F4C21F` | **Aksen primer**: CTA, status aktif, eyebrow. Selalu berteks ink (kontras 10,9:1) |
| `rave-purple` | `#5B2A6E` | Warna merek: panel hero, banner, cahaya latar |
| `rave-purple-soft` | `#7A3E91` | Cahaya/glow ungu |
| `rave-plum` | `#2A1233` | Gradasi transisi ungu → ink |
| `rave-berry` | `#8A2F3F` | Stiker/label sekunder |
| `rave-teal` | `#1F5C52` | Aksen data/status sekunder (jarang) |

Netral app (`rave-*`): `black #0E0C0F`, `base #181818`, `elevated #1F1D21`, `highlight #2B282E`, `line #2E2B31`,
`muted #BDB8C2`, `subtle #807A86`.

Aturan: mustard hanya satu titik fokus per layar. Merah (`red-500`) hanya untuk status **LIVE** dan error.

## 4. Tipografi

| Peran | Font | Pemakaian |
| --- | --- | --- |
| Display | **Staatliches** (`font-display`) | Judul h1–h2, angka besar, headline banner. Selalu kapital, `leading` 0.86–1.0 |
| Label | **Space Mono** (`font-label`, `.rave-label`) | Eyebrow, tanggal, katalog, tombol kecil. 10–12px, kapital, `tracking` 0.12–0.18em |
| Paragraf | **Bricolage Grotesque** (`font-sans`) | Teks badan, UI umum |

Judul berbaris tetap (mis. hero landing) memakai `whitespace-nowrap` per frasa agar tidak terjadi pergeseran layout saat font termuat.

## 5. Tekstur & latar

| Kelas | Dipakai di | Catatan |
| --- | --- | --- |
| `.rave-app-canvas` | Kanvas **semua** halaman app pendengar | Satu sumber: raster halftone 45° halus (`assets/brand/app-dots.webp`, strip 12px), cahaya ungu tipis kanan atas (α 0,14), gradasi plum → ink |
| `glow(color)` (`components/fan`) | Header tiap halaman app | Hanya menambah cahaya warna transparan. Jangan menambah pola titik baru |
| `.rave-dots` | Permukaan kecil (banner pratinjau, pita) | Titik paper α 0,07, grid 8–9px |
| `.rave-grain`, `.rave-crumple`, `.rave-poster` | Landing & halaman publik | Kertas fotokopi, kertas kusut, poster terlipat (`assets/brand/*.webp`) |
| Halftone kasar (`paper-halftone.webp`) | Kartu daftar berita, landing | Dibaurkan `multiply`/`screen`, jangan di bawah teks paragraf |

Prinsip: **tipis dan konsisten**. Pola titik baru tidak boleh dibuat per halaman. Ubah sumbernya di `index.css`.

## 6. Komponen khas

- **Kartu**: `.rave-card` (+ `-hover`, `-label`, `-paper`), `.media-card`, `.rave-tilt` (kemiringan halus bergantian pada grid).
- **Ornamen zine**: `.rave-sticker`, `.rave-stamp`, `.rave-taped`, `.rave-stapled`, `.rave-ransom`, `.rave-catno`. Maksimal 1–2 ornamen per kartu.
- **Pita**: `.rave-band` (marquee kuning), `.rave-rail`.
- **Pemutar**: kontrol tape deck `.deck-tray` / `.deck-key` / `.deck-led`.
- **Tombol**: primer = mustard + teks ink, sudut tegas. Sekunder = garis `white/25`, hover `white/60`.

## 7. Iklan

- Audio/visual di pemutar: `components/ads/AdCard.tsx` (placement `between_tracks`, `podcast_preroll`).
- Banner display: `components/ads/SponsorBanner.tsx`. Tinggi tetap 128px (≥ sm) sehingga tidak menggeser layout.
  Selalu berlabel **Iklan**, menautkan ke "Tentang iklan" (`/iklan`), dan memakai `rel="sponsored"` pada tautan keluar.
  Tidak tampil untuk pengguna Premium. Slot: landing (setelah testimoni) dan Beranda app (setelah "Playlist pilihan").
- Kreatif pengiklan memakai visual pengiklan sendiri. Bingkai, label, dan tombol tetap mengikuti token RAVE.

## 8. Gerak

- Motion (`motion/react`) untuk masuk (rise/fade, 0,3–0,6 dtk, easing `[0.22, 1, 0.36, 1]`).
- Selalu hormati `prefers-reduced-motion` (`useReducedMotion`, `motion-safe:`/`motion-reduce:`).
- Animasi tidak boleh mengubah ukuran layout. Sediakan penahan lebar (contoh: `RotatingWord`).

## 9. Aksesibilitas & performa (wajib)

- Satu `h1` per halaman. Gambar dekoratif `alt=""`. Tombol ikon wajib punya nama aksesibel.
- Kontras teks ≥ 4,5:1 (mustard di atas ink 11:1; paper di atas ink 14:1).
- Target sentuh ≥ 40px. Tidak ada scroll horizontal pada lebar 320px.
- Aset raster `webp`. Gambar di bawah lipatan pakai `loading="lazy" decoding="async"`. Target CLS < 0,1.
