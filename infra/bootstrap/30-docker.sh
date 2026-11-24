#!/usr/bin/env bash
#
# 30-docker.sh — install Docker CE + Compose plugin from Docker's official Debian
#                repo (PGP fingerprint verified) with hardened daemon defaults.
#
# USAGE:
#   sudo ./30-docker.sh [--add-docker-group <user>]

set -euo pipefail

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

DOCKER_USER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --add-docker-group) DOCKER_USER="${2:?}"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "run with sudo/root."
[ -r /etc/os-release ] || die "no /etc/os-release."
# shellcheck disable=SC1091
. /etc/os-release
[ "${ID:-}" = "debian" ] || die "expected Debian; found ID=${ID:-unknown}."
case "${VERSION_CODENAME:-}" in
  bookworm|trixie) ok "Debian ${VERSION_ID:-?} (${VERSION_CODENAME})" ;;
  *) die "expected bookworm or trixie; found ${VERSION_CODENAME:-unknown}." ;;
esac

say "Removing conflicting distro container packages (if any)"
export DEBIAN_FRONTEND=noninteractive
for pkg in docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc; do
  apt-get remove -y -qq "$pkg" >/dev/null 2>&1 || true
done

say "Adding Docker CE apt repository (verifying pinned GPG fingerprint)"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg >/dev/null
install -m 0755 -d /etc/apt/keyrings

DOCKER_KEY_FPR="9DC858229FC7DD38854AE2D88D81803C0EBFCD88"
DOCKER_KEYRING=/etc/apt/keyrings/docker.gpg
TMPKEY="$(mktemp)"
TMPRING="$(mktemp)"
trap 'rm -f "$TMPKEY" "$TMPRING"' EXIT

curl -fsSL --proto '=https' --tlsv1.2 https://download.docker.com/linux/debian/gpg -o "$TMPKEY" \
  || die "failed to download Docker signing key."
gpg --no-default-keyring --keyring "$TMPRING" --import "$TMPKEY" >/dev/null 2>&1 \
  || die "downloaded key is not a valid PGP key."
GOT_FPR="$(gpg --no-default-keyring --keyring "$TMPRING" --list-keys --with-colons 2>/dev/null | awk -F: '/^fpr:/{print $10; exit}')"
[ "$GOT_FPR" = "$DOCKER_KEY_FPR" ] \
  || die "Docker GPG fingerprint mismatch! expected ${DOCKER_KEY_FPR}, got ${GOT_FPR:-none}."
NPUB="$(gpg --no-default-keyring --keyring "$TMPRING" --list-keys --with-colons 2>/dev/null | grep -c '^pub:' || true)"
[ "$NPUB" = "1" ] || die "expected 1 primary key in Docker keyring, found ${NPUB}."
gpg --no-default-keyring --keyring "$TMPRING" --export "$DOCKER_KEY_FPR" > "$DOCKER_KEYRING"
chmod 0644 "$DOCKER_KEYRING"
ok "Docker signing key verified: $GOT_FPR"

cat > /etc/apt/sources.list.d/docker.sources <<EOF
# Managed by deep-fryer infra/bootstrap/30-docker.sh
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.gpg
EOF

apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null

say "Configuring hardened Docker daemon (/etc/docker/daemon.json)"
install -d -m 0755 /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": "5"
  },
  "no-new-privileges": true,
  "live-restore": true
}
EOF

systemctl enable --now docker >/dev/null
systemctl restart docker
docker compose version >/dev/null
ok "Docker CE + Compose ready"

if [ -n "$DOCKER_USER" ]; then
  usermod -aG docker "$DOCKER_USER"
  ok "added ${DOCKER_USER} to docker group (takes effect on next login)"
fi
