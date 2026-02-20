#!/usr/bin/env bash
# Serves a dummy MJPEG stream to emulate ESP32-CAM /stream endpoint.
# Default source is docs/video.mp4 when available; falls back to ffmpeg test pattern.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

DEFAULT_VIDEO_FILE="$ROOT_DIR/docs/video.mp4"
SOURCE_MODE="${SOURCE_MODE:-auto}" # auto | testsrc | video
VIDEO_FILE="${VIDEO_FILE:-}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-18081}"
STREAM_PATH="${STREAM_PATH:-stream}"
FPS="${FPS:-15}"
TESTSRC_SIZE="${TESTSRC_SIZE:-1280x720}"
RESTART_DELAY_SECONDS="${RESTART_DELAY_SECONDS:-1}"
FFMPEG_BIN="${FFMPEG_BIN:-}"
LOCAL_FFMPEG="$ROOT_DIR/tools/ffmpeg/ffmpeg"
stop_requested=0

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

resolve_source_mode() {
  case "$SOURCE_MODE" in
    auto|testsrc|video) ;;
    *)
      echo "Invalid SOURCE_MODE: $SOURCE_MODE (expected: auto, testsrc, video)"
      exit 1
      ;;
  esac

  if [ "$SOURCE_MODE" = "auto" ]; then
    if [ -n "$VIDEO_FILE" ] && [ -f "$VIDEO_FILE" ]; then
      SOURCE_MODE="video"
      return 0
    fi
    if [ -f "$DEFAULT_VIDEO_FILE" ]; then
      VIDEO_FILE="$DEFAULT_VIDEO_FILE"
      SOURCE_MODE="video"
      return 0
    fi
    SOURCE_MODE="testsrc"
  fi

  if [ "$SOURCE_MODE" = "video" ]; then
    if [ -z "$VIDEO_FILE" ]; then
      VIDEO_FILE="$DEFAULT_VIDEO_FILE"
    fi
    if [ ! -f "$VIDEO_FILE" ]; then
      echo "video file not found: $VIDEO_FILE"
      exit 1
    fi
  fi
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
    echo "Install ffmpeg in PATH or set FFMPEG_BIN to a valid binary path."
    exit 1
  fi
elif ! command -v "$FFMPEG_BIN" >/dev/null 2>&1; then
  echo "ffmpeg command not found: $FFMPEG_BIN"
  echo "Install ffmpeg in PATH or set FFMPEG_BIN to a valid binary path."
  exit 1
fi

resolve_source_mode

MJPEG_URL="http://${HOST}:${PORT}/${STREAM_PATH}"

log "Starting dummy MJPEG camera"
log "SOURCE_MODE=$SOURCE_MODE"
if [ "$SOURCE_MODE" = "video" ]; then
  log "VIDEO_FILE=$VIDEO_FILE"
else
  log "TESTSRC_SIZE=$TESTSRC_SIZE"
fi
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

  if [ "$SOURCE_MODE" = "video" ]; then
    ffmpeg_args=(
      -re
      -stream_loop -1
      -i "$VIDEO_FILE"
      -an
      -vf "fps=${FPS}"
      -q:v 5
      -f mpjpeg
      -listen 1
      "$MJPEG_URL"
    )
  else
    ffmpeg_args=(
      -re
      -f lavfi
      -i "testsrc=size=${TESTSRC_SIZE}:rate=${FPS}"
      -an
      -q:v 5
      -f mpjpeg
      -listen 1
      "$MJPEG_URL"
    )
  fi

  if "$FFMPEG_BIN" -hide_banner -loglevel error "${ffmpeg_args[@]}"; then
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
