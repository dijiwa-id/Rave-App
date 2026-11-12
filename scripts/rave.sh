#!/usr/bin/env bash
# Satu pintu untuk menjalankan aplikasi RAVE secara lokal (WSL, tanpa Docker/sudo).
#
#   ./rave dev              # Postgres → migrasi (seed otomatis bila DB kosong) → semua service + gateway + web, foreground,
#                           # auto-reload: web (Vite HMR) & service (restart saat src berubah). Ctrl+C untuk berhenti.
#   ./rave start            # sama, tetapi di background (log: ./rave logs)
#   ./rave stop             # hentikan service + web (Postgres tetap jalan; `stop --all` ikut mematikan Postgres)
#   ./rave restart          # stop lalu start
#   ./rave status           # cek port & /healthz tiap komponen
#   ./rave logs             # ikuti log (tail -f)
#   ./rave restart-web      # restart Vite saja (biasanya tidak perlu lagi — polling aktif otomatis di /mnt/*)
#   ./rave restart-svc iam  # restart satu service
#   ./rave seed             # jalankan seed data demo (idempoten)
set -euo pipefail

# Toolchain user-local (Node/PostgreSQL tanpa sudo, lihat README) — dimuat otomatis agar tidak perlu `source` manual.
if [ -f "$HOME/.rave/env.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.rave/env.sh"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$HOME/.rave"
LOGDIR="$STATE/logs"
LOG="$LOGDIR/rave.log"
PIDFILE="$STATE/rave.pid"
if [ -z "${RAVE_PGPORT:-}" ] && [ -f "$ROOT/.env" ]; then RAVE_PGPORT="$(grep -E '^RAVE_PGPORT=' "$ROOT/.env" | tail -1 | cut -d= -f2 | tr -d '[:space:]')"; fi
PGPORT="${RAVE_PGPORT:-55432}"
PGDATA_DIR="${RAVE_PGDATA:-$HOME/.rave/pgdata}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PGBIN

# Hot-reload: proyek di /mnt/* (drvfs WSL) tidak mengirim event inotify → Vite & watcher service memakai polling.
case "$ROOT" in
  /mnt/*) export CHOKIDAR_USEPOLLING="${CHOKIDAR_USEPOLLING:-true}" ;;
esac
# Auto-restart service saat src berubah (scripts/dev-services.ts). RAVE_WATCH=0 untuk mematikan.
export RAVE_WATCH="${RAVE_WATCH:-1}"

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
# Hentikan proses yang LISTEN di port TCP. `fuser` (psmisc) tidak selalu terpasang → fallback ke PID dari `ss -p`.
# Hanya PID pendengar yang dihentikan, bukan process group-nya (grup `npm run dev` memuat semua service).
kill_port() {
  local sig="${2:-TERM}"
  if command -v fuser >/dev/null 2>&1; then fuser -k "-$sig" "$1/tcp" >/dev/null 2>&1 || true; return; fi
  # `|| true`: tanpa pendengar grep keluar 1 → di bawah `set -euo pipefail` skrip berhenti diam-diam.
  local pids; pids=$(ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true)
  if [ -n "$pids" ]; then kill "-$sig" $pids 2>/dev/null || true; fi
}

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
  seeded=$("$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U rave -d rave -tAc "SELECT to_regclass('iam.users') IS NOT NULL" 2>/dev/null || echo f)
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
  [ ${#busy[@]} -eq 0 ] || die "port sudah dipakai: ${busy[*]} — jalankan './rave stop' dulu"
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
  ok "RAVE berjalan"
  urls
}

urls() {
  cat <<EOF

  ${c_b}Web${c_0}       http://localhost:5173
  ${c_b}Gateway${c_0}   http://localhost:8080
  ${c_b}RTMP${c_0}      rtmp://localhost:1935/live
  ${c_dim}Auto-reload: web $( [ "${CHOKIDAR_USEPOLLING:-}" = true ] && echo "(polling)" || echo "(HMR)" ) · service $( [ "$RAVE_WATCH" = 1 ] && echo aktif || echo mati )${c_0}
  ${c_dim}Log: $LOG   ·   ./rave logs   ·   ./rave stop${c_0}

EOF
}

cmd_start() {
  [ -n "$(running_pid)" ] && { ok "RAVE sudah berjalan (pid $(running_pid))"; urls; return; }
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
  [ -n "$(running_pid)" ] && die "RAVE sudah berjalan di background (pid $(running_pid)) — './rave stop' dulu, atau './rave logs'"
  preflight
  free_ports
  db_up
  : >"$LOG"
  db_prepare
  urls
  cd "$ROOT"
  # pid dicatat agar `./rave status|stop` dari terminal lain juga mengenali sesi foreground ini.
  echo $$ >"$PIDFILE"
  exec npm run --silent dev
}

cmd_stop() {
  local pid
  if pid=$(running_pid); then
    info "menghentikan RAVE (pid $pid)"
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  fi
  rm -f "$PIDFILE"
  # sisa proses (mis. dijalankan manual / restart-svc) dibersihkan per port
  local ports=(1935) p; for c in "${COMPONENTS[@]}"; do ports+=("${c##*:}"); done
  for p in "${ports[@]}"; do listening "$p" && kill_port "$p"; done
  sleep 1
  for p in "${ports[@]}"; do listening "$p" && kill_port "$p" KILL; done
  ok "service & web berhenti"
  if [ "${1:-}" = "--all" ]; then (cd "$ROOT" && bash scripts/dev-db.sh stop) && ok "postgres berhenti"; fi
}

cmd_status() {
  local pid; pid=$(running_pid || true)
  echo "${c_b}RAVE${c_0} ${pid:+(pid $pid)}"
  # pg_isready saja tidak cukup: port bisa dipegang Postgres lain (container proyek lain) → cek cluster RAVE sendiri.
  if "$PGBIN/pg_ctl" -D "$PGDATA_DIR" status >/dev/null 2>&1 && "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" -q 2>/dev/null; then ok "postgres      :$PGPORT"
  elif listening "$PGPORT"; then echo "${c_err}✗${c_0} postgres      :$PGPORT ${c_dim}(port dipakai proses lain, bukan cluster RAVE)${c_0}"; else echo "${c_err}✗${c_0} postgres      :$PGPORT"; fi
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
  kill_port "$port"
  [ "$name" = live ] && kill_port 1935
  # Proses lama harus benar-benar lepas dari port — bila tidak, Vite pindah diam-diam ke port lain
  # dan cek "listening" di bawah keliru melihat proses lama sebagai sukses.
  local free_by=$((SECONDS + 10))
  while listening "$port"; do
    [ $SECONDS -ge $free_by ] && die "port $port masih dipakai proses lain — hentikan manual (ss -ltnp 'sport = :$port')"
    sleep 0.5
  done
  # exec: subshell digantikan prosesnya sendiri — tidak ada bash yang tertinggal memegang stdout pemanggil.
  if [ "$name" = web ]; then
    (cd "$ROOT/apps/web" && exec setsid nohup npx vite --strictPort) </dev/null >>"$LOGDIR/web.log" 2>&1 &
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
  restart-svc) [ -n "${2:-}" ] || die "pakai: ./rave restart-svc <nama>"; restart_one "$2" ;;
  *) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
esac
