# Unduhan aplikasi RAVE

Folder ini disajikan apa adanya di `/downloads/` (nginx produksi: bind mount `./downloads:/srv/downloads:ro`;
dev: middleware Vite). Tombol unduh di web (header player, halaman `/unduh`, Landing, footer) membaca
`/downloads/manifest.json`; tanpa manifest, web menampilkan status "segera".

```
downloads/
  desktop/   RAVE_<versi>_x64-setup.exe, RAVE_<versi>_x64_en-US.msi   (Windows, dari RAVE-Desktop-apps/installers)
  mobile/    RAVE_<versi>_android-arm64.apk                           (Android, dari build release RAVE-mobile-apps)
  manifest.json                                                       (dibuat otomatis: versi, ukuran, SHA-256)
```

Perbarui setelah membangun installer/APK baru:

```bash
npm run apps:publish          # salin build terbaru dari ../RAVE-Desktop-apps & ../RAVE-mobile-apps + tulis manifest
```

Installer & manifest **ikut di-commit** (installer Windows ±7 MB, APK ±22 MB): setelah `npm run apps:publish`,
commit folder ini lalu `git pull` di server — tombol unduh langsung menyajikan versi baru.
