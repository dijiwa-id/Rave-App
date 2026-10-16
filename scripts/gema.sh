#!/usr/bin/env bash
# Satu pintu untuk menjalankan aplikasi GEMA secara lokal (WSL, tanpa Docker/sudo).
#
#   ./gema start            # Postgres → migrasi (seed otomatis bila DB kosong) → semua service + gateway + web, di background
#   ./gema dev              # sama, tetapi di foreground (log langsung di terminal, Ctrl+C untuk berhenti)
#   ./gema stop             # hentikan service + web (Postgres tetap jalan; `stop --all` ikut mematikan Postgres)
#   ./gema restart          # stop lalu start
#   ./gema status           # cek port & /healthz tiap komponen
#   ./gema logs             # ikuti log (tail -f)
#   ./gema restart-web      # restart Vite saja (Vite di /mnt/d tidak hot-reload)
#   ./gema restart-svc iam  # restart satu service
#   ./gema seed             # jalankan seed data demo (idempoten)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$HOME/.gema"
LOGDIR="$STATE/logs"
LOG="$LOGDIR/gema.log"
PIDFILE="$STATE/gema.pid"
PGPORT="${GEMA_PGPORT:-55432}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"

# name:port — urutan sama dengan scripts/services.ts
COMPONENTS=(platform:4009 iam:4001 catalog:4002 library:4003 playback:4004 booking:4005 finance:4006
  ticketing:4007 notification:4008 live:4010 ads:4011 gateway:8080 web:5173)

c_ok=$'\e[32m'; c_err=$'\e[31m'; c_dim=$'\e[2m'; c_b=$'\e[1m'; c_0=$'\e[0m'
info() { echo "${c_b}→${c_0} $*"; }
ok() { echo "${c_ok}✓${c_0} $*"; }
die() { echo "${c_err}✗${c_0} $*" >&2; exit 1; }

port_of() { for c in "${COMPONENTS[@]}"; do [ "${c%%:*}" = "$1" ] && { echo "${c##*:}"; return; }; done; die "komponen tidak dikenal: $1"; }
listening() { ss -ltn "sport = :$1" 2>/dev/null | grep -q LISTEN; }
healthy() { curl -fsS -m 2 "http://127.0.0.1:$1/healthz" >/dev/null 2>&1; }

preflight() {
  command -v node >/dev/null || die "Node.js belum terpasang (butuh ≥ 20.19)"
  [ -n "$PGBIN" ] || die "PostgreSQL tidak ditemukan di /usr/lib/postgresql/*/bin (set PGBIN=...)"
  if [ ! -d "$ROOT/node_modules" ]; then
    info "npm install (pertama kali)"
    (cd "$ROOT" && npm install)
  fi
  mkdir -p "$LOGDIR"
}

db_up() { (cd "$ROOT" && bash scripts/dev-db.sh start); }

db_prepare() {
  local seeded
  seeded=$("$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U gema -d gema -tAc "SELECT to_regclass('iam.users') IS NOT NULL" 2>/dev/null || echo f)
  if [ "$seeded" = "t" ] && [ "${SEED:-0}" != "1" ]; then
    info "migrasi skema"
    (cd "$ROOT" && npm run --silent migrate) >>"$LOG" 2>&1 || die "migrasi gagal — lihat $LOG"
    ok "migrasi selesai"
  else
    info "seed data demo (migrasi + data awal)"
    (cd "$ROOT" && npm run --silent seed) >>"$LOG" 2>&1 || die "seed gagal — lihat $LOG"
    ok "seed selesai"
  fi
}

running_pid() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null && cat "$PIDFILE"; }

free_ports() {
  local busy=()
  for c in "${COMPONENTS[@]}"; do listening "${c##*:}" && busy+=("${c%%:*}:${c##*:}"); done
  [ ${#busy[@]} -eq 0 ] || die "port sudah dipakai: ${busy[*]} — jalankan './gema stop' dulu"
}

wait_ready() {
  info "menunggu semua komponen siap"
  local deadline=$((SECONDS + 120)) pending
  while :; do
    pending=()
    for c in "${COMPONENTS[@]}"; do
      local n="${c%%:*}" p="${c##*:}"
      if [ "$n" = web ]; then listening "$p" || pending+=("$n"); else healthy "$p" || pending+=("$n"); fi
    done
    [ ${#pending[@]} -eq 0 ] && break
    if [ -z "$(running_pid)" ]; then die "proses berhenti saat start — lihat $LOG"; fi
    [ $SECONDS -ge $deadline ] && die "belum siap setelah 120 dtk: ${pending[*]} — lihat $LOG"
    sleep 2
  done
  ok "GEMA berjalan"
  urls
}

urls() {
  cat <<EOF

  ${c_b}Web${c_0}       http://localhost:5173
  ${c_b}Gateway${c_0}   http://localhost:8080
  ${c_b}RTMP${c_0}      rtmp://localhost:1935/live
  ${c_dim}Log: $LOG   ·   ./gema logs   ·   ./gema stop${c_0}

EOF
}

cmd_start() {
  [ -n "$(running_pid)" ] && { ok "GEMA sudah berjalan (pid $(running_pid))"; urls; return; }
  preflight
  free_ports
  [ -s "$LOG" ] && mv -f "$LOG" "$LOG.1" # simpan log sesi sebelumnya untuk diagnosis
  : >"$LOG"
  db_up
  db_prepare
  info "menjalankan 11 service + gateway + web (background)"
  cd "$ROOT"
  # setsid → grup proses sendiri, agar `stop` bisa menghentikan seluruh pohon proses sekaligus
  setsid nohup npm run --silent dev </dev/null >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  wait_ready
}

cmd_dev() {
  preflight
  free_ports
  db_up
  : >"$LOG"
  db_prepare
  cd "$ROOT" && exec npm run --silent dev
}

cmd_stop() {
  local pid
  if pid=$(running_pid); then
    info "menghentikan GEMA (pid $pid)"
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  fi
  rm -f "$PIDFILE"
  # sisa proses (mis. dijalankan manual / restart-svc) dibersihkan per port
  local ports=(1935) p; for c in "${COMPONENTS[@]}"; do ports+=("${c##*:}"); done
  for p in "${ports[@]}"; do listening "$p" && fuser -k "$p/tcp" >/dev/null 2>&1 || true; done
  sleep 1
  for p in "${ports[@]}"; do listening "$p" && fuser -k -KILL "$p/tcp" >/dev/null 2>&1 || true; done
  ok "service & web berhenti"
  if [ "${1:-}" = "--all" ]; then (cd "$ROOT" && bash scripts/dev-db.sh stop) && ok "postgres berhenti"; fi
}

cmd_status() {
  local pid; pid=$(running_pid || true)
  echo "${c_b}GEMA${c_0} ${pid:+(pid $pid)}"
  if "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" -q 2>/dev/null; then ok "postgres      :$PGPORT"; else echo "${c_err}✗${c_0} postgres      :$PGPORT"; fi
  for c in "${COMPONENTS[@]}"; do
    local n="${c%%:*}" p="${c##*:}" up=0
    if [ "$n" = web ]; then listening "$p" && up=1; else healthy "$p" && up=1; fi
    if [ $up = 1 ]; then ok "$(printf '%-13s :%s' "$n" "$p")"; else echo "${c_err}✗${c_0} $(printf '%-13s :%s' "$n" "$p")"; fi
  done
}

# Log per komponen > 10 MB diputar (satu cadangan .1) agar disk tidak terisi log dev.
rotate_log() { [ -f "$1" ] && [ "$(stat -c %s "$1")" -gt 10485760 ] && mv -f "$1" "$1.1" || true; }

# Restart satu komponen di luar proses induk; log ditambahkan ke file yang sama.
restart_one() {
  local name="$1" port; port=$(port_of "$name")
  rotate_log "$LOGDIR/$name.log"
  fuser -k "$port/tcp" >/dev/null 2>&1 || true
  [ "$name" = live ] && { fuser -k 1935/tcp >/dev/null 2>&1 || true; }
  sleep 1
  # exec: subshell digantikan prosesnya sendiri — tidak ada bash yang tertinggal memegang stdout pemanggil.
  if [ "$name" = web ]; then
    (cd "$ROOT/apps/web" && exec setsid nohup npx vite) </dev/null >>"$LOGDIR/web.log" 2>&1 &
  else
    (cd "$ROOT/services/$name" && exec setsid nohup npx tsx src/index.ts) </dev/null >>"$LOGDIR/$name.log" 2>&1 &
  fi
  local deadline=$((SECONDS + 60))
  until { [ "$name" = web ] && listening "$port"; } || { [ "$name" != web ] && healthy "$port"; }; do
    [ $SECONDS -ge $deadline ] && die "$name belum siap — lihat $LOGDIR/$name.log"
    sleep 1
  done
  ok "$name di-restart (:$port) — log: $LOGDIR/$name.log"
}

case "${1:-help}" in
  start) cmd_start ;;
  dev) cmd_dev ;;
  stop) shift; cmd_stop "${1:-}" ;;
  restart) cmd_stop; cmd_start ;;
  status) cmd_status ;;
  logs) touch "$LOG"; tail -n 100 -f "$LOG" ;;
  seed) preflight; db_up; SEED=1 db_prepare ;;
  restart-web) restart_one web ;;
  restart-svc) [ -n "${2:-}" ] || die "pakai: ./gema restart-svc <nama>"; restart_one "$2" ;;
  *) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
esac
