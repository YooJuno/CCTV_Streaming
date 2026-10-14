#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/_dev_lib.sh
source "$SCRIPT_DIR/_dev_lib.sh"

stop_service test_stream
stop_service converter
stop_service frontend
stop_service backend

# Stop only recorded services and their descendants, including custom dummy ports.
# Processes started manually are stopped from their own terminal.

"$SCRIPT_DIR/dev-status.sh"
