#!/usr/bin/env bash
#
# backup.sh — nightly Postgres custom-format dump with SHA-256 checksum,
#             encrypted with `age` when BACKUP_AGE_RECIPIENT is configured.
#             Never includes /etc/deep-fryer/app.env secrets.

set -euo pipefail

RELEASE_DIR="/opt/deep-fryer/current"
ENV_FILE="/etc/deep-fryer/app.env"
OPS_FILE="/etc/deep-fryer/ops.env"
BACKUP_DIR="/var/lib/deep-fryer/backups"

# shellcheck disable=SC1090
[ -r "$OPS_FILE" ] && . "$OPS_FILE"
# shellcheck disable=SC1090
[ -r "$ENV_FILE" ] && . "$ENV_FILE"

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$BACKUP_DIR"

DUMP_FILE="$WORK/deep-fryer-${STAMP}.pgdump"
docker compose --env-file "$ENV_FILE" -f "$RELEASE_DIR/docker-compose.yml" \
  exec -T db pg_dump -U "${POSTGRES_USER:-deep_fryer}" -Fc "${POSTGRES_DB:-deep_fryer}" \
  > "$DUMP_FILE"

sha256sum "$DUMP_FILE" | awk '{print $1 "  " "deep-fryer-'"${STAMP}"'.pgdump"}' > "$WORK/SHA256SUMS"

if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  OUT_FILE="${BACKUP_DIR}/deep-fryer-${STAMP}.pgdump.age"
  age -r "$BACKUP_AGE_RECIPIENT" -o "$OUT_FILE" "$DUMP_FILE"
  sha256sum "$OUT_FILE" > "${OUT_FILE}.sha256"
  chmod 0640 "$OUT_FILE" "${OUT_FILE}.sha256"
else
  OUT_FILE="${BACKUP_DIR}/deep-fryer-${STAMP}.pgdump"
  mv "$DUMP_FILE" "$OUT_FILE"
  sha256sum "$OUT_FILE" > "${OUT_FILE}.sha256"
  chmod 0600 "$OUT_FILE" "${OUT_FILE}.sha256"
fi

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'deep-fryer-*.pgdump*' -mtime "+${RETENTION_DAYS}" -delete
printf 'Backup saved: %s\n' "$OUT_FILE"
