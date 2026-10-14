# Deploying deep-fryer

Fully self-hosted (SPEC-v3 §2.4, SPEC-v4): one droplet (or any Docker host)
running `docker compose` — Postgres 16, SeaweedFS (S3-compatible) for evidence, a one-shot
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
| `POSTGRES_PASSWORD`, `STORAGE_SECRET_KEY` | `openssl rand -hex 32` (the storage key may contain only letters, digits, `.`, `_`, `-`) |
| a sign-in method | `AUTH_MICROSOFT_ENTRA_ID_*` (Microsoft 365 cities), `AUTH_GOOGLE_*`, and/or `SMTP_URL` + `EMAIL_FROM` |

The web app **refuses to start** in production if any required value is
missing (it lists every problem), rather than running in anonymous dev mode.

OAuth redirect URIs to register:
- Google: `https://<SITE_ADDRESS>/api/auth/callback/google`
- Microsoft Entra ID: `https://<SITE_ADDRESS>/api/auth/callback/microsoft-entra-id`
  (set `AUTH_MICROSOFT_ENTRA_ID_ISSUER` to your directory's
  `https://login.microsoftonline.com/<tenant-id>/v2.0` to restrict sign-in to
  your city's accounts; a tenant on Microsoft's US government cloud, GCC
  High, uses `https://login.microsoftonline.us/<tenant-id>/v2.0` — the CSP
  allows whatever origin the issuer names). deep-fryer requests only
  `openid profile email`: no Microsoft Graph permission to consent to, no
  profile photo fetched. Keep the app registration's default of omitting
  unverified email claims.

Optional: `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (online billing),
`SUPPORT_EMAIL`, `ANTHROPIC_API_KEY` (research worker).

## 3. Start

```bash
docker compose up -d --build
docker compose logs -f migrate web     # migrations apply, then web starts
curl https://<SITE_ADDRESS>/api/health # {"ok":true}
```

Evidence snapshots live in the `storage` service (SeaweedFS) and are served
read-only at `https://<SITE_ADDRESS>/files/…` (same origin, so the CSP and the
offline cache treat them as first-party). The app's storage identity can read
and write objects in the evidence bucket but cannot create or delete buckets;
anonymous callers can fetch objects but not list them
(`deploy/storage/start.sh`). To use DigitalOcean Spaces or S3 instead, point
the `S3_*` entries of `x-app-env` in `docker-compose.yml` at them and drop the
`storage` services.

### Verify against the live services

```bash
docker compose run --rm migrate node --import tsx ../../scripts/preflight.ts
```

Talks to every real dependency and prints PASS / WARN / FAIL with the fix:
the production environment rules (the same ones the web app enforces at
boot), migrations applied, the row-level-security role, the storage bucket
and its public `/files/` route (objects yes, listings no), the SMTP relay's
login, Google and Microsoft Entra discovery **and the client id/secret**
(proved without a user: Google rejects an invalid code only after
authenticating the client; Entra is probed with a permissionless app-only
token from your tenant, so pin the issuer), Stripe (live vs test key, every
catalog price active and non-zero, the webhook registered for this
`APP_URL` with every synced event, the customer portal), and `APP_URL`
health and security headers through Caddy. Exit 1 on any failure — do not
onboard a city until it passes.

## Go-live checklist

Things only the operator can supply; the preflight confirms each one.

1. **DNS and host** — `SITE_ADDRESS` resolves to the droplet; ports 80/443 open.
2. **Sign-in** — register the OAuth apps (§2): Microsoft Entra in the city's
   own tenant (pinned issuer; GCC High uses `login.microsoftonline.us`),
   and/or Google. An SMTP relay for email links and notifications.
3. **Billing** — write the real price sheet (`docs/billing/prices.json`,
   §5), run `pnpm stripe:setup` with the live key, set
   `STRIPE_WEBHOOK_SECRET`; enable ACH/check for invoices in the Dashboard.
   Contract-only deployments (NYC's Metro contract) can leave Stripe unset.
4. **Preflight** passes with no FAIL.
5. **Organization** — `provision-nyc.ts` (or `create-tenant.ts`) with the
   owner's email; for NYC set the contract end and PO.
6. **Language access** — certified review of the translation catalogs before
   an agency relies on them under Local Law 30 (docs/language-access.md).
7. **Backups** — nightly `pg_dump` plus the `storage` volume (§6).

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

### Emergency view (SPEC-v5 §3)

Per portrait, staff set the National Weather Service zones (UGC county or
forecast-zone codes, e.g. `NYC061`), the official alert sign-up link, and
the emergency / information phone numbers at `/{tenant}/admin/emergency`,
then rate and publish hazards, plans, and help resources. The worker
refreshes alerts every five minutes from `api.weather.gov` — allow that host
in the worker's egress proxy, and set `SUPPORT_EMAIL` (or `EMAIL_FROM`): the
NWS requires a contact in the User-Agent. The preflight checks the feed for
every configured portrait. NYC:

```bash
docker compose run --rm migrate node --import tsx ../../scripts/nyc-emergency.ts           # review the proposal
docker compose run --rm migrate node --import tsx ../../scripts/nyc-emergency.ts --apply   # writes hazards/plans unpublished
```

Hazard ratings in the proposal are proposals; staff review and publish
them. Plan links that do not answer are refused at `--apply`.

### Policy analysis (SPEC-v5 §2)

Staff-only, at `/{tenant}/admin/policy`. Each analysis is one research
session against the plan and needs the worker's `ANTHROPIC_API_KEY`.

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
  nightly, plus the `storage` volume (evidence is the audit record — back it
  up with the same retention as the database).
- **Upgrades:** `git pull && docker compose up -d --build` — the migrate job
  runs first and the app waits for it.
- **Scaling research:** `docker compose up -d --scale worker=3`; sessions are
  independent and the queue is in Postgres.
- **Legacy Supabase data:** memberships from the Supabase era point at user
  ids with no login; re-invite those people from each portrait's Members page.
- **Database roles:** migrations create `deep_fryer_app` (no login, no
  `BYPASSRLS`) and grant it to the connecting user. Every user-driven query
  runs inside a transaction that switches to that role and sets the caller's
  id, so row-level security is enforced by Postgres (SPEC-v4 §6). Only
  identity resolution, billing, invitations, webhooks, and the worker use the
  owner connection.
- **Mail:** with `SMTP_URL` set, the worker emails each portrait's owners,
  editors, and organization owners when a research run finishes, fails, or
  flags findings (per the portrait's notification settings).
