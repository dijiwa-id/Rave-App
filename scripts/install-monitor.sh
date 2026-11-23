#!/usr/bin/env bash
# Pasang / periksa jadwal RAVE monitor (systemd timer) di host produksi. Idempoten. Runbook: docs/OPERATIONS.md §2.
#
#   sudo scripts/install-monitor.sh install [--dry-run] [--user U] [--env-file F] [--node PATH]
#   sudo scripts/install-monitor.sh test       # kirim SATU alert uji dengan env persis seperti unit (systemd-run)
#   sudo scripts/install-monitor.sh run        # jalankan satu putaran sekarang + tampilkan log
#        scripts/install-monitor.sh status     # timer, hasil terakhir, log 30 baris
#   sudo scripts/install-monitor.sh uninstall [--dry-run]   # hapus unit; /etc/rave/monitor.env & state DIBIARKAN
#        scripts/install-monitor.sh render [opsi]           # cetak unit hasil render (tanpa memasang)
#
# Opsi:
#   --dry-run        tampilkan apa yang akan dipasang/diubah, tanpa menulis apa pun (tidak butuh root)
#   --user U         user non-root yang menjalankan monitor (default: pemilik direktori repo). Butuh akses Docker.
#   --env-file F     file env produksi (default: <repo>/.env.production) — dibaca monitor, TIDAK disalin
#   --node PATH      biner node ≥ 20.12 (default: `command -v node`)
#   --destdir DIR    pasang ke DIR/etc/... tanpa systemctl (hanya untuk uji)
#
# Tanpa systemd (mis. container/WSL lama): skrip mencetak baris cron pengganti — lihat docs/OPERATIONS.md §2.3.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_SRC="$ROOT/infra/systemd"
SVC=rave-monitor.service
TMR=rave-monitor.timer

cmd="${1:-help}"; shift || true
DRY=0 USER_OPT="" ENV_FILE="" NODE_BIN="" DESTDIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --user) USER_OPT="${2:?--user butuh nilai}"; shift ;;
    --env-file) ENV_FILE="${2:?--env-file butuh nilai}"; shift ;;
    --node) NODE_BIN="${2:?--node butuh nilai}"; shift ;;
    --destdir) DESTDIR="${2:?--destdir butuh nilai}"; shift ;;
    *) echo "opsi tidak dikenal: $1" >&2; exit 64 ;;
  esac
  shift
done

ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }
info() { printf '→ %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
do_() { if [ "$DRY" = 1 ]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi; }

ETC="$DESTDIR/etc"
UNIT_DIR="$ETC/systemd/system"
CONF_DIR="$ETC/rave"
CONF="$CONF_DIR/monitor.env"
have_systemd() { [ -z "$DESTDIR" ] && [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; }
need_root() { [ "$DRY" = 1 ] || [ -n "$DESTDIR" ] || [ "$(id -u)" = 0 ] || die "jalankan dengan sudo (atau --dry-run untuk melihat rencana)"; }

resolve() {
  ENV_FILE="${ENV_FILE:-$ROOT/.env.production}"
  case "$ENV_FILE" in /*) ;; *) ENV_FILE="$ROOT/$ENV_FILE" ;; esac
  RUN_USER="${USER_OPT:-$(stat -c %U "$ROOT")}"
  NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
  for v in "$ROOT" "$ENV_FILE" "$RUN_USER" "$NODE_BIN"; do
    case "$v" in *$'\n'*|*'"'*|*'\'*|*'%'*) die "nilai mengandung karakter yang tidak didukung unit systemd: $v" ;; esac
  done
}

# Pemeriksaan prasyarat. Galat fatal → keluar; peringatan → lanjut.
preflight() {
  local fail=0
  [ "$RUN_USER" != root ] || { warn "monitor akan berjalan sebagai root — tidak disarankan; pilih user deploy dengan --user"; [ -n "$USER_OPT" ] || fail=1; }
  id "$RUN_USER" >/dev/null 2>&1 || { warn "user '$RUN_USER' tidak ada"; fail=1; }
  if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
    warn "node tidak ditemukan — pasang Node ≥ 22 (mis. NodeSource) atau beri --node /path/ke/node"; fail=1
  else
    local v; v="$("$NODE_BIN" -p 'process.versions.node' 2>/dev/null || echo 0)"
    "$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>21||(a===21&&b>=7)||(a===20&&b>=12)?0:1)' \
      || { warn "node $v terlalu lama (butuh ≥ 20.12 untuk util.parseEnv)"; fail=1; }
    ok "node $v ($NODE_BIN)"
  fi
  if [ -f "$ROOT/node_modules/tsx/package.json" ] && [ -f "$ROOT/node_modules/pg/package.json" ]; then ok "node_modules: tsx & pg ada"
  else warn "node_modules/tsx atau pg belum ada di $ROOT — jalankan sebagai $RUN_USER: cd '$ROOT' && npm ci --no-audit --no-fund"; fail=1; fi
  if [ -f "$ENV_FILE" ]; then ok "file env produksi: $ENV_FILE"; else warn "file env tidak ada: $ENV_FILE (beri --env-file)"; fail=1; fi
  if [ "$(id -u)" = 0 ] && id "$RUN_USER" >/dev/null 2>&1 && [ -f "$ENV_FILE" ]; then
    runuser -u "$RUN_USER" -- test -r "$ENV_FILE" || { warn "$RUN_USER tidak bisa membaca $ENV_FILE"; fail=1; }
    runuser -u "$RUN_USER" -- test -r "$ROOT/scripts/monitor.ts" || { warn "$RUN_USER tidak bisa membaca $ROOT"; fail=1; }
  fi
  if getent group docker >/dev/null 2>&1; then ok "grup docker ada (unit memakai SupplementaryGroups=docker)"
  else warn "grup docker tidak ada — pemeriksaan disk volume & data Postgres akan CRITICAL"; fi
  [ "$fail" = 0 ] || { [ "$DRY" = 1 ] && warn "prasyarat belum lengkap (dry-run tetap dilanjutkan)" || die "prasyarat belum lengkap — perbaiki dulu"; }
}

render() { # $1 = berkas templat
  local s; s="$(cat "$1")"
  s="${s//@RAVE_DIR@/"$ROOT"}"; s="${s//@RAVE_USER@/"$RUN_USER"}"
  s="${s//@NODE_BIN@/"$NODE_BIN"}"; s="${s//@ENV_FILE@/"$ENV_FILE"}"
  printf '%s\n' "$s"
}

TMPD=""
cleanup() { [ -z "$TMPD" ] || rm -rf "$TMPD"; }
trap cleanup EXIT
stage() {
  TMPD="$(mktemp -d)"
  render "$UNIT_SRC/$SVC" > "$TMPD/$SVC"
  render "$UNIT_SRC/$TMR" > "$TMPD/$TMR"
  if command -v systemd-analyze >/dev/null 2>&1; then
    # Hanya galat sintaks/unit yang relevan; peringatan lingkungan (user/biner tidak ada di mesin uji) tidak menggagalkan.
    local out; out="$(systemd-analyze verify "$TMPD/$SVC" "$TMPD/$TMR" 2>&1 || true)"
    if printf '%s' "$out" | grep -E "$TMPD" | grep -viE "not executable|No such file|Failed to resolve|failed to determine|does not exist" | grep -q .; then
      printf '%s\n' "$out" >&2; die "systemd-analyze verify menemukan galat pada unit"
    fi
    ok "systemd-analyze verify: unit valid"
  fi
}

put() { # $1 sumber, $2 tujuan, $3 mode — tulis hanya bila berbeda; echo 1 bila berubah
  if [ -f "$2" ] && cmp -s "$1" "$2"; then echo 0; return; fi
  if [ "$DRY" = 1 ]; then printf '  [dry-run] tulis %s (mode %s)%s\n' "$2" "$3" "$([ -f "$2" ] && echo ' — BERUBAH' || echo ' — baru')" >&2
  else install -D -m "$3" "$1" "$2"; printf '  tulis %s\n' "$2" >&2; fi
  echo 1
}

cron_fallback() {
  warn "systemd tidak tersedia — pakai cron (dedup tetap jalan lewat MONITOR_STATE_FILE):"
  cat <<EOF
# /etc/cron.d/rave-monitor   (root:root 0644; secret di /etc/rave/monitor.env 0600 dibaca lewat 'set -a; .')
SHELL=/bin/bash
*/5 * * * * $RUN_USER cd '$ROOT' && set -a && . /etc/rave/monitor.env && set +a && MONITOR_ENV_FILE='$ENV_FILE' MONITOR_STATE_FILE=\$HOME/.rave-monitor-state.json ALERT_WARN_CONFIRM_RUNS=2 nice -n 10 '$NODE_BIN' --max-old-space-size=96 --import tsx scripts/monitor.ts --prod >> \$HOME/rave-monitor.log 2>&1
EOF
  warn "catatan: dengan cron, /etc/rave/monitor.env harus bisa dibaca $RUN_USER (chmod 640, grup $RUN_USER)."
}

cmd_install() {
  need_root; resolve
  info "RAVE monitor — repo $ROOT, user $RUN_USER, env $ENV_FILE$([ "$DRY" = 1 ] && echo ' (DRY-RUN)')"
  preflight
  stage
  if [ "$DRY" = 1 ]; then
    info "unit yang akan dipasang:"; sed 's/^/    /' "$TMPD/$SVC"; echo; sed 's/^/    /' "$TMPD/$TMR"
  fi
  if [ -z "$DESTDIR" ] && ! have_systemd; then cron_fallback; exit 3; fi
  local changed=0 c
  c="$(put "$TMPD/$SVC" "$UNIT_DIR/$SVC" 0644)"; changed=$((changed + c))
  c="$(put "$TMPD/$TMR" "$UNIT_DIR/$TMR" 0644)"; changed=$((changed + c))
  if [ -f "$CONF" ]; then
    ok "$CONF sudah ada — tidak ditimpa"
    local mode; mode="$(stat -c %a "$CONF")"
    [ "$mode" = 600 ] || { warn "$CONF mode $mode → 600"; do_ chmod 600 "$CONF"; }
  else
    do_ install -d -m 0750 "$CONF_DIR"
    do_ install -m 0600 "$UNIT_SRC/monitor.env.example" "$CONF"
    info "isi $CONF: ALERT_EMAIL_TO, ALERT_EMAIL_FROM, ALERT_SMTP_URL (lihat komentar di berkas)"
  fi
  [ "$(id -u)" != 0 ] || [ -n "$DESTDIR" ] || do_ chown root:root "$CONF"
  if [ -n "$DESTDIR" ]; then ok "dipasang ke $DESTDIR (tanpa systemctl)"; return; fi
  [ "$changed" = 0 ] || do_ systemctl daemon-reload
  do_ systemctl enable --now "$TMR"
  [ "$changed" = 0 ] || [ "$DRY" = 1 ] || systemctl try-restart "$TMR"
  if [ "$DRY" = 0 ]; then
    systemctl list-timers --no-pager "$TMR" | head -3
    ok "terpasang. Berikutnya: sudo $0 test  (alert uji)  lalu  sudo $0 run  (satu putaran nyata)"
  fi
}

cmd_uninstall() {
  need_root
  if have_systemd; then do_ systemctl disable --now "$TMR" || true; fi
  for f in "$UNIT_DIR/$TMR" "$UNIT_DIR/$SVC"; do [ ! -f "$f" ] || do_ rm -f "$f"; done
  if have_systemd; then do_ systemctl daemon-reload; fi
  ok "unit dihapus; $CONF dan /var/lib/rave-monitor dibiarkan (hapus manual bila memang tidak dipakai lagi)"
}

# Jalankan monitor sekali dengan lingkungan PERSIS seperti unit (user, EnvironmentFile, batas memori).
transient() {
  [ "$(id -u)" = 0 ] || die "butuh sudo"
  have_systemd || die "systemd tidak tersedia"
  [ -f "$UNIT_DIR/$SVC" ] || die "unit belum terpasang — jalankan: sudo $0 install"
  local user wd envf node
  user="$(systemctl show -p User --value "$SVC")"
  wd="$(systemctl show -p WorkingDirectory --value "$SVC")"
  envf="$(sed -n 's/^Environment="MONITOR_ENV_FILE=\(.*\)"$/\1/p' "$UNIT_DIR/$SVC")"
  node="$(sed -n 's/^ExecStart="\([^"]*\)".*/\1/p' "$UNIT_DIR/$SVC")"
  systemd-run --quiet --wait --pipe --collect -p User="$user" -p SupplementaryGroups=docker -p WorkingDirectory="$wd" \
    -p EnvironmentFile=-"$CONF" -p MemoryMax=256M -p PrivateTmp=yes \
    -E MONITOR_ENV=prod -E MONITOR_ENV_FILE="${envf:-$wd/.env.production}" -E MONITOR_STATE_FILE=/var/lib/rave-monitor/state.json \
    -E NODE_OPTIONS=--max-old-space-size=96 \
    "$node" --import tsx scripts/monitor.ts --prod "$@"
}

cmd_test() {
  info "kanal alert yang aktif:"
  transient --channels
  info "mengirim SATU alert uji…"
  transient --test-alert && ok "alert uji terkirim — periksa kotak masuk (subjek '[RAVE UJI] prod uji alert dari $(hostname)'; cek juga folder Spam)" \
    || die "alert uji gagal — lihat baris ✗ di atas (docs/OPERATIONS.md §2.5)"
}

cmd_run() {
  need_root; have_systemd || die "systemd tidak tersedia"
  systemctl start "$SVC" || true # exit 2 (CRITICAL) membuat start "gagal" — log di bawah menjelaskan
  journalctl -u "$SVC" -n 40 --no-pager -o cat
}

cmd_status() {
  have_systemd || die "systemd tidak tersedia"
  systemctl list-timers --all --no-pager "$TMR" || true
  echo
  systemctl show "$SVC" -p Result -p ExecMainStatus -p ExecMainExitTimestamp --no-pager || true
  echo "  (ExecMainStatus: 0 = OK/WARN, 2 = CRITICAL)"
  echo
  journalctl -u "$SVC" -n 30 --no-pager -o short-iso || true
}

case "$cmd" in
  install) cmd_install ;;
  uninstall) cmd_uninstall ;;
  test) cmd_test ;;
  run) cmd_run ;;
  status) cmd_status ;;
  render) resolve; render "$UNIT_SRC/$SVC"; echo; render "$UNIT_SRC/$TMR" ;;
  help|-h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "perintah tidak dikenal: $cmd (install|test|run|status|uninstall|render)" ;;
esac
