#!/usr/bin/env bash
# Push video.mp4 to RTSP server (rtsp-simple-server)

set -euo pipefail

VIDEO_FILE="$(cd "$(dirname "$0")/../.." && pwd)/video.mp4"
RTSP_URL="${RTSP_URL:-rtsp://localhost:8554/mystream}"

if [ ! -f "$VIDEO_FILE" ]; then
  echo "video.mp4 not found at $VIDEO_FILE"
  exit 1
fi

echo "Publishing $VIDEO_FILE to $RTSP_URL"

ffmpeg -re -stream_loop -1 -i "$VIDEO_FILE" -c copy -f rtsp "$RTSP_URL"
