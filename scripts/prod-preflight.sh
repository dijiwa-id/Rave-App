#!/usr/bin/env bash
# Pemeriksaan kesiapan go-live sebelum `prod:up`. Keluar ≠ 0 bila ada kesalahan fatal.
#   bash scripts/prod-preflight.sh [.env.production]
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${1:-.env.production}"
export RAVE_ENV_FILE="$ENV_FILE"
# WSL + Docker Desktop: docker.exe hanya menerima env yang terdaftar di WSLENV (tanpa efek di Linux biasa).
export WSLENV="${WSLENV:+$WSLENV:}RAVE_ENV_FILE:RAVE_VERSION:GIT_SHA:BUILD_DATE"
c_ok=$'\e[32m'; c_err=$'\e[31m'; c_warn=$'\e[33m'; c_0=$'\e[0m'
errors=0; warns=0
ok() { echo "${c_ok}✓${c_0} $*"; }
err() { echo "${c_err}✗${c_0} $*"; errors=$((errors + 1)); }
warn() { echo "${c_warn}!${c_0} $*"; warns=$((warns + 1)); }

[ -f "$ENV_FILE" ] || { err "$ENV_FILE tidak ada — salin dari .env.production.example"; exit 1; }
get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

# 1. Versi
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
V="$(get RAVE_VERSION)"
if [ -z "$V" ]; then err "RAVE_VERSION kosong"; elif [ "$V" != "$PKG_VERSION" ]; then warn "RAVE_VERSION=$V ≠ package.json $PKG_VERSION (boleh untuk rollback/pin versi lama)"; else ok "RAVE_VERSION=$V"; fi
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || err "RAVE_VERSION bukan SemVer: '$V'"

# 2. Secret
DEV_VALUES="dev-only-change-me-please-32-bytes-min dev-media-signing-secret dev-pg-webhook-secret dev-internal-service-secret"
for n in JWT_SECRET INTERNAL_SERVICE_SECRET MEDIA_SIGNING_SECRET PG_WEBHOOK_SECRET KYC_KEY; do
  v="$(get "$n")"
  if [ -z "$v" ]; then err "$n kosong"
  elif [[ " $DEV_VALUES " == *" $v "* ]]; then err "$n masih nilai dev"
  elif [ ${#v} -lt 32 ]; then err "$n terlalu pendek (${#v} < 32)"
  else ok "$n terisi (${#v} karakter)"; fi
done
dupes="$(for n in JWT_SECRET INTERNAL_SERVICE_SECRET MEDIA_SIGNING_SECRET PG_WEBHOOK_SECRET KYC_KEY; do get "$n"; done | grep -v '^$' | sort | uniq -d)"
[ -z "$dupes" ] || err "ada secret yang sama dipakai ulang — buat nilai unik per secret"

# 3. Database
DBURL="$(get DATABASE_URL)"; PGPW="$(get POSTGRES_PASSWORD)"
if [ -n "$DBURL" ]; then
  [[ "$DBURL" == *"rave:rave@"* ]] && err "DATABASE_URL memakai password dev" || ok "DATABASE_URL eksternal"
  [[ "$DBURL" == *sslmode=* ]] || warn "DATABASE_URL tanpa sslmode — pastikan koneksi ke DB terkelola terenkripsi"
elif [ -z "$PGPW" ]; then err "POSTGRES_PASSWORD kosong"
elif [ "$PGPW" = rave ] || [ ${#PGPW} -lt 16 ]; then err "POSTGRES_PASSWORD lemah (min 16 karakter, bukan 'rave')"
elif [[ ! "$PGPW" =~ ^[A-Za-z0-9_-]+$ ]]; then err "POSTGRES_PASSWORD hanya boleh [A-Za-z0-9_-] (dipakai di dalam URL)"
else ok "POSTGRES_PASSWORD kuat"; fi

# 4. URL publik
URL="$(get PUBLIC_WEB_URL)"
if [ -z "$URL" ]; then err "PUBLIC_WEB_URL kosong"
elif [[ "$URL" != https://* ]]; then warn "PUBLIC_WEB_URL bukan https ($URL)"
elif [[ "$URL" == *example* ]]; then err "PUBLIC_WEB_URL masih contoh ($URL)"
else ok "PUBLIC_WEB_URL=$URL"; fi

# 5. Integrasi yang belum produksi
[ "$(get PAYMENT_PROVIDER)" = sandbox ] && warn "PAYMENT_PROVIDER=sandbox — pembayaran tidak memindahkan uang sungguhan"
warn "BLOCKER go-live: pengiriman OTP/notifikasi (email/WA) belum punya adapter — kode OTP login hanya dicatat di log (docs/GO-LIVE.md §P0)"
[ "$(get RAVE_ALLOW_SEED)" = 1 ] && warn "RAVE_ALLOW_SEED=1 — akun demo bisa ter-seed"
[ "$(get RAVE_FAST_CLOCK)" = 1 ] && err "RAVE_FAST_CLOCK=1 dilarang di produksi"

# 6. Compose valid
if command -v docker >/dev/null; then
  if docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" config -q 2>/tmp/rave-preflight.$$; then ok "docker-compose.prod.yml valid"
  else err "docker-compose.prod.yml tidak valid: $(cat /tmp/rave-preflight.$$)"; fi
  rm -f /tmp/rave-preflight.$$
else warn "docker tidak terpasang — validasi compose dilewati"; fi

echo
if [ $errors -gt 0 ]; then echo "${c_err}Preflight GAGAL: $errors kesalahan, $warns peringatan.${c_0}"; exit 1; fi
echo "${c_ok}Preflight lolos${c_0} ($warns peringatan). Lanjutkan: npm run prod:up"
