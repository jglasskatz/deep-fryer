# Local setup

## Prerequisites

- Node.js 20 (see `.nvmrc`). With `nvm`: `nvm use`.
- pnpm 9+. Install with `corepack enable && corepack prepare pnpm@9 --activate`, or `npm i -g pnpm`.

## Install

```bash
pnpm install
```

## Environment

```bash
cp .env.example .env.local
```

Fill in the values you have. None are required to boot the dev server in M0 — the
DB client only instantiates on first use, so the landing page, the `/[tenant]`
placeholder, and the `/embed/[tenant]` placeholder will all render without a
database.

Anything that talks to Postgres (real `/api/*` routes, the `create-tenant`
script, Drizzle Kit commands) will throw until `DATABASE_URL` points at a real
Postgres instance.

## Run the dev server

```bash
pnpm dev
```

Then open:

- http://localhost:3000 — landing page
- http://localhost:3000/santacruz — mock tenant page (renders mock dimensions)
- http://localhost:3000/santacruz/admin — admin placeholder
- http://localhost:3000/embed/santacruz — embed placeholder

## What does NOT work yet

- Supabase auth — no sign-in flow is wired up.
- Database — schema exists in `packages/db` but no migrations have been run.
- `pnpm create-tenant` — stub only, throws "not implemented".
- The actual `<Doughnut>` D3 component — not ported yet; the tenant page shows
  a placeholder list of mock dimensions instead of the chart.

These all land in subsequent M0 steps (see `SPEC.md` §12).

## Workspace layout

- `apps/web` — Next.js 15 app (`@deep-fryer/web`)
- `packages/core` — domain types, Zod validators, viz_level deriver (`@deep-fryer/core`)
- `packages/db` — Drizzle schema and client (`@deep-fryer/db`)
- `scripts/` — provisioning / ops CLIs

## Common commands

```bash
pnpm dev                  # next dev for apps/web
pnpm build                # build everything
pnpm typecheck            # tsc --noEmit across packages
pnpm lint                 # lint across packages
pnpm --filter @deep-fryer/db db:generate   # drizzle-kit generate
pnpm --filter @deep-fryer/db db:studio     # drizzle studio
```
