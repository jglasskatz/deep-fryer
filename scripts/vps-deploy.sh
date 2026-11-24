#!/usr/bin/env bash
#
# vps-deploy.sh — package a clean git archive with SHA-256 verification, stage
#                 it onto a Debian VPS under /opt/deep-fryer/releases/<id>,
#                 atomically switch /opt/deep-fryer/current, and deploy via
#                 Docker Compose without touching /etc/deep-fryer/app.env.
#
# USAGE:
#   bash scripts/vps-deploy.sh --host df-admin@app.example.org
#   bash scripts/vps-deploy.sh --host df-admin@app.example.org --stage-only
#   bash scripts/vps-deploy.sh --host df-admin@app.example.org --rollback <release-id>

set -euo pipefail

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()  { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

HOST=""
SSH_KEY=""
STAGE_ONLY=0
ROLLBACK_ID=""

while [ $# -gt 0 ]; do
  case "$1" in
    --host)       HOST="${2:?}"; shift 2 ;;
    --key)        SSH_KEY="${2:?}"; shift 2 ;;
    --stage-only) STAGE_ONLY=1; shift ;;
    --rollback)   ROLLBACK_ID="${2:?}"; shift 2 ;;
    -h|--help)    grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$HOST" ] || die "provide --host user@vps-host"
SSH_OPTS=(-o IdentitiesOnly=yes)
[ -n "$SSH_KEY" ] && SSH_OPTS+=(-i "$SSH_KEY")

if [ -n "$ROLLBACK_ID" ]; then
  say "Rolling back $HOST to release $ROLLBACK_ID"
  ssh "${SSH_OPTS[@]}" "$HOST" "sudo sh -c '
    set -eu
    TARGET=/opt/deep-fryer/releases/${ROLLBACK_ID}
    test -d \"\$TARGET\"
    ln -sfn \"\$TARGET\" /opt/deep-fryer/current
    docker compose --env-file /etc/deep-fryer/app.env -f /opt/deep-fryer/current/docker-compose.yml up -d --build
  '"
  ok "rolled back to $ROLLBACK_ID"
  exit 0
fi

GIT_SHA="$(git rev-parse --short=12 HEAD)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE_ID="${STAMP}-${GIT_SHA}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

ARCHIVE="$TMP/deep-fryer-${RELEASE_ID}.tar.gz"
say "Creating clean git release archive (${RELEASE_ID})"
git archive --format=tar.gz -o "$ARCHIVE" HEAD
SHA256="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
printf '%s  %s\n' "$SHA256" "$(basename "$ARCHIVE")" > "${ARCHIVE}.sha256"
ok "archive checksum: $SHA256"

say "Uploading verified bundle to $HOST"
scp "${SSH_OPTS[@]}" "$ARCHIVE" "${ARCHIVE}.sha256" "${HOST}:/tmp/"

say "Verifying checksum and unpacking into /opt/deep-fryer/releases/${RELEASE_ID}"
ssh "${SSH_OPTS[@]}" "$HOST" "sudo sh -c '
  set -eu
  cd /tmp
  sha256sum -c \"deep-fryer-${RELEASE_ID}.tar.gz.sha256\"
  mkdir -p \"/opt/deep-fryer/releases/${RELEASE_ID}\"
  tar -xzf \"deep-fryer-${RELEASE_ID}.tar.gz\" -C \"/opt/deep-fryer/releases/${RELEASE_ID}\"
  chmod +x \"/opt/deep-fryer/releases/${RELEASE_ID}/infra/bootstrap/\"*.sh \"/opt/deep-fryer/releases/${RELEASE_ID}/infra/scripts/\"*.sh
  rm -f \"deep-fryer-${RELEASE_ID}.tar.gz\" \"deep-fryer-${RELEASE_ID}.tar.gz.sha256\"
'"
ok "staged /opt/deep-fryer/releases/${RELEASE_ID}"

if [ "$STAGE_ONLY" -eq 1 ]; then
  say "Stage-only complete. Bootstrap with: sudo /opt/deep-fryer/releases/${RELEASE_ID}/infra/bootstrap/40-deep-fryer.sh --release /opt/deep-fryer/releases/${RELEASE_ID}"
  exit 0
fi

say "Promoting /opt/deep-fryer/current and restarting compose stack"
ssh "${SSH_OPTS[@]}" "$HOST" "sudo sh -c '
  set -eu
  test -r /etc/deep-fryer/app.env
  ln -sfn \"/opt/deep-fryer/releases/${RELEASE_ID}\" /opt/deep-fryer/current
  docker compose --env-file /etc/deep-fryer/app.env -f /opt/deep-fryer/current/docker-compose.yml up -d --build
'"
ok "deployed release ${RELEASE_ID}"
