#!/usr/bin/env bash
# Operasional stack produksi (docker-compose.prod.yml). Lihat docs/DEPLOYMENT.md.
#
#   scripts/prod.sh build              # build semua image bertag RAVE_VERSION (+ GIT_SHA, BUILD_DATE)
#   scripts/prod.sh push               # push image ke RAVE_REGISTRY
#   scripts/prod.sh pull               # tarik image versi RAVE_VERSION dari registry
#   scripts/prod.sh up                 # preflight → up -d → tunggu sehat → smoke test
#   scripts/prod.sh rollback 0.1.0     # jalankan ulang versi lama (image harus sudah ada / bisa di-pull)
#   scripts/prod.sh down | status | logs [service] | smoke
#   scripts/prod.sh backup             # salin dump DB ke off-site sekali (BACKUP_OFFSITE); keluar ≠ 0 bila gagal
#   scripts/prod.sh backup-verify [..] # uji pemulihan dump terbaru ke DB sementara (scripts/backup-verify.sh)
#
# Env: ENV_FILE (default .env.production), PROFILES="tls kafka" untuk mengaktifkan profil compose.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# Path relatif terhadap root repo (juga aman untuk Docker Desktop/WSL yang menerjemahkan path).
ENV_FILE="${ENV_FILE:-.env.production}"
export RAVE_ENV_FILE="$ENV_FILE"
# WSL + Docker Desktop: docker.exe hanya menerima env yang terdaftar di WSLENV (tanpa efek di Linux biasa).
export WSLENV="${WSLENV:+$WSLENV:}RAVE_ENV_FILE:RAVE_VERSION:GIT_SHA:BUILD_DATE"
# Override sesaat dari shell (mis. BACKUP_OFFSITE=dir BACKUP_OFFSITE_DIR=/mnt/nas scripts/prod.sh backup).
export WSLENV="$WSLENV:BACKUP_OFFSITE:BACKUP_OFFSITE_DIR:BACKUP_S3_URI:BACKUP_RCLONE_REMOTE:BACKUP_OFFSITE_KEEP_DAYS:BACKUP_MAX_AGE_HOURS"

profile_args=()
for p in ${PROFILES:-}; do profile_args+=(--profile "$p"); done
dc() { docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" "${profile_args[@]}" "$@"; }
envget() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2-; }

export GIT_SHA="${GIT_SHA:-$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)}"
export BUILD_DATE="${BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

web_url() {
  local bind; bind="$(envget WEB_BIND)"; bind="${bind:-80}"
  [[ "$bind" == *:* ]] && echo "http://$bind" || echo "http://127.0.0.1:$bind"
}

smoke() {
  local base; base="$(web_url)"
  echo "→ smoke test $base"
  local v; v="$(curl -fsS -m 5 "$base/v1/version")" || { echo "✗ /v1/version gagal"; return 1; }
  echo "  versi API: $v"
  local s; s="$(curl -fsS -m 10 "$base/v1/status")" || { echo "✗ /v1/status gagal"; return 1; }
  node -e '
    const s = JSON.parse(process.argv[1]);
    for (const x of s.services) console.log(`  ${x.ok ? "✓" : "✗"} ${x.service.padEnd(13)} ${x.version ?? "-"} ${x.ms}ms`);
    if (s.version_drift?.length) console.log("  ! versi tidak seragam:", s.version_drift.join(", "));
    process.exit(s.ok && !s.version_drift?.length ? 0 : 1);
  ' "$s" || { echo "✗ ada service tidak sehat / versi tidak seragam"; return 1; }
  curl -fsS -m 5 -o /dev/null "$base/" || { echo "✗ web / tidak merespons"; return 1; }
  echo "✓ smoke test lolos"
}

wait_healthy() {
  echo "→ menunggu semua container sehat (maks 180 dtk)"
  local deadline=$((SECONDS + 180))
  while :; do
    local bad; bad="$(dc ps --format '{{.Service}}|{{.Health}}|{{.State}}' | awk -F'|' '($2!="" && $2!="healthy") || $3!="running" {print $1}')"
    [ -z "$bad" ] && { echo "✓ semua container sehat"; return 0; }
    [ $SECONDS -ge $deadline ] && { echo "✗ belum sehat: $bad"; dc ps; return 1; }
    sleep 3
  done
}

cmd="${1:-status}"; shift || true
case "$cmd" in
  build) echo "→ build RAVE v$(envget RAVE_VERSION) ($GIT_SHA)"; dc build "$@" ;;
  push) dc push "$@" ;;
  pull) dc pull "$@" ;;
  up)
    bash scripts/prod-preflight.sh "$ENV_FILE"
    dc up -d --remove-orphans "$@"
    wait_healthy
    smoke
    ;;
  rollback)
    [ -n "${1:-}" ] || { echo "usage: $0 rollback <versi>"; exit 1; }
    export RAVE_VERSION="$1"
    echo "→ rollback ke v$RAVE_VERSION (migrasi DB tidak di-rollback — lihat docs/DEPLOYMENT.md §Rollback)"
    dc up -d --remove-orphans
    wait_healthy
    smoke
    ;;
  down) dc down "$@" ;;
  status) dc ps ;;
  logs) dc logs -f --tail=200 "$@" ;;
  smoke) smoke ;;
  backup) dc run --rm --no-deps -T backup-offsite once ;;
  backup-verify) ENV_FILE="$ENV_FILE" bash scripts/backup-verify.sh --compose "$@" ;;
  *) echo "perintah tidak dikenal: $cmd"; exit 1 ;;
esac
