#!/usr/bin/env bash
# Uji pemulihan (restore drill) dump database RAVE — docs/DEPLOYMENT.md §Backup & pemulihan.
#
# Memulihkan satu dump ke database SEMENTARA (rave_restore_test_<waktu>) di server Postgres target,
# menjalankan pemeriksaan kewajaran, mencetak laporan, lalu menghapus database sementara itu.
# Database `rave` yang sedang dipakai TIDAK disentuh.
#
#   bash scripts/backup-verify.sh                       # dev: dump terbaru di storage/backups → DATABASE_URL (.env)
#   bash scripts/backup-verify.sh --fresh               # dev: buat pg_dump baru dari DATABASE_URL lalu uji
#   bash scripts/backup-verify.sh --file x.sql.gz       # dump tertentu (mis. dari disk off-site)
#   bash scripts/backup-verify.sh --compose [--file …]  # stack produksi: Postgres container via `docker compose exec`;
#                                                       # tanpa --file memakai dump terbaru di volume storage (/data/backups)
#   bash scripts/backup-verify.sh --url postgres://…    # Postgres lain (mis. server staging khusus uji restore)
#   --keep                                              # jangan hapus DB sementara (untuk diperiksa manual)
#
# Env opsional:
#   ENV_FILE                     file env stack produksi untuk --compose (default .env.production)
#   BACKUP_VERIFY_SCHEMAS        schema wajib ada (default: schema semua service + bus)
#   BACKUP_VERIFY_NONEMPTY       tabel yang wajib berisi baris, mis. "iam.users catalog.tracks" (default kosong)
#   BACKUP_VERIFY_MAX_AGE_HOURS  peringatan bila dump lebih tua dari ini (default 30)
#
# Keluar ≠ 0 bila ada pemeriksaan GAGAL. URL/password database tidak pernah dicetak.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE=direct FILE="" URL="" KEEP=0 FRESH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --compose) MODE=compose ;;
    --file) FILE="${2:?--file butuh path}"; shift ;;
    --url) URL="${2:?--url butuh URL}"; shift ;;
    --keep) KEEP=1 ;;
    --fresh) FRESH=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "argumen tidak dikenal: $1" >&2; exit 2 ;;
  esac
  shift
done

SCHEMAS="${BACKUP_VERIFY_SCHEMAS:-iam catalog library playback booking finance ticketing notify platform live ads bus}"
NONEMPTY="${BACKUP_VERIFY_NONEMPTY:-}"
MAX_AGE_H="${BACKUP_VERIFY_MAX_AGE_HOURS:-30}"
TS="$(date -u +%Y%m%d%H%M%S)"
TESTDB="rave_restore_test_${TS}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/rave-restore.XXXXXX")"
c_ok=$'\e[32m'; c_err=$'\e[31m'; c_warn=$'\e[33m'; c_0=$'\e[0m'
[ -t 1 ] || c_ok= c_err= c_warn= c_0=
fails=0; warns=0
ok() { echo "  ${c_ok}✓${c_0} $*"; }
bad() { echo "  ${c_err}✗${c_0} $*"; fails=$((fails + 1)); }
warn() { echo "  ${c_warn}!${c_0} $*"; warns=$((warns + 1)); }
die() { echo "${c_err}✗ $*${c_0}" >&2; exit 1; }

# ---------- Target Postgres ----------
# SOURCE (asal dump default) = compose bila --compose; TARGET = container postgres kecuali --url diberikan.
envget() { grep -E "^$1=" "$2" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
if [ "$MODE" = compose ]; then
  ENV_FILE="${ENV_FILE:-.env.production}"
  [ -f "$ENV_FILE" ] || die "$ENV_FILE tidak ada"
  export RAVE_ENV_FILE="$ENV_FILE"
  export WSLENV="${WSLENV:+$WSLENV:}RAVE_ENV_FILE:RAVE_VERSION"
  dc() { docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" "$@"; }
fi
if [ "$MODE" = compose ] && [ -z "$URL" ]; then
  TARGET=compose
  [ -z "$(envget DATABASE_URL "$ENV_FILE")" ] ||
    die "DATABASE_URL eksternal di $ENV_FILE (tanpa container postgres) — pakai --url ke server uji"
  # psql di container postgres lewat socket lokal (tanpa password).
  psql_db() { local db="$1"; shift; dc exec -T postgres psql -X -q -v ON_ERROR_STOP=1 -U rave -d "$db" "$@"; }
else
  TARGET=direct
  if [ -z "$URL" ]; then
    URL="${DATABASE_URL:-$(envget DATABASE_URL .env)}"
    [ -n "$URL" ] || die "DATABASE_URL tidak ditemukan (env atau .env) — atau pakai --url"
  fi
  command -v psql >/dev/null || die "psql tidak ada di PATH (dev: source ~/.rave/env.sh)"
  # Ganti nama database di URL (pertahankan query string, mis. sslmode).
  url_for() {
    local base="${URL%%\?*}" qs=""
    [ "$base" != "$URL" ] && qs="?${URL#*\?}"
    echo "${base%/*}/$1$qs"
  }
  psql_db() { local db="$1"; shift; psql -X -q -v ON_ERROR_STOP=1 "$(url_for "$db")" "$@"; }
fi
sql() { psql_db "$TESTDB" -Atc "$1"; }

# ---------- Sumber dump ----------
DUMP=""
cleanup() {
  local rc=$?
  if [ -n "${CREATED:-}" ] && [ "$KEEP" = 0 ]; then
    psql_db postgres -c "DROP DATABASE IF EXISTS \"$TESTDB\"" >/dev/null 2>&1 &&
      echo "→ DB sementara $TESTDB dihapus" || echo "${c_warn}! gagal menghapus $TESTDB — hapus manual${c_0}"
  fi
  rm -rf "$WORK"
  exit $rc
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if [ "$FRESH" = 1 ]; then
  [ "$TARGET" = direct ] || die "--fresh hanya untuk target langsung (dev/--url); produksi memakai dump dari service platform"
  DUMP="$WORK/rave-fresh-$TS.sql.gz"
  echo "→ pg_dump baru (flag sama dengan service platform)"
  pg_dump --dbname "$URL" --no-owner --no-privileges --format=plain | gzip -6 > "$DUMP"
elif [ -n "$FILE" ]; then
  [ -f "$FILE" ] || die "file $FILE tidak ada"
  DUMP="$FILE"
elif [ "$MODE" = compose ]; then
  name="$(dc exec -T platform sh -c 'cd /data/backups && ls -t rave-*.sql.gz 2>/dev/null | head -1' | tr -d '\r')"
  [ -n "$name" ] || die "tidak ada dump di volume storage (/data/backups) — jalankan backup di Platform → Backup dulu"
  echo "→ menyalin $name dari volume storage"
  dc exec -T platform cat "/data/backups/$name" > "$WORK/$name"
  DUMP="$WORK/$name"
else
  DUMP="$(ls -t "$ROOT"/storage/backups/*.sql.gz 2>/dev/null | head -1 || true)"
  [ -n "$DUMP" ] || die "tidak ada dump di storage/backups — pakai --file atau --fresh"
fi

echo "RAVE uji pemulihan backup — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  dump   : $DUMP"
echo "  target : $( [ "$TARGET" = compose ] && echo "docker compose (postgres) [$ENV_FILE]" || echo "Postgres langsung" ) → $TESTDB"
echo

# ---------- 1. Integritas file ----------
echo "1. Integritas file"
size=$(wc -c < "$DUMP")
sum="$(sha256sum "$DUMP" | cut -d' ' -f1)"
echo "     ukuran $size byte, sha256 $sum"
if [ "$FRESH" = 1 ]; then :
elif [ -f "$DUMP.sha256" ]; then
  want="$(cut -d' ' -f1 "$DUMP.sha256")"
  [ "$want" = "$sum" ] && ok "sha256 cocok dengan $(basename "$DUMP").sha256" || bad "sha256 TIDAK cocok dengan $(basename "$DUMP").sha256"
else
  warn "tidak ada $(basename "$DUMP").sha256 di sebelah dump (salinan off-site selalu menyertakannya)"
fi
gzip -t "$DUMP" 2>/dev/null && ok "gzip utuh" || { bad "gzip rusak/terpotong"; echo; die "Uji pemulihan GAGAL"; }
age_h=$(( ($(date +%s) - $(date -r "$DUMP" +%s)) / 3600 ))
# Nama rave-YYYYMMDD-HHMMSS-*: pakai stempel di nama (mtime berubah saat disalin).
if [[ "$(basename "$DUMP")" =~ ^rave-([0-9]{8})-([0-9]{6})- ]]; then
  d="${BASH_REMATCH[1]}" t="${BASH_REMATCH[2]}"
  stamp="$(date -u -d "${d:0:4}-${d:4:2}-${d:6:2}T${t:0:2}:${t:2:2}:${t:4:2}Z" +%s 2>/dev/null || echo "")"
  [ -n "$stamp" ] && age_h=$(( ($(date +%s) - stamp) / 3600 ))
fi
[ "$age_h" -lt "$MAX_AGE_H" ] && ok "umur dump ${age_h} jam" || warn "dump berumur ${age_h} jam (≥ $MAX_AGE_H) — bukan backup terbaru?"

# ---------- 2. Restore ----------
echo "2. Restore ke $TESTDB"
psql_db postgres -c "CREATE DATABASE \"$TESTDB\"" >/dev/null
CREATED=1
t0=$SECONDS
if gunzip -c "$DUMP" | psql_db "$TESTDB" --single-transaction >"$WORK/restore.log" 2>&1; then
  ok "restore selesai dalam $((SECONDS - t0)) dtk (satu transaksi, ON_ERROR_STOP)"
else
  bad "restore GAGAL:"; tail -n 15 "$WORK/restore.log" | sed 's/^/       /'
  echo; die "Uji pemulihan GAGAL ($fails gagal)"
fi

# ---------- 3. Pemeriksaan kewajaran ----------
echo "3. Pemeriksaan"
present="$(sql "SELECT string_agg(nspname, ' ' ORDER BY nspname) FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('information_schema','public')")"
echo "     schema: $present"
for s in $SCHEMAS; do
  if [[ " $present " != *" $s "* ]]; then bad "schema $s tidak ada"; continue; fi
  has_mig="$(sql "SELECT to_regclass('$s._migrations') IS NOT NULL")"
  if [ "$has_mig" = t ]; then
    n="$(sql "SELECT count(*) FROM $s._migrations")"
    [ "$n" -gt 0 ] && ok "schema $s ($n migrasi)" || bad "schema $s: _migrations kosong"
  else
    ok "schema $s"
  fi
done
tables="$(sql "SELECT count(*) FROM pg_tables WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema'")"
[ "$tables" -gt 0 ] && ok "$tables tabel dipulihkan" || bad "tidak ada tabel"

# Jumlah baris tabel kunci (informasi) + tabel wajib berisi (BACKUP_VERIFY_NONEMPTY).
for t in iam.users catalog.tracks library.playlists booking.bookings ticketing.ticket_types finance.ledger_entries platform.backups; do
  [ "$(sql "SELECT to_regclass('$t') IS NOT NULL")" = t ] && echo "     $(printf '%-24s' "$t") $(sql "SELECT count(*) FROM $t") baris"
done
for t in $NONEMPTY; do
  if [ "$(sql "SELECT to_regclass('$t') IS NOT NULL")" != t ]; then bad "tabel wajib $t tidak ada"; continue; fi
  n="$(sql "SELECT count(*) FROM $t")"
  [ "$n" -gt 0 ] && ok "$t berisi $n baris" || bad "$t kosong"
done

# Ledger double-entry (services/finance/migrations/001_init.sql): total debit = kredit, dan per transaksi.
if [ "$(sql "SELECT to_regclass('finance.ledger_entries') IS NOT NULL")" = t ]; then
  IFS='|' read -r deb cred n <<<"$(sql "SELECT coalesce(sum(amount) FILTER (WHERE side='DEBIT'),0), coalesce(sum(amount) FILTER (WHERE side='CREDIT'),0), count(*) FROM finance.ledger_entries")"
  [ "$deb" = "$cred" ] && ok "ledger seimbang: debit = kredit = $deb ($n entri)" || bad "ledger TIDAK seimbang: debit $deb ≠ kredit $cred"
  unbal="$(sql "SELECT count(*) FROM (SELECT txn_id FROM finance.ledger_entries GROUP BY txn_id HAVING sum(CASE side WHEN 'DEBIT' THEN amount ELSE -amount END) <> 0) x")"
  [ "$unbal" = 0 ] && ok "tidak ada transaksi ledger yang timpang" || bad "$unbal transaksi ledger timpang"
  orphan="$(sql "SELECT count(*) FROM finance.ledger_entries e LEFT JOIN finance.ledger_transactions t ON t.id = e.txn_id WHERE t.id IS NULL")"
  [ "$orphan" = 0 ] && ok "semua entri ledger punya transaksi induk" || bad "$orphan entri ledger tanpa transaksi"
else
  bad "tabel finance.ledger_entries tidak ada"
fi

echo
if [ "$fails" -gt 0 ]; then echo "${c_err}Uji pemulihan GAGAL: $fails gagal, $warns peringatan.${c_0}"; exit 1; fi
[ "$KEEP" = 1 ] && echo "→ --keep: DB $TESTDB dibiarkan untuk diperiksa (hapus manual setelah selesai)"
echo "${c_ok}Uji pemulihan LOLOS${c_0} ($warns peringatan) — $(basename "$DUMP")"
