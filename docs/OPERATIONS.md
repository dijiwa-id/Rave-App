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
| `npm run monitor -- --test-alert` | kirim pesan uji ke `ALERT_WEBHOOK_URL` |
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

## 2. Alert

`ALERT_WEBHOOK_URL` menerima `POST` JSON:

```json
{ "text": "🔴 RAVE prod CRITICAL (…)\n• [CRITICAL] disk.storage: /data …", "content": "…", "source": "rave-monitor",
  "env": "prod", "level": "CRITICAL", "target": "http://…", "host": "…", "at": "…", "checks": [ … hanya WARN/CRITICAL … ] }
```

`text` langsung dipahami Slack Incoming Webhook / Mattermost / Google Chat; `content` untuk Discord; sisanya untuk
penerima generik (n8n, Zapier, PagerDuty Events lewat relay, dsb.).

- `ALERT_MIN_LEVEL` = `WARN` (default) atau `CRITICAL`.
- Dedup: alert dikirim saat **daftar masalah berubah**, saat **pulih** (✅), dan pengingat tiap `ALERT_REPEAT_MIN`
  (default 60) selama masalah sama masih ada. State disimpan di `MONITOR_STATE_FILE`
  (default `$TMPDIR/rave-monitor-<env>.json`) sehingga dedup juga berlaku antar-eksekusi cron.
- Webhook gagal → dicetak ke stderr dan dicoba lagi pada putaran berikutnya.

### Contoh cron (host produksi)

```cron
# /etc/cron.d/rave-monitor — tiap menit; log ringkas JSON; alert lewat webhook
SHELL=/bin/bash
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/XXX/YYY/ZZZ
MONITOR_STATE_FILE=/var/lib/rave/monitor-prod.json
* * * * * deploy cd /srv/rave && npm run -s monitor:prod -- --json >> /var/log/rave-monitor.log 2>&1
```

Atau systemd timer:

```ini
# /etc/systemd/system/rave-monitor.service
[Service]
Type=oneshot
User=deploy
WorkingDirectory=/srv/rave
EnvironmentFile=/etc/rave/monitor.env      # ALERT_WEBHOOK_URL=… ambang MONITOR_*
ExecStart=/usr/bin/npm run -s monitor:prod -- --json

# /etc/systemd/system/rave-monitor.timer
[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
[Install]
WantedBy=timers.target
```

Monitor ini berjalan **di host yang sama** — bila host mati, tidak ada yang berteriak. Wajib ditambah uptime check
**eksternal**:

- UptimeRobot / Better Stack / Pingdom: monitor *HTTP(s) – Keyword* ke `https://<domain>/v1/status`, keyword
  `"ok":true`, interval 1 menit, alert setelah 2 kegagalan berturut-turut. Tambahan opsional: keyword
  `"version_drift":[]` (deploy setengah jalan). `/v1/status` di-cache 5 dtk di gateway sehingga aman di-poll sering.
- Kedua: monitor HTTP ke `https://<domain>/` (SPA via nginx/Caddy) dan, bila memakai live, TCP port 1935.

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
