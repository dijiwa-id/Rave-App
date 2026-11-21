# Deploy berikutnya — fitur yang BELUM ada di produksi

Status server per 2026-11-22:

| Server | Versi berjalan | Ketinggalan |
|---|---|---|
| **`rave.danantrex.my.id`** (dipakai aplikasi desktop & mobile terpasang) | **v0.3.1 · 61f8c4a** | v0.4.0, v0.4.1, v0.4.2 **dan** semua fitur di tabel "Isi" |
| prod-local (`127.0.0.1:8088`) | **sudah dideploy** 2026-11-22 (efeb97c + perbaikan nginx) | — (rollback: image `0.4.2-pre-share-20261122`, dump `storage/predeploy/rave-prod-pre-share-20261122.sql.gz`) |

Aplikasi desktop & mobile yang terpasang sudah memanggil endpoint baru (bagikan, unduhan, varian gambar, login
Google native) dan menampilkan "belum tersedia" sampai server-nya diperbarui. Perbarui/hapus berkas ini setelah deploy.

### Sudah dirilis (v0.4.0–v0.4.2) tetapi belum ada di `rave.danantrex.my.id`

- v0.4.0: verifikasi akun & KYC NIK + OTP email/WhatsApp, RAVE Pro (langganan B2B), royalti bulanan + laporan LMKN
- v0.4.1: login Google native mobile (Credential Manager), CORS origin aplikasi desktop (Tauri)
- v0.4.2: pengaturan platform dimuat sebelum service menerima permintaan
- Migrasi (otomatis saat service start): booking `008_pro_take_rate`; catalog `017_avatar_upload`; finance `009_pro_subscriptions`,
  `010_royalty`, `011_royalty_lmkn`; iam `012_verification`, `013_identity_number`, `014_org_pro`
- Konfigurasi: client Google OAuth untuk Android (Super Admin → Integrasi), `CORS_ORIGINS` berisi origin Tauri
  (`tauri://localhost`, `http://tauri.localhost`), penyedia OTP email/WhatsApp untuk verifikasi akun.

## Isi — fitur baru di atas v0.4.2 (belum ada di server mana pun)

| Area | Perubahan | Butuh di server |
|---|---|---|
| Berita | Ruang Berita (`/admin/news`, `/berita`), cerita utama unik di antara artikel tayang | migrasi platform `004_news`, `005_news_featured` (otomatis) |
| Go-live | Konfigurasi gagal-tertutup: `NODE_ENV` selain dev/test = produksi; `PUBLIC_WEB_URL` **wajib**; `PAYOUT_AUTO_COMPLETE=1` / `ROYALTY_ALLOW_OPEN_PERIOD=1` ditolak; `PG_WEBHOOK_SECRET` ≥ 32 karakter | cek `.env.production` → `npm run prod:preflight` |
| Alur bisnis | Midtrans `deny` tidak lagi membatalkan booking/order (uji di sandbox!), kunci wallet denda artis, batas tiket per akun, event hanya diedit editor org, chat siaran bertiket butuh akses, event iklan `complete` wajib `start` | — |
| Keuangan | Setting `finance.subscription_ppn_pct` (11) & `finance.artist_cancel_penalty_pct` (25, dibekukan per kontrak) — Super Admin → Monetisasi → Keuangan | — |
| Bagikan | Tombol bagikan Instagram/X/Facebook di setiap lagu (web, desktop, mobile); `GET/POST /v1/catalog/tracks/:id/share`, halaman Open Graph `/s/t/:id` + gambar pratinjau berlogo RAVE asli `/v1/catalog/share/t/:id/og.jpg` (komposit ffmpeg, aset `services/catalog/assets/share-logo.png`), laporan `GET /v1/admin/reports/share`; Super Admin → Pengaturan Layanan → Bagikan ke Medsos | migrasi catalog `019_track_shares` (otomatis); image **gateway** (rute laporan) & **web** (nginx `/s/t/`) wajib dibangun ulang |
| Unduhan aplikasi | Folder `downloads/` (installer Windows + APK) disajikan di `/downloads/`, menu unduh di player, halaman `/unduh` | folder `./downloads` ikut repo (installer desktop 0.4.2 + APK 0.3.2 sudah di-commit) — cukup `git pull`; bind mount `./downloads:/srv/downloads:ro` di service web |
| Performa (LCP) | Varian gambar WebP `?w=` dari ffmpeg (cache `<UPLOAD_DIR>/variants`), preload gambar hero per rute, satu loader boot | image **catalog** (ffmpeg sudah ada); volume storage bertambah oleh cache varian (aman dihapus, dibuat ulang otomatis) |
| Desain | Vinyl vintage hyperrealistic (tekstur `public/textures/`) | image **web** |

## Langkah deploy (VPS `rave.danantrex.my.id`)

Catatan dari deploy prod-local: lokasi nginx regex berkurung kurawal wajib dikutip (`location ~ "^/s/t/…{36}$"`) —
sudah diperbaiki di template; validasi dulu dengan `nginx -t` bila mengubah template.


```bash
git pull rave main                                   # di direktori server
npm run prod:preflight                               # wajib lolos tanpa BLOCKER (PUBLIC_WEB_URL dkk.)
npm run prod:backup                                  # dump DB sebelum migrasi (atau scripts/prod.sh backup)
npm run prod:build && npm run prod:up                # SEMUA image dibangun ulang (catalog, gateway, web, platform, …)
npm run prod:smoke
```

## Cek setelah deploy

```bash
H=https://rave.danantrex.my.id
T=<id lagu tayang>
curl -s  $H/v1/catalog/tracks/$T/share | jq .platforms        # 3 platform + url intent X/Facebook
curl -s  $H/s/t/$T | grep og:image                            # kartu pratinjau
curl -sI $H/v1/catalog/share/t/$T/og.jpg | grep -i content-type  # image/jpeg (sampul + logo RAVE)
curl -sI "$H/v1/catalog/media/<cover>.jpg?w=320" | grep -i content-type   # image/webp
curl -s  $H/downloads/manifest.json | jq '.desktop.version, .android.version'
```

- Super Admin → Pengaturan Layanan: **Bagikan ke Medsos** (saklar & template) dan **Keuangan** (PPN, penalti) tampil.
- Desktop & mobile terpasang: tombol bagikan berfungsi tanpa build ulang (sudah menunjuk ke domain ini).
- Uji pembayaran Midtrans sandbox: kartu ditolak (`deny`) → order tetap PENDING & bisa dibayar ulang.
- Item yang tetap menunggu server/domain final ada di `docs/GO-LIVE.md` → "Menunggu server & domain final".
