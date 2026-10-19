# Local setup

## Prerequisites

- Node.js 20+ (see `.nvmrc`) and pnpm 9 (`corepack enable`).
- Postgres 15+ for anything beyond the bundled demo portrait — a local
  install, or `docker compose up -d db` (add `storage storage-init` for
  S3-compatible evidence storage on 127.0.0.1:8333).

## Install and configure

```bash
pnpm install
cp .env.example apps/web/.env.local
```

Next.js reads `.env.local` from the web app's own folder. The worker and the
scripts read only their shell environment, so export what they need there
(or pass it inline, as below). The file's first half is the local
configuration; its second half is what a deployment sets (docs/deploy.md).

Everything degrades gracefully in development:

- **No env** — the web app serves the bundled demo portrait at `/santacruz`.
- **`DATABASE_URL` only** — the full product in **dev mode**: every request
  acts as owner (and as staff), evidence lands in `apps/web/public/evidence/`,
  billing shows contract-only.
- **+ `AUTH_SECRET`** — real accounts. With no SMTP configured, email sign-in
  links print to the server log, so you can sign in as any address locally.
  Add Google / Microsoft credentials to test OAuth.
- **+ `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`** (test mode) — online
  billing; forward webhooks with `stripe listen --forward-to localhost:3000/api/billing/webhook`.
- **+ `ANTHROPIC_API_KEY`** (the worker's environment) **and
  `DF_RESEARCH_KEY_CONFIGURED=true`** (the web app's) — research the plan
  pays for can run. The web app never sees the key, only this flag, which
  docker compose derives from the key; without it the web app refuses
  plan-funded research before anything starts. Building always needs a plan
  or contract — there are no trials — so seed one (below).

Production (including a local `next start`) refuses to start without auth,
a sign-in method and `SUPPORT_EMAIL` (`packages/core/src/deploy-env.ts`).

## Database

```bash
createdb deep_fryer_dev
DATABASE_URL=postgres://localhost/deep_fryer_dev pnpm --filter @deep-fryer/db migrate
```

`migrate` uses drizzle-orm's runtime migrator (the same journal as
`drizzle-kit migrate`). Migrations include RLS policies, immutability
triggers, and the billing/accounts schema.

## Seed

```bash
# An organization + portrait owned by you, on a one-year staff contract
# (sign in with that email; omit --plan to try the buy-a-plan flow instead):
pnpm create-tenant --slug demo --name "Demo City" --owner you@example.org --plan city

# The NYC family: organization `nyc`, six portraits, Metro contract:
pnpm provision:nyc --owner you@example.org --plan metro
tsx scripts/nyc-portrait-config.ts --apply

# Synthetic history for exercising progress/compare views (local DBs only,
# every value labeled SYNTHETIC, every portrait marked as sample data so its
# pages say "Sample data — not research"; never promote such a database):
tsx scripts/seed-demo-data.ts --org nyc

# The real Santa Cruz portrait with evidence, from a doughnut-santa-cruz clone:
pnpm import-santa-cruz --from /path/to/doughnut-santa-cruz
```

## Run

```bash
pnpm dev                                   # web on :3000
pnpm --filter @deep-fryer/worker dev       # research worker (optional)
```

Useful pages: `/nyc` (portrait), `/nyc/progress`, `/o/nyc` (organization),
`/o/nyc/compare`, `/o/nyc/insights`, `/o/nyc/progress`, `/o/nyc/billing`,
`/nyc/admin` (overview + getting-started checklist), `/nyc/admin/members`,
`/start` (a 404 with `DF_DISABLED_FEATURES=self_serve`), `/pricing`,
`/account`, `/api/v1/portraits/nyc/progress.csv`. A portrait is public only
once it has published; before that only its members and staff see it.

The service worker registers only in production builds (`pnpm --filter
@deep-fryer/web build && pnpm --filter @deep-fryer/web start`).

## Checks

```bash
pnpm typecheck
DATABASE_URL=… pnpm test     # unit tests + Postgres integration tests
pnpm --filter @deep-fryer/web build
npx keel verify --diff origin/main..HEAD
```
