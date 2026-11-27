# Unduhan aplikasi RAVE

Folder ini disajikan apa adanya di `/downloads/` (nginx produksi: bind mount `./downloads:/srv/downloads:ro`;
dev: middleware Vite). Tombol unduh di web (header player, halaman `/unduh`, Landing, footer) membaca
`/downloads/manifest.json`; tanpa manifest, web menampilkan status "segera".

**Android**: tombol unduh APK mengambil langsung dari GitHub Release terbaru
[dijiwa-id/RAVE-Mobile-Apps](https://github.com/dijiwa-id/RAVE-Mobile-Apps/releases/latest) (aset `*.apk`, utamakan arm64)
— rilis mobile baru langsung tampil tanpa commit/deploy web. APK **tidak** disimpan di repo ini. Bila GitHub API
tak terjangkau (mis. rate limit 60 req/jam per IP), tombol menautkan ke halaman rilis terbaru di GitHub.

```
downloads/
  desktop/   RAVE_<versi>_x64-setup.exe, RAVE_<versi>_x64_en-US.msi   (Windows, dari RAVE-Desktop-apps/installers)
  mobile/    (kosong — APK Android diambil dari GitHub Releases, lihat di atas)
  manifest.json                                                       (dibuat otomatis: versi, ukuran, SHA-256)
```

Perbarui setelah membangun installer/APK baru:

```bash
npm run apps:publish          # salin installer Windows terbaru dari ../RAVE-Desktop-apps + tulis manifest
```

Installer & manifest **ikut di-commit** (installer Windows ±7 MB): setelah `npm run apps:publish`,
commit folder ini lalu `git pull` di server — tombol unduh langsung menyajikan versi baru.
