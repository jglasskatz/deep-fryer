# Measuring research strategies

The research plane verifies individual findings (SPEC.md §8). This document
covers the layer above that: measuring the *strategy* that produced them, so
two configurations can be compared on a fixed budget before committing to a
132-session run.

Implementation: `packages/research/src/measure.ts`.

## Why per-finding verification is not enough

The existing pipeline runs two gates. `deterministicChecks` validates schema,
URL resolution, recency and scale; an independent verifier subagent refetches
the cited page and judges whether it supports the claim. That is a good
per-finding instrument, but it cannot answer "is this strategy working," for
three structural reasons.

**Gaps pass verification vacuously.** A `kind: "gap"` finding short-circuits
to all-true and never reaches the verifier — correctly, since a gap has
nothing to fetch. But it means the degenerate strategy that answers every
indicator with a gap scores a perfect verification rate at zero cost and zero
value. Coverage and accuracy must be scored jointly or that strategy wins.

**Tier compliance is unauditable from inside.** The verifier's allowlist is
`['WebFetch']` by design, so it can refetch the cited page but can never
discover the tier-1 source the researcher skipped. `source_tier` is written by
the researcher and taken on trust — and it is the whole basis of the "the
city's own data" claim.

**Surface metrics do not move when a strategy degrades.** Published
evaluations of deep-research agents find link validity holding above 94% and
topical relevance above 80% while factual accuracy sits between 39% and 77%,
and report factual accuracy falling by roughly 42% as tool calls scale from 2
to 150 *while the surface metrics stay flat*. Our deterministic gates are
surface metrics. A strategy drifting toward plausible-but-wrong citations
would keep passing them.

That last finding bears directly on `DEFAULT_SESSION_MAX_TURNS = 60`.

## The scorecard

`scoreStrategy()` reduces a strategy's output to one comparable row.

| Metric | Definition |
| --- | --- |
| Coverage | non-gap findings ÷ indicators attempted |
| Verified accuracy | `content_supported === 'pass'` ÷ non-gap findings |
| **Yield** | coverage × verified accuracy |
| Fabrication rate | `content_supported === 'fail'` ÷ non-gap |
| Uncertain rate | `content_supported === 'uncertain'` ÷ non-gap |
| Tier-1 share | self-reported, audited separately |
| Cost per verified finding | (researcher + verifier tokens) ÷ passes |

**Yield is the headline.** The all-gap strategy scores 0 on coverage; the
reckless strategy scores 0 on accuracy. Neither degenerate case can win.

The deterministic gate pass rates are reported alongside but never folded into
yield — they are diagnostics, for the reason above.

Per-session cost is already attributable: the worker keys `RunTokenUsage` by
session id and files that session's verifier calls under `verifier:<id>`.
`sessionSpend()` charges both to the strategy under test.

## Instruments

All four are label-free. There is no hand-built gold set, deliberately: labels
produced with the same tools and instincts as the researchers would share
their blind spots, and measured accuracy would be optimistic by an unknown
margin. The consequence is that strategies can be **ranked against each
other** but no absolute accuracy figure is claimed.

### A. Independent replication — `replicationAgreement()`

Run k researchers on the same dimension and compare. Convergence on both the
number *and* the primary source is the signal; divergence is a difficulty flag
that doubles as review-queue triage. Reports relative spread, modal source
agreement, tier agreement, and gap-versus-value disagreement.

### B. Borough reconciliation — `reconcileBoroughs()`

The six-portrait structure yields a free internal-validity test: the five
boroughs must reconcile to the city figure. Coherence is a named criterion in
the ESS quality framework, and it is the one dimension a per-finding verifier
cannot see — it only ever looks at one claim at a time.

Every framework indicator is intensive (a rate, share, or per-capita figure);
none are summable counts. So reconciliation is always a weighted mean, never a
sum, and the denominator decides the weight:

- `population` — the default; tolerance 5%.
- `households` / `subpopulation` — the denominator is not a headcount, so
  population weighting is a proxy and the check is indicative. Tolerance 15%.
- `non-additive` — skipped entirely. A Gini coefficient over the union is not
  the mean of five Ginis; a concentration in mg/L does not population-weight;
  a planetary boundary has no borough decomposition.

`DENOMINATORS` is guarded by a test that every key exists in the framework, so
a rename fails loudly instead of silently disabling a rule.

### C. Negative controls — `scoreNegativeControls()`

Indicators where the correct answer is a gap. Without a positive gold set
these are the only direct measure of fabrication pressure: a strategy that
returns a confident value here invented it. Shipped controls are
`aragonite-saturation` and `ods-phaseout-compliance` at borough scale — ocean
chemistry has no borough decomposition, and Montreal Protocol compliance is
tracked nationally by treaty party.

Controls are scored *alongside* coverage, so the inverse degenerate strategy
cannot win either.

### D. Tier-compliance audit — `renderTierAuditPrompt()`

An auditor that does get `WebSearch`, run over a sample rather than every
finding, asking only: did a higher-tier source exist and get missed? This is
the gate the in-pipeline verifier structurally cannot provide.

## Bake-off protocol

1. Pick a slice — three dimensions is enough to rank arms.
2. Run each arm at a fixed token budget.
3. Score with `scoreStrategy()`; rank on yield, break ties on cost per
   verified finding.
4. Run instruments B–D against the winner before scaling to the full run.

Candidate axes, in the order worth testing:

- **Turn budget (15 vs 60).** Tests the depth-degrades-accuracy finding
  against our own default. The cheap arm may also be the accurate one, which
  on a 132-session run is the difference that matters.
- **Researcher model.** sonnet-5 vs opus-5, turns held constant.
- **Tier strictness.** Whether forcing tier-1 exhaustion raises quality or
  just raises the gap rate.

## Known limitations

- No absolute accuracy figure, by design (see above).
- No "relevant content" gate. The verifier confirms *the page says X*, not
  that X is the right construct — a correctly fetched number with the wrong
  denominator passes today.
- Reconciliation cannot distinguish *which* level is wrong. A divergence says
  the city figure and the boroughs disagree, not which one to fix.
- Negative controls measure fabrication pressure on indicators known to have
  no data. They say nothing about fabrication on indicators that do.
- This pipeline produces a quantitative Data Portrait only. DEAL's city
  portrait method pairs that with a participatory Community Portrait; a
  published NYC portrait should say which half it is.
