#!/usr/bin/env bash
# Verify service ownership and descendant cleanup without touching project services.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_DIR="$(mktemp -d)"
export RUN_DIR
# shellcheck source=scripts/_dev_lib.sh
source "$SCRIPT_DIR/_dev_lib.sh"
foreign_pid=""
owned_pid=""
child_pid=""

cleanup() {
  for pid in "$child_pid" "$owned_pid" "$foreign_pid"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$RUN_DIR"
}
trap cleanup EXIT

sleep 60 &
foreign_pid=$!
start_service lifecycle_test bash -c 'sleep 60 & echo "$!" > "$1"; wait' bash "$RUN_DIR/child.pid"
owned_pid="$(cat "$(pid_file lifecycle_test)")"
child_pid="$(cat "$RUN_DIR/child.pid")"

# A stale/reused PID file must never authorize killing the unrelated process.
echo "$foreign_pid" >"$(pid_file foreign_test)"
echo "different process identity" >"$(pid_file foreign_test).identity"
stop_service foreign_test
is_pid_running "$foreign_pid" || { echo "Unrelated process was terminated"; exit 1; }

stop_service lifecycle_test
if is_pid_running "$owned_pid" || is_pid_running "$child_pid"; then
  echo "Owned process or child survived shutdown"
  exit 1
fi
is_pid_running "$foreign_pid" || { echo "Unrelated process was terminated"; exit 1; }
echo "Process ownership and descendant shutdown tests passed."
