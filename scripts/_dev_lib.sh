#!/usr/bin/env bash

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${RUN_DIR:-$ROOT_DIR/.run}"
PID_DIR="$RUN_DIR/pids"
LOG_DIR="$RUN_DIR/logs"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

ensure_run_dirs() {
  mkdir -p "$PID_DIR" "$LOG_DIR"
}

pid_file() {
  local service_name="$1"
  echo "$PID_DIR/${service_name}.pid"
}

is_pid_running() {
  local pid="$1"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] && [ "$pid" -gt 1 ] && kill -0 "$pid" 2>/dev/null || return 1
  local state
  state="$(ps -p "$pid" -o stat= 2>/dev/null || true)"
  [[ "$state" != *Z* ]] && [ -n "$state" ]
}

process_identity() {
  ps -p "$1" -o lstart= 2>/dev/null | sed 's/^[[:space:]]*//' || true
}

is_owned_service_pid() {
  local service_name="$1" pid="$2"
  local identity_file
  identity_file="$(pid_file "$service_name").identity"
  [ -s "$identity_file" ] && is_pid_running "$pid" &&
    [ "$(cat "$identity_file")" = "$(process_identity "$pid")" ]
}

descendant_pids() {
  local root_pid="$1"
  ps -axo pid=,ppid= | awk -v root="$root_pid" '
    {parent[$1]=$2; order[++count]=$1}
    END {
      owned[root]=1
      for (pass=0; pass<count; pass++) {
        changed=0
        for (i=1; i<=count; i++) {
          pid=order[i]
          if (!owned[pid] && owned[parent[pid]]) {owned[pid]=1; changed=1}
        }
        if (!changed) break
      }
      for (i=count; i>=1; i--) if (owned[order[i]]) print order[i]
    }'
}

start_service() {
  local service_name="$1"
  shift

  ensure_run_dirs
  local file
  file="$(pid_file "$service_name")"
  local log_file="$LOG_DIR/${service_name}.log"

  if [ -f "$file" ]; then
    local current_pid
    current_pid="$(cat "$file" 2>/dev/null || true)"
    if is_owned_service_pid "$service_name" "$current_pid"; then
      log "$service_name already running (pid=$current_pid)"
      return 0
    fi
    rm -f "$file"
    rm -f "$file.identity"
  fi

  log "Starting $service_name..."
  if command -v setsid >/dev/null 2>&1; then
    setsid "$@" < /dev/null >"$log_file" 2>&1 &
  else
    nohup "$@" < /dev/null >"$log_file" 2>&1 &
  fi
  local new_pid=$!
  echo "$new_pid" >"$file"
  process_identity "$new_pid" >"$file.identity"
  sleep 1

  if ! is_pid_running "$new_pid"; then
    log "Failed to start $service_name. Last logs:"
    tail -n 40 "$log_file" || true
    rm -f "$file"
    rm -f "$file.identity"
    return 1
  fi

  log "$service_name started (pid=$new_pid, log=$log_file)"
}

stop_service() {
  local service_name="$1"
  local file
  file="$(pid_file "$service_name")"

  if [ ! -f "$file" ]; then
    log "$service_name not running (no pid file)"
    return 0
  fi

  local pid
  pid="$(cat "$file" 2>/dev/null || true)"

  if ! is_owned_service_pid "$service_name" "$pid"; then
    log "$service_name has no matching owned process; stale pid file removed"
    rm -f "$file" "$file.identity"
    return 0
  fi

  log "Stopping $service_name (pid=$pid)..."
  # Capture the owned tree before terminating its parent, including custom-port
  # ffmpeg children. No command-pattern search crosses checkout boundaries.
  local tree_file="$file.tree"
  local child_pid identity
  : >"$tree_file"
  while read -r child_pid; do
    identity="$(process_identity "$child_pid")"
    if [ -n "$identity" ]; then
      printf '%s|%s\n' "$child_pid" "$identity" >>"$tree_file"
    fi
  done < <(descendant_pids "$pid")
  while IFS='|' read -r child_pid identity; do
    if [ "$identity" = "$(process_identity "$child_pid")" ]; then
      kill "$child_pid" 2>/dev/null || true
    fi
  done <"$tree_file"

  local i
  for i in {1..20}; do
    local any_running=false
    while IFS='|' read -r child_pid identity; do
      if is_pid_running "$child_pid" && [ "$identity" = "$(process_identity "$child_pid")" ]; then
        any_running=true
      fi
    done <"$tree_file"
    if [ "$any_running" = false ]; then
      rm -f "$file" "$file.identity" "$tree_file"
      log "$service_name stopped"
      return 0
    fi
    sleep 0.5
  done

  log "$service_name did not stop gracefully, sending SIGKILL"
  while IFS='|' read -r child_pid identity; do
    if [ "$identity" = "$(process_identity "$child_pid")" ]; then
      kill -9 "$child_pid" 2>/dev/null || true
    fi
  done <"$tree_file"
  rm -f "$file" "$file.identity" "$tree_file"
}

service_status() {
  local service_name="$1"
  local file
  file="$(pid_file "$service_name")"

  if [ ! -f "$file" ]; then
    printf "%-12s %s\n" "$service_name" "stopped"
    return 1
  fi

  local pid
  pid="$(cat "$file" 2>/dev/null || true)"
  if is_owned_service_pid "$service_name" "$pid"; then
    printf "%-12s %s (pid=%s)\n" "$service_name" "running" "$pid"
    return 0
  fi

  printf "%-12s %s\n" "$service_name" "stale pid file"
  return 1
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local timeout_seconds="${3:-20}"
  local i

  for ((i = 0; i < timeout_seconds; i++)); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      log "$name is ready: $url"
      return 0
    fi
    sleep 1
  done

  log "$name did not become ready within ${timeout_seconds}s: $url"
  return 1
}

wait_for_file() {
  local path="$1"
  local timeout_seconds="${2:-20}"
  local i

  for ((i = 0; i < timeout_seconds; i++)); do
    if [ -s "$path" ]; then
      log "File is ready: $path"
      return 0
    fi
    sleep 1
  done

  log "File was not created within ${timeout_seconds}s: $path"
  return 1
}

# ss is Linux-only; fall back to lsof/netstat so the dev scripts also run on macOS.
is_port_listening() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :${port} )" 2>/dev/null | awk 'NR > 1 {found=1} END {exit(found ? 0 : 1)}'
    return $?
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -an 2>/dev/null | grep -qE "[.:]${port}[[:space:]]+.*LISTEN"
    return $?
  fi
  log "Warning: no ss/lsof/netstat available, cannot check port ${port}."
  return 1
}
