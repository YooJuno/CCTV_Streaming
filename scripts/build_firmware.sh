#!/usr/bin/env bash
# Build the public image without compiling local wifi_secrets.h credentials.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEVICE_DIR="$ROOT_DIR/apps/cctv/device"
OUTPUT_DIR="${1:-$ROOT_DIR/apps/frontend/public/firmware}"

if ! command -v pio >/dev/null 2>&1; then
  echo "PlatformIO not found. Install with: python3 -m pip install platformio==6.2.0"
  exit 1
fi

pio run --project-dir "$DEVICE_DIR" -e esp32cam_factory
mkdir -p "$OUTPUT_DIR"
BUILD_DIR="$DEVICE_DIR/.pio/build/esp32cam_factory"
for binary in "$BUILD_DIR"/*.bin; do
  cp "$binary" "$OUTPUT_DIR/$(basename "$binary")"
done
# Publish the manifest after all images so browsers verify a complete build.
cp "$BUILD_DIR/manifest.json" "$OUTPUT_DIR/manifest.json.tmp"
mv "$OUTPUT_DIR/manifest.json.tmp" "$OUTPUT_DIR/manifest.json"
printf 'Firmware ready: %s\n' "$OUTPUT_DIR"
