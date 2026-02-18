#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

INSTALL_DIR="${INSTALL_DIR:-$ROOT_DIR/tools/ffmpeg}"
ARCHIVE_URL="${FFMPEG_ARCHIVE_URL:-https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz}"
ARCHIVE_SHA256="${FFMPEG_ARCHIVE_SHA256:-}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$INSTALL_DIR"

echo "Downloading: $ARCHIVE_URL"
curl -fL "$ARCHIVE_URL" -o "$TMP_DIR/ffmpeg.tar.xz"

if [ -n "$ARCHIVE_SHA256" ]; then
  if ! command -v sha256sum >/dev/null 2>&1; then
    echo "sha256sum command not found. Install coreutils to verify archive integrity."
    exit 1
  fi
  actual_sha256="$(sha256sum "$TMP_DIR/ffmpeg.tar.xz" | awk '{print $1}')"
  if [ "$actual_sha256" != "$ARCHIVE_SHA256" ]; then
    echo "FFmpeg archive checksum mismatch."
    echo "expected: $ARCHIVE_SHA256"
    echo "actual:   $actual_sha256"
    exit 1
  fi
  echo "Checksum verified: $actual_sha256"
else
  echo "Warning: FFMPEG_ARCHIVE_SHA256 is not set. Skipping checksum verification."
fi

tar -xJf "$TMP_DIR/ffmpeg.tar.xz" -C "$TMP_DIR"
EXTRACT_DIR="$(find "$TMP_DIR" -maxdepth 1 -type d -name 'ffmpeg-*-static' | head -n 1)"
if [ -z "$EXTRACT_DIR" ]; then
  echo "Could not locate extracted ffmpeg directory."
  exit 1
fi

install -m 755 "$EXTRACT_DIR/ffmpeg" "$INSTALL_DIR/ffmpeg"
if [ -f "$EXTRACT_DIR/ffprobe" ]; then
  install -m 755 "$EXTRACT_DIR/ffprobe" "$INSTALL_DIR/ffprobe"
fi

echo "Installed local ffmpeg:"
"$INSTALL_DIR/ffmpeg" -version | head -n 1
echo "Path: $INSTALL_DIR/ffmpeg"
