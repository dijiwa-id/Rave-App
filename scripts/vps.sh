#!/usr/bin/env bash
# Deploy RAVE ke VPS kecil tanpa build di server (image dibangun di PC, dikirim lewat SSH).
# Lihat docs/GO-LIVE-VPS.md.
#
#   scripts/vps.sh bundle                 # kemas: image rave/*:<versi>, dump DB + storage prod-lokal, kode (git HEAD)
#   scripts/vps.sh setup  user@host       # sekali: swap 4 GB, firewall, Docker (bila belum ada)
#   scripts/vps.sh ship   user@host       # kirim bundle + env → docker load → pulihkan data (hanya bila DB kosong) → up (TLS)
#   scripts/vps.sh status user@host       # docker compose ps + smoke di server
#
# Env: VPS_ENV (default storage/vps/.env.production), VPS_DIR (default /opt/rave), SSH_OPTS.
set -euo pipefail
cd "$(dirname "$0")/.."

VPS_ENV="${VPS_ENV:-storage/vps/.env.production}"
VPS_DIR="${VPS_DIR:-/opt/rave}"
BUNDLE=storage/vps/bundle
SSH_OPTS="${SSH_OPTS:-}"
VERSION="$(grep -E '^RAVE_VERSION=' .env.production | cut -d= -f2)"
LOCAL_ENV=.env.production

ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }
step() { printf '\033[1m→\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
need_host() { [ -n "${1:-}" ] || die "pakai: $0 $cmd user@host"; }
rsh() { ssh $SSH_OPTS "$host" "$@"; }

cmd_bundle() {
  [ -f "$VPS_ENV" ] || die "$VPS_ENV tidak ada"
  mkdir -p "$BUNDLE"
  step "kode (git HEAD $(git rev-parse --short HEAD))"
  [ -z "$(git status --porcelain -- . ':!storage')" ] || die "working tree tidak bersih — commit dulu agar server = commit tercatat"
  git archive --format=tar.gz -o "$BUNDLE/src.tar.gz" HEAD
  git rev-parse --short=12 HEAD > "$BUNDLE/GIT_SHA"
  step "image rave/*:$VERSION (layer bersama disimpan sekali)"
  mapfile -t imgs < <(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "^rave/rave-[a-z]+:${VERSION}$")
  [ "${#imgs[@]}" -ge 13 ] || die "image belum lengkap (${#imgs[@]}/13) — jalankan npm run prod:build"
  docker save "${imgs[@]}" | gzip -1 > "$BUNDLE/images.tar.gz"
  step "dump DB produksi lokal"
  docker exec rave-postgres-1 pg_dump -U rave -d rave --no-owner | gzip > "$BUNDLE/db.sql.gz"
  step "volume storage produksi lokal"
  # Lewat stdout (bukan bind-mount): docker.exe Docker Desktop tidak bisa me-mount path WSL berspasi.
  docker run --rm -v rave_storage:/s:ro alpine tar czf - -C /s --exclude='./live/*' --exclude='./backups/*' . > "$BUNDLE/storage.tar.gz"
  tar tzf "$BUNDLE/storage.tar.gz" >/dev/null || die "arsip storage rusak"
  ls -lh "$BUNDLE"
  ok "bundle siap: $BUNDLE"
}

cmd_setup() {
  step "persiapan host $host"
  rsh 'bash -s' <<'EOF'
set -e
SUDO=; [ "$(id -u)" = 0 ] || SUDO=sudo
if ! swapon --show | grep -q .; then
  $SUDO fallocate -l 4G /swapfile && $SUDO chmod 600 /swapfile && $SUDO mkswap /swapfile >/dev/null && $SUDO swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
  echo 'vm.swappiness=10' | $SUDO tee /etc/sysctl.d/99-rave.conf >/dev/null && $SUDO sysctl -p /etc/sysctl.d/99-rave.conf >/dev/null
  echo "swap 4G aktif"
fi
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | $SUDO sh; fi
$SUDO usermod -aG docker "$(id -un)" 2>/dev/null || true
if command -v ufw >/dev/null; then
  $SUDO ufw allow OpenSSH >/dev/null; $SUDO ufw allow 80,443,1935/tcp >/dev/null; $SUDO ufw --force enable >/dev/null; echo "ufw: 22,80,443,1935"
fi
$SUDO timedatectl set-timezone Asia/Jakarta 2>/dev/null || true
$SUDO mkdir -p /opt/rave && $SUDO chown "$(id -un)" /opt/rave
docker --version; free -h | head -2; df -h / | tail -1
EOF
  ok "host siap (keluar-masuk SSH sekali bila user baru ditambahkan ke grup docker)"
}

cmd_ship() {
  [ -f "$BUNDLE/images.tar.gz" ] || die "bundle belum ada — jalankan $0 bundle"
  # Skrip remote sebagai berkas (bukan `bash -s` dari stdin: `docker compose exec` akan menelan sisa skrip).
  cat > "$BUNDLE/remote-ship.sh" <<'EOF'
set -e
cd "$(dirname "$0")/.."
VPS_DIR="$PWD"
tar xzf bundle/src.tar.gz
chmod 600 .env.production
export GIT_SHA="$(cat bundle/GIT_SHA)"
gunzip -c bundle/images.tar.gz | docker load | tail -3
dc() { docker compose -f docker-compose.prod.yml --env-file .env.production --profile tls "$@"; }
dc up -d postgres
for i in $(seq 60); do dc exec -T postgres pg_isready -U rave -d rave </dev/null >/dev/null 2>&1 && break; sleep 2; done
if [ "$(dc exec -T postgres psql -U rave -d rave -Atc "select count(*) from pg_namespace where nspname='catalog'" </dev/null)" = 0 ]; then
  gunzip -c bundle/db.sql.gz | dc exec -T postgres psql -q -U rave -d rave -v ON_ERROR_STOP=1 >/dev/null && echo "✓ DB dipulihkan dari prod-lokal"
  docker run --rm -i -v rave_storage:/s alpine tar xzf - -C /s < bundle/storage.tar.gz && echo "✓ storage dipulihkan"
  docker run --rm -v rave_storage:/s alpine chown -R 1000:1000 /s </dev/null
else
  echo "! DB sudah berisi data — tidak ditimpa (hapus volume rave_pgdata bila memang ingin memulihkan ulang)"
fi
PROFILES=tls ENV_FILE=.env.production bash scripts/prod.sh up
EOF
  step "salin bundle ke $host:$VPS_DIR"
  rsh "mkdir -p $VPS_DIR/bundle"
  scp $SSH_OPTS "$BUNDLE"/{src.tar.gz,images.tar.gz,db.sql.gz,storage.tar.gz,GIT_SHA,remote-ship.sh} "$host:$VPS_DIR/bundle/"
  scp $SSH_OPTS "$VPS_ENV" "$host:$VPS_DIR/.env.production"
  step "muat image, pulihkan data (bila DB kosong), jalankan stack TLS"
  rsh "bash $VPS_DIR/bundle/remote-ship.sh"
  ok "RAVE berjalan di $host — https://$(grep -E '^RAVE_DOMAIN=' "$VPS_ENV" | cut -d= -f2)"
}

cmd_status() {
  rsh "cd $VPS_DIR && PROFILES=tls ENV_FILE=.env.production bash scripts/prod.sh status && ENV_FILE=.env.production bash scripts/prod.sh smoke"
}

cmd="${1:-}"; host="${2:-}"
case "$cmd" in
  bundle) cmd_bundle ;;
  setup) need_host "$host"; cmd_setup ;;
  ship) need_host "$host"; cmd_ship ;;
  status) need_host "$host"; cmd_status ;;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
