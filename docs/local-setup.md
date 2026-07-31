# Local setup

## Prerequisites

- Node.js 20+ (see `.nvmrc`). With `nvm`: `nvm use`.
- pnpm 9+. Install with `corepack enable && corepack prepare pnpm@9 --activate`, or `npm i -g pnpm`.
- Postgres 15+ for anything beyond the demo portrait (a plain local Postgres works; Supabase is only needed for real auth/storage).

## Install

```bash
pnpm install
```

## Environment

```bash
cp .env.example .env.local
```

Everything degrades gracefully:

- **No env at all** — the web app boots and serves the bundled demo portrait at `/santacruz`. Admin routes redirect (they need a database).
- **`DATABASE_URL` only** — full local product: provisioning, imports, admin, review queue, discussion. Auth runs in labeled **dev mode** (every request acts as owner) because Supabase isn't configured; evidence files land in `apps/web/public/evidence/<tenant>/`.
- **+ Supabase env** — real Google OAuth, RLS-governed access, storage buckets.
- **+ `ANTHROPIC_API_KEY`** — the research worker can actually run sessions.

## Database

```bash
createdb deep_fryer_dev
DATABASE_URL=postgres://localhost/deep_fryer_dev pnpm --filter @deep-fryer/db db:migrate
```

The migrations include the RLS policies and immutability triggers (SPEC §7/§11); they apply cleanly to plain Postgres (an `auth.uid()` shim is created only when Supabase's isn't present).

## Seed a tenant

```bash
# Framework-provisioned empty tenant (21 dimensions, config defaults, draft versions):
DATABASE_URL=... pnpm create-tenant --slug demo --name "Demo City" --owner you@example.com

# Or the real Santa Cruz portrait with its evidence, from a doughnut-santa-cruz clone:
DATABASE_URL=... pnpm import-santa-cruz --from /path/to/doughnut-santa-cruz
```

## Run

```bash
DATABASE_URL=... pnpm dev                                # web app on :3000
DATABASE_URL=... pnpm --filter @deep-fryer/worker dev    # research worker (optional)
```

Then open:

- http://localhost:3000/santacruz — the public doughnut (canvas renderer)
- http://localhost:3000/santacruz/dim/climate-change — drilldown: evidence, actions, discussion
- http://localhost:3000/santacruz/methodology — auto-generated from config
- http://localhost:3000/santacruz/admin — overview, staleness, audit
- http://localhost:3000/santacruz/admin/research — plan/apply research runs
- http://localhost:3000/santacruz/admin/review — the review queue
- http://localhost:3000/santacruz/admin/settings — §6 config forms
- http://localhost:3000/embed/santacruz — the embed view (`public/embed.js` is the loader)

## Workspace layout

- `apps/web` — Next.js 15 app (`@deep-fryer/web`)
- `apps/worker` — research worker (`@deep-fryer/worker`)
- `packages/contract` — framework + thresholds + JSON Schemas (`@deep-fryer/contract`)
- `packages/core` — domain types, validators, thresholds engine (`@deep-fryer/core`)
- `packages/db` — Drizzle schema, migrations, provisioning (`@deep-fryer/db`)
- `packages/research` — plan rendering + verification + queue (`@deep-fryer/research`)
- `vendor/open-doughnut` — the vendored research plugin
- `scripts/` — provisioning / import CLIs

## Common commands

```bash
pnpm dev                  # next dev for apps/web
pnpm build                # build everything
pnpm typecheck            # tsc --noEmit across packages
pnpm test                 # vitest suites (core scoring engine, research plan/verify)
pnpm lint                 # lint across packages
pnpm --filter @deep-fryer/db db:generate   # drizzle-kit generate
pnpm --filter @deep-fryer/db db:studio     # drizzle studio
```
