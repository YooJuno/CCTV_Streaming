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

# 기본은 복사(무트랜스코딩). ESP32가 H.264이면 그대로 재생됩니다.
# MJPEG 등 비호환 코덱이면 아래 옵션으로 트랜스코딩을 고려하세요.
#   -c:v libx264 -preset veryfast -tune zerolatency -c:a aac -b:a 128k
ffmpeg -rtsp_transport tcp -i "$RTSP_URL" \
  -c copy \
  -f hls \
  -hls_time "$HLS_TIME" \
  -hls_list_size "$HLS_LIST_SIZE" \
  -hls_flags "$HLS_FLAGS" \
  -hls_segment_filename "$HLS_DIR/${STREAM_ID}_%05d.ts" \
  "$HLS_DIR/${STREAM_ID}.m3u8"
