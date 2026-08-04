# NYC doughnut research — orchestrator brief

You are the orchestrating agent for the NYC doughnut-portrait workstream.
Your job: produce rigorously sourced doughnut portraits for New York City —
one whole-city doughnut plus one per borough — using this repo's research
plane as your execution substrate, fanning out research agents and reviewers
as necessary. Read `SPEC.md` first (Design Spec v2); the full v2 build
(M0–M5) is on this branch.

The audience is the mayor's office. The way this impresses is rigor and
relevance: NYC's own adopted goals as targets, NYC's own data as sources,
honest gray wedges where data doesn't exist. Never tune a threshold to make
a wedge look better.

## Phase 0 — environment (fresh container)

1. `pnpm install`
2. `service postgresql start`; as the postgres user set password `postgres`;
   `createdb deep_fryer_dev`
3. `DATABASE_URL=postgres://postgres:postgres@localhost:5432/deep_fryer_dev pnpm --filter @deep-fryer/db db:migrate`
4. `DATABASE_URL=... npx tsx scripts/provision-nyc.ts` — six tenants: `nyc`
   plus the five boroughs (county-equivalents), with NYC data-portal context
   notes already in their region config.
5. Research sessions execute on this session's own credentials via the Agent
   SDK — no API key needed. The session runner uses only each plan's tool
   allowlist (no permission bypass), and works under root.
6. Note: your own shell commands may hit interactive permission prompts —
   if progress stalls, that is usually a prompt waiting for the user.

## Phase 1 — NYC goals & data-sources research (no confirmation needed)

Fan out research agents (parallel subagents) to establish, with citations:

- **Adopted climate/environment goals**: OneNYC / PlaNYC targets, Local Law
  97 building-emissions limits, 80x50 / carbon-neutrality commitments, DEP
  water goals, solid-waste/zero-waste goals.
- **The current administration's affordability agenda** (Mayor Mamdani):
  housing/rent, transit, childcare, food access — as published in official
  documents, not press coverage.
- **The city's own instruments**: NYC Open Data, DOHMH Community Health
  Profiles, DCP Population FactFinder, MOCEJ GHG inventories, DEP water
  quality, HPD/HVS + NYCHA housing data, and strong tier-3 institutions
  (NYU Furman Center, Citizens Budget Commission, Regional Plan Association).

Synthesize into a **proposed portrait config** per tenant:

- `threshold_overrides` keyed by threshold_ref, each with a one-line
  rationale citing the adopted NYC goal (rationales render on the public
  methodology page);
- source-priority tier pins (specific portals/institutions per tier);
- per-dimension recency/scale exceptions where NYC publication cadence
  warrants (e.g. GHG inventory lag, HVS cycle);
- custom indicators that better express the administration's priorities
  (with units and proposed targets + rationales).

Have an independent reviewer agent check the proposal for: fabricated or
misattributed targets, rationales that don't cite an adopted source, and
overrides that soften rather than reflect the city's goals.

## Phase 2 — user review gate (hard stop)

Present the proposed config compactly as a diff against the framework
defaults (`packages/contract/framework/thresholds.json`). WAIT for the
user's explicit confirmation. They may adjust scope — whole-city pilot
first (22 sessions) vs all six portraits (132 sessions).

## Phase 3 — launch, supervise, persist (only after confirmation)

1. Apply the confirmed config to `tenant_config` (validated writes — see
   `updateConfig` in `apps/web/lib/actions.ts` or write via drizzle with
   `tenantConfigSchemas` validation).
2. Plan runs (`createPlannedRun` / POST `/api/research/plan`); inspect
   session counts and spot-check rendered prompts.
3. Execute with the worker (`pnpm --filter @deep-fryer/worker start`,
   `WORKER_CONCURRENCY` 2–4). The research plane fans out one session per
   dimension plus an independent verifier per finding.
4. Supervise as an orchestrator: watch run/session status in the DB, triage
   failures, re-plan targeted re-research with reviewer notes where findings
   are weak, and fan out additional reviewer agents to audit samples of
   findings against their sources.
5. Persist before the container dies: `pg_dump` the database, collect
   `apps/web/public/evidence/`, run `scripts/export-static.ts`, and push all
   of it to a new branch `nyc-research` on this repo.
6. Report to the user: findings counts, verification verdicts, gaps, and
   where to review (`/{slug}/admin/review`).
