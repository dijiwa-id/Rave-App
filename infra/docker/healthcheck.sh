#!/bin/sh
# HEALTHCHECK kontainer: GET /healthz pada port service ini. Memakai wget busybox (bawaan Alpine) — jauh lebih ringan
# daripada menyalakan proses Node baru tiap pemeriksaan (13 kontainer × tiap interval).
case "$SERVICE" in
  gateway) port=8080 ;; iam) port=4001 ;; catalog) port=4002 ;; library) port=4003 ;; playback) port=4004 ;;
  booking) port=4005 ;; finance) port=4006 ;; ticketing) port=4007 ;; notification) port=4008 ;; platform) port=4009 ;;
  live) port=4010 ;; ads) port=4011 ;;
  *) echo "healthcheck: service tidak dikenal '$SERVICE'" >&2; exit 1 ;;
esac
# Override port per service (<NAMA>_PORT) bila diatur.
var="$(echo "$SERVICE" | tr '[:lower:]' '[:upper:]')_PORT"
eval "override=\${$var:-}"
[ -n "$override" ] && port="$override"
exec wget -q -T 3 -O /dev/null "http://127.0.0.1:${port}/healthz"
