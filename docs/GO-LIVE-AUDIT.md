# Audit Go-Live RAVE — 12 November 2026

Audit ulang terhadap **BRD v3.0** dan **TDD v3.0** (status dinilai dari **kode**, bukan dari catatan status di dokumen).
Empat area diaudit paralel: (1) fan & konten, (2) kreator & B2B, (3) uang, kepercayaan & back office, (4) NFR, arsitektur
& operasi. Setiap temuan memiliki bukti `file:baris` atau respons endpoint; temuan bertanda ✔ sudah diverifikasi ulang
secara langsung.

**Kesimpulan:** fondasi teknis kuat (ledger double-entry, entitlement, iklan, live, refund tiket, pengaturan tanpa deploy,
e2e 222/222). Namun RAVE **belum layak go-live publik**. Selain blocker vendor yang sudah diketahui, ada **celah keamanan
dan alur uang** yang bisa dikerjakan sekarang tanpa vendor, serta **klaim produk yang tidak sesuai** dengan keputusan D-03.

---

## A. P0 — wajib sebelum publik (dapat dikerjakan sekarang, tanpa vendor)

### Keamanan & akses
| # | Temuan | Bukti | Usaha |
|---|---|---|---|
| A1 ✔ | **Semua admin back office (termasuk SUPPORT/EDITORIAL) bertindak sebagai OWNER setiap org & wallet**: bisa mengajukan payout untuk wallet mana pun (dengan rekening sendiri, tanpa masa tunggu bila rekening pertama), menambah diri ke org, mengubah split royalti | `packages/service-kit/src/auth.ts:146` (`assertOrg` → OWNER untuk admin), `:112` (`requireRole` meloloskan admin), `services/finance/src/routes.ts` payout | M |
| A2 ✔ | **Master audio mentah dapat diunduh siapa pun** (`<id>.flac`/`.wav`/`.aiff` → 206 tanpa tanda tangan), melewati hak Premium & status rilis | `services/catalog/src/routes.ts:237-266`, `services/playback/src/sessions.ts:66` | S |
| A3 | Pratinjau 30 dtk anonim hanya dipotong di klien; URL stream memberi berkas penuh | `stores/player.ts:226`, sesi `preview_only` → 302 berkas penuh | M (P1) |

### Alur uang & hukum
| # | Temuan | Bukti | Usaha |
|---|---|---|---|
| B1 ✔ | **Refund booking tidak pernah sampai ke promotor**: `refundEscrow` hanya menjurnal ke kas escrow, tanpa baris `refunds` → tidak masuk `refund-dispatch` maupun antrean Finance (pembatalan & putusan dispute) | `services/finance/src/escrow.ts` `refundEscrow` | M |
| B2 ✔ | **Payout tidak bisa dieksekusi**: nomor rekening hanya disimpan hash/masked; job menandai COMPLETED dan memberi tahu "sudah ditransfer" tanpa transfer | `finance/migrations/001_init.sql:108-116`, `finance/src/jobs.ts:32-52` | M |
| B3 | Payout & penjualan tiket tidak mensyaratkan KYC terverifikasi; admin bisa menyetujui KYC sendiri; event bisa dibuat dengan artis mana pun tanpa persetujuan (notifikasi ke follower artis) | `finance/src/routes.ts` payouts, `iam/src/admin.ts:51-60`, `ticketing/src/routes.ts:141-160` | M |
| B4 ✔ | **Pajak & split saat pencairan ≠ kontrak yang ditandatangani**: `payeeType:'individual'` di-hardcode (2,5%), mengabaikan PPh di kontrak & pengaturan; split dibaca dari `fee_splits` terkini (bisa diubah manajer setelah tanda tangan) | `booking/src/routes-bookings.ts:457`, `routes-admin.ts:41`, `booking/src/repo.ts:80` | M |
| B5 ✔ | **Kontrak**: penanda tangan membaca teks lama `booking-v1`, bukan PDF spk-v2; `RENDER_FINAL` belum diimplementasikan → tidak ada PDF final bertanda tangan (masih watermark DRAF) | `BookingDetail.tsx:383`, `booking/src/contract-jobs.ts:51` | M |
| B6 | **Celah pembatalan**: force majeure dapat dinyatakan sepihak dengan satu centang (menghindari denda H-3), dana escrow beku selamanya; manajemen membatalkan dari AT_RISK → DP dikembalikan (kontrak: hangus); denda 25% artis tidak pernah ditagih | `booking/src/routes-bookings.ts:365-406`, `finance/src/consumers.ts:70-80` | M |
| B7 | ISRC/UPC palsu (`ID-GM1`, sequence CYCLE, `899${Date.now()}`); rilis boleh memakai URL audio eksternal (lolos validasi & transcoding) | `catalog/src/studio.ts:141,262`, `NewRelease.tsx:243` | S |

### Produk & kepatuhan konsumen
| # | Temuan | Bukti | Usaha |
|---|---|---|---|
| C1 | **Klaim produk bertentangan dengan D-03**: "lossless gratis" di meta, landing, halaman Premium, company; Premium menjanjikan "unduhan tanpa batas" & "akses tiket lebih awal" (belum ada); catatan "normalisasi −14 LUFS aktif" (tidak diterapkan); "royalti terbit tgl 15", "PBJT dipotong", "undangan split" (belum ada) | `apps/web/index.html:7`, `packages/domain/src/landing.ts:86-98`, `locales/*/public.ts`, `Premium.tsx:37`, `Settings.tsx:194`, `locales/en/b2b.ts:522,576,679,793` | S |
| C2 | **Tidak ada jalur isi konten di produksi**: genre, kategori jelajah, playlist editorial, podcast/episode hanya dari seed (seed ditolak di produksi) → halaman Cari/Podcast/Beranda kosong saat launch | `catalog/src/seed.ts`, `library/src/routes.ts:44` | L |
| C3 | Banner sponsor di Beranda tampil untuk pengguna anonim, mengabaikan `ads.enabled` & review, kreatif default hard-coded ("BRAP Fibrecase") | `fan/Home.tsx:133`, `domain/landing.ts:153-162` | S |
| C4 | Konten demo (berita, investor, karier, pers) dipublikasikan seperti nyata | `pages/company/news-data.ts` dll. | S |

## B. P0 — butuh keputusan / vendor / infrastruktur
| # | Item | Status |
|---|---|---|
| D1 | Vendor email OTP (Q-01) & kontrak Midtrans (Q-02) | Adapter & dasbor Integrasi siap; tinggal isi kunci & uji |
| D2 | Tujuan backup off-site + **sinkron volume `storage`** (master audio & PDF kontrak belum ikut); drill pemulihan bertimer (RTO nyata) | Sidecar siap; tujuan belum dipilih |
| D3 | **MFA TOTP untuk Super Admin, Finance, penyetuju payout** (BRD REQ-IAM-06). Login pengguna tetap OTP-only sesuai keputusan PO | Belum ada; perlu konfirmasi PO karena menyentuh IAM |
| D4 | Server produksi nyata (bukan Docker Desktop di WSL), TLS (Caddy), monitor terjadwal + uptime eksternal | Belum |
| D5 | Kebersihan rilis: tag `v0.1.0`, image GHCR immutable, release.yml digating CI, pemindaian image | Belum (tag kosong; image `:0.1.0` ditimpa) |
| D6 | Dependensi rentan: zod < 4.6.6 (DoS memori, 9 high), puppeteer-core 25; CSP + perbaikan header nginx; pentest eksternal | Belum |
| D7 | Bisnis/legal: badan hukum, kode ISRC, domain & email dukungan, PSE, DPO, konfirmasi pajak, kanal pengaduan | Belum |

## C. P1 — minggu pertama
- **Status macet & timeout**: DP tak dibayar tidak kedaluwarsa (booking SIGNED selamanya), `contracts.expires_at` tidak ditegakkan, AT_RISK tanpa akhir, inquiry tanpa hold tak pernah kedaluwarsa, giliran tanda tangan tidak dinotifikasi.
- **Rilis**: split tidak perlu disetujui pihak lain sebelum QC; undangan split tidak dikirim.
- **Tiket**: tidak ada pemindaian QR kamera / offline di check-in, presale tanpa gating, tidak ada `sale_ends_at`, pemegang tiket tidak dinotifikasi saat event batal.
- **Akses**: penangguhan/hapus akun tidak dipublikasikan ke service lain (payout tetap jalan); token tetap berlaku ≤ 15 mnt; tidak ada hapus anggota org; perubahan peran tidak mencabut sesi.
- **UU PDP**: tidak ada ekspor data; consent personalisasi/agregat/pemasaran tidak ditegakkan; riwayat consent hilang saat hapus akun; playlist PUBLIC default tanpa toggle.
- **Audit log**: viewer hanya schema IAM (aksi uang/kontrak/pengaturan tidak terlihat); `trustProxy` belum diset (IP audit = gateway).
- **Notifikasi**: jam tenang tersimpan tapi tidak ditegakkan; toggle push tampil padahal push belum ada; konten hanya bahasa Indonesia; email tanpa tautan berhenti langganan.
- **Live**: token HLS tiket tidak terikat pengguna; chat siaran bertiket bisa dibaca publik.
- **Performa**: `POST /v1/ticketing/orders` p95 690–840 ms (target 500); batas tiket 30/mnt hard-coded; belum ada waiting room.
- **Observabilitas**: tidak ada log terpusat, Sentry, metrik, RUM web-vitals.
- **SEO**: SPA tanpa title/OG per halaman, robots.txt & sitemap mengembalikan HTML SPA, 404 lunak.
- **Royalti** (ROY-02/03): mesin perhitungan bulanan belum ada.
- **Dokumen**: 18 endpoint tidak ada di `docs/API.md`; TDD §3.1/§13.2/§16.1/§18.2 & ARCHITECTURE.md usang.

## D. P2 — polish
Dialog `prompt()/confirm()` bawaan browser, kartu pembatalan tanpa pratinjau dampak uang, dasbor tanpa state galat, pesan galat
server berbahasa Indonesia untuk pengguna EN, tautan sosial `href="#"`, tombol login sosial "segera hadir", skip-link &
audit aksesibilitas, font Google di-hotlink (privasi), PWA, gzip level nginx, dua pustaka ikon.

## E. Yang sudah kuat (tidak perlu dikerjakan ulang)
Entitlement kualitas & URL rendisi Premium bertanda tangan, mesin iklan (kebijakan, empat mata, pacing, consent), live
streaming (state machine, moderasi), refund tiket end-to-end, kontrol payout (dual control & masa tunggu), integrasi
email/Midtrans di dasbor, pengaturan tanpa deploy + riwayat, k-anonimitas analitik, enkripsi data KYC, i18n EN lengkap
(dijamin typecheck), penanganan galat rute di web.

## F. Usulan urutan kerja
1. **Batch 1 — keamanan & uang (±3–4 hari)**: A1, A2, B1, B2 (payout manual + nomor rekening terenkripsi), B3, B4, B6, B7, C1, C3, C4.
2. **Batch 2 — kontrak & alur B2B (±3 hari)**: B5, status macet/timeout, notifikasi giliran tanda tangan, persetujuan split.
3. **Batch 3 — konten & fan (±4 hari)**: C2 (admin konten editorial & podcast), A3, playlist privasi, UU PDP ekspor/consent, SEO dasar.
4. **Batch 4 — operasi**: D5, D6 (zod/puppeteer, CSP), monitor terjadwal, observabilitas, perbaikan checkout p95, sinkron dokumen.
5. Paralel oleh bisnis: D1, D2, D4, D7; keputusan D3 (MFA admin).
