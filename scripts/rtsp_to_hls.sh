#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RTSP_URL="${RTSP_URL:-rtsp://localhost:8554/mystream}"
STREAM_ID="${STREAM_ID:-mystream}"
HLS_DIR="${HLS_DIR:-$ROOT_DIR/apps/back-end/hls}"
HLS_TIME="${HLS_TIME:-2}"
HLS_LIST_SIZE="${HLS_LIST_SIZE:-10}"
HLS_DELETE="${HLS_DELETE:-true}"
RTSP_TRANSPORT="${RTSP_TRANSPORT:-tcp}"
TRANSCODE="${TRANSCODE:-false}"
VIDEO_CODEC="${VIDEO_CODEC:-libx264}"
AUDIO_CODEC="${AUDIO_CODEC:-aac}"
VIDEO_PRESET="${VIDEO_PRESET:-veryfast}"
VIDEO_TUNE="${VIDEO_TUNE:-zerolatency}"

mkdir -p "$HLS_DIR"

HLS_FLAGS="program_date_time+append_list"
if [ "$HLS_DELETE" = "true" ]; then
  HLS_FLAGS="delete_segments+$HLS_FLAGS"
fi

echo "RTSP_URL=$RTSP_URL"
echo "STREAM_ID=$STREAM_ID"
echo "HLS_DIR=$HLS_DIR"
echo "HLS_TIME=$HLS_TIME"
echo "HLS_LIST_SIZE=$HLS_LIST_SIZE"
echo "HLS_DELETE=$HLS_DELETE"
echo "RTSP_TRANSPORT=$RTSP_TRANSPORT"
echo "TRANSCODE=$TRANSCODE"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg command not found in PATH"
  exit 1
fi

if [ "$TRANSCODE" = "true" ]; then
  ffmpeg -rtsp_transport "$RTSP_TRANSPORT" -i "$RTSP_URL" \
    -c:v "$VIDEO_CODEC" -preset "$VIDEO_PRESET" -tune "$VIDEO_TUNE" \
    -c:a "$AUDIO_CODEC" -b:a 128k \
    -f hls \
    -hls_time "$HLS_TIME" \
    -hls_list_size "$HLS_LIST_SIZE" \
    -hls_flags "$HLS_FLAGS" \
    -hls_segment_filename "$HLS_DIR/${STREAM_ID}_%05d.ts" \
    "$HLS_DIR/${STREAM_ID}.m3u8"
else
  # Stream copy keeps CPU usage low. Use TRANSCODE=true if the source codec is not browser friendly.
  ffmpeg -rtsp_transport "$RTSP_TRANSPORT" -i "$RTSP_URL" \
    -c copy \
    -f hls \
    -hls_time "$HLS_TIME" \
    -hls_list_size "$HLS_LIST_SIZE" \
    -hls_flags "$HLS_FLAGS" \
    -hls_segment_filename "$HLS_DIR/${STREAM_ID}_%05d.ts" \
    "$HLS_DIR/${STREAM_ID}.m3u8"
fi
