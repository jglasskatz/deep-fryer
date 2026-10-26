# Cross-slice policy evaluation — research draft

## What runs

- Static atlas: `site/policy-view/`. Ten curated historical cases, 47 directional pathways, name/topic/exact-source-URL lookup, a guided proposed-policy analogy, JSON export.
- Typed reusable functions: `packages/core/src/policy-impact-graph.ts`: `lookupPolicyImpactGraphs`, `summarizePolicySlice`, `policyRadialDirection`, `evaluatePolicyImpact`, `gatePolicyGraphEvidence`, input/output schemas.
- Existing staff action accepts `evaluationContext`; authentication, feature flag, plan standing, quota, provider funding and transactional enqueue are unchanged. Scoped requests require a graph matching the exact mode, geography, date cutoff, horizon and comparator; a missing graph or changed scope fails closed. Legacy unscoped request compatibility is retained. The existing worker requests graph output through its existing read-only WebSearch/WebFetch session. No new credential or funding route.
- `apps/worker/src/policy-evidence.ts` binds real WebFetch tool calls to successful results in the existing gzipped JSONL transcript. Matching URL + exact normalized excerpt (at least 20 characters) + nonblank locator is a necessary source gate. Search-only mentions, invented URLs, failed fetches, unpaired results and model-proclaimed verification do not pass.
- Unmatched claims become unknown/inferred, lose numeric magnitude, and retain the original model direction/type in a clearly unverified field. Graph-backed output suppresses legacy impacts/projections so an unverified second channel cannot bypass the gate. Existing legacy results remain compatible.
- `evaluatePolicyImpact` without an injected provider returns `requires_configuration`. A bare provider result has no trusted retrieval receipts; its claims are conservatively gated. The deployed **static private preview has no agent/backend**, fetches no pasted URLs, and makes no paid calls.

## Epistemic and geometry contract

Directions: `towardSafeJust`, `away`, `mixed`, `unknown`, `noDemonstratedChange`. A null test is not proof of zero; lack of evidence is unknown. Mixed can mean opposed mechanisms, uneven incidence or conflicting studies, made explicit in the edge text.

Social improvement points **outward from deprivation**; ecological improvement points **inward from overshoot**. The safe-and-just band lies between these boundaries, not in the central hole. Wedge area and arrow length are fixed, never effect size. A direction concerns a named outcome/proxy and comparator, not demonstrated attainment of an entire slice.

Every edge carries direct/indirect link, evidence type (observed, quasi-experimental, modeled, inferred), outcome, mechanism, native magnitude or null, uncertainty, geography, horizon, affected groups, comparator, sources, assumptions, validation and a shared `pathId`. Costs and distribution are explicit at graph level. There is no additive score. Repeated income/energy views of one bill saving and food/education links along one pathway must not be summed.

All curated records are **AI-curated/source-checked research drafts**, `reviewer_type=AI`, `human_approved=false`. The user liking the atlas did not approve each claim. The prior evidence audit covers headline sources, not a complete independent replication or archive. New downstream pathways are explicitly labeled inference or unknown where no outcome study exists.

Host retrieval receipts hash the tool-extracted content, **not original source bytes**. Matching an excerpt does not verify its entailment, source quality, study design, locator accuracy, external validity or causal identification. The worker and UI say “retrieved, not independently verified”; no automatic human-publication approval is created. A further independent content/design review remains necessary.

## Reproduction

```sh
python scripts/build-policy-impact-graph.py
pnpm pages:test
pnpm pages:build
pnpm pages:check # includes offline Playwright policy-atlas controls/arrows/mobile/export checks
pnpm --filter @deep-fryer/core test
pnpm --filter @deep-fryer/worker exec vitest run src/policy-evidence.test.ts src/tasks/policy-analyze.test.ts
pnpm --filter @deep-fryer/web exec vitest run lib/policy.test.ts lib/policy-actions.test.ts lib/feature-guards.test.ts
pnpm typecheck
pnpm exec keel map --check
```

Graph regeneration reads the original atlas policy records and preserves their source links. The browser runtime and typed summary/lookup functions are parity-tested. Scenario transfer removes all original magnitudes and marks every edge inferred; a historical null becomes unknown in a new context. Geography/horizon/affected groups/comparator and the user's transfer assumption are carried into export. The selected analog is not automatically causally transferable. Dates before the collection's review cutoff are refused; later dates do not pretend newer research has been fetched.

## Paper-use example and evaluation design

Universal school meals illustrate one policy linked to food participation and education outcomes on the same causal pathway, a tested weight-outcome null, mixed distribution and an unknown food-system climate footprint. Youth Cruz Free illustrates why weak attendance variation is unknown rather than a zero effect. Community-choice energy illustrates an adverse accounting comparator alongside a modeled tariff benefit, not a causal verdict on CCA. These are a purposive case set, not a systematic review or city ranking.

For a policy-specific forecast, specify a stable exposed cohort, baseline and no-policy counterfactual; test mechanisms and transportability; identify a credible comparison and assumptions; report native-unit uncertainty; measure adverse and distributional outcomes; account for rebound, leakage and lifecycle effects; and keep resource costs separate from transfers. Do not convert the graph into a welfare total or normative threshold claim without a justified external model and explicit choices.

## Validation boundary (26 October 2026)

Focused graph/core tests: 21 passed. Static/browser-logic tests: 5 passed; complete Pages contract suite: 23 passed. Focused worker tests: 12 passed, 11 database-dependent skipped. Focused web/theme tests: 38 passed, 1 database-dependent skipped; a separate action suite skipped 7 database-dependent cases. Core/web/worker TypeScript checks passed. No live model/API session, database integration or paid test was run.

Browser layout/keyboard checks are not claimed: local browser transport was unavailable and the deployed private Site correctly required sign-in in the cloud browser. Native Sites publication succeeded for the existing owner-private identity. Original baseline Keel aggregate failure was separately reproduced as existing worker timeout(s); see the original atlas QA report. The first extension aggregate also caught a new dark-theme literal and a missing broad web-app architecture update; both were fixed, with the dark-theme suite passing 15/15. Worker org-key timeout cases also appeared under aggregate load and have not been causally attributed. Final local Keel aggregate exited 2: architecture and principles passed; the only failing tests were the pre-existing worker alerts_sync scheduling and sessionConcurrency 5-second timeouts (129 worker tests passed, 51 skipped). Semantic/spec review remains pending; no paid check was run. The new offline browser smoke is wired into CI pages:check, with screenshots retained under test-results/policy-evaluator. Local execution could not start because Chromium is not installed in this checkout; CI installs Chromium explicitly. CI/visual results remain pending. Local Node is 24.22.1, while CI uses Node 20.

Initial GitHub branch creation was denied with `403 Resource not accessible by integration`. After the user updated connector permissions, the same bounded branch creation succeeded for `codex/policy-impact-evaluator-2026-10-26` from baseline `d189a966649ffb4c876879a9bcd27f88b51f7809`. No alternate credential route was used. Nothing was merged or deployed to public production.
