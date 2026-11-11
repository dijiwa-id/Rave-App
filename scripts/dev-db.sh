#!/usr/bin/env bash
# Menjalankan cluster PostgreSQL lokal milik user (tanpa Docker/sudo) untuk development.
# Data disimpan di $HOME/.rave/pgdata karena filesystem NTFS (/mnt/*) tidak didukung Postgres.
# Jika Docker tersedia, gunakan `docker compose up postgres` sebagai gantinya.
set -euo pipefail

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
# Migrasi satu kali dari nama lama (GEMA): pindahkan state ~/.gema → ~/.rave bila cluster lama tidak sedang berjalan.
if [ -z "${RAVE_PGDATA:-}" ] && [ ! -e "$HOME/.rave/pgdata" ] && [ -d "$HOME/.gema/pgdata" ]; then
  if ! "$PGBIN/pg_ctl" -D "$HOME/.gema/pgdata" status >/dev/null 2>&1; then
    mkdir -p "$HOME/.rave" && mv "$HOME/.gema/pgdata" "$HOME/.rave/pgdata" && echo "→ data Postgres lokal dipindah: ~/.gema/pgdata → ~/.rave/pgdata"
  else
    echo "✗ cluster lama masih berjalan dari ~/.gema/pgdata — hentikan dulu: $PGBIN/pg_ctl -D ~/.gema/pgdata stop" >&2; exit 1
  fi
fi
DATA="${RAVE_PGDATA:-$HOME/.rave/pgdata}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Port bisa di-override lewat env atau baris `RAVE_PGPORT=` di .env (mis. bila 55432 dipakai proyek/container lain).
if [ -z "${RAVE_PGPORT:-}" ] && [ -f "$ROOT/.env" ]; then RAVE_PGPORT="$(grep -E '^RAVE_PGPORT=' "$ROOT/.env" | tail -1 | cut -d= -f2 | tr -d '[:space:]')"; fi
PORT="${RAVE_PGPORT:-55432}"
SOCK="$HOME/.rave/run"
LOG="$HOME/.rave/postgres.log"

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
    # Port sudah dipakai proses lain (mis. container Postgres proyek lain) → jangan diam-diam memakai DB asing.
    if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
      echo "✗ port $PORT sudah dipakai proses lain (bukan cluster RAVE di $DATA)." >&2
      echo "  Set RAVE_PGPORT=<port lain> dan sesuaikan DATABASE_URL di .env (lihat .env.example)." >&2
      exit 1
    fi
    # max_connections: stack dev (±45 koneksi) + stack e2e terisolasi (±45) + LISTEN/psql/pg_dump melebihi default 100.
    "$PGBIN/pg_ctl" -D "$DATA" -l "$LOG" -o "-p $PORT -k $SOCK -c listen_addresses=127.0.0.1 -c max_connections=${RAVE_PG_MAX_CONNECTIONS:-300}" -w start >/dev/null
    echo "✓ postgres berjalan di 127.0.0.1:$PORT"
  fi
  local Q=("$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -tAc)
  # Migrasi satu kali dari nama lama: role & database `gema` → `rave` (data dev dipertahankan).
  if "${Q[@]}" "SELECT 1 FROM pg_database WHERE datname='gema'" | grep -q 1 && ! "${Q[@]}" "SELECT 1 FROM pg_database WHERE datname='rave'" | grep -q 1; then
    "${Q[@]}" "SELECT 1 FROM pg_roles WHERE rolname='rave'" | grep -q 1 || "${Q[@]}" "CREATE ROLE rave LOGIN SUPERUSER PASSWORD 'rave'" >/dev/null
    "${Q[@]}" "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='gema'" >/dev/null
    "${Q[@]}" "ALTER DATABASE gema RENAME TO rave" >/dev/null
    "${Q[@]}" "ALTER DATABASE rave OWNER TO rave" >/dev/null
    "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -d rave -qc "REASSIGN OWNED BY gema TO rave" >/dev/null || true
    echo "→ database gema di-rename menjadi rave"
  fi
  "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='rave'" | grep -q 1 \
    || "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -c "CREATE ROLE rave LOGIN SUPERUSER PASSWORD 'rave'" >/dev/null
  "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='rave'" | grep -q 1 \
    || "$PGBIN/createdb" -h "$SOCK" -p "$PORT" -U postgres -O rave rave
}

stop() { "$PGBIN/pg_ctl" -D "$DATA" -m fast stop || true; }
# Restart Postgres saja (mis. setelah mengubah RAVE_PG_MAX_CONNECTIONS); service dev tersambung ulang sendiri.
restart() { stop; start; }

reset() {
  start
  "$PGBIN/psql" -h "$SOCK" -p "$PORT" -U postgres -c "DROP DATABASE IF EXISTS rave WITH (FORCE)" >/dev/null
  "$PGBIN/createdb" -h "$SOCK" -p "$PORT" -U postgres -O rave rave
  echo "✓ database rave di-reset"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  reset) reset ;;
  restart) restart ;;
  *) echo "usage: $0 start|stop|restart|reset"; exit 1 ;;
esac
