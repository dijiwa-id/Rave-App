#!/usr/bin/env bash
# Snapshot data demo dari DB dev lokal (lebih lengkap dari seed: rilis hasil unggah Studio, playlist, riwayat, booking).
#
#   scripts/demo-data.sh export            # DB dev (DATABASE_URL di .env) → infra/demo/rave-demo.sql.gz
#   scripts/demo-data.sh import [URL]      # pulihkan ke DB KOSONG (default DATABASE_URL di .env)
#
# Yang TIDAK ikut: berkas storage/uploads (audio/cover hasil unggah — sebagian materi berhak cipta, repo publik),
# isi tabel OTP, refresh token, audit log, rate limit, sampel/backup platform, instance & penonton live.
# Rilis hasil unggah tetap tampil, tetapi audio/cover-nya baru bisa diputar bila storage/uploads disalin terpisah.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=infra/demo/rave-demo.sql.gz
url_from_env() { grep -E '^DATABASE_URL=' .env | cut -d= -f2-; }
die() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

EXCLUDE=(
  iam.otp_codes iam.refresh_tokens booking.signature_otps
  iam.audit_logs catalog.audit_logs platform.audit_logs
  gateway.rate_limits platform.backups platform.storage_samples
  live.instances live.viewers
)

case "${1:-}" in
  export)
    url="$(url_from_env)"; [ -n "$url" ] || die "DATABASE_URL tidak ada di .env"
    args=(); for t in "${EXCLUDE[@]}"; do args+=(--exclude-table-data="$t"); done
    mkdir -p "$(dirname "$OUT")"
    pg_dump "$url" --no-owner --no-privileges "${args[@]}" | gzip -9n > "$OUT"
    ls -lh "$OUT"
    ;;
  import)
    url="${2:-$(url_from_env)}"; [ -f "$OUT" ] || die "$OUT tidak ada"
    [ "$(psql "$url" -Atc "select count(*) from pg_namespace where nspname='catalog'")" = 0 ] \
      || die "DB sudah berisi skema RAVE — kosongkan dulu (mis. ./rave demo --reset atau npm run db:reset)"
    gunzip -c "$OUT" | psql "$url" -q -v ON_ERROR_STOP=1 >/dev/null
    echo "✓ data demo dipulihkan ke $(echo "$url" | sed -E 's#//[^@]*@#//#')"
    ;;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
