# Deploying deep-fryer

Fully self-hosted (SPEC-v3 §2.4, SPEC-v4): one droplet (or any Docker host)
running `docker compose` — Postgres 16, MinIO for evidence, a one-shot
migration job, the web app, the research worker, and Caddy for TLS. No
managed services are required; Stripe and an SMTP relay are optional
integrations.

## 1. Host

A 4 GB droplet is a comfortable start (the worker's Chromium likes RAM). Point
your DNS name (e.g. `doughnut.cityofexample.gov` or `app.deep-fryer.io`) at it
and open ports 80/443.

```bash
git clone https://github.com/jglasskatz/deep-fryer.git && cd deep-fryer
cp .env.example .env
```

## 2. Configure `.env`

Required:

| Var | Value |
|---|---|
| `SITE_ADDRESS` | the DNS name (Caddy gets the certificate) |
| `APP_URL` | `https://<SITE_ADDRESS>` |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD` | long random strings |
| a sign-in method | `AUTH_MICROSOFT_ENTRA_ID_*` (Microsoft 365 cities), `AUTH_GOOGLE_*`, and/or `SMTP_URL` + `EMAIL_FROM` |

The web app **refuses to start** in production if any required value is
missing (it lists every problem), rather than running in anonymous dev mode.

OAuth redirect URIs to register:
- Google: `https://<SITE_ADDRESS>/api/auth/callback/google`
- Microsoft Entra ID: `https://<SITE_ADDRESS>/api/auth/callback/microsoft-entra-id`
  (set `AUTH_MICROSOFT_ENTRA_ID_ISSUER` to your directory's
  `https://login.microsoftonline.com/<tenant-id>/v2.0` to restrict sign-in to
  your city's accounts)

Optional: `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (online billing),
`SUPPORT_EMAIL`, `ANTHROPIC_API_KEY` (research worker).

## 3. Start

```bash
docker compose up -d --build
docker compose logs -f migrate web     # migrations apply, then web starts
curl https://<SITE_ADDRESS>/api/health # {"ok":true}
```

Evidence snapshots live in MinIO and are served read-only at
`https://<SITE_ADDRESS>/files/…` (same origin, so the CSP and the offline
cache treat them as first-party). To use DigitalOcean Spaces or S3 instead,
set the `S3_*` variables (see `.env.example`) and drop the `minio` services.

## 4. First organization

Self-serve: sign in and use **/start** (30-day trial).
Sales-led / NYC:

```bash
docker compose run --rm migrate node --import tsx ../../scripts/provision-nyc.ts \
  --owner owner@cityhall.nyc.gov --plan metro --contract-end 2027-06-30 --po PO-12345
# or any jurisdiction:
docker compose run --rm migrate node --import tsx ../../scripts/create-tenant.ts \
  --slug ithaca --name "Ithaca" --owner clerk@cityofithaca.org --plan city
```

Make yourself staff (contract editing on billing pages):
`docker compose exec db psql -U deep_fryer -c "update users set is_staff = true where email = 'you@…'"`.

## 5. Billing (optional)

```bash
cp docs/billing/prices.example.json docs/billing/prices.json   # set real amounts
STRIPE_SECRET_KEY=sk_live_… pnpm stripe:setup --prices docs/billing/prices.json \
  --portal --webhook-url https://<SITE_ADDRESS>/api/billing/webhook
```

Put the printed `STRIPE_WEBHOOK_SECRET` in `.env` and `docker compose up -d web`.
In the Stripe Dashboard, enable the invoice payment methods governments use
(ACH credit transfer / bank transfer, check) under Invoice settings.

## 6. Operations

- **Backups:** `docker compose exec db pg_dump -U deep_fryer -Fc deep_fryer > backup.dump`
  nightly, plus the `minio` volume (evidence is the audit record — back it up
  with the same retention as the database).
- **Upgrades:** `git pull && docker compose up -d --build` — the migrate job
  runs first and the app waits for it.
- **Scaling research:** `docker compose up -d --scale worker=3`; sessions are
  independent and the queue is in Postgres.
- **Legacy Supabase data:** memberships from the Supabase era point at user
  ids with no login; re-invite those people from each portrait's Members page.

## Known gaps (see docs/SPEC-v4.md §6)

The app connects as the database owner, so row-level security is defined but
not yet enforced at the database layer (app-layer checks are the enforcing
layer today).
