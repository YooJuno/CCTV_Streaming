#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/_dev_lib.sh
source "$SCRIPT_DIR/_dev_lib.sh"

stop_service test_stream
stop_service converter
stop_service frontend
stop_service backend

# Best-effort orphan cleanup for previous manual runs
kill_matching_processes "backend" "$ROOT_DIR/apps/backend.*bootRun"
kill_matching_processes "frontend" "$ROOT_DIR/apps/frontend.*vite"
# Match the path fragment rather than the absolute path: without setsid (macOS) stop_service
# only reaps the wrapper shell, and the surviving child is invoked relative to ROOT_DIR.
kill_matching_processes "converter" "scripts/mjpeg_to_hls\.sh"
kill_matching_processes "dummy camera" "apps/cctv/test/dummy_mjpeg_camera\.sh"
kill_matching_processes "test stream" "apps/cctv/test/run_test_stream\.sh"
kill_matching_processes "dummy ffmpeg listener" "http://127.0.0.1:18081/stream"

"$SCRIPT_DIR/dev-status.sh"
