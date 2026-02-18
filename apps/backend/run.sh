#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ -x "./gradlew" ]; then
  ./gradlew bootRun
else
  if command -v gradle >/dev/null 2>&1; then
    gradle bootRun
  else
    echo "gradle not found. Install Gradle or generate the Gradle wrapper by running 'gradle wrapper' in this directory." >&2
    exit 1
  fi
fi
