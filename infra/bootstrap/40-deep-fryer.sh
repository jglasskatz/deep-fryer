#!/usr/bin/env bash
#
# 40-deep-fryer.sh — initialize external runtime config (/etc/deep-fryer/app.env),
#                    backup directories, and systemd healthcheck/backup timers.
#
# Never overwrites an existing /etc/deep-fryer/app.env so hand-edited secrets
# survive every release deploy.
#
# USAGE:
#   sudo ./40-deep-fryer.sh [--release /opt/deep-fryer/current]

set -euo pipefail

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

RELEASE_DIR="/opt/deep-fryer/current"
while [ $# -gt 0 ]; do
  case "$1" in
    --release) RELEASE_DIR="${2:?}"; shift 2 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "run with sudo/root."
[ -d "$RELEASE_DIR/infra" ] || die "release dir not found: $RELEASE_DIR"

say "Creating /etc/deep-fryer and /var/lib/deep-fryer"
install -d -m 0750 /etc/deep-fryer
install -d -m 0750 /var/lib/deep-fryer /var/lib/deep-fryer/backups /var/lib/deep-fryer/state

ENV_FILE="/etc/deep-fryer/app.env"
if [ ! -f "$ENV_FILE" ]; then
  say "Generating initial $ENV_FILE with fresh random secrets"
  PG_PASS="$(openssl rand -hex 24)"
  ST_SECRET="$(openssl rand -hex 24)"
  AUTH_SEC="$(openssl rand -base64 32)"
  DF_SEC_KEY="$(openssl rand -base64 32)"
  cat > "$ENV_FILE" <<EOF
# Managed runtime secrets for deep-fryer (outside git & Docker images).
# Fill in SITE_ADDRESS, APP_URL, SUPPORT_EMAIL, sign-in, and billing/model keys.

SITE_ADDRESS=app.example.org
APP_URL=https://app.example.org
SUPPORT_EMAIL=support@example.org

# Core storage & auth secrets (auto-generated)
POSTGRES_USER=deep_fryer
POSTGRES_PASSWORD=${PG_PASS}
POSTGRES_DB=deep_fryer
STORAGE_ACCESS_KEY=deepfryer
STORAGE_SECRET_KEY=${ST_SECRET}
AUTH_SECRET=${AUTH_SEC}
DF_SECRETS_KEY=${DF_SEC_KEY}

# Self-serve first doughnut:
#   own  -> groups may build their first doughnut on their own Anthropic/OpenAI/Gemini key
#   paid -> requires a paid Stripe plan or staff-set contract
DF_FIRST_DOUGHNUT=own

# Model provider keys (optional when using BYOK; required for plan-funded builds & ask_portrait)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5
VERIFIER_MODEL=claude-opus-5
MAX_RUN_USD=150
MAX_ACTIVE_SESSIONS=6

# Group login providers (configure at least one: Google, Microsoft, or SMTP magic link)
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
SMTP_URL=
EMAIL_FROM=

# Optional Stripe Checkout ("they pay, our VPS builds it")
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
EOF
  chmod 0600 "$ENV_FILE"
  ok "created $ENV_FILE (0600)"
else
  ok "preserving existing $ENV_FILE"
fi

OPS_FILE="/etc/deep-fryer/ops.env"
if [ ! -f "$OPS_FILE" ]; then
  cat > "$OPS_FILE" <<'EOF'
# Optional ops notifications & encrypted backup settings (0600)
# NTFY_URL=https://ntfy.sh/your-private-topic
# BACKUP_AGE_RECIPIENT=age1...
BACKUP_RETENTION_DAYS=14
EOF
  chmod 0600 "$OPS_FILE"
  ok "created $OPS_FILE (0600)"
else
  ok "preserving existing $OPS_FILE"
fi

say "Installing systemd healthcheck and backup timers"
install -m 0644 "$RELEASE_DIR/infra/systemd/deep-fryer-healthcheck.service" /etc/systemd/system/
install -m 0644 "$RELEASE_DIR/infra/systemd/deep-fryer-healthcheck.timer" /etc/systemd/system/
install -m 0644 "$RELEASE_DIR/infra/systemd/deep-fryer-backup.service" /etc/systemd/system/
install -m 0644 "$RELEASE_DIR/infra/systemd/deep-fryer-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now deep-fryer-healthcheck.timer deep-fryer-backup.timer >/dev/null
ok "systemd timers enabled"

cat <<'EOF'

Next steps:
  1. Edit /etc/deep-fryer/app.env (SITE_ADDRESS, APP_URL, SUPPORT_EMAIL, login, keys/Stripe).
  2. Start the stack:
     sudo docker compose --env-file /etc/deep-fryer/app.env \
       -f /opt/deep-fryer/current/docker-compose.yml up -d --build
  3. Run live preflight:
     sudo docker compose --env-file /etc/deep-fryer/app.env \
       -f /opt/deep-fryer/current/docker-compose.yml run --rm migrate \
       node --import tsx ../../scripts/preflight.ts
EOF
