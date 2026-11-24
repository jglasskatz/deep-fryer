#!/usr/bin/env bash
#
# 20-firewall.sh — default-deny nftables firewall allowing only SSH (22) and
#                  public HTTP/HTTPS (80, 443 for Caddy automatic TLS).
#
# SAFETY: Arms a dead-man's-switch rollback timer (default 180 seconds) before
# applying rules. After verifying SSH still works in a second terminal, run:
#   sudo ./20-firewall.sh --confirm
# If you do not confirm in time, nftables automatically flushes back open.
#
# USAGE:
#   sudo ./20-firewall.sh [--ssh-port 22] [--revert-seconds 180]
#   sudo ./20-firewall.sh --confirm

set -euo pipefail

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  !!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

SSH_PORT="22"
REVERT_SECONDS="180"
CONFIRM=0
ROLLBACK_UNIT="deep-fryer-fw-rollback"

while [ $# -gt 0 ]; do
  case "$1" in
    --ssh-port)       SSH_PORT="${2:?}"; shift 2 ;;
    --revert-seconds) REVERT_SECONDS="${2:?}"; shift 2 ;;
    --confirm)        CONFIRM=1; shift ;;
    -h|--help)        grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "run with sudo/root."

if [ "$CONFIRM" -eq 1 ]; then
  systemctl stop "${ROLLBACK_UNIT}.timer" >/dev/null 2>&1 || true
  systemctl reset-failed "${ROLLBACK_UNIT}.service" >/dev/null 2>&1 || true
  systemctl enable nftables >/dev/null 2>&1 || true
  ok "firewall confirmed and persisted across reboots (rollback timer cancelled)."
  exit 0
fi

case "$SSH_PORT" in
  ''|*[!0-9]*) die "invalid --ssh-port: $SSH_PORT" ;;
esac

say "Writing /etc/nftables.conf (allow SSH:${SSH_PORT}, HTTP:80, HTTPS:443)"
cat > /etc/nftables.conf <<EOF
#!/usr/sbin/nft -f
# Managed by deep-fryer infra/bootstrap/20-firewall.sh
# Uses a dedicated table so Docker's own iptables/nftables NAT rules remain intact.

table inet deep_fryer_host
delete table inet deep_fryer_host

table inet deep_fryer_host {
  chain input {
    type filter hook input priority 0; policy drop;

    iif "lo" accept
    ct state established,related accept
    ct state invalid drop

    ip protocol icmp icmp type { echo-request, destination-unreachable, time-exceeded } limit rate 10/second accept
    ip6 nexthdr icmpv6 icmpv6 type { echo-request, nd-neighbor-solicit, nd-neighbor-advert, nd-router-advert, packet-too-big, time-exceeded } limit rate 10/second accept

    tcp dport ${SSH_PORT} ct state new accept
    tcp dport { 80, 443 } ct state new accept
    udp dport 443 ct state new accept
  }

  chain output {
    type filter hook output priority 0; policy accept;
  }
}
EOF

nft -c -f /etc/nftables.conf

say "Arming automatic rollback in ${REVERT_SECONDS}s (cancel with --confirm)"
systemctl stop "${ROLLBACK_UNIT}.timer" >/dev/null 2>&1 || true
systemd-run --unit="$ROLLBACK_UNIT" --on-active="${REVERT_SECONDS}s" \
  /bin/sh -c 'nft delete table inet deep_fryer_host >/dev/null 2>&1 || true' >/dev/null

nft -f /etc/nftables.conf
ok "firewall active — verify a new SSH connection, then run: sudo $0 --confirm"
