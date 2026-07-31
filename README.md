# deep-fryer

A multi-tenant SaaS for building and hosting Doughnut Economics portraits for municipalities — a civic engagement and governance tool. AI does the research labor backstage and never appears in the public experience: residents see a doughnut, evidence, actions, and a discussion.

Status: **v2 build** — see [`SPEC.md`](./SPEC.md) for the full design. Milestones M0–M5 are implemented; deployment provisioning (Supabase project, Vercel, worker host) is what remains to go live.

## What's a doughnut portrait?

A visual framework from Kate Raworth's *Doughnut Economics* showing two concentric rings:

- **Social Foundation** (inner ring) — 12 dimensions of human wellbeing nobody should fall below
- **Ecological Ceiling** (outer ring) — 9 planetary boundaries humanity shouldn't overshoot

The "doughnut" between them is the safe and just space for humanity. Cities use it as a planning lens.

## The three planes (SPEC §3)

- **Public plane** — the doughnut at `/{tenant}`, per-dimension drilldowns with evidence snapshots beside each claim, action items, a per-dimension discussion board, an auto-generated methodology page, and an embeddable widget. No AI chrome anywhere.
- **Review plane** — the product surface at `/{tenant}/admin`: a review queue of research findings with worked scoring math, verification badges, and evidence; approve / edit / re-research / flag-gap; draft/publish versioning with a full timeline; §6 config as settings forms; audit log.
- **Research plane** — a worker service executing the vendored open-doughnut plugin via the Claude Agent SDK: plan (render every session prompt, token-free) → apply (region-context session, then one session per dimension) → verify (deterministic checks + an independent verifier that re-fetches every source). Findings are immutable; failures are red-flagged, never dropped; data gaps are first-class findings.

## Workspace layout

- `apps/web` — Next.js 15 app: public + review planes, research plan/apply API
- `apps/worker` — research-plane worker (graphile-worker + Claude Agent SDK + Playwright evidence capture)
- `packages/contract` — the shared contract (framework, thresholds with rationales, JSON Schemas); vendored form of `open-doughnut/framework` + `plugin/schemas`, extracted at M2
- `packages/core` — domain types, validators, thresholds engine (`level_pct` with worked math), `viz_level` deriver
- `packages/db` — Drizzle schema, SQL migrations (including RLS + immutability enforcement), provisioning
- `packages/research` — plan rendering from plugin templates + portrait config, deterministic verification, queue
- `vendor/open-doughnut` — the vendored Claude Code plugin (agents, skills, commands): the identical artifact the OSS community runs
- `scripts/` — `create-tenant`, `import-santa-cruz` (migrates the SC portrait with its evidence)

## Getting started

See [`docs/local-setup.md`](./docs/local-setup.md). Short version:

```bash
pnpm install
# Postgres: createdb deep_fryer_dev, then
DATABASE_URL=... pnpm --filter @deep-fryer/db db:migrate
DATABASE_URL=... pnpm create-tenant --slug demo --name "Demo City" --owner you@example.com
DATABASE_URL=... pnpm import-santa-cruz --from ../doughnut-santa-cruz   # real portrait + evidence
DATABASE_URL=... pnpm dev                                               # web on :3000
DATABASE_URL=... pnpm --filter @deep-fryer/worker dev                   # research worker
```

Without `DATABASE_URL` the public app serves a bundled demo portrait; without Supabase env the admin surface runs in labeled dev mode. Research sessions additionally need `ANTHROPIC_API_KEY`.

## Origins

deep-fryer is the third generation in a small family of doughnut projects:

1. [`doughnut-santa-cruz`](https://github.com/jglasskatz/doughnut-santa-cruz) — static prototype for the City of Santa Cruz; source of the canonical canvas doughnut, the evidence pattern, and (at M2) the restructured OSS artifact `open-doughnut`.
2. [`ca-doughnut`](https://github.com/jglasskatz/ca-doughnut) — single-tenant React + FastAPI build for California state data (archived; its static-export and versioning ideas live on here).
3. **deep-fryer** — generalized, multi-tenant, sellable; the hosted product and the community plugin run the identical research workflow by construction.
