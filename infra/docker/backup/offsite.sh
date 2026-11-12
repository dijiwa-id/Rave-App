#!/bin/sh
# Salinan OFF-SITE dump database RAVE (docs/DEPLOYMENT.md §Backup & pemulihan).
#
# Dijalankan oleh service `backup-offsite` di docker-compose.prod.yml (image rclone/rclone, busybox sh).
#   offsite.sh loop   # default: sinkron tiap BACKUP_OFFSITE_INTERVAL_HOURS jam (service jalan terus)
#   offsite.sh once   # satu kali; keluar ≠ 0 bila gagal (scripts/prod.sh backup / cron host)
#
# Desain (sengaja sederhana):
# - Produsen dump tetap SATU: service platform (Super Admin → Platform → Backup) menulis
#   /data/backups/rave-<stamp>-<id>.sql.gz ke volume `storage`. Sidecar ini hanya MEMBACA volume itu (:ro),
#   jadi tidak ada pg_dump kedua yang bersaing koneksi/IO, dan retensi lokal tetap diatur platform.
# - Satu image (rclone) untuk semua tujuan: `dir` cukup cp, sedangkan `s3`/`rclone` memakai rclone yang
#   mendukung S3 (AWS/R2/Wasabi/MinIO/GCS-interop), B2, SFTP, dst. tanpa image/awscli terpisah.
# - Setiap dump disertai <file>.sha256 (format `sha256sum -c`) dan diuji `gzip -t` sebelum dikirim.
#   File yang sudah ada di tujuan tidak dikirim ulang (nama file unik per backup).
# - Retensi off-site (BACKUP_OFFSITE_KEEP_DAYS) hanya dijalankan bila sinkron berhasil DAN dump terbaru
#   masih segar — agar backup lama tidak terhapus habis ketika produksi dump sedang macet.
#
# Env:
#   BACKUP_OFFSITE              none | dir | s3 | rclone            (default none → hanya peringatan)
#   BACKUP_OFFSITE_DIR          (dir)    path host disk kedua/NAS; di container dipasang di /offsite
#   BACKUP_S3_URI               (s3)     s3://bucket/prefix — kredensial via RCLONE_S3_* (lihat .env.production.example)
#   BACKUP_RCLONE_REMOTE        (rclone) remote:path — remote didefinisikan via RCLONE_CONFIG_<NAMA>_* di env
#   BACKUP_OFFSITE_KEEP_DAYS    retensi off-site dalam hari (default 30; 0 = jangan pernah hapus)
#   BACKUP_OFFSITE_INTERVAL_HOURS  jeda antar-sinkron mode loop (default 6)
#   BACKUP_MAX_AGE_HOURS        dump terbaru lebih tua dari ini = GAGAL (default 30; jadwal platform default 24 jam)
set -u

SRC="${BACKUP_SRC_DIR:-/data/backups}"
MODE="${BACKUP_OFFSITE:-none}"
KEEP_DAYS="${BACKUP_OFFSITE_KEEP_DAYS:-30}"
INTERVAL_H="${BACKUP_OFFSITE_INTERVAL_HOURS:-6}"
MAX_AGE_H="${BACKUP_MAX_AGE_HOURS:-30}"
WORK="${TMPDIR:-/tmp}/rave-offsite"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [backup-offsite] $*"; }

# Tujuan dalam notasi rclone (path lokal untuk mode dir).
dest() {
  case "$MODE" in
    dir) echo /offsite ;;
    s3) echo ":s3:${BACKUP_S3_URI#s3://}" ;;
    rclone) echo "$BACKUP_RCLONE_REMOTE" ;;
  esac
}

check_config() {
  case "$MODE" in
    dir)
      [ -n "${BACKUP_OFFSITE_DIR:-}" ] || { log "GAGAL: BACKUP_OFFSITE=dir tetapi BACKUP_OFFSITE_DIR kosong"; return 1; }
      [ -d /offsite ] && [ -w /offsite ] || { log "GAGAL: /offsite (BACKUP_OFFSITE_DIR) tidak bisa ditulis"; return 1; } ;;
    s3)
      case "${BACKUP_S3_URI:-}" in s3://?*) ;; *) log "GAGAL: BACKUP_S3_URI harus berbentuk s3://bucket/prefix"; return 1 ;; esac ;;
    rclone)
      case "${BACKUP_RCLONE_REMOTE:-}" in ?*:*) ;; *) log "GAGAL: BACKUP_RCLONE_REMOTE harus berbentuk remote:path"; return 1 ;; esac ;;
    *) log "GAGAL: BACKUP_OFFSITE='$MODE' tidak dikenal (none|dir|s3|rclone)"; return 1 ;;
  esac
}

# Sudah ada di tujuan? (nama file unik per backup, jadi cukup cek keberadaan + .sha256)
exists_remote() {
  if [ "$MODE" = dir ]; then [ -f "/offsite/$1" ] && [ -f "/offsite/$1.sha256" ]
  else rclone lsf "$(dest)" --include "$1.sha256" 2>/dev/null | grep -qx "$1.sha256"; fi
}

push() { # $1 = path lokal → tujuan
  if [ "$MODE" = dir ]; then
    cp "$1" "/offsite/.$(basename "$1").part" && mv "/offsite/.$(basename "$1").part" "/offsite/$(basename "$1")"
  else
    # rclone copyto memverifikasi ukuran + hash bawaan backend (MD5/ETag S3) setelah upload.
    rclone copyto --retries 3 --low-level-retries 10 "$1" "$(dest)/$(basename "$1")"
  fi
}

prune() {
  [ "$KEEP_DAYS" -gt 0 ] 2>/dev/null || { log "retensi off-site nonaktif (BACKUP_OFFSITE_KEEP_DAYS=$KEEP_DAYS)"; return 0; }
  if [ "$MODE" = dir ]; then
    n=$(find /offsite -maxdepth 1 -type f -name 'rave-*.sql.gz*' -mtime +"$KEEP_DAYS" | wc -l)
    find /offsite -maxdepth 1 -type f -name 'rave-*.sql.gz*' -mtime +"$KEEP_DAYS" -delete || return 1
    log "retensi: $n file > $KEEP_DAYS hari dihapus dari tujuan"
  else
    rclone delete "$(dest)" --min-age "${KEEP_DAYS}d" --include 'rave-*.sql.gz' --include 'rave-*.sql.gz.sha256' || return 1
    log "retensi: file > $KEEP_DAYS hari dihapus dari tujuan"
  fi
}

sync_once() {
  if [ "$MODE" = none ]; then
    log "PERINGATAN: BACKUP_OFFSITE=none — dump hanya ada di volume lokal (go-live P0 #5). Set dir|s3|rclone."
    return 0
  fi
  check_config || return 1
  [ -d "$SRC" ] || { log "GAGAL: direktori sumber $SRC tidak ada (volume storage terpasang?)"; return 1; }
  mkdir -p "$WORK" || return 1

  # ls -t: terbaru dulu; nama rave-*.sql.gz dibuat service platform (services/platform/src/backups.ts).
  files=$(cd "$SRC" && ls -t rave-*.sql.gz 2>/dev/null)
  [ -n "$files" ] || { log "GAGAL: belum ada dump di $SRC — cek Platform → Backup (storage.backup_enabled)"; return 1; }
  newest=$(echo "$files" | head -1)
  age_h=$(( ($(date +%s) - $(date -r "$SRC/$newest" +%s)) / 3600 ))
  fresh=1
  if [ "$age_h" -ge "$MAX_AGE_H" ]; then
    fresh=0
    log "GAGAL: dump terbaru $newest berumur ${age_h} jam (≥ BACKUP_MAX_AGE_HOURS=$MAX_AGE_H) — jadwal backup platform macet?"
  fi

  sent=0; skipped=0; failed=0
  for f in $files; do
    if exists_remote "$f"; then skipped=$((skipped + 1)); continue; fi
    # Lewati file yang masih ditulis (pg_dump berjalan): umur < 2 menit.
    if [ $(( $(date +%s) - $(date -r "$SRC/$f" +%s) )) -lt 120 ]; then log "lewati $f (masih ditulis?)"; continue; fi
    if ! gzip -t "$SRC/$f" 2>/dev/null; then log "GAGAL: $f rusak (gzip -t) — tidak dikirim"; failed=$((failed + 1)); continue; fi
    (cd "$SRC" && sha256sum "$f") > "$WORK/$f.sha256" || { failed=$((failed + 1)); continue; }
    # Dump dulu, .sha256 terakhir: keberadaan .sha256 di tujuan = salinan lengkap.
    if push "$SRC/$f" && push "$WORK/$f.sha256"; then
      if [ "$MODE" = dir ] && ! (cd /offsite && sha256sum -c -s "$f.sha256"); then
        log "GAGAL: checksum salinan $f di tujuan tidak cocok"; rm -f "/offsite/$f.sha256"; failed=$((failed + 1)); continue
      fi
      sent=$((sent + 1)); log "terkirim $f ($(wc -c < "$SRC/$f") byte, sha256 $(cut -d' ' -f1 "$WORK/$f.sha256"))"
    else
      log "GAGAL: kirim $f ke $MODE"; failed=$((failed + 1))
    fi
    rm -f "$WORK/$f.sha256"
  done

  if [ "$failed" -gt 0 ] || [ "$fresh" -eq 0 ]; then
    log "GAGAL: sinkron $MODE selesai dengan masalah (terkirim=$sent sudah-ada=$skipped gagal=$failed, terbaru=$newest ${age_h} jam) — retensi dilewati"
    return 1
  fi
  prune || { log "GAGAL: retensi off-site"; return 1; }
  log "OK: sinkron $MODE (terkirim=$sent sudah-ada=$skipped, terbaru=$newest ${age_h} jam)"
}

case "${1:-loop}" in
  once) sync_once; exit $? ;;
  loop)
    log "mulai: mode=$MODE interval=${INTERVAL_H} jam retensi=${KEEP_DAYS} hari maks-umur=${MAX_AGE_H} jam"
    while :; do
      if sync_once; then sleep $((INTERVAL_H * 3600)); else sleep 1800; fi # gagal → coba lagi 30 menit
    done ;;
  *) echo "usage: $0 once|loop" >&2; exit 2 ;;
esac
