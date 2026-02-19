#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/_dev_lib.sh
source "$SCRIPT_DIR/_dev_lib.sh"

KEEP_RUNNING=false
REUSE_RUNNING=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --keep-running)
      KEEP_RUNNING=true
      shift
      ;;
    --reuse-running)
      REUSE_RUNNING=true
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./scripts/e2e_smoke_dummy.sh [--reuse-running] [--keep-running]

Default behavior starts a fresh local stack using dummy source and
shuts it down after verification.
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

E2E_USERNAME="${E2E_USERNAME:-admin}"
E2E_PASSWORD="${E2E_PASSWORD:-admin123}"
E2E_STREAM_ID="${E2E_STREAM_ID:-mystream}"
E2E_AUTH_JWT_SECRET="${E2E_AUTH_JWT_SECRET:-e2e-jwt-secret-change-me-32-bytes-min}"
DEFAULT_E2E_AUTH_USERS='admin:{plain}admin123:*;viewer:{plain}viewer123:mystream'
E2E_AUTH_USERS="${E2E_AUTH_USERS:-$DEFAULT_E2E_AUTH_USERS}"

started_here=false
COOKIE_FILE="$(mktemp)"
cleanup() {
  if [ "$started_here" = true ] && [ "$KEEP_RUNNING" = false ]; then
    "$SCRIPT_DIR/dev-down.sh" >/dev/null 2>&1 || true
  fi
  rm -f "$COOKIE_FILE"
}
trap cleanup EXIT

if [ "$REUSE_RUNNING" = false ]; then
  "$SCRIPT_DIR/dev-down.sh" >/dev/null 2>&1 || true
  AUTH_JWT_SECRET="$E2E_AUTH_JWT_SECRET" AUTH_USERS="$E2E_AUTH_USERS" \
    "$SCRIPT_DIR/dev-up.sh" --with-dummy
  started_here=true
elif ! is_port_listening 8081 || ! is_port_listening 5174; then
  AUTH_JWT_SECRET="$E2E_AUTH_JWT_SECRET" AUTH_USERS="$E2E_AUTH_USERS" \
    "$SCRIPT_DIR/dev-up.sh" --with-dummy
  started_here=true
fi

echo "[e2e] waiting for backend/frontend"
for _ in {1..40}; do
  if curl -fsS http://127.0.0.1:8081/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:5174 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[e2e] login"
curl -fsS -c "$COOKIE_FILE" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${E2E_USERNAME}\",\"password\":\"${E2E_PASSWORD}\"}" \
  http://127.0.0.1:5174/api/auth/login >/dev/null

echo "[e2e] session check"
curl -fsS -b "$COOKIE_FILE" http://127.0.0.1:5174/api/auth/me >/dev/null

echo "[e2e] stream health check"
curl -fsS -b "$COOKIE_FILE" http://127.0.0.1:5174/api/streams/health >/dev/null

echo "[e2e] system health check"
curl -fsS -b "$COOKIE_FILE" http://127.0.0.1:5174/api/system/health >/dev/null

echo "[e2e] hls manifest check"
curl -fsS -b "$COOKIE_FILE" "http://127.0.0.1:5174/hls/${E2E_STREAM_ID}.m3u8" >/dev/null

echo "[e2e] OK"
