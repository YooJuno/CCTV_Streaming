#!/usr/bin/env bash
# Convert ESP32-CAM MJPEG HTTP stream directly to HLS (no RTSP server required).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

MJPEG_URL="${MJPEG_URL:-http://YOUR_DEVICE_IP:81/stream}"
STREAM_ID="${STREAM_ID:-mystream}"
HLS_DIR="${HLS_DIR:-$ROOT_DIR/apps/backend/hls}"
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
STALL_TIMEOUT_SECONDS="${STALL_TIMEOUT_SECONDS:-20}"
FFMPEG_BIN="${FFMPEG_BIN:-}"
LOCAL_FFMPEG="$ROOT_DIR/tools/ffmpeg/ffmpeg"

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

if [[ "$MJPEG_URL" == *"YOUR_DEVICE_IP"* ]] || [[ "$MJPEG_URL" == *"<device-ip>"* ]]; then
  echo "MJPEG_URL is not configured."
  echo "Example:"
  echo "  MJPEG_URL=http://192.168.0.42:81/stream STREAM_ID=mystream ./scripts/mjpeg_to_hls.sh"
  exit 1
fi

mkdir -p "$HLS_DIR"

HLS_FLAGS="append_list+program_date_time+independent_segments+omit_endlist"
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
echo "FFMPEG_BIN=$FFMPEG_BIN"
echo "STALL_TIMEOUT_SECONDS=$STALL_TIMEOUT_SECONDS"

stop_requested=0
on_stop_signal() {
  stop_requested=1
}
trap on_stop_signal INT TERM

while true; do
  if [ "$stop_requested" -eq 1 ]; then
    break
  fi

  "$FFMPEG_BIN" -hide_banner -loglevel warning \
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
    "$HLS_DIR/${STREAM_ID}.m3u8" &
  ffmpeg_pid=$!

  manifest_file="$HLS_DIR/${STREAM_ID}.m3u8"
  start_ts="$(date +%s)"
  last_update_ts="$start_ts"
  last_mtime=""
  restarted_for_stall=0

  while kill -0 "$ffmpeg_pid" 2>/dev/null; do
    now_ts="$(date +%s)"
    if [ -f "$manifest_file" ]; then
      current_mtime="$(stat -c %Y "$manifest_file" 2>/dev/null || true)"
      if [ -n "$current_mtime" ] && [ "$current_mtime" != "$last_mtime" ]; then
        last_mtime="$current_mtime"
        last_update_ts="$now_ts"
      fi
      if [ $((now_ts - last_update_ts)) -ge "$STALL_TIMEOUT_SECONDS" ]; then
        echo "No HLS update for ${STALL_TIMEOUT_SECONDS}s. Restarting ffmpeg..."
        kill "$ffmpeg_pid" 2>/dev/null || true
        restarted_for_stall=1
        break
      fi
    elif [ $((now_ts - start_ts)) -ge "$STALL_TIMEOUT_SECONDS" ]; then
      echo "No HLS manifest created for ${STALL_TIMEOUT_SECONDS}s. Restarting ffmpeg..."
      kill "$ffmpeg_pid" 2>/dev/null || true
      restarted_for_stall=1
      break
    fi

    if [ "$stop_requested" -eq 1 ]; then
      kill "$ffmpeg_pid" 2>/dev/null || true
      break
    fi
    sleep 1
  done

  if wait "$ffmpeg_pid"; then
    exit_code=0
  else
    exit_code=$?
  fi

  if [ "$stop_requested" -eq 1 ] || [ "$exit_code" -eq 130 ]; then
    break
  fi
  if [ "$exit_code" -eq 255 ] && [ "$restarted_for_stall" -eq 0 ]; then
    break
  fi
  if [ "$restarted_for_stall" -eq 1 ]; then
    echo "ffmpeg was restarted after stream stall."
  elif [ "$exit_code" -eq 0 ]; then
    echo "ffmpeg exited cleanly. restarting in ${RETRY_DELAY_SECONDS}s..."
  else
    echo "ffmpeg exited with code ${exit_code}. restarting in ${RETRY_DELAY_SECONDS}s..."
  fi

  if [ "$stop_requested" -eq 1 ]; then
    break
  fi
  sleep "$RETRY_DELAY_SECONDS"
done

echo "mjpeg_to_hls stopped."
