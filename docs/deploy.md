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
`SUPPORT_EMAIL`, `ANTHROPIC_API_KEY` (research worker), `DF_SECRETS_KEY`
(organizations' own API keys, below).

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

### Features (SPEC-v7 §3)

A portrait's core is always on: the doughnut with its detail panel, the
dimension pages with their sources and evidence, methodology, progress,
open data and embeds. Everything else is a feature that a portrait's owner
turns on under **Settings → Features**: emergencies, policy analysis, the
curated Get involved listings and organization form, discussion,
translation, family compare and insights, and research requests. A new
portrait starts with all of them off; portraits that existed before
migration 0011 kept everything they showed (all on).

Off means gone: the feature's pages are a 404, its links leave the header
and the admin and family navigation, its server actions refuse, and the
worker skips it (no alert fetches, no policy jobs). With translation off a
portrait is English only and readers get a "Request a translation" button
instead; the requests are counted for owners in Settings.

To switch a feature off for the whole deployment, whatever the portraits
say, list it in `DF_DISABLED_FEATURES` (comma-separated; `deep_fry` turns
off the theme menu's deep fry) and restart web and worker.

### Emergency view (SPEC-v5 §3)

Per portrait, staff set the National Weather Service zones — both the UGC
county and the forecast-zone codes for the area (e.g. `NYC061` and
`NYZ072`): the NWS issues heat, winter storm, coastal flood, wind, and air
quality alerts by forecast zone, and counties alone miss them — the
official alert sign-up link, and
the emergency / information phone numbers at `/{tenant}/admin/emergency`,
then rate and publish hazards, plans, and help resources. The worker
refreshes alerts every five minutes from `api.weather.gov` — allow that host
in the worker's egress proxy, and set `SUPPORT_EMAIL` (or `EMAIL_FROM`): the
NWS requires a contact in the User-Agent. The preflight checks the feed for
every configured portrait and looks up every zone's NWS record, so a
mistyped or retired code fails there instead of showing "no alerts". NYC:

```bash
docker compose run --rm migrate node --import tsx ../../scripts/nyc-emergency.ts           # review the proposal
docker compose run --rm migrate node --import tsx ../../scripts/nyc-emergency.ts --apply   # writes hazards/plans unpublished
```

Hazard ratings in the proposal are proposals; staff review and publish
them. Plan links that do not answer are refused at `--apply`.

### Policy analysis (SPEC-v5 §2)

Staff-only, at `/{tenant}/admin/policy`. Each analysis is one research
session against the plan and needs the worker's `ANTHROPIC_API_KEY`.

### Getting involved and discussion (SPEC-v6)

Every dimension page lists ways to get involved, and organizations can put
themselves forward through a form on that page and on `/{tenant}/outreach`
— no account needed. Submissions wait for an editor at
`/{tenant}/admin/involvement`, where approving one turns it into a listing
(edit it first); nothing is published automatically, and contact details are
never shown publicly. The form's rate limits key on the client address
Caddy passes in `X-Forwarded-For`; if you put another proxy or a CDN in
front of Caddy, configure Caddy's `trusted_proxies` so the address is the
resident's, not the proxy's.

A new account's first comment is held: moderators approve or decline it on
the thread or at `/{tenant}/admin/discussion`, and the admin overview counts
what is waiting. NYC:

```bash
docker compose run --rm migrate node --import tsx ../../scripts/nyc-involvement.ts           # review the proposal
docker compose run --rm migrate node --import tsx ../../scripts/nyc-involvement.ts --apply   # writes listings unpublished
```

Each proposed listing names the public page it was taken from. Staff check
the link ("Link checked today" stamps the date residents see) and publish.

### Models

The worker reaches models only through the Claude Agent SDK, pinned to
exactly 0.3.220 (`apps/worker/package.json`): a newer SDK changes what model
aliases mean and how requests are built, so upgrade it on purpose, never by a
lockfile refresh. Compose sets these defaults; override them in `.env`.

| Role | Variable | Default | What it does |
|---|---|---|---|
| Researcher | `ANTHROPIC_MODEL` | `claude-sonnet-5` | The region-context, dimension, and policy-analysis sessions: searches (WebSearch runs on this model), picks sources, captures evidence, writes the findings |
| Verifier | `VERIFIER_MODEL` | `claude-opus-5` | One session per indicator finding, blind to the researcher's reasoning: re-fetches the source and judges whether it supports the value |
| Page reader | `ANTHROPIC_SMALL_FAST_MODEL` | `claude-haiku-4-5-20251001` | Claude Code's WebFetch hands each fetched page to this model and passes on its summary (quotes capped at 125 characters), so researchers and the verifier alike read pages through it; only short markdown from a few preapproved domains passes through raw |
| Scouts | `RESEARCH_SUBAGENT_MODEL` | empty (off) | When set, each dimension session may dispatch `source-scout` subagents on this model for breadth searching; the researcher still captures the evidence and decides |

`RESEARCH_SESSION_CONCURRENCY` (default 3) is how many dimension sessions one
research run keeps going at once.

The page reader is pinned to what the CLI picks today, because later SDKs
move the `haiku` alias it otherwise uses to Claude Haiku 5.5, which would
change what the verifier sees without anyone deciding to. The pin assumes
Anthropic's first-party API: the CLI sends the id verbatim, and setting it
skips the CLI's own fallback to the main model on gateway deployments. Behind
Bedrock, Vertex, Foundry, or an LLM gateway, set your provider's id for the
model. Never set it to an empty value (compose replaces a blank with the
default; elsewhere the CLI treats a blank as unset and the pin is lost). Do
not set `ANTHROPIC_DEFAULT_HAIKU_MODEL` (it also redefines the `haiku` alias
subagents use), its `…_SUPPORTED_CAPABILITIES` companion (ignored on the
first-party API), or `CLAUDE_CODE_EFFORT_LEVEL` (it overrides the effort of
every session).

An organization's own key (below) runs the same models, so it needs access to
all of them.

Claude Haiku 5.5 is not used anywhere yet. Where it could help, what has to
be measured before any switch, and what it would cost:
[docs/haiku-5-5.md](haiku-5-5.md).

### Organizations' own Anthropic API keys (SPEC-v7 §4)

Organization owners can store their own Anthropic API key under
`/o/{org}/billing`; their research and policy sessions then run on that key
and are not counted against the plan's session allowance (a plan, or the
trial, is still needed). The key is checked with one Models API call, stored
only as AES-256-GCM ciphertext, and shown afterwards by its last four
characters; only the worker decrypts it, into the session's environment.
Who pays is decided when a run is applied or an analysis is queued and is
stored with it, so sessions started on the key never count against the
allowance (even after the key is removed), and plan-funded work stays on
`ANTHROPIC_API_KEY` if a key is added later. Work queued on a key that is
removed before it starts fails with a message asking staff to start it again —
it never runs on the deployment's key instead.

To offer this, set `DF_SECRETS_KEY` (`openssl rand -base64 32`) in `.env` —
compose passes it to web and worker, which must share it — and
`docker compose up -d web worker`. Without it the billing page says the
option is unavailable and research runs on `ANTHROPIC_API_KEY`. With it set,
the web app refuses to start unless it decodes to exactly 32 bytes. Keep it
with your other secrets and back it up: if it is changed or lost, stored keys
cannot be decrypted — the worker then fails those organizations' research
with a message asking an owner to enter the key again, and never falls back
to the deployment's key.

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
