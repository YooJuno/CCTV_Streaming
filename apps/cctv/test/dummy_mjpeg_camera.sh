#!/usr/bin/env bash
# Serves docs/video.mp4 as an MJPEG stream to emulate ESP32-CAM /stream endpoint.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

VIDEO_FILE="${VIDEO_FILE:-$ROOT_DIR/docs/video.mp4}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-18081}"
STREAM_PATH="${STREAM_PATH:-stream}"
FPS="${FPS:-15}"
RESTART_DELAY_SECONDS="${RESTART_DELAY_SECONDS:-1}"
FFMPEG_BIN="${FFMPEG_BIN:-}"
LOCAL_FFMPEG="$ROOT_DIR/tools/ffmpeg/ffmpeg"
stop_requested=0

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

if [ -z "$FFMPEG_BIN" ]; then
  if [ -x "$LOCAL_FFMPEG" ]; then
    FFMPEG_BIN="$LOCAL_FFMPEG"
  else
    FFMPEG_BIN="ffmpeg"
  fi
fi

if [[ "$FFMPEG_BIN" == */* ]]; then
  if [ ! -x "$FFMPEG_BIN" ]; then
    echo "ffmpeg binary not executable: $FFMPEG_BIN"
    echo "Run ./scripts/install_local_ffmpeg.sh or install ffmpeg in PATH."
    exit 1
  fi
elif ! command -v "$FFMPEG_BIN" >/dev/null 2>&1; then
  echo "ffmpeg command not found: $FFMPEG_BIN"
  echo "Run ./scripts/install_local_ffmpeg.sh or install ffmpeg in PATH."
  exit 1
fi

if [ ! -f "$VIDEO_FILE" ]; then
  echo "video file not found: $VIDEO_FILE"
  exit 1
fi

MJPEG_URL="http://${HOST}:${PORT}/${STREAM_PATH}"

log "Starting dummy MJPEG camera"
log "VIDEO_FILE=$VIDEO_FILE"
log "FPS=$FPS"
log "MJPEG_URL=$MJPEG_URL"
log "FFMPEG_BIN=$FFMPEG_BIN"
log "RESTART_DELAY_SECONDS=$RESTART_DELAY_SECONDS"

on_stop_signal() {
  stop_requested=1
}
trap on_stop_signal INT TERM

while true; do
  if [ "$stop_requested" -eq 1 ]; then
    break
  fi

  if "$FFMPEG_BIN" -hide_banner -loglevel error \
      -re -stream_loop -1 \
      -i "$VIDEO_FILE" \
      -an \
      -vf "fps=${FPS}" \
      -q:v 5 \
      -f mpjpeg \
      -listen 1 \
      "$MJPEG_URL"; then
    exit_code=0
  else
    exit_code=$?
  fi

  if [ "$stop_requested" -eq 1 ]; then
    break
  fi

  log "Dummy MJPEG server exited (code=$exit_code). Restarting in ${RESTART_DELAY_SECONDS}s..."
  sleep "$RESTART_DELAY_SECONDS"
done

log "Dummy MJPEG camera stopped."
