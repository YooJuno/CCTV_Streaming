#!/usr/bin/env bash
# Starts a local dummy MJPEG camera from docs/video.mp4 and pipes it to HLS.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

DUMMY_HOST="${DUMMY_HOST:-127.0.0.1}"
DUMMY_PORT="${DUMMY_PORT:-18081}"
STREAM_PATH="${STREAM_PATH:-stream}"
STREAM_ID="${STREAM_ID:-mystream}"
VIDEO_FILE="${VIDEO_FILE:-$ROOT_DIR/docs/video.mp4}"
STARTUP_DELAY_SECONDS="${STARTUP_DELAY_SECONDS:-1}"

dummy_pid=""

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

cleanup() {
  if [ -n "$dummy_pid" ] && kill -0 "$dummy_pid" 2>/dev/null; then
    log "Stopping dummy camera (pid=$dummy_pid)"
    kill "$dummy_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

log "Launching dummy camera from video file"
HOST="$DUMMY_HOST" \
PORT="$DUMMY_PORT" \
STREAM_PATH="$STREAM_PATH" \
VIDEO_FILE="$VIDEO_FILE" \
"$SCRIPT_DIR/dummy_mjpeg_camera.sh" &
dummy_pid=$!

MJPEG_URL="http://${DUMMY_HOST}:${DUMMY_PORT}/${STREAM_PATH}"
log "Waiting ${STARTUP_DELAY_SECONDS}s for dummy server startup: $MJPEG_URL"
sleep "$STARTUP_DELAY_SECONDS"

if ! kill -0 "$dummy_pid" 2>/dev/null; then
  log "Dummy camera exited before startup completed."
  exit 1
fi

log "Dummy camera is ready. Starting MJPEG->HLS converter."
log "STREAM_ID=$STREAM_ID"

SOURCE_PROBE_ENABLED=false MJPEG_URL="$MJPEG_URL" STREAM_ID="$STREAM_ID" "$ROOT_DIR/scripts/mjpeg_to_hls.sh"
