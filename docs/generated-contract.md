# Generated Contract (SPK Booking Artis)

Memperluas modul kontrak di `services/booking` (templat markdown `booking-v1`, tanda tangan PSrE tiruan) menjadi mesin kontrak: PDF, versi, e-sign OTP multi-pihak, invoice DP otomatis, verifikasi publik.

Status implementasi: **Tahap 0–2 selesai** (dokumen, skema, domain murni). Tahap 3–8 belum.

## Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| K1 | Ikuti stack repo: SQL migration + `pg`, antrean job di Postgres (`contract_jobs`, `SKIP LOCKED`), storage lokal dengan signed URL HMAC, React Vite. Hanya tambah Puppeteer dan Handlebars. | Prisma, BullMQ/Redis, S3, dan Next.js tidak dipakai repo. Adapter S3 menyusul lewat antarmuka storage. |
| K2 | Status kontrak berdiri sendiri (`CONTRACT_GENERATED … ACTIVE`). Status booking tetap dan mengikutinya: `CONTRACT_SENT` selama kontrak belum `ACTIVE`, `SIGNED` saat `ACTIVE`. | State machine booking dipakai kalender, finance, dan UI. Mengubahnya berdampak luas. |
| K3 | "DEAL" = booking `AGREED` (aksi `accept`). Generate kontrak hanya terjadi di transisi itu. | `accept` sudah menjadi pintu tunggal ke kontrak. |
| K4 | Tarif PPh 21/23, ambang e-Meterai, dan penanggung e-Meterai disimpan di registri pengaturan platform (bisa diubah Super Admin). Default: PPh21 2,5%, PPh23 2%, ambang Rp 5.000.000, penanggung promotor. | Aturan pajak belum final (BRD §8.5: wajib dikonfirmasi konsultan pajak). |

## Asumsi (ubah bila keliru)

1. Pajak dihitung backend dari `value_basis`: `GROSS` memotong dari nilai, `NETT` di-gross-up (dibulatkan ke atas agar nett tidak kurang dari yang disepakati). Jenis pajak mengikuti status penerima: orang pribadi PPh 21, badan PPh 23.
2. Termin pertama wajib `ON_SIGN` (dasar invoice DP). Jatuh tempo `ON_SIGN` = tanggal tanda tangan + 3 hari (sama dengan templat lama: 3×24 jam). Sisa pembulatan masuk termin terakhir.
3. Penolakan draf (`reject`, memicu versi baru): promotor hanya pada `AWAITING_PROMOTOR_SIGN`; manajemen hanya membuang draf yang belum dikirim (`CONTRACT_GENERATED`). Setelah promotor menandatangani, jalur keluar adalah `CANCELLED`.
4. Versi yang berakhir (`REJECTED`, `CANCELLED`, `EXPIRED`) read-only (trigger DB). Hanya satu versi "hidup" per booking (indeks unik parsial).
5. Pihak pertama menandatangani saat ia menjadi penanda tangan yang diharapkan; urutan Promotor → Manajemen → (Artis) ditegakkan di backend dengan `statusAfterSign`.
6. Audit memakai dua tempat: `audit_logs` kit (aksi sistem) dan `contract_audit` (aksi per kontrak, dengan IP dan user agent, append-only).
7. Tabel `invoices` tidak ditambah di booking: invoice tetap milik `finance` dan terbit lewat event `booking.contract.signed` (diperluas dengan daftar termin).
8. Split fee tiga pihak (manajemen, artis, platform) divalidasi 100% di kontrak. Komisi platform nyata tetap dari `commission.*`; kontrak mencatat angka yang berlaku saat generate.
9. Kolom enkripsi di `legal_profiles` (`*_enc`) memakai AES-256-GCM seperti KYC. Helper `encrypt`/`mask` saat ini ada di `services/iam/src/core.ts`; dipindah ke `service-kit` di Tahap 3.

## Yang sudah ada di kode

- `packages/domain/src/contract.ts` (+ `contract.test.ts`, 15 tes): state machine kontrak, urutan tanda tangan, validasi termin dan split, nominal termin, jatuh tempo, pajak, e-Meterai, whitelist field, diff snapshot versi.
- `services/booking/migrations/002_generated_contract.sql`: aditif dan kompatibel mundur (status lama `SENT/SIGNED/VOID` tetap valid; baris lama menjadi versi 1). Menambah versi dan snapshot di `contracts`, metode/IP/UA di `signatures`, `signature_otps`, `contract_audit`, `contract_jobs`, `contract_addenda`, `rider_versions`, `legal_profiles`.

## Rencana tahap berikutnya

3. Templat `spk-v2` (Handlebars, escape, klausul terkunci, lampiran rider), render PDF Puppeteer tanpa jaringan, QR dan hash, storage privat dengan signed URL.
4. E-sign native: `SignatureProvider`, `NativeOtpProvider`, rate limit OTP, urutan tanda tangan.
5. Finalisasi: PDF final, hash, kunci, distribusi, invoice DP; migrasi kode lama ke status baru.
6. Revisi dan versi baru, riwayat dan diff.
7. UI Bahasa Indonesia: negosiasi, previewer, tracker, riwayat, halaman tanda tangan, `/verify/:contractId`.
8. Adapter Privy/Vida (stub, flag e-Meterai) dan tes integrasi/keamanan.

## Setup (diisi per tahap)

Env var provider e-sign, storage, dan Puppeteer ditambahkan di sini saat modulnya masuk.
