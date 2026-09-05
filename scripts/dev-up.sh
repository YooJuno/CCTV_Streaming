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
  --with-dummy          Start dummy CCTV source + converter (uses docs/video.mp4 by default)
  --mjpeg-url <url>     Override MJPEG source URL
  --stream-id <id>      Stream ID (default: mystream)
  --frontend-host <ip>  Frontend bind host (default: 0.0.0.0)
  -h, --help            Show this help

Examples:
  ./scripts/dev-up.sh
  ./scripts/dev-up.sh --with-converter --mjpeg-url http://192.168.219.106:81/stream
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
if [ -z "${AUTH_JWT_SECRET:-}" ] && ! command -v openssl >/dev/null 2>&1; then
  echo "openssl not found in PATH. Install it or export AUTH_JWT_SECRET yourself."
  exit 1
fi

if [ "$WITH_DUMMY" = true ] && [ -z "$MJPEG_URL" ]; then
  MJPEG_URL="http://127.0.0.1:${DUMMY_PORT}/stream"
fi

if [ "$WITH_CONVERTER" = true ] && [ -z "$MJPEG_URL" ]; then
  echo "MJPEG_URL is required when using --with-converter"
  exit 1
fi

# A checked-in default secret is a publicly known signing key, and this script happily adds the
# machine's public IP to the CORS allow-list below. Generate one per machine instead and keep it
# in .run/ so sessions survive a restart.
resolve_dev_jwt_secret() {
  if [ -n "${AUTH_JWT_SECRET:-}" ]; then
    echo "$AUTH_JWT_SECRET"
    return 0
  fi
  ensure_run_dirs
  local secret_file="$RUN_DIR/jwt_secret"
  if [ ! -s "$secret_file" ]; then
    ( umask 077 && openssl rand -base64 48 | tr -d '\n' > "$secret_file" )
    # stdout of this function is the secret itself, so status goes to stderr.
    log "Generated a local dev JWT secret: $secret_file" >&2
  fi
  cat "$secret_file"
}

AUTH_JWT_SECRET_VALUE="$(resolve_dev_jwt_secret)"
DEFAULT_AUTH_USERS='admin:{plain}admin123:*;viewer:{plain}viewer123:mystream'
AUTH_USERS_VALUE="${AUTH_USERS:-$DEFAULT_AUTH_USERS}"
if [ -z "${AUTH_USERS:-}" ]; then
  log "WARNING: using built-in dev accounts (admin/admin123, viewer/viewer123)."
  log "         Set AUTH_USERS before exposing this host to a network you do not control."
fi
API_ALLOWED_ORIGINS_VALUE="${API_ALLOWED_ORIGINS:-http://localhost:5174,http://127.0.0.1:5174}"
HLS_ALLOWED_ORIGINS_VALUE="${HLS_ALLOWED_ORIGINS:-$API_ALLOWED_ORIGINS_VALUE}"
VITE_PROXY_TARGET_VALUE="${VITE_PROXY_TARGET:-http://127.0.0.1:8081}"

append_origin_if_missing() {
  local origin_list="$1"
  local origin="$2"
  case ",$origin_list," in
    *,"$origin",*) echo "$origin_list" ;;
    *) echo "${origin_list},${origin}" ;;
  esac
}

is_valid_ipv4() {
  local ip="$1"
  local IFS='.'
  local octets=()
  read -r -a octets <<< "$ip"
  if [ "${#octets[@]}" -ne 4 ]; then
    return 1
  fi
  for octet in "${octets[@]}"; do
    if ! [[ "$octet" =~ ^[0-9]+$ ]]; then
      return 1
    fi
    if [ "$octet" -lt 0 ] || [ "$octet" -gt 255 ]; then
      return 1
    fi
  done
  return 0
}

detect_public_ip() {
  if [ -n "${PUBLIC_IP:-}" ] && is_valid_ipv4 "$PUBLIC_IP"; then
    echo "$PUBLIC_IP"
    return 0
  fi

  local ip_services=(
    "https://api.ipify.org"
    "https://checkip.amazonaws.com"
    "https://ifconfig.me/ip"
  )
  local candidate=""
  local service=""

  for service in "${ip_services[@]}"; do
    candidate="$(curl -fsS --connect-timeout 1 --max-time 2 "$service" 2>/dev/null | tr -d '\r\n' || true)"
    if is_valid_ipv4 "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

# `ip route` and `hostname -I` are Linux-only; macOS resolves the default route differently.
detect_lan_ip() {
  local ip=""
  if command -v ip >/dev/null 2>&1; then
    ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}' || true)"
  fi
  if [ -z "$ip" ] && command -v route >/dev/null 2>&1 && command -v ipconfig >/dev/null 2>&1; then
    local iface
    iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}' || true)"
    if [ -n "$iface" ]; then
      ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    fi
  fi
  if [ -z "$ip" ]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  echo "$ip"
}

if [ -z "${API_ALLOWED_ORIGINS:-}" ]; then
  LAN_IP="$(detect_lan_ip)"
  if [ -n "$LAN_IP" ] && [ "$LAN_IP" != "127.0.0.1" ]; then
    API_ALLOWED_ORIGINS_VALUE="$(append_origin_if_missing "$API_ALLOWED_ORIGINS_VALUE" "http://${LAN_IP}:5174")"
  fi

  PUBLIC_IP_VALUE="$(detect_public_ip || true)"
  if [ -n "$PUBLIC_IP_VALUE" ]; then
    API_ALLOWED_ORIGINS_VALUE="$(append_origin_if_missing "$API_ALLOWED_ORIGINS_VALUE" "http://${PUBLIC_IP_VALUE}:5174")"
    API_ALLOWED_ORIGINS_VALUE="$(append_origin_if_missing "$API_ALLOWED_ORIGINS_VALUE" "https://${PUBLIC_IP_VALUE}:5174")"
  fi
fi

if [ -z "${HLS_ALLOWED_ORIGINS:-}" ]; then
  HLS_ALLOWED_ORIGINS_VALUE="$API_ALLOWED_ORIGINS_VALUE"
fi

log "API_ALLOWED_ORIGINS resolved: $API_ALLOWED_ORIGINS_VALUE"
log "HLS_ALLOWED_ORIGINS resolved: $HLS_ALLOWED_ORIGINS_VALUE"

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
