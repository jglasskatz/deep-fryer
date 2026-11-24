# deep-fryer Debian VPS Runbook

Hardened, single-box deployment guide for the full `deep-fryer` platform (Next.js app, Postgres 16 + RLS, SeaweedFS evidence store, research worker, and Caddy automatic HTTPS) — using the `infra/` provisioning kit adapted from our Chameleon VPS architecture.

## Recommended hardware
- **OS:** Debian 12 (`bookworm`) or Debian 13 (`trixie`)
- **Size:** 2–4 vCPU, **4 GB+ RAM** (8 GB recommended for concurrent Chromium evidence captures + research workers), **40 GB+ SSD**
- **DNS:** Point an `A` (and optional `AAAA`) record for `app.yourdomain.org` to the VPS IP before starting Caddy.

---

## 1. Harden the fresh Debian VPS (one time)
Copy `infra/bootstrap/00-first-login.sh` and your SSH public key to the fresh box as `root`, then run:

```bash
chmod +x /root/00-first-login.sh
/root/00-first-login.sh --pubkey-file /root/admin.pub
```

Open a **second terminal** and verify `ssh df-admin@<vps-ip>` works **before** closing the root shell.

## 2. Lock down the firewall & install Docker CE
```bash
sudo ./infra/bootstrap/20-firewall.sh
# Verify a new SSH login still works, then cancel the dead-man's-switch rollback:
sudo ./infra/bootstrap/20-firewall.sh --confirm

sudo ./infra/bootstrap/30-docker.sh --add-docker-group df-admin
```

## 3. Deploy a checksum-verified release from your laptop
```bash
bash scripts/vps-deploy.sh --host df-admin@app.yourdomain.org --stage-only
```

Then initialize `/etc/deep-fryer/app.env` (`0600`, auto-generates Postgres, SeaweedFS, Auth, and AES-GCM secrets) and install the systemd healthcheck + nightly backup timers:

```bash
sudo /opt/deep-fryer/releases/<release-id>/infra/bootstrap/40-deep-fryer.sh \
  --release /opt/deep-fryer/releases/<release-id>
```

## 4. Configure Self-Serve (`/start`), Group Login, and Payment-to-Build
Edit `/etc/deep-fryer/app.env` (never stored in git or Docker images):

1. **Domain & Support:** Set `SITE_ADDRESS`, `APP_URL`, and `SUPPORT_EMAIL`.
2. **Group Logins (`/login`):** Configure Google OAuth (`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`), Microsoft Entra ID, or SMTP magic-link email (`SMTP_URL` / `EMAIL_FROM`).
3. **Choose how groups fund builds (you can enable BOTH at once):**
   - **Bring Your Own API Key (lowest friction to launch):** Keep `DF_FIRST_DOUGHNUT=own` (requires `DF_SECRETS_KEY`, already auto-generated). Any community group signs in, opens `/start`, follows the built-in 3-step API key guide on `/o/<org>/billing` to paste an Anthropic, OpenAI, or Google Gemini key, and clicks **Build my doughnut** — your VPS pays `$0` in model tokens.
   - **They pay, our VPS builds it (Stripe Checkout):** Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and at least one deployment model key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`). Run the one-time Stripe price setup from `docs/deploy.md §5`. Groups pay by card on `/o/<org>/billing`, Stripe's webhook activates them in seconds, and your VPS worker builds their doughnut automatically (guarded by `MAX_RUN_USD=150` and `MAX_ACTIVE_SESSIONS=6`).

## 5. Launch, verify, and promote staff
```bash
bash scripts/vps-deploy.sh --host df-admin@app.yourdomain.org

# Verify live Postgres, storage, auth, and model keys:
sudo docker compose --env-file /etc/deep-fryer/app.env \
  -f /opt/deep-fryer/current/docker-compose.yml run --rm migrate \
  node --import tsx ../../scripts/preflight.ts

# Promote your own account to staff:
sudo docker compose --env-file /etc/deep-fryer/app.env \
  -f /opt/deep-fryer/current/docker-compose.yml run --rm migrate \
  node --import tsx ../../scripts/make-staff.ts you@yourdomain.org
```

## 6. Ongoing ops, backups, and rollback
- **Healthcheck alerts:** Set `NTFY_URL` in `/etc/deep-fryer/ops.env`; `deep-fryer-healthcheck.timer` checks all 5 containers, web reachability, and disk headroom every 5 minutes.
- **Encrypted nightly backups:** Set `BACKUP_AGE_RECIPIENT=age1...` in `/etc/deep-fryer/ops.env`; `deep-fryer-backup.timer` writes SHA-256 checksummed `age`-encrypted Postgres dumps to `/var/lib/deep-fryer/backups/` with 14-day retention.
- **Instant rollback:** `bash scripts/vps-deploy.sh --host df-admin@app.yourdomain.org --rollback <previous-release-id>`
