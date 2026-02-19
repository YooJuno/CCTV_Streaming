#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/deploy/systemd"
USER_SYSTEMD_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
APP_CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/cctv-streaming"

ENABLE=false
START=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --enable)
      ENABLE=true
      shift
      ;;
    --start)
      START=true
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./scripts/install_systemd_user_services.sh [--enable] [--start]

--enable  Enable services at login
--start   Start services immediately
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl not found"
  exit 1
fi

mkdir -p "$USER_SYSTEMD_DIR" "$APP_CONFIG_DIR"

install_unit() {
  local name="$1"
  sed "s|{{PROJECT_ROOT}}|$ROOT_DIR|g" "$SOURCE_DIR/$name" >"$USER_SYSTEMD_DIR/$name"
  echo "installed: $USER_SYSTEMD_DIR/$name"
}

install_if_missing() {
  local source="$1"
  local target="$2"
  if [ ! -f "$target" ]; then
    cp "$source" "$target"
    echo "created: $target"
  fi
}

install_unit cctv-backend.service
install_unit cctv-frontend.service
install_unit cctv-converter.service
install_unit cctv-dummy-stream.service

install_if_missing "$SOURCE_DIR/backend.env.example" "$APP_CONFIG_DIR/backend.env"
install_if_missing "$SOURCE_DIR/frontend.env.example" "$APP_CONFIG_DIR/frontend.env"
install_if_missing "$SOURCE_DIR/converter.env.example" "$APP_CONFIG_DIR/converter.env"
install_if_missing "$SOURCE_DIR/dummy.env.example" "$APP_CONFIG_DIR/dummy.env"

systemctl --user daemon-reload

if [ "$ENABLE" = true ]; then
  systemctl --user enable cctv-backend.service cctv-frontend.service
  echo "enabled: cctv-backend.service, cctv-frontend.service"
fi

if [ "$START" = true ]; then
  systemctl --user restart cctv-backend.service cctv-frontend.service
  echo "started: cctv-backend.service, cctv-frontend.service"
fi

cat <<EOF

Done.

Config files:
  $APP_CONFIG_DIR/backend.env
  $APP_CONFIG_DIR/frontend.env
  $APP_CONFIG_DIR/converter.env
  $APP_CONFIG_DIR/dummy.env

Next commands:
  systemctl --user status cctv-backend.service
  systemctl --user status cctv-frontend.service
  systemctl --user start cctv-converter.service      # real camera source
  systemctl --user start cctv-dummy-stream.service   # dummy source
EOF
