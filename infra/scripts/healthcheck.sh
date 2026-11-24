#!/usr/bin/env bash
#
# healthcheck.sh — checks deep-fryer compose services, web responsiveness, and
#                  disk headroom; emits transition-based alerts via NTFY_URL.

set -euo pipefail

RELEASE_DIR="/opt/deep-fryer/current"
ENV_FILE="/etc/deep-fryer/app.env"
OPS_FILE="/etc/deep-fryer/ops.env"
STATE_FILE="/var/lib/deep-fryer/state/health.status"

# shellcheck disable=SC1090
[ -r "$OPS_FILE" ] && . "$OPS_FILE"
# shellcheck disable=SC1090
[ -r "$ENV_FILE" ] && . "$ENV_FILE"

notify() {
  local title="$1" body="$2" priority="${3:-default}"
  if [ -n "${NTFY_URL:-}" ]; then
    curl -fsS --max-time 10 \
      -H "Title: ${title}" \
      -H "Priority: ${priority}" \
      -d "$body" "$NTFY_URL" >/dev/null 2>&1 || true
  fi
}

PROBLEMS=()
for svc in db storage web worker caddy; do
  STATUS="$(docker compose --env-file "$ENV_FILE" -f "$RELEASE_DIR/docker-compose.yml" ps --format '{{.State}}' "$svc" 2>/dev/null | head -n1 || true)"
  if [ "$STATUS" != "running" ]; then
    PROBLEMS+=("service ${svc} is ${STATUS:-missing}")
  fi
done

DISK_PCT="$(df --output=pcent / | tail -n1 | tr -dc '0-9')"
if [ "${DISK_PCT:-0}" -ge 88 ]; then
  PROBLEMS+=("root disk at ${DISK_PCT}%")
fi

if [ -n "${APP_URL:-}" ]; then
  if ! curl -fsS --max-time 10 "${APP_URL%/}/api/health" >/dev/null 2>&1; then
    if ! curl -fsS --max-time 10 "${APP_URL%/}/" >/dev/null 2>&1; then
      PROBLEMS+=("web endpoint unreachable at ${APP_URL}")
    fi
  fi
fi

PREV="$(cat "$STATE_FILE" 2>/dev/null || printf 'unknown')"
mkdir -p "$(dirname "$STATE_FILE")"

if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  MSG="$(printf '%s; ' "${PROBLEMS[@]}")"
  printf 'unhealthy: %s\n' "$MSG" > "$STATE_FILE"
  if [ "$PREV" != "unhealthy: $MSG" ]; then
    notify "deep-fryer UNHEALTHY" "$MSG" "high"
  fi
  printf 'UNHEALTHY: %s\n' "$MSG" >&2
  exit 1
fi

printf 'healthy\n' > "$STATE_FILE"
if [ "${PREV#unhealthy}" != "$PREV" ]; then
  notify "deep-fryer RECOVERED" "All services healthy (disk ${DISK_PCT}%)." "default"
fi
printf 'OK (disk %s%%)\n' "$DISK_PCT"
