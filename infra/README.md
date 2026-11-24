# deep-fryer VPS provisioning kit (`infra/`)

Adapted from the hardened Debian VPS kit pattern (idempotent bootstrap scripts, dead-man's-switch firewall, fingerprint-verified Docker CE, external `/etc/deep-fryer/` secrets, verified release deploys with rollback, systemd healthchecks, and `age`-encrypted nightly backups) for `deep-fryer`'s full self-hosted stack (`db`, `storage`, `migrate`, `web`, `worker`, `caddy`).

Read the full operator guide first: [`../docs/VPS.md`](../docs/VPS.md).

## Order of operations

```text
VPS (root):    infra/bootstrap/00-first-login.sh --pubkey-file /root/admin.pub
  --> verify SSH login as df-admin before closing root <--
VPS (sudo):    infra/bootstrap/20-firewall.sh           # allow 22, 80, 443 only (auto-reverts unless --confirm)
VPS (sudo):    infra/bootstrap/30-docker.sh             # Docker CE (pinned GPG key) + hardened daemon.json
laptop:        bash scripts/vps-deploy.sh --host <vps>  # checksummed release bundle -> /opt/deep-fryer/releases/<id>
VPS (sudo):    /opt/deep-fryer/current/infra/bootstrap/40-deep-fryer.sh
VPS (sudo):    edit /etc/deep-fryer/app.env             # domain, auth, model keys, DF_FIRST_DOUGHNUT=own / Stripe
VPS (sudo):    docker compose --env-file /etc/deep-fryer/app.env -f /opt/deep-fryer/current/docker-compose.yml up -d --build
```

## File map

| Path | Purpose |
|---|---|
| `bootstrap/00-first-login.sh` | One-time Debian 12/13 hardening: `df-admin` user, key-only SSH verified via `sshd -T`, UTC clock, `chrony`, `nftables`, `age`, `unattended-upgrades`. |
| `bootstrap/20-firewall.sh` | Default-deny `nftables` firewall allowing only SSH (`22`) and Caddy HTTP/HTTPS (`80`, `443`), with an automatic dead-man's-switch rollback unless confirmed. |
| `bootstrap/30-docker.sh` | Installs Docker CE from Docker's official Debian repo after verifying the pinned PGP key fingerprint, and configures log rotation, `no-new-privileges`, and `live-restore`. |
| `bootstrap/40-deep-fryer.sh` | Creates `/etc/deep-fryer/app.env` (`0600`, preserving existing hand-edited secrets), `/var/lib/deep-fryer/backups`, and enables healthcheck + backup systemd timers. |
| `scripts/healthcheck.sh` | Checks compose services (`db`, `storage`, `web`, `worker`, `caddy`), web health, and disk usage; sends transition-based alerts via `ntfy` if configured. |
| `scripts/backup.sh` | Nightly `pg_dump` + SHA-256 manifest encrypted to an offline `age` recipient key with 14-day retention (never includes `/etc/deep-fryer/app.env`). |
| `systemd/deep-fryer-*.{service,timer}` | 5-minute healthcheck timer and 03:15 UTC nightly backup timer. |
| `../scripts/vps-deploy.sh` | Packages a clean git archive with SHA-256 verification, deploys into `/opt/deep-fryer/releases/<id>`, runs `migrate` + `web` + `worker` + `caddy`, and supports `--rollback <id>`. |
