# deep-fryer

A multi-tenant SaaS for building and hosting Doughnut Economics portraits for municipalities — a civic engagement and governance tool. AI does the research labor backstage and never appears in the public experience: residents see a doughnut, evidence, actions, and a discussion.

Status: **v4 — shippable product.** [`SPEC.md`](./SPEC.md) (v2) is the base design, amended by [`docs/SPEC-v3.md`](./docs/SPEC-v3.md) and [`docs/SPEC-v4.md`](./docs/SPEC-v4.md): accounts (Auth.js: Microsoft 365, Google, email links), organizations that own portrait families, billing that fits how governments buy (hard research quotas, card or annual invoice with PO, contracts), progress monitoring against adopted goals with open-data exports, and an installable PWA. Fully self-hosted — see [`docs/deploy.md`](./docs/deploy.md).

## What's a doughnut portrait?

A visual framework from Kate Raworth's *Doughnut Economics* showing two concentric rings:

- **Social Foundation** (inner ring) — 12 dimensions of human wellbeing nobody should fall below
- **Ecological Ceiling** (outer ring) — 9 planetary boundaries humanity shouldn't overshoot

The "doughnut" between them is the safe and just space for humanity. Cities use it as a planning lens.

## The three planes (SPEC §3)

- **Public plane** — the doughnut at `/{tenant}`, per-dimension drilldowns with evidence snapshots beside each claim, action items, a per-dimension discussion board, progress against adopted goals (`/{tenant}/progress`), an auto-generated methodology page, CSV/JSON open data, and an embeddable widget. Families of portraits (NYC: the city + five boroughs) get compare, insights, and progress views at `/o/{org}`. Installable and readable offline. Served in English plus the ten NYC Local Law 30 languages (`/es/nyc`, `/zh-hant/nyc`, right-to-left Arabic and Urdu — see docs/language-access.md). No AI chrome anywhere.
- **Review plane** — the product surface at `/{tenant}/admin`: a review queue of research findings with worked scoring math, verification badges, and evidence; approve / edit / re-research / flag-gap; draft/publish versioning with a full timeline; §6 config as settings forms; audit log.
- **Research plane** — a worker service executing the vendored open-doughnut plugin via the Claude Agent SDK: plan (render every session prompt, token-free) → apply (region-context session, then one session per dimension) → verify (deterministic checks + an independent verifier that re-fetches every source). Findings are immutable; failures are red-flagged, never dropped; data gaps are first-class findings.

## Workspace layout

- `apps/web` — Next.js 15 app: public + review planes, research plan/apply API
- `apps/worker` — research-plane worker (graphile-worker + Claude Agent SDK + Playwright evidence capture)
- `packages/contract` — the shared contract (framework, thresholds with rationales, JSON Schemas); vendored form of `open-doughnut/framework` + `plugin/schemas`, extracted at M2
- `packages/core` — domain types, validators, thresholds engine (`level_pct` with worked math), `viz_level` deriver, plan catalog + entitlement rules, progress engine
- `packages/db` — Drizzle schema, SQL migrations (RLS, immutability triggers, accounts, organizations, billing), provisioning, runtime migrator
- `packages/research` — plan rendering from plugin templates + portrait config, deterministic verification, queue
- `vendor/open-doughnut` — the vendored Claude Code plugin (agents, skills, commands): the identical artifact the OSS community runs
- `scripts/` — `create-tenant`, `provision-nyc`, `stripe-setup`, `import-santa-cruz` (migrates the SC portrait with its evidence), research gates and exports
- `deploy/`, `docker-compose.yml` — the self-hosted stack (Postgres, SeaweedFS object storage, migrate, web, worker, Caddy)

## Getting started

See [`docs/local-setup.md`](./docs/local-setup.md). Short version:

```bash
pnpm install
# Postgres: createdb deep_fryer_dev, then
DATABASE_URL=... pnpm --filter @deep-fryer/db migrate
DATABASE_URL=... pnpm create-tenant --slug demo --name "Demo City" --owner you@example.com --plan city
DATABASE_URL=... pnpm provision:nyc --plan metro                        # the NYC family
DATABASE_URL=... pnpm dev                                               # web on :3000
DATABASE_URL=... pnpm --filter @deep-fryer/worker dev                   # research worker
```

Without `DATABASE_URL` the public app serves a bundled demo portrait; without `AUTH_SECRET` the app runs in labeled dev mode (never in production — it refuses to start). Research sessions additionally need `ANTHROPIC_API_KEY` for the worker and `DF_RESEARCH_KEY_CONFIGURED=true` for the web app (docker compose derives it from the key), and an organization with a plan or contract: viewing is free, building is paid, and there are no trials. Production refuses to start without `SUPPORT_EMAIL`; [`docs/deploy.md`](./docs/deploy.md) covers a deployment end to end, including what to check before a public launch.

## Origins

deep-fryer is the third generation in a small family of doughnut projects:

1. [`doughnut-santa-cruz`](https://github.com/jglasskatz/doughnut-santa-cruz) — static prototype for the City of Santa Cruz; source of the canonical canvas doughnut, the evidence pattern, and (at M2) the restructured OSS artifact `open-doughnut`.
2. [`ca-doughnut`](https://github.com/jglasskatz/ca-doughnut) — single-tenant React + FastAPI build for California state data (archived; its static-export and versioning ideas live on here).
3. **deep-fryer** — generalized, multi-tenant, sellable; the hosted product and the community plugin run the identical research workflow by construction.
