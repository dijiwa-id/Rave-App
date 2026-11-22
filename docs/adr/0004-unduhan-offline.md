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
  dan skema `offline_plays` (pelaporan putar offline — T6, rave-money).

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
