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
PP="$(get PAYMENT_PROVIDER)"; PP="${PP:-sandbox}"
case "$PP" in
  sandbox) warn "BLOCKER go-live: PAYMENT_PROVIDER=sandbox — pembayaran tidak memindahkan uang (abaikan bila Midtrans sudah diatur di dasbor Super Admin → Integrasi)" ;;
  midtrans) [ -n "$(get MIDTRANS_SERVER_KEY)" ] && ok "PAYMENT_PROVIDER=midtrans (mode $(get MIDTRANS_MODE || true))" || err "PAYMENT_PROVIDER=midtrans tetapi MIDTRANS_SERVER_KEY kosong" ;;
  *) err "PAYMENT_PROVIDER='$PP' tidak dikenal (sandbox|midtrans)" ;;
esac
# Pengirim OTP & notifikasi (packages/service-kit/src/messaging.ts). Tanpa provider email nyata tidak ada yang bisa login.
EP="$(get EMAIL_PROVIDER)"; EP="${EP:-log}"
case "$EP" in
  log) warn "BLOCKER go-live: EMAIL_PROVIDER=log — kode OTP login & notifikasi email tidak terkirim (abaikan bila sudah diatur di dasbor Super Admin → Integrasi)" ;;
  resend|mailgun|postmark|webhook)
    need=(EMAIL_FROM); case "$EP" in resend) need+=(RESEND_API_KEY) ;; mailgun) need+=(MAILGUN_API_KEY MAILGUN_DOMAIN) ;; postmark) need+=(POSTMARK_SERVER_TOKEN) ;; webhook) need+=(EMAIL_WEBHOOK_URL) ;; esac
    miss=(); for k in "${need[@]}"; do [ -n "$(get "$k")" ] || miss+=("$k"); done
    if [ ${#miss[@]} -gt 0 ]; then err "EMAIL_PROVIDER=$EP tetapi ${miss[*]} kosong"; else ok "EMAIL_PROVIDER=$EP, pengirim $(get EMAIL_FROM)"; fi ;;
  *) err "EMAIL_PROVIDER='$EP' tidak dikenal (log|resend|mailgun|postmark|webhook)" ;;
esac
WP="$(get WHATSAPP_PROVIDER)"; WP="${WP:-log}"
case "$WP" in
  log) warn "WHATSAPP_PROVIDER=log — OTP & notifikasi WhatsApp tidak terkirim (login web memakai email; BRD menyarankan email + WA)" ;;
  meta) { [ -n "$(get WA_PHONE_NUMBER_ID)" ] && [ -n "$(get WA_ACCESS_TOKEN)" ]; } && ok "WHATSAPP_PROVIDER=meta (templat OTP: $(get WA_OTP_TEMPLATE || true))" || err "WHATSAPP_PROVIDER=meta tetapi WA_PHONE_NUMBER_ID / WA_ACCESS_TOKEN kosong" ;;
  webhook) [ -n "$(get WHATSAPP_WEBHOOK_URL)" ] && ok "WHATSAPP_PROVIDER=webhook" || err "WHATSAPP_PROVIDER=webhook tetapi WHATSAPP_WEBHOOK_URL kosong" ;;
  *) err "WHATSAPP_PROVIDER='$WP' tidak dikenal (log|meta|webhook)" ;;
esac
[ "$(get RAVE_ALLOW_SEED)" = 1 ] && warn "RAVE_ALLOW_SEED=1 — akun demo bisa ter-seed"
[ "$(get RAVE_FAST_CLOCK)" = 1 ] && err "RAVE_FAST_CLOCK=1 dilarang di produksi"

# 6. Backup off-site (docs/DEPLOYMENT.md §Backup & pemulihan) — peringatan, bukan blocker teknis deploy.
BO="${BACKUP_OFFSITE:-$(get BACKUP_OFFSITE)}"
case "${BO:-none}" in
  none) warn "BLOCKER go-live: BACKUP_OFFSITE=none/kosong — dump DB hanya di volume lokal; set dir|s3|rclone (docs/GO-LIVE.md §P0 #5)" ;;
  dir) d="${BACKUP_OFFSITE_DIR:-$(get BACKUP_OFFSITE_DIR)}"
       if [ -z "$d" ]; then err "BACKUP_OFFSITE=dir tetapi BACKUP_OFFSITE_DIR kosong"
       else ok "BACKUP_OFFSITE=dir → $d (pastikan disk/NAS terpisah dari disk utama)"; fi ;;
  s3) [[ "$(get BACKUP_S3_URI)" == s3://?* ]] && ok "BACKUP_OFFSITE=s3 → $(get BACKUP_S3_URI)" || err "BACKUP_OFFSITE=s3 tetapi BACKUP_S3_URI bukan s3://bucket/prefix"
      [ -n "$(get RCLONE_S3_ACCESS_KEY_ID)" ] || [ "$(get RCLONE_S3_ENV_AUTH)" = true ] || warn "BACKUP_OFFSITE=s3 tanpa RCLONE_S3_ACCESS_KEY_ID / RCLONE_S3_ENV_AUTH=true" ;;
  rclone) [[ "$(get BACKUP_RCLONE_REMOTE)" == ?*:* ]] && ok "BACKUP_OFFSITE=rclone → $(get BACKUP_RCLONE_REMOTE)" || err "BACKUP_OFFSITE=rclone tetapi BACKUP_RCLONE_REMOTE bukan remote:path" ;;
  *) err "BACKUP_OFFSITE='$BO' tidak dikenal (none|dir|s3|rclone)" ;;
esac

# 7. Compose valid
if command -v docker >/dev/null; then
  if docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" config -q 2>/tmp/rave-preflight.$$; then ok "docker-compose.prod.yml valid"
  else err "docker-compose.prod.yml tidak valid: $(cat /tmp/rave-preflight.$$)"; fi
  rm -f /tmp/rave-preflight.$$
else warn "docker tidak terpasang — validasi compose dilewati"; fi

echo
if [ $errors -gt 0 ]; then echo "${c_err}Preflight GAGAL: $errors kesalahan, $warns peringatan.${c_0}"; exit 1; fi
echo "${c_ok}Preflight lolos${c_0} ($warns peringatan). Lanjutkan: npm run prod:up"
