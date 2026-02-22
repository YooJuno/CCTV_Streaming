#!/usr/bin/env bash
# Convert ESP32-CAM MJPEG HTTP stream directly to HLS (no RTSP server required).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

MJPEG_URL="${MJPEG_URL:-http://YOUR_DEVICE_IP:81/stream}"
STREAM_ID="${STREAM_ID:-mystream}"
HLS_DIR="${HLS_DIR:-$ROOT_DIR/apps/backend/hls}"
# ESP32-CAM MJPEG streams can fluctuate heavily in delivered FPS.
# Keep defaults stability-first to reduce rebuffering on weaker Wi-Fi links.
INPUT_FRAMERATE="${INPUT_FRAMERATE:-8}"
FRAMERATE="${FRAMERATE:-6}"
# Keep keyframe interval aligned with output fps by default.
# This avoids unintended long HLS segment durations (and extra latency)
# when HLS_TIME is configured around 1s.
KEYINT="${KEYINT:-$FRAMERATE}"
HLS_TIME="${HLS_TIME:-2}"
HLS_LIST_SIZE="${HLS_LIST_SIZE:-6}"
HLS_DELETE="${HLS_DELETE:-true}"
VIDEO_CODEC="${VIDEO_CODEC:-libx264}"
VIDEO_PRESET="${VIDEO_PRESET:-ultrafast}"
VIDEO_TUNE="${VIDEO_TUNE:-zerolatency}"
PIX_FMT="${PIX_FMT:-yuv420p}"
VIDEO_BITRATE="${VIDEO_BITRATE:-500k}"
VIDEO_MAXRATE="${VIDEO_MAXRATE:-650k}"
VIDEO_BUFSIZE="${VIDEO_BUFSIZE:-1000k}"
INPUT_THREAD_QUEUE_SIZE="${INPUT_THREAD_QUEUE_SIZE:-256}"
RETRY_DELAY_SECONDS="${RETRY_DELAY_SECONDS:-1}"
MAX_RETRY_DELAY_SECONDS="${MAX_RETRY_DELAY_SECONDS:-15}"
STALL_TIMEOUT_SECONDS="${STALL_TIMEOUT_SECONDS:-25}"
SOURCE_PROBE_ENABLED="${SOURCE_PROBE_ENABLED:-false}"
SOURCE_PROBE_CONNECT_TIMEOUT_SECONDS="${SOURCE_PROBE_CONNECT_TIMEOUT_SECONDS:-4}"
SOURCE_PROBE_MAX_TIME_SECONDS="${SOURCE_PROBE_MAX_TIME_SECONDS:-8}"
FFMPEG_RW_TIMEOUT_US="${FFMPEG_RW_TIMEOUT_US:-15000000}"
FFMPEG_BIN="${FFMPEG_BIN:-}"
LOCAL_FFMPEG="$ROOT_DIR/tools/ffmpeg/ffmpeg"
LOCK_DIR="${LOCK_DIR:-/tmp/cctv_streaming_locks}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

calculate_delay_seconds() {
  local failures="$1"
  local delay_seconds="$RETRY_DELAY_SECONDS"
  if [ "$failures" -gt 0 ]; then
    delay_seconds=$((RETRY_DELAY_SECONDS * (failures + 1)))
    if [ "$delay_seconds" -gt "$MAX_RETRY_DELAY_SECONDS" ]; then
      delay_seconds="$MAX_RETRY_DELAY_SECONDS"
    fi
  fi
  echo "$delay_seconds"
}

probe_source() {
  if [ "$SOURCE_PROBE_ENABLED" != "true" ]; then
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    log "Warning: curl not found, source preflight probe skipped."
    return 0
  fi

  local probe_file
  probe_file="$(mktemp)"

  set +e
  curl -fsS --connect-timeout "$SOURCE_PROBE_CONNECT_TIMEOUT_SECONDS" --max-time "$SOURCE_PROBE_MAX_TIME_SECONDS" \
    --range 0-4096 "$MJPEG_URL" -o "$probe_file"
  local curl_exit=$?
  set -e

  if [ "$curl_exit" -eq 0 ]; then
    rm -f "$probe_file"
    return 0
  fi

  if [ "$curl_exit" -eq 28 ] && [ -s "$probe_file" ]; then
    rm -f "$probe_file"
    return 0
  fi
  rm -f "$probe_file"
  return 1
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

if [[ "$MJPEG_URL" == *"YOUR_DEVICE_IP"* ]] || [[ "$MJPEG_URL" == *"<device-ip>"* ]]; then
  log "MJPEG_URL is not configured."
  log "Example:"
  log "  MJPEG_URL=http://192.168.219.106:81/stream STREAM_ID=mystream ./scripts/mjpeg_to_hls.sh"
  exit 1
fi

mkdir -p "$HLS_DIR"

if command -v flock >/dev/null 2>&1; then
  mkdir -p "$LOCK_DIR"
  LOCK_NAME="$(echo "$STREAM_ID" | tr -c 'A-Za-z0-9._-' '_')"
  LOCK_FILE="$LOCK_DIR/${LOCK_NAME}.lock"
  exec {LOCK_FD}> "$LOCK_FILE"
  if ! flock -n "$LOCK_FD"; then
    log "Another converter is already running for STREAM_ID=$STREAM_ID (lock: $LOCK_FILE)"
    exit 1
  fi
else
  log "Warning: 'flock' not found. Duplicate STREAM_ID processes are not guarded."
fi

HLS_FLAGS="append_list+program_date_time+independent_segments+omit_endlist"
if [ "$HLS_DELETE" = "true" ]; then
  HLS_FLAGS="delete_segments+$HLS_FLAGS"
fi
HLS_FLAGS="$HLS_FLAGS+temp_file"

find "$HLS_DIR" -maxdepth 1 -type f \( -name "${STREAM_ID}.m3u8" -o -name "${STREAM_ID}_*.ts" \) -delete

log "MJPEG_URL=$MJPEG_URL"
log "STREAM_ID=$STREAM_ID"
log "HLS_DIR=$HLS_DIR"
log "INPUT_FRAMERATE=$INPUT_FRAMERATE"
log "FRAMERATE=$FRAMERATE"
log "KEYINT=$KEYINT"
log "HLS_TIME=$HLS_TIME"
log "HLS_LIST_SIZE=$HLS_LIST_SIZE"
log "HLS_DELETE=$HLS_DELETE"
log "VIDEO_CODEC=$VIDEO_CODEC"
log "VIDEO_PRESET=$VIDEO_PRESET"
log "VIDEO_TUNE=$VIDEO_TUNE"
log "VIDEO_BITRATE=$VIDEO_BITRATE"
log "VIDEO_MAXRATE=$VIDEO_MAXRATE"
log "VIDEO_BUFSIZE=$VIDEO_BUFSIZE"
log "INPUT_THREAD_QUEUE_SIZE=$INPUT_THREAD_QUEUE_SIZE"
log "FFMPEG_BIN=$FFMPEG_BIN"
log "STALL_TIMEOUT_SECONDS=$STALL_TIMEOUT_SECONDS"
log "FFMPEG_RW_TIMEOUT_US=$FFMPEG_RW_TIMEOUT_US"
log "MAX_RETRY_DELAY_SECONDS=$MAX_RETRY_DELAY_SECONDS"
log "SOURCE_PROBE_ENABLED=$SOURCE_PROBE_ENABLED"
log "SOURCE_PROBE_CONNECT_TIMEOUT_SECONDS=$SOURCE_PROBE_CONNECT_TIMEOUT_SECONDS"
log "SOURCE_PROBE_MAX_TIME_SECONDS=$SOURCE_PROBE_MAX_TIME_SECONDS"

stop_requested=0
on_stop_signal() {
  stop_requested=1
}
trap on_stop_signal INT TERM
consecutive_failures=0

while true; do
  if [ "$stop_requested" -eq 1 ]; then
    break
  fi

  if ! probe_source; then
    consecutive_failures=$((consecutive_failures + 1))
    delay_seconds="$(calculate_delay_seconds "$consecutive_failures")"
    log "Source probe failed for ${MJPEG_URL}. retrying in ${delay_seconds}s..."
    if [ "$stop_requested" -eq 1 ]; then
      break
    fi
    sleep "$delay_seconds"
    continue
  fi

  "$FFMPEG_BIN" -hide_banner -loglevel warning \
    -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 2 \
    -fflags +discardcorrupt \
    -thread_queue_size "$INPUT_THREAD_QUEUE_SIZE" \
    -rw_timeout "$FFMPEG_RW_TIMEOUT_US" \
    -r "$INPUT_FRAMERATE" \
    -f mjpeg -i "$MJPEG_URL" \
    -an \
    -r "$FRAMERATE" \
    -c:v "$VIDEO_CODEC" -preset "$VIDEO_PRESET" -tune "$VIDEO_TUNE" -pix_fmt "$PIX_FMT" \
    -profile:v baseline -level 3.1 \
    -b:v "$VIDEO_BITRATE" -maxrate "$VIDEO_MAXRATE" -bufsize "$VIDEO_BUFSIZE" \
    -fps_mode cfr \
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
        log "No HLS update for ${STALL_TIMEOUT_SECONDS}s. Restarting ffmpeg..."
        kill "$ffmpeg_pid" 2>/dev/null || true
        restarted_for_stall=1
        break
      fi
    elif [ $((now_ts - start_ts)) -ge "$STALL_TIMEOUT_SECONDS" ]; then
      log "No HLS manifest created for ${STALL_TIMEOUT_SECONDS}s. Restarting ffmpeg..."
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
  if [ "$restarted_for_stall" -eq 1 ] || [ "$exit_code" -ne 0 ]; then
    consecutive_failures=$((consecutive_failures + 1))
  else
    consecutive_failures=0
  fi

  delay_seconds="$(calculate_delay_seconds "$consecutive_failures")"

  if [ "$restarted_for_stall" -eq 1 ]; then
    log "ffmpeg was restarted after stream stall."
  elif [ "$exit_code" -eq 0 ]; then
    log "ffmpeg exited cleanly. restarting in ${delay_seconds}s..."
  else
    log "ffmpeg exited with code ${exit_code}. restarting in ${delay_seconds}s..."
  fi

  if [ "$stop_requested" -eq 1 ]; then
    break
  fi
  sleep "$delay_seconds"
done

log "mjpeg_to_hls stopped."
