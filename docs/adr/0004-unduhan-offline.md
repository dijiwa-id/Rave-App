# ADR-0004: Unduhan offline Premium — lisensi per perangkat, bukan DRM penuh

- Status: Diterima — 2026-11-22 (P-7 di `docs/CLIENT-APPS.md`)
- Konteks: Pelanggan Premium ingin mendengar lagu & episode tanpa koneksi di aplikasi desktop (Tauri) dan mobile
  (Flutter). Belum ada vendor multi-DRM (Widevine/FairPlay/PlayReady) dan server produksi adalah VPS 2 GB. Master
  audio tidak boleh pernah keluar; rendisi Premium (AAC 320/FLAC) hanya lewat URL bertanda tangan.

## Keputusan

### Hak & batas (semuanya pengaturan platform, grup `download`, diubah Super Admin)
| Kunci | Default | Arti |
|---|---|---|
| `download.enabled` | **false** (berbahaya) | Saklar induk. Mati → daftar perangkat, terbit lisensi, recheck & daftar lisensi = 403 `offline_disabled`. Hapus perangkat/lisensi & kunci publik tetap dilayani. |
| `download.allow_user_ids` | `[]` | Rollout terbatas; kosong = semua Premium yang memenuhi syarat. |
| `download.tiers` | INDIVIDUAL, STUDENT, DUO | Paket berbayar yang berhak. FREE tidak pernah berhak. |
| `subscription.download_devices` | 5 | Perangkat aktif per akun (perangkat ke-6 → 409 `device_limit` + daftar perangkat). |
| `download.max_tracks_per_device` | 500 | Lisensi aktif per perangkat (→ 409 `device_full`). |
| `download.license_ttl_days` | 30 | Masa berlaku lisensi sejak terbit/recheck terakhir = **batas risiko**. |
| `download.recheck_hours` | 72 | Klien wajib cek ulang saat online setelah `recheck_at`. |
| `download.rate_per_user_hour` | 60 | Lisensi BARU per akun per jam (perpanjangan tidak dihitung) → 429 `rate_limited`. |
| `download.podcast_enabled` | true | Episode unggahan boleh diunduh (episode embed tidak pernah). Live tidak pernah. |
| `download.quality` | `normal` (AAC 160) | Rendisi yang dienkripsi (`low` = AAC 64). Master & Lossless tidak pernah. |
| `download.report_max_age_days` | 35 | Laporan putar offline lebih tua dari ini (dari `started_at`) ditolak `too_old`. |

Hak = Premium aktif menurut IAM (`memberActive`) ∧ paket di `download.tiers` ∧ tidak ditangguhkan ∧ (allowlist kosong
∨ terdaftar). Masa tenggang gagal bayar (`subscription.grace_days`) diwarisi dari IAM: lisensi mengikuti keputusan
Premium IAM sehingga saat billing berulang menerapkan masa tenggang di `memberActive`, unduhan ikut tanpa tenggang ganda.
Izin konten: `tracks.offline_allowed` / `episodes.offline_allowed` (default true; diubah artis/label/kreator lewat
`PATCH /v1/studio/tracks/:id` dan `PATCH /v1/studio/podcasts/:id/episodes/:episodeId`), rilis harus LIVE / episode tayang.

### Pembagian tanggung jawab
- **iam**: perangkat (`user_devices`, kunci publik ECDH P-256 dari perangkat). `iam.device.revoked` saat dicabut.
  `/internal/offline/entitlement` memberi status member + perangkat dalam satu panggilan.
- **catalog**: izin konten & **artefak terenkripsi**. Artefak dibuat SEKALI per konten+rendisi, lazy saat lisensi
  pertama diminta (`offline_artifacts`), oleh job `offline-artifacts` dengan konkurensi 1 per replika, streaming
  (memori ≈ 64 KiB; tanpa ffmpeg — hanya mengenkripsi rendisi AAC yang sudah ada), tulis `.part` lalu rename.
  CEK (32 byte acak) disimpan tersegel AES-256-GCM; CEK polos tidak pernah meninggalkan proses catalog — catalog
  membungkusnya ke kunci publik perangkat (`/internal/offline/key`). Berkas disajikan lewat jalur media yang ada
  (`/v1/catalog/media/:file`, URL bertanda tangan HMAC, Range 206, `cache-control: private`), bukan publik.
  `catalog.offline.revoked` saat rilis ditarik, `offline_allowed` dimatikan, episode/acara disembunyikan, tidak
  tayang lagi, berganti audio, atau dihapus.
- **playback**: lisensi (`offline_licenses`), tanda tangan Ed25519, recheck, konsumen pencabutan, job kedaluwarsa,
  dan pelaporan putar offline (`offline_plays`, `POST /v1/events/offline-plays` — lihat §Putar offline).

### Skema kripto (persis; semua tersedia di node:crypto, WebCrypto, dan paket kripto Flutter)
1. **Kunci perangkat**: perangkat membuat pasangan ECDH P-256 (kunci privat tidak pernah keluar; simpan di keychain /
   Keystore / Secure Enclave bila bisa) dan mengirim kunci publik: titik mentah tak terkompresi 65 byte (WebCrypto
   `exportKey('raw')`) atau SPKI DER, base64/base64url.
2. **Pembungkus CEK** (`alg = "ECDH-ES+HKDF-SHA256+A256GCM"`):
   `shared = ECDH(eph_priv, device_pub)` (32 byte, koordinat-x) →
   `KEK = HKDF-SHA256(ikm = shared, salt = epk_raw(65 byte), info = "rave-offline-cek-v1", L = 32)` →
   `ct‖tag = AES-256-GCM(KEK, iv 12 byte, CEK, AAD = "rave-ofl1:<track|episode>:<content_id>")`.
   Dikirim `{alg, epk, iv, ct}` (base64url; `ct` = 32 byte ciphertext ‖ 16 byte tag). AAD mengikat kunci ke konten.
3. **Berkas `RAVEOFL1`**: header 32 byte = `"RAVEOFL1"` ‖ versi u8 (1) ‖ 3 byte nol ‖ `chunk_size` u32 BE (65 536) ‖
   `plain_size` u64 BE ‖ `nonce_prefix` 8 byte. Lalu potongan `i = 0..n-1` (`n = max(1, ceil(plain_size/chunk))`):
   `ciphertext (min(chunk, sisa)) ‖ tag 16`, AES-256-GCM(CEK, nonce = nonce_prefix ‖ i u32 BE,
   AAD = header(32) ‖ i u32 BE ‖ final u8 (1 hanya potongan terakhir)). Offset potongan i = `32 + i·(chunk+16)` →
   seek tanpa mendekripsi seluruh berkas; tukar urutan/pemotongan berkas terdeteksi. Plaintext = berkas AAC/MP4 utuh.
4. **Lisensi**: `{alg:"Ed25519", kid, payload, sig}` — `payload` = base64url byte JSON, `sig` = Ed25519 atas BYTE
   payload itu (tanpa kanonikalisasi JSON). Kunci publik: `GET /v1/offline/pubkey` (`kid` = 16 hex pertama SHA-256
   kunci publik mentah). Isi payload: `v, typ="rave.offline.license", license_id, user_id, device_id, track_id,
   episode_id, artifact{id, version, format, rendition, codec_label, mime, size, plain_size, sha256}, key{…},
   issued_at, expires_at, recheck_at`. Klien WAJIB: verifikasi tanda tangan, `device_id` = perangkat sendiri,
   `sha256` berkas cocok, dan menolak memutar setelah `expires_at` (jam perangkat + waktu server terakhir yang dilihat).
5. **Kunci server**: bahan induk `OFFLINE_KEY` (opsional, ≥ 32 karakter) → `KYC_KEY` (wajib di produksi) → JWT secret
   (dev, jelas hanya dev). Diturunkan dua kunci terpisah (`:offline-cek:v1` untuk segel CEK, `:offline-license:v1` untuk
   seed Ed25519). Mengganti bahan kunci = semua artefak harus dibuat ulang (hapus baris `offline_artifacts`) dan semua
   lisensi lama gagal verifikasi (klien meminta ulang). Jangan dirotasi tanpa rencana.

### Siklus lisensi & pencabutan
- `POST /v1/offline/licenses` idempoten per perangkat+konten (lisensi ACTIVE yang sama diperpanjang, 200); 202 selama
  artefak disiapkan. `POST /v1/offline/recheck` memperpanjang yang masih berhak dan mengembalikan `revoked`,
  `expired`, `unknown`. Lisensi EXPIRED tidak dihidupkan ulang (minta lisensi baru).
- Pencabutan eager lewat event (idempoten, di transaksi handler): `iam.user.member_changed` (bukan Premium / paket
  tidak diizinkan), `iam.device.revoked`, `catalog.offline.revoked`. Recheck memeriksa ulang ke sumber (iam & catalog)
  sehingga pencabutan tetap benar walau event terlambat. Job `offline-expire` (tiap jam, batch kecil) menandai EXPIRED.

### Putar offline (T6) — `POST /v1/events/offline-plays`
- Perangkat mencatat putar lokal dengan `seq` monoton per perangkat dan mengirim batch ≤ 200 saat online. Idempoten:
  `UNIQUE(device_id, seq)` di `offline_plays`; kirim ulang → `duplicate` (hasil pertama berlaku, tanpa efek kedua).
- Sah bila: perangkat milik pengguna (boleh sudah dicabut, asal `started_at` < waktu cabut); lisensi milik pengguna +
  perangkat + konten yang sama; `started_at` ∈ [lisensi pertama terbit (`created_at`), `min(expires_at, revoked_at)`);
  tidak di masa depan (> 5 menit skew); tidak lebih tua dari `download.report_max_age_days` (default 35 = TTL 30 + margin);
  tidak beririsan dengan putar lain yang diterima di perangkat itu (toleransi 1 dtk); total per perangkat per hari
  kalender WIB ≤ 24 jam. `played_ms` dipangkas ke durasi + 5 dtk (sama dengan online). Batas bawah memakai `created_at`,
  bukan `issued_at`, karena `POST /v1/offline/licenses` ulang memperbarui `issued_at` baris yang sama — putar sebelum
  perpanjangan tetap sah.
- Yang lolos masuk ke **logika qualified stream yang sama** dengan jalur online (`recordQualified` di
  `services/playback/src/events.ts`): ambang `royalty.qualified_stream_seconds`, fraudCheck, `daily_listeners`,
  agregat (`source = 'offline'`), event `playback.stream.qualified` (`source: 'offline'`). Lagu offline = stream Premium
  tanpa iklan (konsumen ads mengabaikannya). Episode dicatat, bukan stream royalti lagu (sama dengan online).
- fraudCheck dihitung menurut **waktu dengar**: `RATE_LIMIT` menghitung stream qualified pada 1 jam sebelum `started_at`
  (kolom baru `qualified_streams.played_at`), `LOOP_31S` melihat sesi online + putar offline qualified sebelum
  `started_at`. Satu-satunya perubahan jalur online: hitungan `RATE_LIMIT` memakai `coalesce(played_at, at)` — identik
  untuk data online (played_at = at), dan sinkronisasi ratusan putar offline tidak lagi membuat stream online berikutnya
  dianggap fraud.
- Konkurensi: seluruh batch dalam satu transaksi + outbox, diserialkan `pg_advisory_xact_lock` per pengguna (dua batch
  paralel dari perangkat yang sama / perangkat lain akun yang sama tidak bisa sama-sama lolos tumpang tindih / ambang).
  Panggilan iam (pemilik & waktu cabut perangkat) dan catalog (artis & durasi, `/internal/playback/meta`, tanpa filter
  status) dilakukan sebelum transaksi.
- **Keputusan: endpoint tetap menerima laporan walau `download.enabled` dimatikan.** Mematikan fitur menghentikan
  unduhan & lisensi baru, tetapi putar yang sudah terjadi dari lisensi yang sah tetap harus dibayar ke artis.

### Putar offline & royalti (T7)
- **Setara stream Premium online.** Royalti (`services/finance/src/royalty.ts` → `computeRoyalty`) membaca hitungan stream
  qualified non-fraud per pengguna × lagu dari `/internal/royalty/streams`; stream offline ada di hitungan yang sama
  (tidak ada bobot/sumber terpisah). User-centric: porsi pendapatan Premium pendengar dibagi ke lagu yang ia dengar
  termasuk yang offline; pro-rata/hybrid: masuk pool menurut jumlah stream. Putar offline tidak menghasilkan impresi
  iklan (komponen `ads` hanya ada bila pendengar juga punya impresi iklan di periode itu).
- **Cutoff periode = saat diterima (`received_at`), bukan saat didengar.** `qualified_streams.at` untuk putar offline =
  waktu laporan diterima playback; periode royalti (bulan kalender WIB) memilih stream menurut `at`. Putar yang didengar
  di periode yang sudah ditutup/dihitung tetapi baru dilaporkan masuk ke **periode saat diterima**; periode tertutup
  tidak pernah dibuka ulang, statement terbit tidak berubah, ledger tidak dikoreksi. `played_at` (waktu dengar) hanya
  dipakai analitik & fraudCheck.
- Visibilitas Finance: `/internal/royalty/streams` mengembalikan `offline: { streams, listeners, played_before_period }`;
  draf periode memuat anomali info `OFFLINE_STREAMS` (berapa yang didengar sebelum periode).
- Kirim ulang batch tidak menggandakan: `UNIQUE(device_id, seq)` + `qualified_streams.session_id = offline_plays.id`
  (PK) → satu putar = paling banyak satu stream qualified.
- Konsekuensi (perlu diketahui Finance; ubah hanya lewat keputusan baru): atribusi user-centric memakai pendapatan Premium pendengar **di periode diterima** (prorata
  hari aktif). Pendengar yang berhenti berlangganan lalu baru melapor di bulan berikutnya menyumbang pendapatan lebih kecil
  (atau masuk pool hybrid) untuk putar tersebut. Dibatasi oleh `download.report_max_age_days` dan recheck 72 jam.

## Batas kejujuran (wajib dikomunikasikan)
- Ini **perlindungan lisensi, BUKAN DRM penuh**. Perangkat sah memegang kunci yang bisa membuka berkasnya; perangkat
  yang di-root/jailbreak, klien yang dimodifikasi, atau perekaman keluaran audio dapat mengekstrak audio AAC 160.
  Yang dicegah: berbagi berkas antar-akun/perangkat (CEK terbungkus per perangkat), unduh massal (rate limit, batas
  per perangkat), master/lossless bocor (tidak pernah dienkripsi untuk offline), dan pemakaian setelah berhenti
  berlangganan **begitu perangkat online**.
- **Pencabutan hanya efektif saat perangkat online** (recheck). Perangkat yang terus offline tetap bisa memutar hingga
  `expires_at`; `download.license_ttl_days` adalah batas risiko yang diterima.
- Jam perangkat bisa dimundurkan; klien menyimpan waktu server terakhir (dari respons) dan menolak bila jam mundur.
- Jalur ke DRM penuh (bila label mensyaratkan): CMAF + CENC (cbcs) + Widevine/FairPlay lewat license proxy di playback;
  tabel `offline_licenses` & alur perangkat tetap dipakai.

## Konsekuensi
- Storage bertambah ≈ ukuran rendisi AAC 160 (+ 16 byte/64 KiB) per konten yang pernah diunduh. Artefak tercatat di
  `/internal/media/references` sehingga tidak dianggap berkas yatim.
- Berkas terenkripsi masih disajikan oleh Node (catalog, `createReadStream`, tanpa buffer). Bila trafik unduhan besar,
  pindahkan ke nginx `secure_link`/object storage + CDN dengan tanda tangan yang sama.
- Penerbitan lisensi melakukan 2 panggilan internal (iam, catalog) bertimeout 5 dtk; recheck 2 panggilan per permintaan
  (bukan per lisensi).
