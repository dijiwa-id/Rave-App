# Changelog

Semua perubahan penting RAVE. Format: [Keep a Changelog](https://keepachangelog.com/id/1.1.0/), versi: [SemVer](https://semver.org/lang/id/).
Bagian rilis dibuat otomatis oleh `npm run release` (docs/VERSIONING.md); tulis catatan manual di bawah **Unreleased**.

## [Unreleased]

### Fitur

- **unduhan offline (P-7, backend):** fondasi unduhan offline Premium di balik saklar `download.enabled` (default **mati**) — pengaturan grup baru `download` (rollout per ID akun, paket, batas per perangkat, TTL lisensi 30 hari, cek ulang 72 jam, 60 lisensi baru/jam, podcast, kualitas AAC 160); perangkat `GET/POST/DELETE /v1/me/devices` (kunci publik ECDH P-256, batas `subscription.download_devices`); izin `offline_allowed` per lagu/episode di Studio; artefak AAC terenkripsi `RAVEOFL1` dibuat lazy oleh antrean konkurensi 1 di catalog; lisensi bertanda tangan Ed25519 `POST/GET/DELETE /v1/offline/licenses`, `POST /v1/offline/recheck`, `GET /v1/offline/pubkey`; pencabutan otomatis saat Premium berakhir, perangkat dicabut, atau rilis ditarik/izin dimatikan. Migrasi: iam `015_devices`, catalog `020_offline`, playback `005_offline`. Env opsional `OFFLINE_KEY` (default diturunkan dari `KYC_KEY`). Perlindungan lisensi, **bukan DRM penuh** — lihat docs/adr/0004-unduhan-offline.md & docs/API.md §12.

- **unduhan offline (P-7 T6):** laporan putar offline `POST /v1/events/offline-plays` (batch ≤ 200, idempoten per `(device_id, seq)`, respons per putar `accepted`/`duplicate`/`rejected(reason)`). Validasi lisensi milik pengguna+perangkat+konten, jendela `started_at` (terbit … kedaluwarsa/dicabut, perangkat dicabut, skew 5 menit, umur maks `download.report_max_age_days` = 35 hari — pengaturan baru), `played_ms` dipangkas ke durasi, tanpa tumpang tindih per perangkat, ≤ 24 jam per hari WIB. Yang lolos memakai logika qualified stream yang sama dengan jalur online (fraudCheck, ambang, agregat sumber `offline`, event `playback.stream.qualified` dengan `source: "offline"`); tetap diterima walau `download.enabled` mati. Batch diserialkan per pengguna (advisory lock) dalam satu transaksi + outbox. Migrasi playback `006_offline_plays` (aditif: `qualified_streams.origin/played_at`, `offline_plays.reported_played_ms/qualified_at`, indeks). Endpoint internal catalog `POST /internal/playback/meta`. Rute gateway baru (dilayani saat pemeliharaan). Perubahan jalur online: hitungan fraud `RATE_LIMIT` memakai waktu dengar (identik untuk data online).
- **unduhan offline (P-7, laporan):** laporan Super Admin `GET /v1/admin/reports/downloads` (Pengaturan Layanan → Unduhan → tab Laporan) — playback mengagregasi lisensi & putar offline + statistik perangkat iam + artefak catalog (endpoint internal baru `/internal/reports/downloads` di iam & catalog, hanya token service). KPI perangkat, lisensi per status/alasan cabut, artefak, putar offline diterima/ditolak/qualified, permintaan menunggu; tren lisensi baru 14 hari; 10 konten paling banyak diunduh. Kontrak `ServiceReport` mendapat field opsional `extra_series`/`extra_tables` (aditif: putar diterima per hari, artefak gagal terbaru). Hulu gagal → KPI `null`, bukan 5xx. Migrasi indeks: playback `008_offline_report`, catalog `022_offline_report`, iam `017_device_report` (tabel P-7 kecil, aman di transaksi migrasi).
- **royalti (P-7 T7):** stream dari unduhan offline dihitung setara stream Premium online (user-centric/pro-rata, hitungan yang sama). Periode royalti untuk putar offline ditentukan saat laporan **diterima** — periode yang sudah ditutup tidak dibuka ulang (ADR-0004 §Putar offline & royalti). `/internal/royalty/streams` menambahkan `offline: { streams, listeners, played_before_period }` dan draf periode memuat anomali info `OFFLINE_STREAMS`.

### Perbaikan

- **unduhan offline (P-7, review keamanan):** `OFFLINE_KEY` kosong (`OFFLINE_KEY=` di env_file) tidak lagi menghasilkan kunci offline yang bisa dihitung publik — di produksi service menolak start bila `OFFLINE_KEY` ada tetapi kosong/< 32 karakter/sama dengan secret lain, tanpa OFFLINE_KEY/KYC_KEY tidak pernah jatuh ke JWT secret, dan `prod-preflight` memeriksanya. Permintaan lisensi yang menunggu artefak (202) kini dihitung ke kuota per jam & dibatasi `download.pending_per_user`; antrean artefak global dibatasi `download.queue_max` (503 `queue_full` + `Retry-After`). Hanya OWNER/ADMIN org artis yang bisa mengubah `offline_allowed` (VIEWER/FINANCE 403). Tangguhkan/hapus akun mencabut semua lisensi (event baru `iam.user.suspended`, `iam.user.deleted`; data perangkat dikosongkan saat akun dihapus). Pendaftaran perangkat wajib berhak unduhan, dibatasi `download.devices_per_day`, dan kunci yang baru dicabut diblokir `download.device_reregister_block_days`. Watermark pencabutan mencegah lisensi terbit bersamaan dengan pencabutan. Job artefak tahan klaim ganda; kunci segel berganti → artefak dibangun ulang (bukan 500). Recheck dibatasi `download.recheck_per_minute` dan mengembalikan `unchanged` (aditif). `/internal/offline/key` & `/internal/offline/entitlement` hanya token service. Galat hulu tak terpetakan → 502 `upstream_error`. `download.tiers` berbahaya & minimal 1 paket. Kode Problem baru: `queue_full`, `device_rate_limited`, `upstream_error`. Migrasi: iam `016_device_guards`, catalog `021_offline_key_id`, playback `007_offline_guards`. Langkah pra-deploy indeks `qualified_user_played_idx`: docs/OPERATIONS.md §5.
- **iam (P-7, review keamanan M3):** anggota org MANAGEMENT tidak lagi otomatis mendapat klaim `ADMIN` di setiap org ARTIST yang dikelola. Peran efektif kini mengikuti peran di manajemen: OWNER/ADMIN → `ADMIN`, MEMBER → `MEMBER`, FINANCE/VIEWER → `VIEWER` (FINANCE tidak diturunkan sebagai FINANCE agar tidak membuka penarikan dana wallet artis). Beberapa org manajemen mengelola artis yang sama → peran tertinggi; keanggotaan langsung di org artis tetap dipakai dan hanya dinaikkan bila VIEWER/MEMBER (OWNER/FINANCE langsung tidak pernah ditimpa). Dampak: VIEWER/FINANCE/MEMBER manajemen kehilangan aksi OWNER/ADMIN org artis (mis. `offline_allowed`, RAVE Pro, hapus show podcast, batalkan event); VIEWER/FINANCE manajemen juga kehilangan aksi MEMBER (buat/ubah podcast, event, sesi live). Kerja Studio/booking lewat `managedArtistIds` tidak berubah. Klaim lama di JWT tetap berlaku sampai token akses diperbarui (≤ 15 menit). Payload `iam.org.member_added` untuk jalur manajemen kini membawa peran efektif (informasional). Tanpa migrasi.
- **unduhan offline (P-7, review keamanan putar offline):** laporan `POST /v1/events/offline-plays` diperketat. fraudCheck `RATE_LIMIT` untuk putar offline dihitung **dua arah** (jendela 1 jam mana pun yang memuat waktu dengar) — putar yang dikirim berurutan waktu menurun tidak lagi lolos batas per jam; urutan menaik identik dengan sebelumnya, jalur online tidak berubah hasilnya. Tumpang tindih & batas 24 jam/hari WIB kini **per akun** (semua perangkat), bukan per perangkat. Batch diserialkan dengan kunci *try*: batch lain akun sedang diproses → `429 rate_limited` + `Retry-After: 5` seketika (tidak lagi menahan koneksi pool); ember laju baru per akun `download.report_per_minute` (pengaturan baru, default 30). Jalur online mengambil kunci pengguna yang sama saat mencatat qualified stream. Akun ditangguhkan/dihapus → `403 account_suspended` untuk seluruh batch (tidak disimpan; bisa dikirim ulang). Alasan tolak baru `after_membership` (putar sejak `member_until` saat Premium tidak aktif). Penolakan tersimpan dibatasi 1000/perangkat/hari dan dibersihkan job baru `offline-plays-purge` setelah `download.report_max_age_days` + 1 hari. Galat iam/catalog dipetakan sama dengan `/v1/offline/*` (`502 upstream_error`). Migrasi playback `009_offline_plays_user_guards` (indeks saja).
- **unduhan offline (P-7, S1):** masa Premium yang berakhir alami kini diumumkan iam — job baru `member-expiry` (tiap 10 menit, berbatch, idempoten, aman multi-replika) menerbitkan `iam.user.member_changed` sekali per masa untuk akun berbayar dengan `member_until` yang sudah lewat, sehingga playback mencabut lisensi offline (`MEMBERSHIP`) tanpa menunggu recheck klien. Payload aditif `reason: "EXPIRED" | "ADMIN"` (jalur Super Admin = `ADMIN`; `EXPIRED` mengirim `premium: false`). Saat deploy pertama, semua akun yang masanya sudah lewat diumumkan sekali. Migrasi iam `018_member_expiry` (kolom nullable + indeks parsial).
- **unduhan offline (P-7, S2):** `PATCH /v1/studio/tracks/:id` dengan body campuran pada rilis draf/ditolak (mis. `{ title, offline_allowed: false }`) kini melewati jalur `offline_allowed` yang sama dengan body murni — audit `track.offline_allowed` dan event `catalog.offline.revoked` saat dimatikan — dan seluruh perubahan disimpan dalam satu transaksi. Sebelumnya `offline_allowed` ditulis tanpa audit & tanpa pencabutan. Tanpa migrasi.
- **booking:** Chromium untuk PDF kontrak di-recycle, ditutup saat idle/shutdown, dan render dibatasi konkurensinya (#4). Browser yang crash/terputus otomatis diganti. Env baru (opsional): `CONTRACT_PDF_MAX_RENDERS` (default 25), `CONTRACT_PDF_IDLE_MS` (default 60000), `CONTRACT_PDF_CONCURRENCY` (default 2) — lihat docs/generated-contract.md.

## [0.5.0] — 2026-11-21

### Fitur

- bagikan lagu ke Instagram/X/Facebook, unduhan aplikasi, performa LCP & satu loader (9399021)
- **web:** piringan hitam vintage hyperrealistic — tekstur alur, debu, baret, patina & label kertas tua (backup desain lama di design-backup/) (2e42bc3)
- **berita:** back office Ruang Berita & halaman /berita dari API (9c7a06b)

### Perbaikan

- **nginx:** kutip regex lokasi /s/t/ (kurung kurawal {36} membuat nginx gagal start) (4bc8e77)
- **go-live:** audit e2e — konfigurasi gagal-tertutup, perbaikan alur bisnis, PPN & penalti pembatalan jadi pengaturan Keuangan (a6c863d)
- **berita:** cerita utama unik hanya di antara artikel tayang, slug dinormalkan, pencarian ber-debounce (fb5d83d)
- **web:** area konten dasbor B2B jadi wadah posisi (relative) agar elemen absolut tidak memanjangkan halaman (149a760)

### Lain-lain

- **downloads:** installer RAVE Desktop 0.4.2 & APK Android 0.3.2 terbaru untuk tombol unduh (efeb97c)

### Catatan rilis

### Fitur

- **berita:** Back Office → Konten → **Ruang Berita** (`/admin/news`, izin baru `news.publish`, default peran Editorial). Artikel dwibahasa ID/EN dengan editor blok (paragraf, subjudul, kutipan; tempel beberapa paragraf otomatis dipecah), foto utama 16:9 (unggah `purpose: news`), slug otomatis, cerita utama, pratinjau sesuai tampilan publik, terbitkan sekarang / jadwalkan / batalkan terbit / arsipkan / hapus — semua tercatat di audit log
- **web:** halaman publik `/berita` dan `/berita/:slug` kini membaca artikel dari service Platform (`GET /v1/platform/news`), dengan jumlah per kategori, kerangka muat, keadaan kosong/galat, dan versi bahasa Inggris (fallback ke Indonesia)

- **bagikan:** tombol bagikan lagu ke Instagram Story (kartu 1080×1920), X, dan Facebook di player, panel Sedang Diputar, setiap baris lagu, dan halaman lagu — web, desktop, mobile; `GET/POST /v1/catalog/tracks/:id/share`, halaman Open Graph `/s/t/:id` dengan gambar pratinjau 1200×630 berlogo RAVE asli (kartu Instagram Story juga memakai logo asli), Super Admin → Pengaturan Layanan → **Bagikan ke Medsos** (saklar per platform, teks & tagar) + laporan
- **unduhan:** folder `downloads/` (installer Windows + APK Android, `npm run apps:publish`) disajikan di `/downloads/`; menu unduh di header player, halaman `/unduh`, Landing & footer
- **keuangan:** PPN langganan (`finance.subscription_ppn_pct`) & kompensasi pembatalan artis (`finance.artist_cancel_penalty_pct`, dibekukan per kontrak) jadi pengaturan Super Admin → Keuangan
- **desain:** piringan hitam vintage hyperrealistic (web, desktop, mobile) + loader boot tunggal

### Perbaikan

- **go-live:** konfigurasi produksi gagal-tertutup (`PUBLIC_WEB_URL` wajib, saklar dev keuangan ditolak), Midtrans `deny` tidak membatalkan order, kunci wallet denda artis, batas tiket per akun, akses chat siaran bertiket, validasi event iklan
- **performa:** varian gambar WebP `?w=` dari ffmpeg + cache, preload gambar hero per rute, satu loader (LCP 4G lambat: /berita 8,1→4,7 dtk, /login 9,4→3,8 dtk)

### Catatan deploy

**Wajib baca `docs/DEPLOY-NEXT.md`** — `rave.danantrex.my.id` masih v0.3.1 (ketinggalan v0.4.0–v0.4.2 + semua di atas). Migrasi baru: platform `005_news_featured`, catalog `019_track_shares`; `PUBLIC_WEB_URL` wajib; folder `./downloads` harus ada di server; image gateway, web, catalog wajib dibangun ulang.

## [0.4.2] — 2026-11-21

### Perbaikan

- **service-kit:** muat pengaturan platform sebelum menerima permintaan (6a1a6b3)

### Catatan rilis

### Perbaikan

- **service-kit:** pengaturan platform dimuat sebelum service menerima permintaan (coba ulang ±20 dtk bila platform belum siap) — sebelumnya beberapa detik setelah restart/deploy service melayani nilai bawaan registri, mis. saklar penjualan RAVE Pro yang dimatikan Super Admin terbaca menyala

## [0.4.1] — 2026-11-21

### Fitur

- **iam:** login Google native untuk aplikasi mobile (Credential Manager Android) (067c2ea)

### Perbaikan

- **gateway:** CORS mengizinkan origin aplikasi RAVE Desktop (Tauri) (d11d4eb)

### Catatan rilis

### Perbaikan

- **gateway:** CORS produksi kini selalu mengizinkan origin aplikasi RAVE Desktop (`tauri://localhost`, `http(s)://tauri.localhost`) selain origin web — sebelumnya preflight dari aplikasi desktop dijawab tanpa `Access-Control-Allow-Origin` sehingga API & stream ber-`crossOrigin` (equalizer/spektrum) diblokir. Dapat dimatikan dengan `CORS_APP_ORIGINS=0`.

### Fitur

- **iam:** login Google native untuk aplikasi mobile — `POST /v1/auth/oauth/google/native {id_token}` memverifikasi ID token Credential Manager Android (tanda tangan JWKS Google di-cache, aud = Client ID web, iss, exp) lalu memakai alur akun & 2FA yang sama; `GET /v1/auth/oauth/providers` kini menyertakan `google_client_id` (publik) sebagai `serverClientId` aplikasi

## [0.4.0] — 2026-11-21

### Fitur

- **royalty:** royalti streaming bulanan + Laporan Penggunaan Musik LMKN (BRD §4.3, §7.5, REQ-ROY-02..04) (c4df5ee)
- **pro:** RAVE Pro — langganan B2B organisasi (BRD §4.1, REQ-PAY-03) (8544424)
- **iam:** verifikasi akun (badge Verified) sekaligus KYC identitas (NIK) + OTP email/WhatsApp (1964adb)

### Catatan rilis

### Fitur

- **royalty:** Royalti streaming bulanan (BRD §4.3, §7.5, REQ-ROY-02..04): periode bulan WIB, atribusi pendapatan Premium (DPP prorata) & iklan (per impresi) ke pendengar, UCPS hybrid / pro-rata, split MASTER/PUBLISHING per lagu (ditahan sampai split disetujui, dilepas otomatis), pihak belum terdaftar diklaim saat mendaftar, cadangan koreksi + pelepasan otomatis, PPh & ambang terutang (dibawa, tidak hangus), kontrol ganda hitung/setujui, terbit otomatis tgl statement, jurnal ledger & wallet sumber royalti, anomali untuk review Finance, ekspor rincian, Laporan Penggunaan Musik LMKN (.xlsx template resmi PP 56/2021 terisi otomatis) & log CSV untuk unggah massal SILM; Studio → Royalti (statement per lagu/sumber/kota, CSV, cetak), Back Office → Royalti (meja kerja periode); izin baru `royalty.manage`
- **pro:** RAVE Pro — langganan B2B organisasi (BRD §4.1, REQ-PAY-03): paket Starter/Pro/Label bulanan & tahunan, checkout lewat invoice SUBSCRIPTION (sandbox/Midtrans), PPN keluaran terpisah di ledger, upgrade prorata, downgrade terjadwal, berhenti/lanjutkan, tagihan perpanjangan otomatis, masa tenggang & kedaluwarsa
- **booking:** take rate Pro per booking (promotor 3%, artis 5% bila org artis/manajemennya Pro), dikunci di kontrak; Insight Pro (konversi, GMV, pipeline, waktu ke kontrak, kota, kategori, roster, mitra) + ekspor CSV
- **iam:** status Pro di profil org (`/v1/me`), batas roster multi-roster per paket, pencarian org Back Office
- **web:** halaman RAVE Pro & Insight Pro di Artist Studio dan Promotor Hub, rincian tarif Pro di booking, Back Office → RAVE Pro (MRR, paket komplimen, pencabutan), layanan RAVE Pro di Super Admin siap dipakai

## [0.3.1] — 2026-11-21

### Fitur

- **web:** tata letak seragam halaman bergabung Promotor, Artis & Podcaster (120dc76)
- **iam:** verifikasi 2 langkah (2FA) wajib setelah login + kode pemulihan (6cffc65)
- **iam:** masuk dengan aplikasi authenticator (TOTP, RFC 6238) (93ba4d1)
- **landing:** popup kota bergantian di Audience Match, kolase Join the next dengan kaset berwarna, walkman & turntable (e3cc84f)
- Podcaster, Back Office editorial & podcast, kebijakan iklan tier Gratis/anonim, unggah berkas iklan (450f0ef)
- **library:** API editor playlist editorial untuk Back Office (izin library.curate) (60ad393)
- **iam:** login sosial Google/Facebook/Apple untuk web, desktop & mobile (9ebcc16)
- spektrum per lagu, player web dirombak, kebijakan kualitas & Studio rilis baru (768f8fd)
- **demo:** snapshot data demo dari DB dev + skrip export/import (a738396)
- **ops:** deploy VPS kecil tanpa build di server (scripts/vps.sh) (b232756)
- **web:** sistem tombol seragam, Kategori Jelajahi baru, tema gelap stabil (13af416)
- **catalog:** taksonomi genre bersama — 79 genre kekinian global & Indonesia (b1033dc)

### Perbaikan

- **iam:** onboarding hanya untuk login pertama (75eab8d)
- **platform:** cek kesehatan gateway via GATEWAY_URL, bukan 127.0.0.1 (d5d3d22)
- **onboarding:** artis favorit boleh dilewati saat katalog kosong (81028f3)
- **ads:** promosi internal tanpa frequency cap agar iklan setiap lagu tetap tayang; tunggu event complete sebelum jeda (663e8d5)
- **ops:** vps.sh — arsip storage lewat stdout, skrip remote sebagai berkas (b6691c4)
- **catalog:** sinkronkan taksonomi genre saat boot (produksi tanpa seed) (8ff65ce)
- **stability:** galat input Postgres jadi 4xx, timeout upstream gateway (e27baf3)

### Performa

- **web:** font di-host sendiri (woff2 latin & latin-ext) (0d5bad9)
- **live:** kanal demo dari loop pra-render tanpa encode ulang (8f96b0a)

### Lain-lain

- bersihkan dead code (import, parameter, export & komponen tak terpakai) (9c4071e)

### Catatan rilis

### Diperbaiki
- **Iklan "setiap lagu" tier Gratis berhenti setelah beberapa lagu**: promosi internal RAVE kini tidak terkena frequency
  cap harian (dirotasi: yang paling jarang tampil ke pendengar hari itu), sehingga slot iklan tetap terisi setelah
  kampanye berbayar mencapai batas 3×/hari. Klien web menunggu event `complete` terkirim (maks 2 dtk) sebelum meminta
  jeda iklan agar lagu sudah tercatat.

### Fitur
- **Tier Gratis: tidak bisa menggeser lagu** (pengaturan publik baru `streaming.free_seek_enabled`, default mati): di web,
  desktop & mobile, slider progres hanya tampilan (ikon kunci + toast "Geser lagu khusus Premium"); pintasan keyboard,
  media session/layar kunci, dan ketuk lirik juga diabaikan. "Sebelumnya" tidak mengulang lagu dari awal — langsung ke
  lagu sebelumnya. Pemulihan stream internal tetap berjalan.
- **Iklan setelah setiap lagu untuk tier Gratis**: default kebijakan iklan diubah — masa bebas harian 0, jeda waktu 0
  menit (min. kini 0), 1 lagu antar-jeda, 1 iklan per jeda, batas 20 iklan/jam (maks 30). Tetap bisa diatur Super Admin.
- **Iklan untuk pengguna anonim** (`ads.anonymous_enabled`, default aktif; migrasi ads `003_anonymous_impressions`):
  setelah pratinjau 30 detik berakhir, pengguna yang belum masuk menerima satu iklan (penargetan kontekstual saja) lalu
  lanjut ke pratinjau berikutnya; impresi anonim dilaporkan tanpa login.
- **Super Admin → Iklan: unggah audio & gambar iklan dari komputer** (purpose upload baru `ad`, migrasi catalog
  `016_ad_upload`, izin `ads.manage`): audio MP3/AAC/OGG/Opus ≤ 8 MB dan ≤ `ads.max_audio_seconds`, diputar apa adanya
  (tanpa transcoding) dan disajikan publik (`<id>.ad.<ext>`, bukan master berhak cipta); gambar JPG/PNG ≥ 300 px
  (saran 16:9). Kampanye kini menerima berkas unggahan selain tautan HTTPS.
- **Formulir kampanye iklan dirombak**: 4 langkah bernomor (Pengiklan · Format & pesan · Media · Jadwal & target), kartu
  pilihan format, penghitung karakter, ubin media dengan pratinjau gambar/pemutar audio, footer tetap dengan ringkasan
  galat; responsif (mobile: satu kolom, pratinjau di bawah, tombol selebar layar).
- **Back Office → Konten → Playlist Editorial** (`/admin/editorial`, izin `library.curate`): daftar draf/tayang dengan
  urutan beranda (naik/turun), buat playlist, ubah judul/deskripsi/tag, unggah sampul atau kembali ke sampul otomatis,
  tayangkan/jadikan draf, hapus, tambah lagu sekaligus dari pencarian katalog, pindah & hapus lagu.
- **Podcaster** (`services/catalog/src/podcasts.ts`, migrasi catalog `015_podcaster`): kreator membuat acara podcast/audio
  fiksi & episode dari **Artist Studio → Podcast** atau **Podcaster Studio** (`/podcaster`, akun Kreator baru tanpa profil
  artis). Episode bisa **unggah audio** (purpose `podcast`: batas tersendiri, tanpa standar master lagu & tanpa transcoding)
  atau **embed iframe dari platform lain** (Spotify, YouTube, Apple Podcasts, SoundCloud, Spotify for Creators) — hanya URL
  embed kanonik yang disimpan, dirender sebagai iframe ber-sandbox, tidak dihitung stream. Draf → tinjauan → tayang;
  katalog publik & pemutar hanya melihat episode tayang dari acara aktif.
- **Back Office → Konten → Moderasi Podcast** (`/admin/podcasts`, izin baru `podcast.moderate` untuk Content QC &
  Editorial): antrean tinjauan dengan pratinjau audio/embed, setujui/tolak beralasan, sembunyikan episode/acara.
- **Pengaturan baru**: grup **Podcaster** (penerbitan kreator, jenis akun, tinjauan wajib, audio fiksi, batas acara &
  durasi, episode Premium, embed + daftar platform), grup **Upload** (kunci upload `storage.*` dipindah ke sini + audio
  episode maks, kuota per akun, batas harian, resolusi artwork/sampul minimum), dan **Live Streaming** (jenis akun yang
  boleh siaran, siaran terbuka per akun, siaran bertiket, panjang chat) — semuanya ditegakkan di backend.
- **Editor playlist editorial (API Back Office)** (`services/library/src/editorial.ts`, izin baru `library.curate`
  untuk Super Admin & peran Editorial): `/v1/admin/library/playlists` — daftar (termasuk draf), buat (default draf),
  ubah judul/deskripsi/sampul/tag, tayang/draf, hapus, urutan tampil di beranda, tambah lagu sekaligus (duplikat
  dilewati, lagu tak tersedia ditolak). Hapus/pindah lagu memakai endpoint playlist biasa. Draf tidak tampil di
  beranda; semua perubahan tercatat di audit log. Migrasi library `005_editorial_publish`.
- **Tema dipindah ke Pengaturan (web):** tombol cepat Gelap/Terang di header aplikasi dengar dihapus untuk pengguna
  yang masuk — tema dipilih di **Pengaturan → Tampilan** (Gelap / Terang / Ikuti sistem, tersinkron ke akun).
  Tamu (tanpa akses Pengaturan) tetap mendapat tombol cepat di header.
- **Login sosial: Google, Facebook & Apple** (`services/iam/src/oauth.ts`) — alur authorization code di server
  (state sekali pakai, PKCE + nonce untuk Google, client secret ES256 untuk Apple, cookie pengikat browser melawan
  login-CSRF). Callback mengalihkan ke `/login?oauth_code=…`, lalu web menukar kode sekali pakai 60 dtk lewat
  `POST /v1/auth/token` (`grant_type=oauth_code`), jadi token tidak pernah muncul di URL. Akun ditautkan lewat email terverifikasi; akun baru
  juga mendapat identitas email (bisa masuk via OTP). Kredensial diatur di **Super Admin → Integrasi → Login
  sosial** (terenkripsi, lengkap dengan Redirect URI siap salin; cadangan env `GOOGLE_CLIENT_ID`, …). Halaman Masuk
  hanya menampilkan tombol provider yang aktif. Provider **Simulasi (dev)** untuk menguji alur tanpa pihak ketiga
  (khusus development). Migrasi iam `008_oauth`, platform `003_social_integration`, iam `009_oauth_app`.
  **Aplikasi desktop & mobile** memakai alur bergaya device flow: `POST /v1/auth/oauth/:provider/app` → browser sistem
  (halaman konfirmasi dengan kode pencocokan, mencegah tautan masuk kiriman orang lain) → polling
  `POST /v1/auth/oauth/poll` (428 menunggu · 200 token sekali ambil · 410 kedaluwarsa); tanpa deep link/perubahan native.
- **Karaoke: kolom lirik bergulir mulus** (`components/fan/LyricScroller.tsx`) — pita lirik digeser satu transform GPU
  sehingga baris aktif meluncur ke tengah (bukan potongan antar-baris) dan berwarna mustard solid (tanpa sapuan/masking); baris lain lebih kecil (72%) & blur bertahap
  sesuai jarak dengan tunda bergelombang. Klik baris mana pun untuk lompat; roda/seret untuk menjelajah, kembali
  mengikuti lagu otomatis setelah 4 dtk atau lewat tombol "Ikuti lirik". Tepi atas/bawah memudar; hover hanya aktif
  saat mouse bergerak; gerak dikurangi → tanpa transisi/blur.
- **Panggung karaoke lebih bersih:** orbit, garis gelombang titik & cincin denyut dihapus (gradien & overlay titik halus
  dipertahankan); piringan hitam realistis kini jelas, menyembul sebagian dari tepi kanan & berputar pelan (14 dtk/putaran).
  Logo + "KARAOKE" dan lirik tepat di tengah (tracking diimbangi); tombol keluar disederhanakan jadi ikon X (Esc tetap).
- **Karaoke: spektrum EQ asli** — panggung karaoke kini memakai spektrum yang mengikuti lagu (sama dengan LCD pemutar &
  desktop), menggantikan equalizer dekoratif.
- **Kaset realistis di "pita masih kosong"** (`components/fan/Cassette.tsx`): kaset SVG berproporsi asli — cangkang
  plastik asap bertekstur, sekrup Phillips, label kertas pita ungu RAVE + sisi A, jendela kaca dengan gulungan pita &
  hub bergigi, area head bawah; gulungan berputar pelan saat di-hover (gerak dikurangi → diam).
- **Artist Studio: wizard rilis baru** (`pages/studio/NewRelease.tsx`) — 6 langkah (Info → Lagu → Artwork → Lirik →
  Split → Tinjau) dengan validasi per langkah, daftar periksa sebelum kirim, dan draf tersimpan otomatis per artis
  (dilanjutkan saat kembali ke halaman).
- **Studio: dek unggah master** (`components/studio/upload-deck.tsx`) — antrean 2 unggahan sekaligus, progres byte nyata
  (XHR), tahap pemeriksaan server, polling status transcoding, batal & coba lagi.
- **Studio: meja kerja lirik** (`components/studio/lyrics-workbench.tsx`, `lib/lrc.ts` + tes) — teks biasa ↔ LRC
  tersinkron, impor .lrc/.txt, ketuk waktu sambil memutar pratinjau (Enter/Spasi), geser ±100 ms, validasi per baris
  (cermin aturan server), pratinjau ala pemutar. Format simpan tidak berubah.

## [0.3.0] — 2026-11-13

### Fitur

- **web:** sidebar Back Office per area sidebar Back Office per divisi & jenis layanan jenis layanan, pengaturan per layanan (530005a)
- **admin:** laporan per sub-layanan (KPI, tren 14 hari, tabel) (b38489e)
- **catalog:** kelola kategori Jelajahi dari Back Office + izin Kurasi katalog (f29e676)
- **contract:** Tahap 3 — templat spk-v2, PDF Puppeteer, QR, hash, storage privat, verifikasi publik (eb95613)
- **contract:** fondasi Generated Contract — state machine kontrak, termin/pajak/split, skema berversi, dokumen asumsi (c4aeb0e)
- **platform:** fondasi Super Admin — registri pengaturan, klien settings, stats internal, retry dead letter, kontrak API §9 (160f765)
- platform GEMA — 8 microservice, gateway, web (landing, fan app, studio, promotor hub, back office) (eb6c91b)
- **domain:** katalog seed deterministik (5bbad14)

### Perbaikan

- **domain:** ekspor modul contract dari index (cfe6fba)
- scripts sebagai ES module (ba0d0ce)

### Lain-lain

- sertakan seluruh perubahan kerja lokal (live, ads, platform, web, pengaturan kontrak) (968ad36)
- fondasi monorepo GEMA (service-kit, domain, gateway, notification, web shell) (0470811)

## [0.2.0] — 2026-11-13

### Fitur

- **web:** mode karaoke — lockup logo RAVE + KARAOKE, grafis orbit planet (84b6270)
- **catalog:** persetujuan rilis fase awal cukup admin RAVE / Super Admin (b1c14de)
- **iam:** jenis member per akun diatur Super Admin; dev: Super Admin bebas batas OTP (a068296)
- **studio:** edit rilis lewat QC, pengaturan lirik; audit kebersihan & performa (201378d)
- batch 2 go-live, profil artis, sampul & kurasi artwork, dev auto-reload (b2d9746)
- kesiapan go-live — integrasi email & Midtrans, kontrol payout, backup off-site, monitoring (6967ca8)
- audio multi-format + HQ/Lossless khusus Premium, sampul playlist, audit stabilitas (bf5a54c)
- **contract:** Tahap 3 — templat spk-v2, PDF Puppeteer, QR, hash, storage privat, verifikasi publik (27a2ee3)
- **contract:** fondasi Generated Contract — state machine kontrak, termin/pajak/split, skema berversi, dokumen asumsi (ce2746b)
- **platform:** fondasi Super Admin — registri pengaturan, klien settings, stats internal, retry dead letter, kontrak API §9 (766140f)
- platform GEMA — 8 microservice, gateway, web (landing, fan app, studio, promotor hub, back office) (496aa6b)
- **domain:** katalog seed deterministik (2277964)

### Perbaikan

- **go-live:** batch 1 — hak admin, master audio, refund booking, payout, KYC, kontrak, force majeure (ca1e07e)
- **domain:** ekspor modul contract dari index (f90e67f)
- scripts sebagai ES module (8888e99)

### Performa

- bus & job berbasis sinyal, image produksi JavaScript, healthcheck ringan, batas sumber daya (91915aa)

### Dokumentasi

- audit go-live ulang terhadap BRD/TDD v3.0 (34012c0)

### Lain-lain

- **dev:** ./rave demo — backend demo stabil untuk aplikasi desktop & mobile (6c7266c)
- sertakan seluruh perubahan kerja lokal (live, ads, platform, web, pengaturan kontrak) (62ebf75)
- fondasi monorepo GEMA (service-kit, domain, gateway, notification, web shell) (514c486)

### Catatan rilis

- Rebranding penuh GEMA → RAVE di kode, konfigurasi, skrip, dan dokumen (paket `@rave/*`, env `RAVE_*`, DB `rave`).
  **Breaking (dev):** sesi login lama tidak berlaku (issuer JWT & kunci localStorage berganti); `./gema` → `./rave`;
  `GEMA_PGPORT` → `RAVE_PGPORT`. Data dev lama dipindahkan otomatis oleh `scripts/dev-db.sh`.
- Docker development (`docker-compose.yml`) dan production (`docker-compose.prod.yml`, nginx, Caddy TLS opsional).
- Versioning: `npm run release`, CHANGELOG, workflow rilis GHCR, `/v1/version`, deteksi `version_drift` di `/v1/status`.
- Kesiapan go-live: `npm run prod:preflight`, validasi secret saat boot, CORS terbatas di produksi, docs/GO-LIVE.md.

### Ditambahkan
- **Edit rilis di Artist Studio**: rilis IN_REVIEW dapat ditarik kembali menjadi draf untuk diedit; rilis
  LIVE/SCHEDULED dapat diajukan perubahannya (judul, genre, label, eksplisit, tanggal rilis terjadwal, judul &
  eksplisit lagu) — ditinjau di antrean QC baru, data lama tetap tayang sampai disetujui, artis dinotifikasi.
  Migrasi catalog `010_release_changes_lyrics`.
- **Pengaturan lirik**: artis mengelola lirik tiap lagu (teks biasa atau LRC tersinkron, impor .lrc/.txt, alat
  sinkron ketuk-waktu memakai pratinjau audio, bahasa), validasi stempel waktu & durasi, tercatat di audit log.

### Diperbaiki (audit basecode 2026-11-12)
- Adapter email `log` tidak lagi mencatat subjek — kode OTP login & tanda tangan kontrak tidak masuk log produksi.
- Daftar rilis Studio & antrean QC dimuat batch (2 query, bukan 3+ per rilis) dengan batas; status QC divalidasi.
- Index baru: `tracks.isrc`, `lower(tracks.title)`, rilis per artis, kolaborator playlist per pengguna
  (migrasi catalog `011_perf_indexes`, library `004_perf_indexes`).
- Library: ringkasan dibatasi (riwayat dengar 500 terbaru, follow/simpanan 500); tab Album memakai endpoint batch
  baru `GET /v1/catalog/releases?ids=` (sebelumnya 1 request per album, maks. 30).
- Halaman artis: lagu populer & diskografi dimuat paralel, diskografi dibatasi 100.
- Dihapus: dependency `ogl`, `@hugeicons/*` (diganti lucide), export yang tidak dipakai, build lama `apps/web/dist`;
  dokumen yang masih menyebut stack Docker dev diperbarui.

### Ditambahkan (sebelumnya)
- **Profil artis (Artist Studio)** didesain ulang: pratinjau publik langsung, kartu kelengkapan profil, bar simpan
  dengan peringatan perubahan belum tersimpan, cek ukuran foto/banner. **Tautan sosial & streaming** (Instagram,
  TikTok, YouTube, Spotify, Apple Music, dll., https + host sesuai platform, maks. 8) tampil di halaman artis.
  Foto/banner hanya dari unggahan Studio (URL eksternal ditolak). Migrasi catalog `009_artist_links`.
- **Ganti sampul rilis dari Artist Studio** (rilis LIVE lewat tinjauan QC) dan **Kurasi Artwork Super Admin**
  (ganti langsung / minta artis mengganti); grafik dasbor B2B dirapikan dengan palet RAVE tervalidasi.
- **`./rave dev` dengan auto-reload**: memuat `~/.rave/env.sh` sendiri, Vite polling otomatis di `/mnt/*`, service
  di-restart saat `src` berubah (`RAVE_WATCH`, `RAVE_WATCH_INTERVAL`); restart/stop mematikan seluruh pohon proses.

### Diperbaiki
- Gateway tidak meneruskan `/v1/admin/artwork` ke catalog (halaman Kurasi Artwork selalu 404).

- **Batch 2 go-live (kontrak & alur B2B)**: penampil PDF kontrak spk-v2 + PDF final bertanda tangan dengan Lembar
  Pengesahan & halaman verifikasi publik, tata letak kontrak profesional, pengaturan Legalitas & Dokumen, timeout status
  booking yang macet, notifikasi giliran tanda tangan, undangan & persetujuan split wajib sebelum QC, karya demo lokal
  (tanpa picsum) + fallback gambar di web.
- **Batch 1 go-live (keamanan & uang, docs/GO-LIVE-AUDIT.md)**: admin back office tidak lagi bertindak sebagai OWNER
  semua org/wallet; master audio wajib URL bertanda tangan; refund booking lewat mesin refund; rekening bank terenkripsi
  & payout manual oleh Finance di produksi; KYC wajib untuk payout & event bertiket; pajak/komisi/split dari kontrak;
  force majeure lewat mediasi; denda artis ditagih; ISRC/UPC tanpa kode palsu; klaim produk dikoreksi sesuai D-03.
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
