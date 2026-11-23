# Operasional RAVE — Monitoring, Alert & Uji Beban

Menjawab dua kriteria go-live BRD §15.1: **"Monitoring uptime dan alert disk/database aktif"** dan
**"Uji beban endpoint pemutaran dan checkout tiket"**. Tanpa dependensi baru: kedua skrip memakai Node 22 bawaan
(`fetch`, `statfs`, `parseEnv`) + `pg` yang sudah ada di monorepo.

| Perintah | Fungsi |
| --- | --- |
| `npm run monitor` | sekali periksa stack dev (`./rave start`, gateway :8080) |
| `npm run monitor:prod` | sekali periksa stack produksi (`docker-compose.prod.yml` + `.env.production`, web `WEB_BIND`) |
| `npm run monitor -- --watch 60` | periksa tiap 60 dtk (tmux/systemd); alert hanya saat status berubah |
| `npm run monitor -- --json` | satu baris JSON per putaran (untuk pengumpul log) |
| `npm run monitor -- --test-alert` | kirim SATU alert uji ke semua kanal (email SMTP/Resend, webhook) |
| `npm run monitor:channels` | tampilkan kanal alert aktif (tersamar), tanpa mengirim |
| `sudo scripts/install-monitor.sh install\|test\|run\|status` | pasang & periksa systemd timer di VPS (§2.3) |
| `npm run loadtest:playback -- --vus 10 --duration 30s` | uji beban pemutaran |
| `npm run loadtest:checkout -- --vus 10 --duration 30s` | uji beban checkout tiket + verifikasi tidak oversell |
| `npm run loadtest:browse -- --vus 10 --duration 30s` | uji beban baca (beranda, pencarian, rilis, event) |

> Selalu `source ~/.rave/env.sh` lebih dulu di mesin dev WSL (Node/Postgres user-local, shim `docker`).

## 1. Apa yang dipantau (`scripts/monitor.ts`)

| Pemeriksaan | Sumber | WARN | CRITICAL |
| --- | --- | --- | --- |
| `http.healthz` | `GET /healthz` (gateway; di prod: nginx web) | latensi ≥ 800 ms | tidak terjangkau / bukan 200 / ≥ 3000 ms |
| `http.status` | `GET /v1/status` → `ok` | latensi ≥ 800 ms | `ok: false` / tidak terjangkau |
| `version.drift` | `version_drift` di `/v1/status` | daftar tidak kosong (deploy setengah jalan) | – |
| `svc.<nama>` | per service dari `/v1/status` (`/readyz`) | readyz ≥ 800 ms | readyz gagal |
| `http.web` (prod) | `GET /` (index.html dari nginx) | – | bukan 200 |
| `pg.connect` | koneksi + `SELECT 1` | ≥ 800 ms | gagal terhubung |
| `pg.connections` | `pg_stat_activity` vs `max_connections` | ≥ 70 % | ≥ 90 % |
| `pg.size` | `pg_database_size` | info | – |
| `pg.long_tx` | transaksi terbuka tertua | ≥ 300 dtk | – |
| `bus.outbox` | baris `<schema>.outbox` belum terbit (umur tertua) | ≥ 120 dtk | ≥ 900 dtk |
| `bus.dead_letters` | `bus.dead_letters` (24 jam terakhir, belum di-retry) | > 0 | – |
| `disk.storage` | dev: `statfs` folder `storage/` (atau `UPLOAD_DIR`); prod: `statfs /data` di container `platform` | bebas ≤ 20 % | bebas ≤ 10 % |
| `disk.pgdata` | dev: `SHOW data_directory` (`~/.rave/pgdata`); prod: `df` di container `postgres` | bebas ≤ 20 % | bebas ≤ 10 % |
| `backup.age` | terbaru dari berkas `*.sql.gz` di folder backup **atau** `platform.backups` (COMPLETED) | ≥ 26 jam | ≥ 50 jam / belum ada backup |

Kode keluar: `0` OK/WARN, `1` WARN bila `--strict`, `2` CRITICAL — cocok untuk cron, `systemd OnFailure=`, Nagios/Icinga.

Koneksi DB: dev memakai `DATABASE_URL` dari `.env`; prod memakai `DATABASE_URL` dari `.env.production` bila ada (DB
terkelola), selain itu `postgres://rave:$POSTGRES_PASSWORD@127.0.0.1:$PROD_PG_PORT/rave` (port Postgres compose yang
hanya terikat ke 127.0.0.1). Nilai env dibaca ke memori saja, **tidak pernah dicetak**. Override: `MONITOR_DATABASE_URL`.

Untuk DB terkelola (RDS/Cloud SQL) `disk.pgdata` dilewati — pasang alarm disk/koneksi di konsol penyedia.

### Ambang (env)

| Env | Default | | Env | Default |
| --- | --- | --- | --- | --- |
| `MONITOR_LATENCY_WARN_MS` | 800 | | `MONITOR_LATENCY_CRIT_MS` | 3000 |
| `MONITOR_DISK_WARN_PCT` (bebas) | 20 | | `MONITOR_DISK_CRIT_PCT` (bebas) | 10 |
| `MONITOR_PG_CONN_WARN_PCT` | 70 | | `MONITOR_PG_CONN_CRIT_PCT` | 90 |
| `MONITOR_BACKUP_WARN_HOURS` | 26 | | `MONITOR_BACKUP_CRIT_HOURS` (0 = matikan) | 50 |
| `MONITOR_OUTBOX_WARN_SEC` | 120 | | `MONITOR_OUTBOX_CRIT_SEC` | 900 |
| `MONITOR_TX_WARN_SEC` | 300 | | `MONITOR_TARGET` | gateway dev / `WEB_BIND` prod |

Ambang backup mengikuti jadwal bawaan `storage.backup_interval_hours = 24` (lihat docs/DEPLOYMENT.md *Backup & pemulihan*);
sesuaikan bila interval diubah. Path lain: `MONITOR_STORAGE_DIR`, `MONITOR_BACKUP_DIR`, `MONITOR_PGDATA_DIR`,
`MONITOR_ENV_FILE`.

## 2. Alert, penjadwalan & uptime eksternal

Dua lapis yang saling menutup titik buta:

| Lapis | Di mana | Apa | Bila lapis ini mati |
| --- | --- | --- | --- |
| `rave-monitor` (systemd timer, tiap 5 mnt) | di VPS | semua pemeriksaan §1 (status, DB, outbox, dead letter, disk, backup) → email/webhook | uptime eksternal tetap jalan |
| Uptime eksternal (GitHub Actions, tiap ~10 mnt) | di luar VPS | `GET /v1/status` lewat Cloudflare → workflow merah → email GitHub (+ email/webhook opsional) | monitor VPS tetap jalan |

Opsional: `MONITOR_HEARTBEAT_URL` (healthchecks.io / Better Stack heartbeat) memberi tahu bila **timer monitor sendiri** berhenti.

### 2.1 Kanal alert

Kanal utama = **email**; webhook boleh ditambahkan. Monitor mengirim **langsung** (bukan lewat service notification
RAVE — alert justru dibutuhkan saat service mati). Semua kanal yang dikonfigurasi menerima pesan yang sama.

| Env | Fungsi |
| --- | --- |
| `ALERT_EMAIL_TO` | penerima (pisah koma) — mengaktifkan kanal email |
| `ALERT_EMAIL_FROM` | pengirim (default: user SMTP bila berupa alamat email, selain itu `EMAIL_FROM`). Gmail: alamat akun itu sendiri |
| `ALERT_SMTP_URL` | `smtps://user:pass@host:465` (TLS langsung) atau `smtp://user:pass@host:587` (STARTTLS). User/pass di-URL-encode (`@`→`%40`, spasi→`%20`) |
| `ALERT_SMTP_HOST/PORT/USER/PASS/SECURE` | alternatif tanpa URL-encode |
| `ALERT_EMAIL_PROVIDER` | `auto` (default: SMTP bila ada, selain itu Resend) \| `smtp` \| `resend` |
| `RESEND_API_KEY` / `ALERT_RESEND_API_KEY` | Resend HTTP API (dibaca juga dari `.env.production`) |
| `ALERT_WEBHOOK_URL` (+ `ALERT_WEBHOOK_FORMAT`, `ALERT_TELEGRAM_CHAT_ID`) | webhook: Slack/Discord/Telegram dikenali dari host, lainnya JSON generik |

**Penyedia email sebelum vendor platform siap (#28 / GO-LIVE-AUDIT D1).** Selama `EMAIL_PROVIDER=log` di produksi,
Resend belum bisa dipakai (domain pengirim belum terverifikasi). Yang langsung jalan: **SMTP akun email biasa dengan
App Password** — Gmail: aktifkan 2FA → <https://myaccount.google.com/apppasswords> → buat sandi aplikasi "RAVE
monitor" (16 huruf) → `ALERT_SMTP_URL=smtps://akun%40gmail.com:<16hurufTanpaSpasi>@smtp.gmail.com:465`,
`ALERT_EMAIL_FROM=akun@gmail.com`. Provider lain setara (Zoho `smtp.zoho.com:465`, Outlook `smtp.office365.com:587`
— beberapa tenant mematikan SMTP AUTH). Setelah #28 selesai: ganti ke `ALERT_EMAIL_PROVIDER=resend` dengan
`ALERT_EMAIL_FROM` dari domain terverifikasi.

Keamanan: sertifikat server SMTP selalu diverifikasi; kredensial tidak pernah dikirim tanpa TLS (kecuali ke relay
loopback, mis. postfix lokal); URL webhook, password SMTP & API key disamarkan dari semua keluaran (`***`), deskripsi
kanal hanya menampilkan host & alamat tersamar (`d***@gmail.com`). Isi alert hanya nama pemeriksaan, level, dan detail
§1 (tidak memuat env).

Contoh email:

```
Subject: [RAVE ALERT] prod CRITICAL: http.status, svc.catalog (<host>)

[RAVE ALERT] prod CRITICAL: http.status, svc.catalog (<host>)

Ada masalah yang perlu ditindaklanjuti.

- [CRITICAL] http.status: ok=false — service down: catalog
- [CRITICAL] svc.catalog: readyz gagal (4 ms)
- target http://127.0.0.1:8081

Waktu   : 2026-11-23T02:40:31.093Z
Dikirim : <host> (prod)
Runbook : docs/OPERATIONS.md §2 "Menindaklanjuti alert"
```

Subjek: `[RAVE ALERT] …` (masalah), `[RAVE PULIH] …` (pulih), `[RAVE UJI] …` (uji). Buat filter email pada awalan
`[RAVE ALERT]` agar tidak masuk Spam/Promosi. Webhook generik menerima `POST` JSON
`{ text, content, subject, source: "rave-monitor", kind, env, level, target, host, at, checks: [WARN/CRITICAL] }`
(`text` untuk Slack/Mattermost/Google Chat, `content` untuk Discord).

### 2.2 Anti-spam

- Dikirim saat **daftar masalah berubah**, saat **pulih**, dan pengingat tiap `ALERT_REPEAT_MIN` (default 60) selama
  masalah yang sama masih ada. State di `MONITOR_STATE_FILE` (unit: `/var/lib/rave-monitor/state.json`).
- **WARN** baru dikirim setelah terlihat `ALERT_WARN_CONFIRM_RUNS` putaran berturut-turut (unit: 2 = ±10 mnt) —
  meredam latensi yang naik-turun di VPS 2 GB. **CRITICAL selalu langsung**.
- `ALERT_MIN_LEVEL=CRITICAL` mematikan alert WARN sama sekali.
- Cukup satu kanal berhasil → dianggap terkirim (tidak mengulang ke kanal yang sudah menerima). Kanal yang gagal
  dicatat di log (`! alert email gagal: …`). Bila semua kanal gagal, dicoba lagi pada putaran berikutnya.

Kode keluar tetap `0` OK/WARN, `2` CRITICAL → unit `rave-monitor.service` berstatus *failed* saat CRITICAL
(terlihat di `systemctl --failed`); alert sudah dikirim oleh monitor sendiri.

### 2.3 Penjadwalan di VPS (systemd timer)

Berkas: `infra/systemd/rave-monitor.service` + `rave-monitor.timer` (templat), `infra/systemd/monitor.env.example`,
dipasang oleh `scripts/install-monitor.sh` (idempoten; `--dry-run` mencetak unit hasil render & semua langkah tanpa
menulis apa pun).

| Aspek | Nilai |
| --- | --- |
| Jadwal | `OnCalendar=*:0/5`, `RandomizedDelaySec=30`, `Persistent=true` (putaran terlewat dijalankan saat boot) |
| User | non-root, default pemilik direktori repo (`--user`), + `SupplementaryGroups=docker` untuk `docker compose exec` |
| Env | `MONITOR_ENV_FILE=<repo>/.env.production` **dibaca** monitor (tidak disalin/diekspor); secret alert di `/etc/rave/monitor.env` (root:root 0600, dibaca systemd sebelum turun hak) |
| Sumber daya | ±90 MB RSS, ±2 dtk per putaran; `MemoryHigh=192M`, `MemoryMax=256M`, `CPUQuota=50%`, `Nice=10`, IO idle, `--max-old-space-size=96` |
| Pengerasan | `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full`, `ProtectKernel*`, `ProtectControlGroups` |
| Log | journald (`journalctl -u rave-monitor`), rotasi oleh journald |

Prasyarat host: Node ≥ 20.12 (disarankan 22) dan `node_modules` repo berisi `tsx` + `pg` (`npm ci` sekali; dampak
disk ±beberapa ratus MB, RAM nol di luar putaran). Pemeriksaan prasyarat ada di skrip instalasi.

```bash
cd <repo>                                             # direktori repo di VPS (yang memuat .env.production)
sudo scripts/install-monitor.sh install --dry-run     # lihat rencana: unit, path, user, berkas yang ditulis
sudo scripts/install-monitor.sh install               # pasang + enable --now timer (aman diulang)
sudoedit /etc/rave/monitor.env                        # isi ALERT_EMAIL_TO/FROM + ALERT_SMTP_URL
sudo scripts/install-monitor.sh test                  # kirim SATU alert uji (env persis seperti unit)
sudo scripts/install-monitor.sh run                   # satu putaran nyata sekarang + 40 baris log
scripts/install-monitor.sh status                     # jadwal berikut, hasil terakhir, log 30 baris
sudo scripts/install-monitor.sh uninstall             # lepas unit (monitor.env & state dibiarkan)
```

Padanan: `scripts/prod.sh monitor-install|monitor-test|monitor-run|monitor-status|monitor-uninstall`.
Mengubah jadwal/batas: edit templat di repo → jalankan ulang `install` (hanya berkas yang berubah ditulis). Mengubah
secret/ambang: edit `/etc/rave/monitor.env` — berlaku di putaran berikutnya tanpa reload.

**Tanpa systemd** (jarang di VPS): `install` keluar dengan kode 3 dan mencetak baris `/etc/cron.d/rave-monitor`
pengganti (tiap 5 mnt, `nice`, log ke `~/rave-monitor.log`; `monitor.env` harus bisa dibaca user monitor).

### 2.4 Menindaklanjuti alert

Langkah pertama untuk semua alert: `ssh <vps> 'sudo rave-deploy status'` dan `scripts/install-monitor.sh status`.
Bila penyebabnya deploy terbaru → **rollback dulu** (`rave-deploy` / `scripts/prod.sh rollback <versi>`), diagnosa kemudian.

| Pemeriksaan | Arti | Tindakan |
| --- | --- | --- |
| `http.healthz` / `http.web` CRITICAL | nginx web tidak menjawab di `WEB_BIND` | `rave-deploy status`; `rave-deploy logs web`; container restart loop → cek `docker inspect` OOMKilled, `free -m` |
| `http.status` / `svc.<nama>` CRITICAL | gateway hidup tetapi service gagal `/readyz` | `rave-deploy logs <service>`; OOM (`docker stats --no-stream`, batas di override compose VPS); DB down → lihat `pg.connect` |
| latensi WARN (`http.*`, `svc.*`, `pg.connect` ≥ 800 ms) | VPS tertekan | `free -m` (swap tinggi?), `docker stats --no-stream`, proses Danantrex; bila tidak membaik → kurangi beban / naikkan RAM |
| `version.drift` WARN | deploy setengah jalan | selesaikan atau rollback deploy; jangan dibiarkan |
| `pg.connect` CRITICAL | Postgres tidak bisa dihubungi | `rave-deploy logs postgres`; disk penuh? (`disk.pgdata`); restart postgres hanya setelah penyebab jelas |
| `pg.connections` WARN/CRITICAL | koneksi mendekati `max_connections` | cari service yang bocor koneksi (`pg_stat_activity` per `application_name`); restart service itu |
| `pg.long_tx` WARN | transaksi menggantung ≥ 5 mnt | `SELECT pid, application_name, state, now()-xact_start FROM pg_stat_activity …`; `pg_cancel_backend(pid)` bila jelas macet |
| `bus.outbox` WARN/CRITICAL | event tidak terbit (pembayaran → PAID, notifikasi, dsb. tertahan) | log service pemilik schema di detail; restart service itu; pantau umur turun |
| `bus.dead_letters` WARN | consumer gagal memproses event 24 jam terakhir | Super Admin → Dead letter: baca galat, perbaiki penyebab, *retry* |
| `disk.storage` / `disk.pgdata` WARN/CRITICAL (bebas ≤ 20 % / ≤ 10 %) | disk hampir penuh | `df -h`, `docker system df`; aman: `docker image prune` (image lama, setelah deploy sukses), cache varian gambar `<UPLOAD_DIR>/variants`; **jangan** hapus volume/backup tanpa izin |
| `backup.age` WARN/CRITICAL | backup terakhir > 26 / > 50 jam | `rave-deploy logs platform` (job backup), `scripts/prod.sh backup`; setelah pulih jalankan `npm run prod:backup-verify` |
| `monitor` CRITICAL "monitor gagal" | skrip monitor sendiri galat | `journalctl -u rave-monitor -n 50`; biasanya `node_modules` hilang setelah `git clean` → `npm ci` |
| uptime eksternal TURUN tetapi monitor VPS diam | host/Cloudflare/tunnel bermasalah, atau VPS mati | `systemctl status cloudflared`; dasbor Cloudflare; konsol penyedia VPS |

Setelah insiden: catat kronologi & akar masalah (postmortem tanpa menyalahkan), tindakan pencegahan sebagai issue.

### 2.5 Uji alert & pemecahan masalah

- `npm run monitor:channels` / `scripts/monitor.ts --channels` — kanal aktif (tersamar), tanpa mengirim.
- `sudo scripts/install-monitor.sh test` — satu alert uji `[RAVE UJI] prod uji alert dari <host>`; keluar ≠ 0 bila
  ada kanal gagal, dengan alasan per kanal:

| Pesan | Penyebab |
| --- | --- |
| `SMTP AUTH ditolak: 535 …` | password salah / bukan App Password / 2FA belum aktif |
| `ETIMEDOUT` / `ECONNREFUSED` ke SMTP | penyedia VPS memblokir port SMTP keluar — coba 587 ↔ 465, atau minta buka blokir |
| `server SMTP tidak menawarkan STARTTLS` | pakai `smtps://…:465` |
| `email TIDAK AKTIF (…)` di `--channels` | `ALERT_EMAIL_FROM` atau penyedia (SMTP/Resend) belum di-set |
| `Resend HTTP 403` | domain pengirim belum terverifikasi di Resend (#28) |
| email tidak muncul padahal `SMTP 250` | cek Spam; buat filter `[RAVE ALERT]`/`[RAVE UJI]` → jangan pernah ke Spam |

Uji jalur masalah → pulih tanpa menyentuh layanan (state terpisah agar tidak mengganggu dedup timer):

```bash
cd <repo>
sudo -u <user> env MONITOR_STATE_FILE=/tmp/rave-mon-uji.json MONITOR_BACKUP_WARN_HOURS=0.01 \
  ALERT_SMTP_URL='…' ALERT_EMAIL_TO='…' npm run -s monitor:prod     # → email [RAVE ALERT] prod WARN: backup.age
sudo -u <user> env MONITOR_STATE_FILE=/tmp/rave-mon-uji.json \
  ALERT_SMTP_URL='…' ALERT_EMAIL_TO='…' npm run -s monitor:prod     # → email [RAVE PULIH] …
```

(Nilai `ALERT_*` di shell masuk riwayat shell — awali perintah dengan spasi atau hapus riwayatnya; cara normal adalah
`sudo scripts/install-monitor.sh test`.)

### 2.6 Uptime eksternal — GitHub Actions (`.github/workflows/uptime.yml`)

Dipilih karena tanpa server/akun tambahan dan konfigurasinya ada di repo. Tiap ~10 mnt: `curl --max-time 15` ke
`RAVE_STATUS_URL`, sehat = HTTP 200 **dan** `"ok": true`, 3 percobaan berjeda 20 dtk sebelum dinyatakan turun.

- **Turun** → workflow **gagal** → GitHub mengirim email "Run failed: Uptime" (kanal utama, tanpa secret).
- **Opsional**: email/webhook sendiri hanya saat status **berubah** (turun / pulih), ditentukan dari kesimpulan run
  sebelumnya — butuh secret `ALERT_EMAIL_TO` + `ALERT_EMAIL_FROM` + `ALERT_SMTP_URL` (dan/atau `ALERT_WEBHOOK_URL`).
- `workflow_dispatch`: `test_alert` (kirim satu alert uji), `simulate_down` (workflow merah tanpa menyentuh server →
  menguji email GitHub; run terjadwal berikutnya yang sehat mengirim "pulih").

Pengaturan (sekali): repo → Settings → Secrets and variables → Actions → **Variables**: `RAVE_STATUS_URL` =
`https://<domain>/v1/status`; **Secrets** (opsional) seperti di atas. Notifikasi akun GitHub pemilik (dijiwa-id):
<https://github.com/settings/notifications> → **Actions** → centang **Email** dan **Only notify for failed workflows**.
Email kegagalan workflow terjadwal dikirim ke **pengguna yang terakhir mengubah baris `cron`** di workflow — pastikan itu
akun yang dipantau.

Batasan (diterima secara sadar):

- Cron GitHub **tidak presisi**: run bisa telat 5–30 mnt atau sesekali terlewat saat beban tinggi → deteksi nyata
  10–40 mnt. Untuk deteksi ≤ 1–5 mnt tambahkan UptimeRobot / Better Stack gratis (monitor *Keyword* ke
  `https://<domain>/v1/status`, keyword `"ok":true`, interval 5 mnt, alert ke email).
- Workflow terjadwal **dinonaktifkan otomatis setelah 60 hari tanpa aktivitas repo** (repo publik); GitHub mengirim
  email peringatan sebelumnya. Aktifkan lagi di tab Actions → Uptime → *Enable workflow*.
- Email GitHub dikirim **per run gagal** (±tiap 10 mnt selama gangguan); alert ALERT_* hanya saat berubah.
- Memakai menit Actions (±1 mnt/run; repo publik gratis, privat ±4 300 mnt/bulan dari kuota).
- Bila Cloudflare *Bot Fight Mode*/WAF menantang runner GitHub, run akan merah palsu (HTTP 403) → buat aturan WAF
  *Skip* untuk path `/v1/status` (User-Agent `rave-uptime/1`).

## 3. Uji beban (`scripts/loadtest.ts`)

Generator beban berbasis `fetch` bawaan: `--vus` virtual user berjalan paralel selama `--duration`, masing-masing
mengulang skenario dengan jeda `--think` ms. Hasil: p50/p95/p99/max per langkah, RPS, galat, **429 terpisah**, dan
PASS/WARN terhadap target BRD:

| Kelas langkah | Target p95 |
| --- | --- |
| API baca (`GET`) | < 200 ms |
| API tulis (`POST`) | < 500 ms |
| TTFA (time-to-first-audio) | < 1 s |

Galat = status ≥ 400 selain 429 dan selain penolakan bisnis yang wajar (409 tiket habis, 422 batas per akun — dicatat di
kolom `wajar`, latensinya di baris `langkah [409]`). Exit `1` bila ada galat/oversell (`--strict`: juga bila WARN).
`--out hasil.json` menyimpan semua angka.

### 3.1 Skenario

**playback** — per iterasi: `POST /v1/playback/sessions` → `GET stream_url` (302 ke media) → bila media di origin
yang sama, `GET` byte pertama (`Range: bytes=0-65535`) → `POST /v1/events/play` (start) → jeda → `POST
/v1/events/play` (progress, `played_ms` 15 000). TTFA = sesi + resolusi stream (+ byte pertama media lokal).
Progress sengaja di bawah ambang *qualified stream* (30 dtk) → **tidak menambah royalti / stream qualified**; yang
bertambah hanya `playback.sessions`, `play_events`, dan hitungan *starts* agregat artis. Lagu demo seed mengarah ke
origin eksternal (soundhelix.com) — byte media tidak diambil kecuali `--fetch-media` (jangan membebani pihak ketiga).

**checkout** — membuat event uji `LOADTEST …` di org promotor demo (login `promotor@rave.id`), kuota `--quota`
(default VU×2, sengaja bisa habis agar perebutan kuota teruji), `max_per_account` 20. Per iterasi:
`POST /v1/ticketing/orders` (Idempotency-Key baru) → tiap order ke-3 dikirim ulang dengan key sama (harus order yang
sama + `Idempotent-Replayed: true`) → `POST /v1/finance/invoices/:id/simulate-pay` (sandbox) → polling
`GET /v1/ticketing/orders/:id` sampai `PAID` (`pay_to_PAID` = jalur asinkron finance → bus → ticketing).
Di akhir: verifikasi **terjual (server) ≤ kuota, sisa ≥ 0, PAID diamati klien ≤ kuota**, lalu event uji
**dibatalkan** → semua order PAID direfund otomatis lewat sandbox, reservasi dilepas (data tetap konsisten; event
`CANCELLED` tetap terlihat di dashboard promotor demo). `--event <id>` memakai event yang sudah ada (tidak
dibatalkan — inventori event itu benar-benar terjual!), `--keep-event` melewati pembatalan.
`simulate-pay` hanya ada di `NODE_ENV` dev, jadi checkout penuh hanya bisa diuji di dev/staging.

**browse** — `GET /v1/catalog/home`, `/v1/catalog/search?q=…`, `/v1/catalog/releases/:id`, `/v1/ticketing/events`.

### 3.2 Akun & login

Setiap VU memakai akun sendiri `loadtest-<n>@rave.test` (dibuat otomatis oleh login OTP pertama; `--accounts` untuk
prefix lain) agar bucket rate limit per akun tidak saling berbagi. Login dilakukan **sekali**: token disimpan di
`$TMPDIR/rave-loadtest-tokens-<host>.json` (mode 600) dan dipakai ulang / di-refresh pada eksekusi berikutnya.
Batas yang berlaku saat login: gateway kelas `otp` (`security.rate_limit_otp_per_minute`, default 10/menit per IP —
satu login = 2 permintaan) dan IAM `security.otp_max_per_window` per alamat. Skrip menunggu `Retry-After` dan
melaporkan `429 saat login`; login 30 akun baru ≈ 6 menit tanpa `--raise-limits`.

Target tanpa `dev_code` (produksi): `--tokens-file tokens.json` (array access token) atau `--anon` (playback/browse
anonim = pratinjau, bucket per IP).

### 3.3 Pengaman produksi

Default target = gateway dev (`http://127.0.0.1:${GATEWAY_PORT}`); alias `--target web` (:5173, lewat proxy Vite),
`--target prod` (:8088). Target selain gateway/web dev di loopback **ditolak** kecuali `--allow-prod`.

### 3.4 Rate limit selama uji

Semua uji dari satu IP/akun terkena rate limit gateway — itu perilaku yang benar, bukan galat aplikasi:

| Kelas | Batas | Kunci | Bisa diubah |
| --- | --- | --- | --- |
| umum | `security.rate_limit_per_minute` (600) | per akun (`sub`) / per IP anonim | Super Admin |
| `otp` (`/v1/auth/otp`, `/v1/auth/token`) | `security.rate_limit_otp_per_minute` (10) | per IP | Super Admin |
| `tix` (`/v1/ticketing/orders*`) | **30/menit, di-hardcode** di gateway | per akun | tidak — tambah VU/akun |
| `hls`/`ingest` | 6000/menit | per akun/IP | tidak |

Menaikkan sementara untuk jendela uji:

1. Otomatis (dev): `--raise-limits` — login `superadmin@rave.id`, simpan nilai sekarang, `PUT /v1/admin/platform/settings`
   `{security.rate_limit_per_minute: 10000, security.rate_limit_otp_per_minute: 100}` dengan alasan tercatat di riwayat
   pengaturan, lalu **mengembalikan nilai semula** saat selesai/Ctrl-C (berlaku real-time lewat `LISTEN rave_settings`).
2. Manual (staging/prod): Super Admin → Pengaturan → Keamanan → ubah *Rate limit umum* / *Rate limit endpoint OTP*,
   isi alasan "uji beban <tanggal>", jalankan uji, lalu kembalikan (riwayat pengaturan menunjukkan nilai sebelumnya).
   Jangan biarkan nilai uji aktif di luar jendela uji.

Respons 429 tetap dilaporkan di kolom `429`; VU menunggu `Retry-After` seperti klien sungguhan, sehingga latensi tidak
tercemar. Sampel `pay_to_PAID` yang polling-nya terkena 429 tidak diukur (dihitung terpisah).

## 4. Hasil terukur (2026-11-12)

Lingkungan: laptop dev WSL2 (Kali), semua 12 service Node via `./rave start`, Postgres 18 lokal
(`max_connections` 300), `BUS_DRIVER=pg`, rate-limit store memory. Klien di mesin yang sama → angka ini
**batas bawah kasar**, bukan kapasitas produksi; ulangi di staging dengan spesifikasi server produksi.

### 4.1 Monitor

| Stack | Hasil | Catatan |
| --- | --- | --- |
| dev (`npm run monitor`) | **CRITICAL** (exit 2), ±150–180 ms per putaran | semua service OK, `/v1/status` 38 ms, PG 95/300 koneksi, outbox & dead letter kosong, backup 21 jam; **`disk.storage` bebas 8,3 % (77 GB dari 931 GB) di drive D: (`/mnt/d`)** — temuan nyata, bukan bug skrip |
| prod-lokal (`npm run monitor:prod`) | **OK** (exit 0), ±1,5–2 dtk (termasuk 2× `docker compose exec`) | 11 service + web OK, PG 44/250, volume storage & pgdata bebas 92,9 %, backup 20,7 jam |
| alert | ✓ | `--test-alert`, alert CRITICAL, dedup putaran ke-2 (tidak terkirim ulang), alert pemulihan ✅ — diuji ke penerima webhook lokal |
| alert email + timer (2026-11-23) | ✓ | gateway tiruan + server SMTP tiruan (STARTTLS :587-gaya & TLS :465, AUTH PLAIN, sertifikat diverifikasi) + mock Resend: uji → CRITICAL → dedup → WARN tertunda 1/2 → WARN terkirim → pulih → diam; password salah & sertifikat tak tepercaya ditolak tanpa membocorkan secret; unit dirender lolos `systemd-analyze verify`, dijalankan sebagai transient unit (`MemoryMax=256M`): ±90 MB RSS; langkah shell workflow uptime diuji (turun/diam/pulih/uji) |

### 4.2 Uji beban (dev, gateway :8080)

**playback, 10 VU × 30 dtk, think 500 ms** — 2066 permintaan, 67,9 RPS, 0 galat, 0 × 429

| Langkah | n | p50 | p95 | p99 | Target | Hasil |
| --- | --- | --- | --- | --- | --- | --- |
| `POST /v1/playback/sessions` | 519 | 17 | 78 | 115 | < 500 | PASS |
| `GET stream` (302) | 519 | 6 | 31 | 59 | < 200 | PASS |
| TTFA (sesi + stream) | 519 | 23 | 109 | 165 | < 1000 | PASS |
| `POST /v1/events/play` start | 519 | 13 | 45 | 101 | < 500 | PASS |
| `POST /v1/events/play` progress | 509 | 15 | 58 | 107 | < 500 | PASS |

**playback stres, 30 VU × 30 dtk, think 0, `--raise-limits`** — 10 852 permintaan, **359 RPS**, 0 galat, 0 × 429

| Langkah | p50 | p95 | p99 | max | Hasil |
| --- | --- | --- | --- | --- | --- |
| sessions | 82 | 175 | 248 | 326 | PASS |
| stream | 55 | 124 | 180 | 249 | PASS |
| TTFA | 139 | 278 | 390 | 515 | PASS |
| events start / progress | 71 / 75 | 150 / 164 | 229 / 224 | 331 / 311 | PASS |

**browse, 10 VU × 30 dtk, think 250 ms** — 3938 permintaan, 130 RPS, 0 galat: home p95 31 ms, search 34, release 31,
events 20 → semua PASS (< 200 ms).

**checkout, 10 VU × 30 dtk, kuota 1000, think 2000 ms** — 127 order, 0 galat, 7 × 429 (polling status, kelas `tix`),
tidak oversell, idempoten 42/42

| Langkah | n | p50 | p95 | p99 | Target | Hasil |
| --- | --- | --- | --- | --- | --- | --- |
| `POST /v1/ticketing/orders` | 127 | 52 | 260 | 385 | < 500 | PASS |
| `POST …/simulate-pay` | 127 | 25 | 132 | 190 | < 500 | PASS |
| order replay (key sama) | 42 | 7 | 29 | 48 | < 500 | PASS |
| `GET /v1/ticketing/orders/:id` | 139 | 10 | 31 | 42 | < 200 | PASS |
| bayar → PAID (asinkron) | 126 | 340 | 525 | 972 | – | – |

**checkout perebutan kuota, 30 VU × 30 dtk, kuota 25, think 500 ms** — 25 terjual = kuota, sisa 0, 809 × 409
"habis", 30 × 429, **tidak oversell**, idempoten 8/8, 0 galat. `POST orders` sukses p50 595 / p95 **840 ms → WARN**
(order antre pada kunci baris `ticket_types` yang sama + panggilan sinkron ke finance); `GET order` p95 364 ms → WARN.

**checkout throughput, 30 VU × 60 dtk, kuota 2000, think 1000 ms** — 343 order PAID, tidak oversell, idempoten
111/111, 0 galat, 36 × 429. `POST orders` p50 63 / p95 **689** / p99 1065 ms → **WARN**; simulate-pay p95 184;
`GET order` p95 197.

Setelah semua uji: 4 event `LOADTEST …` berstatus `CANCELLED`, `sold = reserved = 0`, semua order PAID masuk
refund sandbox (`refund_status` → COMPLETED secara asinkron), `bus.dead_letters` kosong, `bus.outbox` kosong,
koneksi PG 105/300.

### 4.3 Kesimpulan & tindak lanjut

- Pemutaran: jauh di bawah target BRD bahkan pada 359 RPS (TTFA p95 278 ms). Belum mencakup byte media dari CDN —
  ulangi dengan `--fetch-media` setelah media produksi di object storage/CDN.
- Checkout: benar secara fungsional di bawah perebutan (tanpa oversell, idempotensi benar, tanpa 5xx). Latensi
  `POST /v1/ticketing/orders` melewati target tulis 500 ms (p95 690–840 ms) saat ≥ 30 pembeli paralel pada satu
  kategori tiket — kandidat optimasi sebelum *war ticket*: pembuatan invoice di finance di luar jalur kritis /
  antrean, atau kuota dipecah per shard. Uji ulang di spesifikasi produksi sebelum event besar.
- Batas `tix` 30/menit per akun bersifat hardcode; untuk uji throughput gunakan banyak akun (bukan menaikkan batas).

## 5. Langkah pra-deploy migrasi

Runner migrasi (`packages/service-kit/src/db.ts` → `migrate`) menjalankan SEMUA berkas migrasi yang belum tercatat di
**satu transaksi** (kunci advisory global), dicatat per nama (bukan checksum). Akibatnya `CREATE INDEX CONCURRENTLY`
tidak bisa dipakai di berkas migrasi, dan `CREATE INDEX` biasa pada tabel besar mengunci tulis tabel itu selama indeks
dibangun (service menunggu saat start).

### 5.1 Unduhan offline P-7 — `playback/006_offline_plays.sql`

Migrasi ini membuat `qualified_user_played_idx` di `playback.qualified_streams` (tabel stream qualified — besar di
produksi). Agar start service tidak menahan tulis stream selama indeks dibangun, buat indeks **sebelum** deploy, di luar
transaksi; migrasi kemudian melewatinya (`IF NOT EXISTS`):

```sql
-- psql ke DB produksi, sebagai pemilik schema playback (di luar BEGIN/COMMIT)
CREATE INDEX CONCURRENTLY IF NOT EXISTS qualified_user_played_idx
  ON playback.qualified_streams (user_id, (coalesce(played_at, at)) DESC);
```

Catatan: ekspresi indeks mengacu kolom `played_at` yang baru ditambahkan migrasi yang sama — jalankan dulu
`ALTER TABLE playback.qualified_streams ADD COLUMN IF NOT EXISTS played_at timestamptz;` (hanya metadata, instan)
lalu perintah di atas. Bila `CONCURRENTLY` gagal di tengah, indeks tertinggal `INVALID` → `DROP INDEX CONCURRENTLY
playback.qualified_user_played_idx;` lalu ulangi. Tabel kecil (< ~1 juta baris) boleh langsung lewat migrasi.

Migrasi lain di rilis ini (iam `016_device_guards`, catalog `021_offline_key_id`, playback `007_offline_guards`) hanya
menambah kolom nullable, tabel baru, atau indeks di tabel kecil — aman di dalam transaksi migrasi.
