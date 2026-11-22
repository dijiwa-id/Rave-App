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
| `download.tiers` | INDIVIDUAL, STUDENT, DUO (berbahaya) | Paket berbayar yang berhak, minimal satu (menghentikan semua = `download.enabled`). FREE tidak pernah berhak. |
| `subscription.download_devices` | 5 | Perangkat aktif per akun (perangkat ke-6 → 409 `device_limit` + daftar perangkat). |
| `download.max_tracks_per_device` | 500 | Lisensi aktif per perangkat (→ 409 `device_full`). |
| `download.license_ttl_days` | 30 | Masa berlaku lisensi sejak terbit/recheck terakhir = **batas risiko**. |
| `download.recheck_hours` | 72 | Klien wajib cek ulang saat online setelah `recheck_at`. |
| `download.rate_per_user_hour` | 60 | Lisensi BARU + permintaan yang masih menunggu artefak (202) per akun per jam (perpanjangan tidak dihitung) → 429 `rate_limited`. |
| `download.pending_per_user` | 20 | Konten berbeda yang sedang disiapkan (202) per akun dalam 1 jam → 429 `rate_limited` (`retry_after_s` 60). |
| `download.queue_max` | 200 | Batas global antrean artefak (`pending`+`processing`). Penuh → 503 `queue_full` + `Retry-After` tanpa menambah antrean. |
| `download.recheck_per_minute` | 6 | Recheck per akun per menit → 429 (`Retry-After`). |
| `download.devices_per_day` | 10 | Pendaftaran perangkat baru per akun per 24 jam (termasuk yang kemudian dicabut) → 429 `device_rate_limited`. |
| `download.device_reregister_block_days` | 7 | Kunci perangkat yang dicabut tidak bisa didaftarkan ulang di akun yang sama selama ini → 403 `device_revoked` + `retry_after_s` (0 = tanpa blokir). |
| `download.podcast_enabled` | true | Episode unggahan boleh diunduh (episode embed tidak pernah). Live tidak pernah. |
| `download.quality` | `normal` (AAC 160) | Rendisi yang dienkripsi (`low` = AAC 64). Master & Lossless tidak pernah. |
| `download.report_max_age_days` | 35 | Laporan putar offline lebih tua dari ini (dari `started_at`) ditolak `too_old`. |

Hak = Premium aktif menurut IAM (`memberActive`) ∧ paket di `download.tiers` ∧ tidak ditangguhkan ∧ (allowlist kosong
∨ terdaftar). Masa tenggang gagal bayar (`subscription.grace_days`) diwarisi dari IAM: lisensi mengikuti keputusan
Premium IAM sehingga saat billing berulang menerapkan masa tenggang di `memberActive`, unduhan ikut tanpa tenggang ganda.
Izin konten: `tracks.offline_allowed` / `episodes.offline_allowed` (default true; diubah artis/label/kreator lewat
`PATCH /v1/studio/tracks/:id` dan `PATCH /v1/studio/podcasts/:id/episodes/:episodeId`), rilis harus LIVE / episode tayang.

### Pembagian tanggung jawab
- **iam**: perangkat (`user_devices`, kunci publik ECDH P-256 dari perangkat). Mendaftar wajib berhak unduhan
  (`offlineAccess` yang sama dengan penerbitan: Premium aktif, paket, rollout, tidak ditangguhkan), dibatasi laju per
  hari, dan kunci yang baru dicabut diblokir. `iam.device.revoked` saat dicabut; `iam.user.suspended` saat akun
  ditangguhkan; `iam.user.deleted` saat akun dihapus (perangkat dicabut & data pengenalnya — nama, versi aplikasi,
  kunci publik, sidik jari — dikosongkan, UU PDP). `/internal/offline/entitlement` memberi status member + perangkat
  dalam satu panggilan — **hanya token service** (Super Admin ditolak & dicatat audit `internal.denied`).
- **catalog**: izin konten & **artefak terenkripsi**. Artefak dibuat SEKALI per konten+rendisi, lazy saat lisensi
  pertama diminta (`offline_artifacts`), oleh job `offline-artifacts` dengan konkurensi 1 per replika, streaming
  (memori ≈ 64 KiB; tanpa ffmpeg — hanya mengenkripsi rendisi AAC yang sudah ada), tulis `.part` bernama unik per
  percobaan lalu rename ke nama berkas unik; UPDATE akhir dijaga `status='processing' AND attempts=n` sehingga klaim
  basi yang diambil worker lain tidak menimpa hasilnya (berkasnya dibuang). Antrean dibatasi global
  `download.queue_max`. CEK (32 byte acak) disimpan tersegel AES-256-GCM beserta `key_id` kunci segel; kunci berganti
  / CEK gagal dibuka → artefak dibangun ulang (202), bukan 500. CEK polos tidak pernah meninggalkan proses catalog —
  catalog membungkusnya ke kunci publik perangkat (`/internal/offline/key`, **hanya token service**). Berkas disajikan lewat jalur media yang ada
  (`/v1/catalog/media/:file`, URL bertanda tangan HMAC, Range 206, `cache-control: private`), bukan publik.
  `catalog.offline.revoked` saat rilis ditarik, `offline_allowed` dimatikan, episode/acara disembunyikan, tidak
  tayang lagi, berganti audio, atau dihapus.
- **playback**: lisensi (`offline_licenses`), tanda tangan Ed25519, recheck, konsumen pencabutan, job kedaluwarsa,
  dan pelaporan putar offline (`offline_plays`, `POST /v1/events/offline-plays` — lihat §Putar offline). Penjaga:
  `offline_requests` (reservasi kuota permintaan 202, dibuat SEBELUM catalog diminta menyiapkan artefak, dihapus saat
  lisensi terbit), `offline_revocations` (watermark pencabutan), `offline_rate` (ember laju recheck). Galat hulu 4xx
  tanpa padanan §12 → 502 `upstream_error` (detail internal tidak diteruskan).

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
   (HANYA dev; di luar dev tanpa OFFLINE_KEY/KYC_KEY = galat, tidak pernah jatuh ke JWT secret). Nilai kosong/spasi
   dianggap tidak diset; di produksi baris `OFFLINE_KEY=` yang kosong, < 32 karakter, atau sama dengan secret lain membuat
   service menolak start (dicek juga oleh `scripts/prod-preflight.sh`). Diturunkan dua kunci terpisah (`:offline-cek:v1`
   untuk segel CEK, `:offline-license:v1` untuk seed Ed25519). Mengganti bahan kunci = lisensi lama gagal verifikasi
   (klien meminta ulang) dan artefak lama dibangun ulang otomatis (id kunci segel `offline_artifacts.key_id` tidak cocok
   / CEK gagal dibuka → antre ulang, 202). Jangan dirotasi tanpa rencana.

### Siklus lisensi & pencabutan
- `POST /v1/offline/licenses` idempoten per perangkat+konten (lisensi ACTIVE yang sama diperpanjang, 200); 202 selama
  artefak disiapkan. `POST /v1/offline/recheck` memperpanjang yang masih berhak dan mengembalikan `revoked`,
  `expired`, `unknown`. Lisensi EXPIRED tidak dihidupkan ulang (minta lisensi baru).
- Pencabutan eager lewat event (idempoten, di transaksi handler): `iam.user.member_changed` (bukan Premium / paket
  tidak diizinkan), `iam.user.suspended` & `iam.user.deleted` (`ACCOUNT_SUSPENDED`), `iam.device.revoked`,
  `catalog.offline.revoked`. Recheck memeriksa ulang ke sumber (iam & catalog) sehingga pencabutan tetap benar walau
  event terlambat. Job `offline-expire` (tiap jam, batch kecil) menandai EXPIRED dan membersihkan tabel penjaga (> 1 jam).
- **Pencabutan bersamaan dengan penerbitan (TOCTOU):** konsumen menulis watermark `offline_revocations` (pengguna /
  perangkat / konten) di bawah kunci advisory yang sama dengan transaksi penerbitan (urutan tetap: pengguna → perangkat →
  konten; konsumen mengambil satu jenis kunci, terurut). Transaksi penerbitan menolak commit bila ada watermark sejak hak
  diperiksa (margin 2 dtk) dan memeriksa ulang hak sekali ke sumber; masih bertabrakan → 409 `content_unavailable`.
  Konsumen yang berjalan SETELAH commit mencabut lisensi baru itu seperti biasa.
- **Recheck** dibatasi `download.recheck_per_minute`; lisensi yang belum melewati separuh interval cek ulang
  dikembalikan di `unchanged` (aditif; lisensi lama tetap berlaku) dan tidak ditandatangani/ditulis ulang.

### Putar offline (T6) — `POST /v1/events/offline-plays`
- Perangkat mencatat putar lokal dengan `seq` monoton per perangkat dan mengirim batch ≤ 200 saat online. Idempoten:
  `UNIQUE(device_id, seq)` di `offline_plays`; kirim ulang → `duplicate` (hasil pertama berlaku, tanpa efek kedua).
- Akun ditangguhkan/dihapus → seluruh batch `403 account_suspended`, tidak ada yang disimpan. Sengaja **tidak final**:
  perangkat menyimpan log dan mengirim ulang; bila akun dipulihkan sebelum `download.report_max_age_days`, putar sah
  tetap dibayar (keputusan konservatif — tidak membayar selama ditangguhkan, tidak menghapus hak artis bila dipulihkan).
- Sah bila: perangkat milik pengguna (boleh sudah dicabut, asal `started_at` < waktu cabut); lisensi milik pengguna +
  perangkat + konten yang sama; `started_at` ∈ [lisensi pertama terbit (`created_at`), `min(expires_at, revoked_at)`);
  bila Premium sudah tidak aktif, `started_at` < `member_until` (`after_membership` — menutup celah masa langganan habis
  secara alami tanpa event pencabutan); tidak di masa depan (> 5 menit skew); tidak lebih tua dari
  `download.report_max_age_days` (default 35 = TTL 30 + margin); tidak beririsan dengan putar lain yang diterima di
  **akun yang sama, perangkat mana pun** (toleransi 1 dtk); total per **akun** per hari kalender WIB ≤ 24 jam. Satu orang
  tidak bisa mendengar dua putar sekaligus — overlap/batas per perangkat membiarkan N perangkat "memutar" bersamaan. `played_ms` dipangkas ke durasi + 5 dtk (sama dengan online). Batas bawah memakai `created_at`,
  bukan `issued_at`, karena `POST /v1/offline/licenses` ulang memperbarui `issued_at` baris yang sama — putar sebelum
  perpanjangan tetap sah.
- Yang lolos masuk ke **logika qualified stream yang sama** dengan jalur online (`recordQualified` di
  `services/playback/src/events.ts`): ambang `royalty.qualified_stream_seconds`, fraudCheck, `daily_listeners`,
  agregat (`source = 'offline'`), event `playback.stream.qualified` (`source: 'offline'`). Lagu offline = stream Premium
  tanpa iklan (konsumen ads mengabaikannya). Episode dicatat, bukan stream royalti lagu (sama dengan online).
- fraudCheck dihitung menurut **waktu dengar** (kolom `qualified_streams.played_at`). `RATE_LIMIT` untuk putar offline
  **dua arah**: ditandai bila ada jendela 1 jam yang memuat `started_at` sudah berisi ≥ batas stream qualified
  (`rateWindowExceeded` di `@rave/domain/offline-plays`). Hitungan satu arah (1 jam sebelum `started_at`) bisa dilewati
  dengan mengirim putar berurutan waktu menurun; dua arah menjamin tidak ada jendela 1 jam berisi > batas stream
  non-fraud, apa pun urutan kedatangan. Untuk kiriman menaik hasilnya identik dengan hitungan satu arah. Kueri dibatasi
  2 × batas baris (pigeonhole: sebanyak itu pasti melampaui). `LOOP_31S` melihat sesi online + putar offline qualified
  sebelum `started_at`. Perubahan jalur online: hitungan `RATE_LIMIT` memakai `coalesce(played_at, at)` — identik untuk
  data online (played_at = at), dan sinkronisasi ratusan putar offline tidak lagi membuat stream online berikutnya
  dianggap fraud; serta kunci pengguna saat mencatat qualified (lihat Konkurensi) — hasil hitungan tidak berubah.
- Konkurensi: seluruh batch dalam satu transaksi + outbox, diserialkan per pengguna dengan
  **`pg_try_advisory_xact_lock`** — batch lain akun yang sama sedang diproses → `429 rate_limited` + `Retry-After: 5`
  seketika (bukan menunggu sambil memegang koneksi pool; kunci blocking membuat banyak batch paralel satu akun menghabiskan
  pool). Sebelum itu ember laju per akun `download.report_per_minute` (default 30 kiriman/menit, tabel `offline_rate`) →
  `429` + `Retry-After: 60` sebelum memanggil iam/catalog. Jalur online (`POST /v1/events/play`) mengambil kunci yang
  sama (blocking) hanya bila ada sesi yang qualified, SETELAH mengunci sesi dan SEBELUM menulis
  `qualified_streams`/`daily_listeners`; transaksi offline tidak pernah mengunci baris sesi → bebas deadlock, dan
  hitungan fraud online & offline pengguna yang sama tidak bisa sama-sama lolos di ambang. Batch tidak dipecah per
  potongan (atomik ≤ 200 putar; kunci try sudah membatasi satu transaksi per akun). Panggilan iam (status akun &
  keanggotaan, pemilik & waktu cabut perangkat) dan catalog (artis & durasi, `/internal/playback/meta`, tanpa filter
  status) dilakukan sebelum transaksi; galatnya dipetakan sama dengan `/v1/offline/*` (`mapIamUpstream`/`mapUpstream`,
  4xx tak terpetakan → `502 upstream_error`).
- Pertumbuhan tabel: paling banyak `OFFLINE_REJECTED_PER_DEVICE_DAY` (1000) baris REJECTED per perangkat per hari WIB
  (waktu diterima); lewat kuota putar tetap dijawab `rejected` tetapi tidak disimpan. Job `offline-plays-purge` (per jam,
  berbatch 5000) menghapus baris REJECTED yang diterima > `download.report_max_age_days` + 1 hari lalu — seq yang
  terbebas tidak bisa memasukkan putar lama lagi (pasti `too_old`). Baris ACCEPTED (dasar royalti) tidak pernah dihapus.
  Migrasi playback `009_offline_plays_user_guards` (indeks per pengguna & kuota REJECTED).
- **Tindak lanjut iam (belum diimplementasikan):** iam sebaiknya menerbitkan `iam.user.member_changed` saat masa
  langganan habis secara alami (job harian `member_until <= now()`), agar lisensi dicabut di sumbernya dan recheck
  melaporkan `MEMBERSHIP` tanpa menunggu `expires_at`. Sampai itu, `after_membership` menjaga dasar royalti.
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

### Kewajiban klien (desktop/mobile) — wajib diimplementasikan persis
- Header `RAVEOFL1`: tolak berkas bila magic ≠ `RAVEOFL1`, versi ≠ 1, 3 byte cadangan ≠ 0, atau `chunk_size` ≠ 65 536
  (jangan memakai nilai header untuk alokasi tanpa batas); ukuran berkas wajib = `32 + plain_size + n·16`.
- Lisensi: `alg` = `Ed25519` dan `kid` lisensi = `kid` dari `GET /v1/offline/pubkey` (kid tak dikenal → ambil ulang
  pubkey sekali; tetap tak cocok → tolak); verifikasi tanda tangan atas BYTE `payload`; `v` = 1, `typ` =
  `rave.offline.license`; `user_id` = pengguna sesi yang sedang login (lisensi akun lain di perangkat yang sama →
  tolak & hapus); `device_id` = perangkat sendiri; `sha256` berkas cocok dengan `artifact.sha256`; `key.alg`
  dikenal; AAD pembuka kunci `rave-ofl1:<track|episode>:<id>` sesuai konten lisensi.
- Waktu: tolak memutar setelah `expires_at` (jam perangkat + waktu server terakhir yang dilihat; jam mundur → tolak).
- Recheck: hapus berkas untuk `revoked`/`expired`/`unknown`; simpan lisensi lama untuk `unchanged`; hormati
  `Retry-After` pada 429/503.

## Batas kejujuran (wajib dikomunikasikan)
- Ini **perlindungan lisensi, BUKAN DRM penuh**. Perangkat sah memegang kunci yang bisa membuka berkasnya; perangkat
  yang di-root/jailbreak, klien yang dimodifikasi, atau perekaman keluaran audio dapat mengekstrak audio AAC 160.
- **Koreksi (review keamanan):** enkripsi offline TIDAK menjaga kerahasiaan audio. Rendisi AAC yang sama
  (`<id>.normal.m4a` / `.low.m4a`) disajikan polos lewat jalur media publik untuk streaming, sehingga siapa pun yang bisa
  memutar online bisa menyimpan berkas polosnya. Yang dicegah lapisan offline: berkas `RAVEOFL1` + lisensi satu akun
  tidak bisa dipakai di akun/perangkat lain lewat aplikasi resmi (CEK terbungkus per perangkat, `user_id`/`device_id`
  di lisensi), unduh massal lewat jalur lisensi (rate limit, batas menunggu & antrean global, batas per perangkat),
  master/lossless bocor (tidak pernah dienkripsi untuk offline), dan pemakaian di aplikasi setelah berhenti berlangganan
  **begitu perangkat online**. Nilai utamanya adalah kontrol lisensi (hak, masa berlaku, pencabutan, royalti).
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
