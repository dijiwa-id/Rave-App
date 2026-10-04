#!/usr/bin/env bash
# Menjalankan cluster PostgreSQL lokal milik user (tanpa Docker/sudo) untuk development.
# Data disimpan di $HOME/.gema/pgdata karena filesystem NTFS (/mnt/*) tidak didukung Postgres.
# Jika Docker tersedia, gunakan `docker compose up postgres` sebagai gantinya.
set -euo pipefail

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="${GEMA_PGDATA:-$HOME/.gema/pgdata}"
PORT="${GEMA_PGPORT:-55432}"
SOCK="$HOME/.gema/run"
LOG="$HOME/.gema/postgres.log"

init() {
  mkdir -p "$SOCK" "$(dirname "$DATA")"
  if [ ! -f "$DATA/PG_VERSION" ]; then
    echo "→ initdb $DATA"
    "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
  fi
}

start() {
  init
  if "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
    echo "✓ postgres sudah berjalan di port $PORT"
  else
    "$PGBIN/pg_ctl" -D "$DATA" -l "$LOG" -o "-p $PORT -k $SOCK -c listen_addresses=127.0.0.1" -w start >/dev/null
    echo "✓ postgres berjalan di 127.0.0.1:$PORT"
  fi
  "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='gema'" | grep -q 1 \
    || "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -c "CREATE ROLE gema LOGIN SUPERUSER PASSWORD 'gema'" >/dev/null
  "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='gema'" | grep -q 1 \
    || "$PGBIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres -O gema gema
}

stop() { "$PGBIN/pg_ctl" -D "$DATA" -m fast stop || true; }

reset() {
  start
  "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -c "DROP DATABASE IF EXISTS gema WITH (FORCE)" >/dev/null
  "$PGBIN/createdb" -h 127.0.0.1 -p "$PORT" -U postgres -O gema gema
  echo "✓ database gema di-reset"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  reset) reset ;;
  *) echo "usage: $0 start|stop|reset"; exit 1 ;;
esac
