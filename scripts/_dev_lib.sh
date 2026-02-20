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
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
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
    if is_pid_running "$current_pid"; then
      log "$service_name already running (pid=$current_pid)"
      return 0
    fi
    rm -f "$file"
  fi

  log "Starting $service_name..."
  if command -v setsid >/dev/null 2>&1; then
    setsid "$@" < /dev/null >"$log_file" 2>&1 &
  else
    nohup "$@" < /dev/null >"$log_file" 2>&1 &
  fi
  local new_pid=$!
  echo "$new_pid" >"$file"
  sleep 1

  if ! is_pid_running "$new_pid"; then
    log "Failed to start $service_name. Last logs:"
    tail -n 40 "$log_file" || true
    rm -f "$file"
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

  if ! is_pid_running "$pid"; then
    log "$service_name stale pid file removed"
    rm -f "$file"
    return 0
  fi

  log "Stopping $service_name (pid=$pid)..."
  kill "$pid" 2>/dev/null || true

  local i
  for i in {1..20}; do
    if ! is_pid_running "$pid"; then
      rm -f "$file"
      log "$service_name stopped"
      return 0
    fi
    sleep 0.5
  done

  log "$service_name did not stop gracefully, sending SIGKILL"
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$file"
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
  if is_pid_running "$pid"; then
    printf "%-12s %s (pid=%s)\n" "$service_name" "running" "$pid"
    return 0
  fi

  printf "%-12s %s\n" "$service_name" "stale pid file"
  return 1
}

kill_matching_processes() {
  local label="$1"
  local pattern="$2"
  mapfile -t pids < <(pgrep -f "$pattern" || true)
  if [ "${#pids[@]}" -eq 0 ]; then
    return 0
  fi

  log "Cleaning up orphan $label processes: ${pids[*]}"
  kill "${pids[@]}" 2>/dev/null || true
  sleep 1

  mapfile -t pids < <(pgrep -f "$pattern" || true)
  if [ "${#pids[@]}" -gt 0 ]; then
    kill -9 "${pids[@]}" 2>/dev/null || true
  fi
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

is_port_listening() {
  local port="$1"
  ss -ltn "( sport = :${port} )" 2>/dev/null | awk 'NR > 1 {found=1} END {exit(found ? 0 : 1)}'
}
