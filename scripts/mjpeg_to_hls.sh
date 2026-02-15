#!/usr/bin/env bash
# Convert ESP32-CAM MJPEG HTTP stream directly to HLS (no RTSP server required).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

MJPEG_URL="${MJPEG_URL:-http://192.168.219.105:81/stream}"
STREAM_ID="${STREAM_ID:-mystream}"
HLS_DIR="${HLS_DIR:-$ROOT_DIR/apps/back-end/hls}"
FRAMERATE="${FRAMERATE:-15}"
KEYINT="${KEYINT:-30}"
HLS_TIME="${HLS_TIME:-1}"
HLS_LIST_SIZE="${HLS_LIST_SIZE:-6}"
HLS_DELETE="${HLS_DELETE:-true}"
VIDEO_CODEC="${VIDEO_CODEC:-libx264}"
VIDEO_PRESET="${VIDEO_PRESET:-veryfast}"
VIDEO_TUNE="${VIDEO_TUNE:-zerolatency}"
PIX_FMT="${PIX_FMT:-yuv420p}"
RETRY_DELAY_SECONDS="${RETRY_DELAY_SECONDS:-1}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg command not found in PATH"
  exit 1
fi

mkdir -p "$HLS_DIR"

HLS_FLAGS="append_list+program_date_time+independent_segments"
if [ "$HLS_DELETE" = "true" ]; then
  HLS_FLAGS="delete_segments+$HLS_FLAGS"
fi

find "$HLS_DIR" -maxdepth 1 -type f \( -name "${STREAM_ID}.m3u8" -o -name "${STREAM_ID}_*.ts" \) -delete

echo "MJPEG_URL=$MJPEG_URL"
echo "STREAM_ID=$STREAM_ID"
echo "HLS_DIR=$HLS_DIR"
echo "FRAMERATE=$FRAMERATE"
echo "KEYINT=$KEYINT"
echo "HLS_TIME=$HLS_TIME"
echo "HLS_LIST_SIZE=$HLS_LIST_SIZE"
echo "HLS_DELETE=$HLS_DELETE"
echo "VIDEO_CODEC=$VIDEO_CODEC"
echo "VIDEO_PRESET=$VIDEO_PRESET"
echo "VIDEO_TUNE=$VIDEO_TUNE"

stop_requested=0
on_stop_signal() {
  stop_requested=1
}
trap on_stop_signal INT TERM

while true; do
  if [ "$stop_requested" -eq 1 ]; then
    break
  fi

  if ffmpeg -hide_banner -loglevel warning \
    -fflags nobuffer -flags low_delay \
    -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 2 \
    -rw_timeout 5000000 \
    -f mjpeg -i "$MJPEG_URL" \
    -an \
    -r "$FRAMERATE" \
    -c:v "$VIDEO_CODEC" -preset "$VIDEO_PRESET" -tune "$VIDEO_TUNE" -pix_fmt "$PIX_FMT" \
    -g "$KEYINT" -keyint_min "$KEYINT" -sc_threshold 0 \
    -f hls \
    -hls_time "$HLS_TIME" \
    -hls_list_size "$HLS_LIST_SIZE" \
    -hls_flags "$HLS_FLAGS" \
    -hls_segment_filename "$HLS_DIR/${STREAM_ID}_%05d.ts" \
    "$HLS_DIR/${STREAM_ID}.m3u8"; then
    if [ "$stop_requested" -eq 1 ]; then
      break
    fi
    echo "ffmpeg exited cleanly. restarting in ${RETRY_DELAY_SECONDS}s..."
  else
    exit_code=$?
    if [ "$stop_requested" -eq 1 ] || [ "$exit_code" -eq 130 ] || [ "$exit_code" -eq 255 ]; then
      break
    fi
    echo "ffmpeg exited with code ${exit_code}. restarting in ${RETRY_DELAY_SECONDS}s..."
  fi

  if [ "$stop_requested" -eq 1 ]; then
    break
  fi
  sleep "$RETRY_DELAY_SECONDS"
done

echo "mjpeg_to_hls stopped."
