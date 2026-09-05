#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/_dev_lib.sh
source "$SCRIPT_DIR/_dev_lib.sh"

echo "== Service status =="
service_status backend || true
service_status frontend || true
service_status converter || true
service_status test_stream || true

echo
echo "== Port listeners (5174/8081/18081/81) =="
if command -v ss >/dev/null 2>&1; then
  ss -ltnp 2>/dev/null | grep -E '(:5174|:8081|:18081|:81)([^0-9]|$)' || true
elif command -v lsof >/dev/null 2>&1; then
  lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -E ':(5174|8081|18081|81)([^0-9]|$)' || true
else
  echo "neither ss nor lsof available"
fi

if command -v curl >/dev/null 2>&1; then
  echo
  echo "== HTTP checks =="
  curl -fsS http://127.0.0.1:8081/health 2>/dev/null || echo "backend /health unavailable"
  echo

  if curl -fsS http://127.0.0.1:5174 >/dev/null 2>&1; then
    echo "frontend / reachable"
  else
    echo "frontend / unavailable"
  fi
fi

echo
echo "Logs: $LOG_DIR"
