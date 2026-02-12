#!/usr/bin/env bash
# Publish docs/video.mp4 to an RTSP server for local testing.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VIDEO_FILE="${VIDEO_FILE:-$ROOT_DIR/docs/video.mp4}"
RTSP_URL="${RTSP_URL:-rtsp://localhost:8554/mystream}"
RTSP_TRANSPORT="${RTSP_TRANSPORT:-tcp}"
TRANSCODE="${TRANSCODE:-false}"

if [ ! -f "$VIDEO_FILE" ]; then
  echo "Video file not found: $VIDEO_FILE"
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg command not found in PATH"
  exit 1
fi

echo "Publishing $VIDEO_FILE -> $RTSP_URL"
echo "RTSP_TRANSPORT=$RTSP_TRANSPORT"
echo "TRANSCODE=$TRANSCODE"

if [ "$TRANSCODE" = "true" ]; then
  ffmpeg -re -stream_loop -1 -i "$VIDEO_FILE" \
    -rtsp_transport "$RTSP_TRANSPORT" \
    -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
    -c:a aac -b:a 128k \
    -f rtsp "$RTSP_URL"
else
  ffmpeg -re -stream_loop -1 -i "$VIDEO_FILE" \
    -rtsp_transport "$RTSP_TRANSPORT" \
    -c copy \
    -f rtsp "$RTSP_URL"
fi
