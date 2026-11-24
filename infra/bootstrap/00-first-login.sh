#!/usr/bin/env bash
#
# 00-first-login.sh — one-time hardening of a fresh Debian 12/13 VPS (run as root).
#
# Creates an unprivileged sudo admin user with SSH key auth, disables root &
# password SSH login (verified via `sshd -T`), sets UTC time + chrony, installs
# nftables / age / unattended-upgrades, and leaves your current SSH session intact.
# Verify login as the new admin user in a second terminal BEFORE closing root.
#
# USAGE:
#   ./00-first-login.sh --pubkey-file /root/admin.pub
#   ./00-first-login.sh --pubkey "ssh-ed25519 AAAA... ops@laptop"
#   Optional: --user df-admin --hostname deep-fryer --no-root-disable

set -euo pipefail

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  !!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

ADMIN_USER="df-admin"
NEW_HOSTNAME="deep-fryer"
PUBKEY=""
PUBKEY_FILE=""
DISABLE_ROOT=1

while [ $# -gt 0 ]; do
  case "$1" in
    --user)            ADMIN_USER="${2:?}"; shift 2 ;;
    --hostname)        NEW_HOSTNAME="${2:?}"; shift 2 ;;
    --pubkey)          PUBKEY="${2:?}"; shift 2 ;;
    --pubkey-file)     PUBKEY_FILE="${2:?}"; shift 2 ;;
    --no-root-disable) DISABLE_ROOT=0; shift ;;
    -h|--help)         grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "run as root (you are $(id -un))."
[ -r /etc/os-release ] || die "no /etc/os-release; expected Debian 12 or 13."
# shellcheck disable=SC1091
. /etc/os-release
[ "${ID:-}" = "debian" ] || die "expected Debian; found ID=${ID:-unknown}."
case "${VERSION_CODENAME:-}" in
  bookworm|trixie) ok "Debian ${VERSION_ID:-?} (${VERSION_CODENAME})" ;;
  *) die "expected Debian 12 (bookworm) or 13 (trixie); found ${VERSION_CODENAME:-unknown}." ;;
esac

if [ -n "$PUBKEY_FILE" ]; then
  [ -r "$PUBKEY_FILE" ] || die "cannot read --pubkey-file $PUBKEY_FILE"
  PUBKEY="$(tr -d '\r' < "$PUBKEY_FILE" | grep -m1 -E '^(ssh-ed25519|ssh-rsa|ecdsa-|sk-)' || true)"
fi
PUBKEY="$(printf '%s' "$PUBKEY" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
[ -n "$PUBKEY" ] || die "provide an SSH public key with --pubkey or --pubkey-file."
printf '%s' "$PUBKEY" | grep -qE '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-|sk-ssh-ed25519@|sk-ecdsa-)' \
  || die "value does not look like an SSH public key."
case "$PUBKEY" in
  *PRIVATE*) die "that is a PRIVATE key — provide the .pub public key only." ;;
esac

say "Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  ca-certificates curl gnupg sudo \
  nftables chrony unattended-upgrades apt-listchanges \
  age rsync jq tmux >/dev/null
ok "base packages installed"

say "Setting hostname ($NEW_HOSTNAME) and UTC timezone"
hostnamectl set-hostname "$NEW_HOSTNAME" >/dev/null 2>&1 || printf '%s\n' "$NEW_HOSTNAME" > /etc/hostname
timedatectl set-timezone UTC >/dev/null 2>&1 || ln -sf /usr/share/zoneinfo/UTC /etc/localtime
systemctl enable --now chrony >/dev/null 2>&1 || true
ok "timezone UTC + chrony enabled"

say "Ensuring admin user ($ADMIN_USER)"
if ! id "$ADMIN_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$ADMIN_USER" >/dev/null
fi
usermod -aG sudo "$ADMIN_USER"
cat > "/etc/sudoers.d/90-${ADMIN_USER}" <<EOF
${ADMIN_USER} ALL=(ALL:ALL) NOPASSWD:ALL
EOF
chmod 0440 "/etc/sudoers.d/90-${ADMIN_USER}"
visudo -cf "/etc/sudoers.d/90-${ADMIN_USER}" >/dev/null

SSH_DIR="/home/${ADMIN_USER}/.ssh"
install -d -m 0700 -o "$ADMIN_USER" -g "$ADMIN_USER" "$SSH_DIR"
AUTH_KEYS="${SSH_DIR}/authorized_keys"
touch "$AUTH_KEYS"
grep -qxF "$PUBKEY" "$AUTH_KEYS" || printf '%s\n' "$PUBKEY" >> "$AUTH_KEYS"
chown "$ADMIN_USER:$ADMIN_USER" "$AUTH_KEYS"
chmod 0600 "$AUTH_KEYS"
ok "admin user & SSH key configured"

say "Hardening sshd (key-only)"
ROOT_LINE="PermitRootLogin no"
[ "$DISABLE_ROOT" -eq 1 ] || ROOT_LINE="PermitRootLogin prohibit-password"
cat > /etc/ssh/sshd_config.d/00-deep-fryer-hardening.conf <<EOF
# Managed by deep-fryer infra/bootstrap/00-first-login.sh
${ROOT_LINE}
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
X11Forwarding no
AllowAgentForwarding no
EOF
sshd -t
systemctl reload ssh || systemctl reload sshd

EFFECTIVE="$(sshd -T)"
printf '%s\n' "$EFFECTIVE" | grep -qx 'passwordauthentication no' \
  || die "effective sshd config still allows password auth (check earlier drop-ins in /etc/ssh/sshd_config.d/)."
if [ "$DISABLE_ROOT" -eq 1 ]; then
  printf '%s\n' "$EFFECTIVE" | grep -qx 'permitrootlogin no' \
    || die "effective sshd config still allows root login."
fi
ok "sshd hardened and verified via sshd -T"

say "Enabling unattended security upgrades"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true
ok "unattended-upgrades active"

say "Done. Open a NEW terminal and verify: ssh ${ADMIN_USER}@<vps-ip> BEFORE closing this root shell."
