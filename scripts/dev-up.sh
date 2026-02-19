#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/_dev_lib.sh
source "$SCRIPT_DIR/_dev_lib.sh"

WITH_DUMMY=false
WITH_CONVERTER=false
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
STREAM_ID="${STREAM_ID:-mystream}"
DUMMY_PORT="${DUMMY_PORT:-18081}"
MJPEG_URL="${MJPEG_URL:-}"

usage() {
  cat <<'EOF'
Usage: ./scripts/dev-up.sh [options]

Options:
  --with-converter      Start MJPEG -> HLS converter (requires MJPEG_URL unless --with-dummy)
  --with-dummy          Start dummy CCTV source + converter (uses docs/video.mp4)
  --mjpeg-url <url>     Override MJPEG source URL
  --stream-id <id>      Stream ID (default: mystream)
  --frontend-host <ip>  Frontend bind host (default: 0.0.0.0)
  -h, --help            Show this help

Examples:
  ./scripts/dev-up.sh
  ./scripts/dev-up.sh --with-converter --mjpeg-url http://192.168.0.42:81/stream
  ./scripts/dev-up.sh --with-dummy
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --with-converter)
      WITH_CONVERTER=true
      shift
      ;;
    --with-dummy)
      WITH_DUMMY=true
      WITH_CONVERTER=true
      shift
      ;;
    --mjpeg-url)
      MJPEG_URL="$2"
      shift 2
      ;;
    --stream-id)
      STREAM_ID="$2"
      shift 2
      ;;
    --frontend-host)
      FRONTEND_HOST="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found in PATH"
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "curl not found in PATH"
  exit 1
fi

if [ "$WITH_DUMMY" = true ] && [ -z "$MJPEG_URL" ]; then
  MJPEG_URL="http://127.0.0.1:${DUMMY_PORT}/stream"
fi

if [ "$WITH_CONVERTER" = true ] && [ -z "$MJPEG_URL" ]; then
  echo "MJPEG_URL is required when using --with-converter"
  exit 1
fi

AUTH_JWT_SECRET_VALUE="${AUTH_JWT_SECRET:-dev-jwt-secret-change-me-32-bytes-minimum-value}"
DEFAULT_AUTH_USERS='admin:{plain}admin123:*;viewer:{plain}viewer123:mystream'
AUTH_USERS_VALUE="${AUTH_USERS:-$DEFAULT_AUTH_USERS}"
API_ALLOWED_ORIGINS_VALUE="${API_ALLOWED_ORIGINS:-http://localhost:5174,http://127.0.0.1:5174}"
HLS_ALLOWED_ORIGINS_VALUE="${HLS_ALLOWED_ORIGINS:-$API_ALLOWED_ORIGINS_VALUE}"
VITE_PROXY_TARGET_VALUE="${VITE_PROXY_TARGET:-http://127.0.0.1:8081}"

if is_port_listening 8081; then
  log "Port 8081 already in use. Skipping backend start."
else
  start_service backend env \
    AUTH_JWT_SECRET="$AUTH_JWT_SECRET_VALUE" \
    AUTH_USERS="$AUTH_USERS_VALUE" \
    API_ALLOWED_ORIGINS="$API_ALLOWED_ORIGINS_VALUE" \
    HLS_ALLOWED_ORIGINS="$HLS_ALLOWED_ORIGINS_VALUE" \
    bash -lc "cd '$ROOT_DIR/apps/backend' && ./gradlew bootRun --no-daemon"
fi

if is_port_listening 5174; then
  log "Port 5174 already in use. Skipping frontend start."
else
  start_service frontend env \
    VITE_PROXY_TARGET="$VITE_PROXY_TARGET_VALUE" \
    bash -lc "cd '$ROOT_DIR/apps/frontend' && npm run dev -- --host '$FRONTEND_HOST' --port 5174"
fi

if [ "$WITH_DUMMY" = true ]; then
  if is_port_listening "$DUMMY_PORT"; then
    log "Port $DUMMY_PORT already in use. Skipping dummy stream start."
  else
    start_service test_stream env \
      STREAM_ID="$STREAM_ID" \
      DUMMY_PORT="$DUMMY_PORT" \
      bash -lc "cd '$ROOT_DIR' && ./apps/cctv/test/run_test_stream.sh"
  fi
elif [ "$WITH_CONVERTER" = true ]; then
  start_service converter env \
    MJPEG_URL="$MJPEG_URL" \
    STREAM_ID="$STREAM_ID" \
    bash -lc "cd '$ROOT_DIR' && ./scripts/mjpeg_to_hls.sh"
fi

wait_for_http "Backend" "http://127.0.0.1:8081/health" 25 || true
wait_for_http "Frontend" "http://127.0.0.1:5174" 25 || true
if [ "$WITH_CONVERTER" = true ]; then
  wait_for_file "$ROOT_DIR/apps/backend/hls/${STREAM_ID}.m3u8" 25 || true
fi

"$SCRIPT_DIR/dev-status.sh"
