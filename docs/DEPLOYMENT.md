# Deployment RAVE (Docker)

Dua lingkungan, satu set Dockerfile (`infra/docker/`):

| | Development | Production |
| --- | --- | --- |
| File | `docker-compose.yml` | `docker-compose.prod.yml` + `.env.production` |
| Image | `rave/dev:local` (target `dev`, satu image untuk semua service) | `rave-<service>:<versi>` (target `runtime`, per service) + `rave-web:<versi>` (nginx) |
| Kode | bind mount, `tsx watch` + Vite HMR (polling) | dibekukan di image |
| Data | seed demo otomatis (`db-init`) | tanpa seed; migrasi saja |
| Port terbuka | Postgres 55442 (ubah lewat `DEV_PG_PORT`), gateway 8080, web 5173, RTMP 1935 | web 80 (atau Caddy 80/443), RTMP 1935; Postgres hanya 127.0.0.1 |
| Secret | default dev | wajib, divalidasi `prod:preflight` + saat boot (`service-kit/config.ts`) |

## Development

```bash
npm run docker:dev            # build image dev + Postgres + db-init (migrasi/seed) + 11 service + gateway + web
# buka http://localhost:5173 — akun demo di README
npm run docker:dev:logs
SEED=1 docker compose up db-init   # seed ulang data demo
docker compose --profile kafka up  # + Redpanda (set BUS_DRIVER=kafka)
npm run docker:dev:down            # `docker compose down -v` menghapus data dev
```

Port bisa diubah lewat `DEV_PG_PORT`, `DEV_GATEWAY_PORT`, `DEV_WEB_PORT` (mis. bila cluster lokal `./rave start` juga berjalan).
Alur tanpa Docker (`./rave start`) tetap tersedia.

## Production (satu host Docker)

Prasyarat server: Docker Engine 24+ dengan Compose v2, 4 vCPU / 8 GB RAM (minimum), disk SSD untuk volume `storage`.

```bash
git clone <repo> && cd <repo> && git checkout vX.Y.Z
cp .env.production.example .env.production   # isi secret: openssl rand -hex 32
npm run prod:preflight                       # WAJIB lolos
npm run prod:build                           # atau: RAVE_REGISTRY=ghcr.io/<org> scripts/prod.sh pull
npm run prod:up                              # preflight → up -d → tunggu healthy → smoke test
```

HTTPS:

- **Caddy bawaan** — set `RAVE_DOMAIN`, `ACME_EMAIL`, `WEB_BIND=127.0.0.1:8081`, lalu `PROFILES=tls npm run prod:up`.
- **TLS di luar** (load balancer / Cloudflare) — arahkan ke port `WEB_BIND` (default 80).

Topologi:

```
internet ─► [Caddy :443] ─► web (nginx :8080) ─┬─ /            aset SPA (cache immutable untuk /assets)
                                               └─ /v1/*  ─► gateway :8080 ─► iam, catalog, ... (jaringan internal)
OBS/Larix ─► live :1935 (RTMP)                     Postgres :5432 (internal) · volume storage (/data)
```

### Operasional

```bash
npm run prod:status              # docker compose ps
npm run prod:logs -- gateway     # log satu service (JSON pino)
npm run prod:smoke               # /v1/version, /v1/status (semua service sehat & versi seragam), web
scripts/prod.sh rollback 0.1.0   # kembali ke image versi lama
```

### Update versi (rolling di satu host)

1. Di mesin rilis: `npm run release -- auto && git push --follow-tags` → CI mendorong image (docs/VERSIONING.md).
2. Di server: ubah `RAVE_VERSION` di `.env.production`, `scripts/prod.sh pull`, `npm run prod:up`.
   Compose hanya membuat ulang container yang image-nya berubah; migrasi berjalan otomatis saat service start.
3. `npm run prod:smoke` harus lolos (tanpa `version_drift`).

### Rollback

`scripts/prod.sh rollback <versi>` menjalankan image lama. **Migrasi DB tidak di-rollback** — aman selama rilis
mengikuti pola expand → contract (docs/VERSIONING.md). Bila rilis membawa migrasi destruktif, pulihkan dari backup.

### Backup & pemulihan

- Super Admin → Platform → Backup menjalankan `pg_dump` ke volume `storage` (`/data/backups`) sesuai jadwal pengaturan.
- **Wajib** salin ke luar host (S3/GCS/rsync) secara terjadwal, contoh cron harian:
  `docker run --rm -v rave_storage:/data -v /srv/offsite:/out alpine sh -c 'cp -n /data/backups/*.sql.gz /out/'`
- Pemulihan: `gunzip -c rave-<stamp>.sql.gz | docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres psql -U rave -d rave`
- Volume `storage` juga berisi upload audio, kontrak PDF, branding, dan HLS — ikut dicadangkan (kecuali `live/`).

### Skala

- Service stateless dapat direplikasi (`docker compose up -d --scale catalog=2`); rate limit & pengaturan sudah
  berbagi state lewat Postgres. Live butuh `LIVE_DIR` bersama + `LIVE_INTERNAL_URL` per replika (docs/ARCHITECTURE.md §6).
- Melampaui satu host: image yang sama dapat dipakai di Kubernetes (probe `/healthz` & `/readyz`, SIGTERM graceful).
