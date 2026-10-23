# Deploying deep-fryer

For the public static portrait collection, use [GitHub Pages deployment](pages.md). Its CI/CD publishes checked snapshots without database or model credentials. The account-based application described below still requires a server; Pages cannot execute its login, billing or research services.

Fully self-hosted (SPEC-v3 §2.4, SPEC-v4): one droplet (or any Docker host)
running `docker compose` — Postgres 16, SeaweedFS (S3-compatible) for evidence, a one-shot
migration job, the web app, the research worker, and Caddy for TLS. No
managed services are required. An Anthropic API key pays for research; Stripe
and an SMTP relay are optional integrations.

## What is free, and what is paid

- **Viewing is always free.** Published portraits, dimension pages, embeds,
  the open-data API and progress pages need no plan, payment or sign-in.
- **Setting up is free.** Anyone signed in can create an organization and a
  portrait at **/start** (unless the deployment turns self-serve off, §2) and
  invite their people. A portrait stays private to its members until it
  first publishes.
- **Building is never free.** Every research spend — a full build, a re-run,
  a policy analysis — needs an organization in good standing: an active paid
  plan (Stripe checkout on its billing page, where Stripe is configured) or
  a contract that staff set. There is no trial, and nothing gives a new
  organization free research sessions: a plan billed by annual invoice
  researches only once its first invoice is paid (Stripe calls it active
  before that), a trial an organization started before trials were retired
  confers nothing, and a Stripe subscription whose period ended more than
  three days ago without word from Stripe stops until the webhook catches
  up. An organization's own Anthropic API
  key (below) pays for the model tokens, not for hosting, review or support,
  so it still needs a plan or contract; it only spares the plan's allowance.
- **Plan-funded research also needs this server's `ANTHROPIC_API_KEY`.**
  Without it, such research is refused before anything is spent ("nothing
  was charged", with `SUPPORT_EMAIL`), while organizations with their own key
  can still build.

## 1. Host

A 4 GB droplet is a comfortable start (the worker's Chromium likes RAM). Give
it at least **25 GB of disk**: the images take about 7 GB (the worker image,
which carries Chromium and doubles as the ops shell, is 5.2 GB; web, Postgres,
SeaweedFS and Caddy about 2 GB together), and the build cache, the database,
evidence and 30 days of backups (§6) need the rest. Point your DNS name
(e.g. `doughnut.cityofexample.gov` or `app.deep-fryer.io`) at it and open
ports 80/443.

Get the release you are deploying. Name it explicitly: the default branch
is not necessarily the release, and a fresh clone checks out whatever the
default branch is that day.

```bash
git clone https://github.com/jglasskatz/deep-fryer.git && cd deep-fryer
git checkout <release>     # the release tag (or branch) named in the release notes
cp .env.example .env
```

While the repository is private, cloning needs read access to it: a GitHub
account the owner has added (with `gh auth login` or an SSH key), or a
read-only deploy key on the host.

## 2. Configure `.env`

`.env.example` has two halves. The first, "Local development only", is for
running the app with pnpm; compose ignores it, because it builds the
database and storage settings for its own services. Fill in the second half,
"Deployment".

Required:

| Var | Value |
|---|---|
| `SITE_ADDRESS` | the DNS name (Caddy gets the certificate) |
| `APP_URL` | `https://<SITE_ADDRESS>` |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `POSTGRES_PASSWORD`, `STORAGE_SECRET_KEY` | `openssl rand -hex 32` (the storage key may contain only letters, digits, `.`, `_`, `-`) |
| a sign-in method | `AUTH_MICROSOFT_ENTRA_ID_*` (Microsoft 365 cities), `AUTH_GOOGLE_*`, and/or `SMTP_URL` + `EMAIL_FROM` |
| `SUPPORT_EMAIL` | a plain address people write to for help (`help@yourcity.gov`), read by a person: the site footer, error pages, and every refusal ("nothing was charged — contact …") show it as a mailto link |
| `ANTHROPIC_API_KEY` | the deployment's Anthropic API key: it pays for every research session a plan funds. Without it, plan-funded research is refused before any spend and only organizations with their own key can build, so leave it unset only if every organization brings its own key. Only the worker (and the preflight) receive it |

Compose refuses to start without `SITE_ADDRESS`, `APP_URL`, `AUTH_SECRET`,
`POSTGRES_PASSWORD` and `STORAGE_SECRET_KEY`, and the web app **refuses to
start** in production without a sign-in method or `SUPPORT_EMAIL` (it lists
every problem) rather than running in anonymous dev mode. `ANTHROPIC_API_KEY`
is the exception: nothing refuses to start without it, so the preflight (§3)
warns.

With `SMTP_URL`, `EMAIL_FROM` must be an address on a domain the relay may
send for — the domain's SPF record includes the relay and the relay signs
for it with DKIM — or recipients refuse the mail or file it as spam,
sign-in links included. Replace the `example.gov` placeholders from
`.env.example`; the preflight warns while one is left.

Optional:

| Var | What it does |
|---|---|
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | self-serve online billing (§5). Without them, organizations run on contracts staff set |
| `DF_SECRETS_KEY` | lets organizations store their own Anthropic API key ([below](#organizations-own-anthropic-api-keys-spec-v7-4)) |
| `TERMS_URL` | your terms of use; the site footer links "Terms" to it. Unset, the footer has no Terms link |
| `DF_SHOWCASE_ORG` | the slug of the organization the landing page showcases (as in `/o/<slug>`). It appears once that organization has a public portrait, never as a link that 404s; unset, or with nothing published yet, the landing page lists the deployment's public portraits instead |
| `DF_DISABLED_FEATURES` | features off for the whole deployment ([Features](#features-spec-v7-3)). `self_serve` turns off public sign-up for a sales-led deployment: `/start` is a 404, no "build your city's doughnut" link appears, and staff create organizations with `create-tenant.ts` (§4). Reading published portraits is unaffected |
| `WORKER_HTTPS_PROXY` | the worker's egress proxy ([Worker egress](#worker-egress)) |
| model settings | [Models](#models) |

Set by compose, never by hand: **`DF_RESEARCH_KEY_CONFIGURED`**. The web app
must know whether the worker has a research key without ever seeing it, so
compose gives the web service `${ANTHROPIC_API_KEY:+true}` — `true` when the
key is set, empty otherwise — and ignores any value in `.env`. After adding
or removing `ANTHROPIC_API_KEY`, run `docker compose up -d web worker` so both
pick it up (a plain `restart` keeps the old environment).

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

### Worker egress

Research agents choose which pages the worker opens, so its outbound traffic
deserves its own control. Set `WORKER_HTTPS_PROXY` to an https forward proxy
you run (Squid, Smokescreen and the like), e.g. `http://egress.internal:3128`.
Compose gives it to the worker as `HTTPS_PROXY`, and sets
`NODE_USE_ENV_PROXY=1` with it so Node's own requests use it too. The
research traffic then goes through the proxy: the sessions' model calls and
page reads, Chromium's evidence captures, the worker's source checks and PDF
downloads, and the NWS alerts feed. The database, mail and the bundled
storage stay direct. The proxy is where every URL research touched is
logged and where you enforce an egress policy; it must allow
`api.anthropic.com`, `api.weather.gov` (if any portrait uses the emergency
view), and the public sources research reads.

Without it, the worker reaches the internet directly, and its egress is
limited only by the in-code guard (`packages/research/src/egress.ts`): https
only, and hosts that resolve to public addresses only — never loopback,
private networks or the cloud metadata address. Nothing below the
application records what was fetched.

## 3. Start

```bash
docker compose up -d --build
docker compose logs -f migrate web     # migrations apply, then web starts
curl https://<SITE_ADDRESS>/api/health # {"ok":true}
```

The first `--build` pulls about 5 GB of base images, unpacked (Playwright's
alone is 3.5 GB), and builds the web and worker images. On a 4-vCPU host with the base
images already pulled, the two builds took about five minutes together, two
of them in the web app's Next.js build; expect longer on a 2-vCPU droplet,
plus the download. Run it in `tmux` or `screen` so a dropped SSH session
does not stop it.

Evidence snapshots live in the `storage` service (SeaweedFS) and are served
read-only at `https://<SITE_ADDRESS>/files/…` (same origin, so the CSP and the
offline cache treat them as first-party). The app's storage identity can read
and write objects in the evidence bucket but cannot create or delete buckets;
anonymous callers can fetch objects but not list them
(`deploy/storage/start.sh`). To use DigitalOcean Spaces or S3 instead, point
the `S3_*` entries of `x-app-env` in `docker-compose.yml` at them and drop the
`storage` services.

### Other ports, or a second stack on one host

To serve on ports other than 80/443 (because the host already uses them, or
for a rehearsal), replace Caddy's published ports in a
`compose.override.yml` next to `docker-compose.yml`, which compose reads
automatically. Use `!override`: a plain `ports:` list is merged with the
original one, so compose would still try to bind 80 and 443.

```yaml
# compose.override.yml
services:
  caddy:
    ports: !override
      - '8080:80'
      - '8443:8443'
```

Then put the port in the address: `SITE_ADDRESS=app.example.gov:8443` and
`APP_URL=https://app.example.gov:8443`. Caddy listens on the port its site
address names, so publish that same port on both sides of the mapping.
Caddy obtains a public certificate only through ports 80 and 443 at the DNS
name, so on other ports it cannot get one by itself: use this for a
rehearsal on `localhost` (Caddy then serves its own local certificate
authority's certificate) or behind a front proxy that holds the
certificate. A second stack on a host that already runs one also needs its
own project name (`docker compose -p <name>`) and the `db` and `storage`
ports overridden the same way (`127.0.0.1:55432:5432`,
`127.0.0.1:18333:8333`).

### Verify against the live services

```bash
docker compose run --rm migrate node --import tsx ../../scripts/preflight.ts
```

Talks to every real dependency and prints PASS / WARN / FAIL with the fix:
the production environment rules (the same ones the web app enforces at
boot) and placeholder sender or support addresses, migrations applied, the
row-level-security role, the storage bucket and its public `/files/` route
(objects yes, listings no), the SMTP relay's login (or that `SMTP_URL` has
none), Google and Microsoft Entra discovery **and the client id/secret**
(proved without a user: Google rejects an invalid code only after
authenticating the client; Entra is probed with a permissionless app-only
token from your tenant, so pin the issuer), Stripe (live vs test key, every
catalog price active and non-zero, the webhook registered for this
`APP_URL` with every synced event, the customer portal), the research key
and every model it runs (one free Models API lookup per model: a refused
key, a model the key's workspace may not use, or a mistyped id fails here,
not in the first paid build), `APP_URL` health and security headers through
Caddy, and the launch items below (sample data, the showcase, the Terms
link). A failure names its cause — a refused connection, a name that does
not resolve, an untrusted certificate — not just "fetch failed". Exit 1 on
any failure — do not onboard a city until it passes.

The storage and web checks fetch `APP_URL` from inside the migrate
container, so **`APP_URL` must resolve to Caddy from inside the containers
and present a certificate they trust**. With a real DNS name and Caddy's
public certificate that holds by itself. On a rehearsal host serving
`https://localhost:8443` it does not: `localhost` inside the migrate
container is the container itself, and Caddy's local certificate authority
is not trusted there. Run the preflight in Caddy's network namespace with
Caddy's root certificate instead:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
chmod 644 caddy-root.crt   # the image runs as an unprivileged user; at 0600 Node ignores the file
cat > compose.preflight.yml <<'YAML'
services:
  migrate:
    network_mode: service:caddy
    environment:
      NODE_EXTRA_CA_CERTS: /certs/caddy-root.crt
    volumes:
      - ./caddy-root.crt:/certs/caddy-root.crt:ro
YAML
docker compose -f docker-compose.yml -f compose.override.yml -f compose.preflight.yml \
  run --rm migrate node --import tsx ../../scripts/preflight.ts
```

(Leave out `-f compose.override.yml` if you have none: naming files with
`-f` stops compose reading the override by itself.)

## Go-live checklist

Things only the operator can supply; the preflight confirms each one.

1. **DNS and host** — `SITE_ADDRESS` resolves to the droplet; ports 80/443 open.
2. **Sign-in** — register the OAuth apps (§2): Microsoft Entra in the city's
   own tenant (pinned issuer; GCC High uses `login.microsoftonline.us`),
   and/or Google. An SMTP relay for email links and notifications, with
   `EMAIL_FROM` on a domain it may send for.
3. **Research key** — `ANTHROPIC_API_KEY` set, with access to every model in
   [Models](#models).
4. **Billing** — write the real price sheet (`docs/billing/prices.json`,
   §5), run the Stripe setup through the ops container with the live key, set
   `STRIPE_WEBHOOK_SECRET`; enable ACH/check for invoices in the Dashboard.
   Contract-only deployments (NYC's Metro contract) can leave Stripe unset.
5. **Preflight** passes with no FAIL.
6. **Organization** — `provision-nyc.ts` (or `create-tenant.ts`) with the
   owner's email; for NYC set the contract end and PO. `provision-nyc.ts`
   turns translation on for all six NYC portraits (Local Law 30); every other
   feature starts off, so turn on what the city will use — emergencies, Get
   involved, compare and insights — under **Settings → Features** before
   running `nyc-emergency.ts` and `nyc-involvement.ts`, whose data is hidden
   while its feature is off.
7. **Language access** — certified review of the translation catalogs before
   an agency relies on them under Local Law 30 (docs/language-access.md).
8. **Backups** — the nightly database, `storage` volume and `.env` backup
   copied off the host, and one restore rehearsed on a scratch host (§6).

## Before a public launch

What the public will see, which the software cannot decide for you:

- **Legal pages.** `/privacy` and `/accessibility` ship with the software and
  describe what it does: what it collects and keeps, its cookies, who can see
  what; the WCAG 2.1 AA target and how it was tested. They are written by the
  software's makers, not by your counsel, and they speak for you once you
  publish them: review both against your own obligations (your
  jurisdiction's privacy law, records retention, your accessibility
  policy and contact) before launch. Terms of
  use are yours to write: publish them and set `TERMS_URL` (the preflight
  warns while it is unset and checks that the page answers).
- **Prices.** The price sheet (§5) holds the real amounts; the preflight
  refuses a missing or zero price. Nothing offers or advertises a trial.
- **Self-serve or sales-led.** With self-serve on (the default), anyone can
  set up an organization at `/start` and buy a plan; for a sales-led
  deployment, set `DF_DISABLED_FEATURES=self_serve` and create organizations
  with `create-tenant.ts`.
- **Attribution.** Wherever a doughnut is drawn, the product credits the
  diagram (Kate Raworth and Christian Guthier, CC BY-SA 4.0) and says the site
  is not affiliated with Doughnut Economics Action Lab (DEAL). Keep
  "Doughnut Economics" out of the site's name, domain and logo, and send DEAL
  a short note before launch saying what the tool is and how it attributes
  (docs/OPEN-SOURCE.md §3).
- **Never promote a demo database.** `scripts/seed-demo-data.ts` marks every
  portrait it seeds as sample data (the `sample_data` portrait setting), and
  those portraits then say "Sample data — not research" on every page and in
  the open-data API. Production starts from an empty database and real
  research; the preflight warns when any portrait carries the mark.
- **Real addresses.** `SUPPORT_EMAIL` is an inbox a person reads, and
  `EMAIL_FROM` is on a domain your relay may send for. Send yourself a
  sign-in link and check it arrives, not in spam.
- **Showcase.** Set `DF_SHOWCASE_ORG` to the organization the landing page
  should feature; it appears once that organization has published.

## 4. First organization

Organizations and portraits cost nothing to set up and stay private until
their first publish; building one needs a plan or a contract.

Self-serve (unless `self_serve` is off): sign in and use **/start** to set up
the organization and its portrait (up to three people, the owner included,
can set it up and review it without a plan), then buy a plan on the
organization's billing page before the first build — by card, which starts
at once, or by annual invoice, which starts once the invoice is paid (where
Stripe is not configured, staff set a contract instead). Plans are sold only
by an interval whose allowance builds a whole doughnut: Community annually,
not monthly (six sessions a month never reach the 22 a build takes).

Sales-led / NYC:

```bash
docker compose run --rm migrate node --import tsx ../../scripts/provision-nyc.ts \
  --owner owner@cityhall.nyc.gov --plan metro --contract-end 2027-06-30 --po PO-12345
# or any jurisdiction:
docker compose run --rm migrate node --import tsx ../../scripts/create-tenant.ts \
  --slug ithaca --name "Ithaca" --owner clerk@cityofithaca.org --plan city
```

`--plan` records a staff contract (through `--contract-end`, default one
year). Without it the organization has no plan: it can set up and invite
people, and buys a plan under Billing before any research.

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
migration 0011 kept everything they showed (all on). The NYC portraits are
the exception: `provision-nyc.ts` keeps translation on for them, as Local
Law 30 requires (an owner's explicit choice in Settings is kept on re-runs).

Off means gone: the feature's pages are a 404, its links leave the header
and the admin and family navigation, its server actions refuse, and the
worker skips it (no alert fetches, no policy jobs). With translation off a
portrait is English only and readers get a "Request a translation" button
instead; the requests are counted for owners in Settings.

To switch a feature off for the whole deployment, whatever the portraits
say, list it in `DF_DISABLED_FEATURES`, comma-separated, by these exact
names: `emergency`, `policy_analysis`, `involvement`, `discussion`,
`translation`, `family_compare`, `request_research`, `deep_fry` (the
theme menu's deep fry), and `self_serve` (public sign-up at `/start` and
every "build your city's doughnut" link; the last two are deployment-wide
only, with no portrait setting). Then run `docker compose up -d web worker`: a plain
`docker compose restart` keeps the environment the containers were created
with and does not re-read `.env`. A name that is not on the list switches
nothing off; the preflight warns about it, and web and worker log it when
they start.

### Emergency view (SPEC-v5 §3)

Per portrait, staff set the National Weather Service zones — both the UGC
county and the forecast-zone codes for the area (e.g. `NYC061` and
`NYZ072`): the NWS issues heat, winter storm, coastal flood, wind, and air
quality alerts by forecast zone, and counties alone miss them — the
official alert sign-up link, and
the emergency / information phone numbers at `/{tenant}/admin/emergency`,
then rate and publish hazards, plans, and help resources. The worker
refreshes alerts every five minutes from `api.weather.gov` — allow that host
in the worker's egress proxy ([Worker egress](#worker-egress)); the NWS
requires a contact in the User-Agent, and the worker sends `SUPPORT_EMAIL`.
The preflight checks the feed for every configured portrait and looks up
every zone's NWS record, so a mistyped or retired code fails there instead
of showing "no alerts". NYC:

```bash
docker compose run --rm migrate node --import tsx ../../scripts/nyc-emergency.ts           # review the proposal
docker compose run --rm migrate node --import tsx ../../scripts/nyc-emergency.ts --apply   # writes hazards/plans unpublished
```

Hazard ratings in the proposal are proposals; staff review and publish
them. Plan links that do not answer are refused at `--apply`.

### Policy analysis (SPEC-v5 §2)

Staff-only, at `/{tenant}/admin/policy`. Each analysis is one research
session: like any research it needs a plan or contract, and it runs on the
deployment's `ANTHROPIC_API_KEY` or on the organization's own key.

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
and are not counted against the plan's session allowance (a plan or contract
is still needed: the key pays for model tokens, not for hosting, review or
support). The key is checked with one Models API call, stored
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
option is unavailable and research runs on `ANTHROPIC_API_KEY` — except for
an organization that already has a key on file (a database restored without
the secret, or the secret removed later): its research and policy analyses
are refused, never moved onto `ANTHROPIC_API_KEY`, until the secret is set
again or an owner removes the key under Billing (removing needs no secret);
the preflight warns when keys are on file and the secret is not set. With it
set, the web app refuses to start unless it decodes to exactly 32 bytes. Keep
it with your other secrets and back it up: if it is changed, stored keys
cannot be decrypted — the worker then fails those organizations' research
with a message asking an owner to enter the key again, and never falls back
to the deployment's key.

## 5. Billing (optional)

Without Stripe, organizations build on contracts staff set (§4). With it,
organizations buy a plan themselves on their billing page. Run the setup
from the checkout, through the ops container (no Node or pnpm on the host):

```bash
cp docs/billing/prices.example.json docs/billing/prices.json   # set real amounts
docker compose run --rm --no-deps -v "$PWD/docs/billing:/billing:ro" -e STRIPE_SECRET_KEY=sk_live_… \
  migrate node --import tsx ../../scripts/stripe-setup.ts --prices /billing/prices.json \
  --portal --webhook-url https://<SITE_ADDRESS>/api/billing/webhook
```

(`-e STRIPE_SECRET_KEY` with no value passes the key from your shell
instead, keeping it out of the shell history; with the key already in
`.env`, leave `-e` out.) Put the key and the printed
`STRIPE_WEBHOOK_SECRET` in `.env` — both or neither, or the web app refuses
to start — and `docker compose up -d web`.
In the Stripe Dashboard, enable the invoice payment methods governments use
(ACH credit transfer / bank transfer, check) under Invoice settings. Mark a
check received as paid in the Dashboard ("paid out of band"): research on an
invoice plan starts when Stripe reports its first invoice paid. Upgrading
from a release before migration 0017? An invoice subscription created
earlier researches again as soon as Stripe sends any event for it; to bring
one up to date at once, resend its latest event from the Dashboard
(Developers → Events) or with `stripe events resend <event id>`.

## 6. Operations

- **Backups and restore:** the database, the `storage` volume, and `.env`
  ([Backups](#backups) and [Restore](#restore) below).
- **Upgrades:** `git fetch --tags && git checkout <new release> && docker
  compose up -d --build` — the migrate job runs first and the app waits for
  it. Each build leaves the previous images and build cache on disk;
  `docker image prune` and `docker builder prune` reclaim the space.
- **Scaling research:** `docker compose up -d --scale worker=3`; sessions are
  independent and the queue is in Postgres.
- **Database connections:** each web and worker container keeps one pool of
  up to `DATABASE_POOL_MAX` connections (default 10; set it in `.env`, and
  compose passes it to web, worker and migrate). Each worker also holds
  graphile-worker's queue connections: four at `WORKER_CONCURRENCY=1`, more
  as it rises. Keep (web containers + worker containers) × `DATABASE_POOL_MAX`,
  plus the queue connections, below Postgres's `max_connections` (100 in the
  bundled `postgres:16`), with room left for migrate, backups and `psql`: one
  web and three workers at the defaults need about 4 × 10 + 3 × 4 = 52.
- **Legacy Supabase data:** memberships from the Supabase era point at user
  ids with no login; re-invite those people from each portrait's Members page.
- **Database roles:** `deep_fryer_app` (no login, no `BYPASSRLS`), `anon`
  and `authenticated` belong to the Postgres cluster, not to the database.
  Migrations create them on a new database and grant `deep_fryer_app` to the
  connecting user; `pg_dump` does not carry them, so a restore must create
  them itself, before `pg_restore` ([Restore](#restore)). Every user-driven
  query runs inside a transaction that switches to that role and sets the caller's
  id, so row-level security is enforced by Postgres (SPEC-v4 §6). Only
  identity resolution, billing, invitations, webhooks, and the worker use the
  owner connection.
- **Mail:** with `SMTP_URL` set, the worker emails each portrait's owners,
  editors, and organization owners when a research run finishes, fails, or
  flags findings (per the portrait's notification settings).

### Backups

Three things, all needed to recover: the database, the `storage` volume
(evidence is the audit record behind every published claim), and `.env`.
Without `DF_SECRETS_KEY` from `.env`, organizations' stored API keys cannot
be decrypted
([Organizations' own Anthropic API keys](#organizations-own-anthropic-api-keys-spec-v7-4)),
so keep `.env` with the backups, as protected as the database itself.

Run this nightly from the deep-fryer checkout, for example from cron with
`15 3 * * * cd /srv/deep-fryer && ./backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
day=$(date +%F)
mkdir -p backups

# Database. pg_dump writes to a temporary name, the archive is read back,
# and only then is it renamed. A failed run exits non-zero and never
# replaces an earlier backup with an empty file.
docker compose exec -T db pg_dump -U deep_fryer -Fc deep_fryer > "backups/db-$day.dump.tmp"
docker compose exec -T db pg_restore -l < "backups/db-$day.dump.tmp" > /dev/null
mv "backups/db-$day.dump.tmp" "backups/db-$day.dump"

# Evidence. SeaweedFS is stopped so that its metadata store is copied in a
# consistent state. Until it starts again, evidence images do not load and
# the worker cannot save evidence. `run` mounts the project's own storage
# volume, so you never need its name. The trap restarts storage if tar fails.
docker compose stop storage
trap 'docker compose start storage' EXIT
docker compose run --rm --no-deps -v "$PWD/backups":/backup --entrypoint tar storage \
  czf "/backup/storage-$day.tgz.tmp" -C /data .
docker compose start storage
trap - EXIT
mv "backups/storage-$day.tgz.tmp" "backups/storage-$day.tgz"

# Keep 30 days on the host. The patterns also match .tmp files left by
# failed runs.
find backups -name 'db-*.dump*' -mtime +30 -delete
find backups -name 'storage-*.tgz*' -mtime +30 -delete
```

Then copy `backups/` and `.env` off the host every night, to an rsync
target or a bucket with another provider. A backup kept only on the
droplet is lost along with it. Keep at least the same 30 days there, or
longer if the city's records schedule requires it for evidence.

### Restore

The only way to know a backup works is to restore it. Rehearse this on a
scratch host before go-live and after upgrades.

Restore onto the release the backup was taken on, or a newer one. Follow
§1 to get a checkout, put the saved `.env` in place, and copy the backup
files into `backups/`. Do **not** run `docker compose up` until step 5.
These steps also work on a host where the stack has already started, but
they replace its data, so back that up first if you still need it.

```bash
d=2026-10-15   # the date of the backup to restore

# 1. Run only the database, so nothing writes while you restore.
docker compose stop caddy web worker storage
docker compose up -d --wait db

# 2. Create an empty database that migrate has never touched, and the
#    cluster roles the dump refers to but does not contain.
docker compose exec -T db psql -U deep_fryer -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DROP DATABASE IF EXISTS deep_fryer;
CREATE DATABASE deep_fryer OWNER deep_fryer;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deep_fryer_app') THEN
    CREATE ROLE deep_fryer_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT deep_fryer_app TO deep_fryer;
SQL

# 3. Restore the database. This must exit 0; any error rolls the whole
#    restore back.
docker compose exec -T db pg_restore -U deep_fryer -d deep_fryer --exit-on-error --single-transaction \
  < "backups/db-$d.dump"

# 4. Restore the evidence into an emptied storage volume.
docker compose run --rm --no-deps -v "$PWD/backups":/backup:ro --entrypoint sh storage \
  -c "find /data -mindepth 1 -delete && tar xzf /backup/storage-$d.tgz -C /data"

# 5. Start everything. Migrate finds every migration already recorded and
#    applies only those newer than the backup.
docker compose up -d --build
```

Why the order matters:

- **The roles must exist before `pg_restore` runs.** Without them, every
  grant to `deep_fryer_app` is dropped, along with the restrictive
  `research_runs_app_insert_planned` policy and the REVOKE that keeps
  `lock_tenant_owners` from PUBLIC. The migration journal still comes back
  complete, so migrate repairs none of this, and every portrait page
  returns a 500. Creating the roles after the restore does not bring those
  objects back. The only fix is to start again from step 2.
- **The database must be one that migrate has never touched.** Restoring
  over the tables a `docker compose up` created fails on every object that
  already exists, and foreign keys reject whole tables of data. A
  `pg_restore` without `--exit-on-error --single-transaction` then exits 1
  with only an "errors ignored on restore" warning. That warning looks the
  same as a restore that only lacked roles, but this time the portraits are
  left with no data and no audit log.
- **Create the roles with step 2, not with `pg_dumpall --roles-only`.** On a
  cluster whose bootstrap superuser is not `deep_fryer`, its
  `GRANT deep_fryer_app TO deep_fryer … GRANTED BY deep_fryer` line fails.

Then check the restored site. The preflight's row-level-security check
fails on any grant, policy or function permission missing from a restore,
and `/api/health` answers 200 only when a visitor's query works:

```bash
docker compose run --rm migrate node --import tsx ../../scripts/preflight.ts
curl -fsS https://<SITE_ADDRESS>/api/health                                # {"ok":true}
curl -fsS -o /dev/null -w '%{http_code}\n' https://<SITE_ADDRESS>/<portrait>  # 200
```

Last, open a dimension page and one of its evidence snapshots (a `/files/…`
link). A 404 there means the storage archive did not restore.
