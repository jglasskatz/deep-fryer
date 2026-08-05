# Research-strategy measurement — findings (2026-08-05)

What the measurement harness (docs/measurement.md) surfaced during the NYC
campaign's calibration and first production runs, and what changed as a
result. Comparison arms: **sonnet-throughout** vs **opus-orchestrated**
(Opus synthesizer dispatching Sonnet source-scouts), with the adversarial
verifier pinned to Opus for both.

## Workflow defects found by measurement (all fixed, in order found)

1. **Schema must travel in the prompt.** The researcher prompt referenced
   `finding.schema.json` by name; sessions have no filesystem access, so the
   model invented field names and 100% of findings failed the schema gate
   despite substantively excellent research (correct tier-1 source, evidence
   captured, honest caveats). After inlining the schema: 100% schema-pass
   across every subsequent session. *Lesson: a named contract the agent
   cannot read is not a contract.* This dominated everything else measured —
   prompt-artifact alignment beats model choice.

2. **The SDK throws; retries must catch.** Transport failures ("Connection
   closed mid-response") and turn-cap exhaustion surface as thrown errors,
   not unsuccessful results. The first retry implementation only handled
   returned failures, so it never fired for the errors it was built for;
   three 22-session runs died from single-session throws. Sessions now
   retry once on throw and a double failure records that one session as
   failed while the run continues.

3. **The verifier must know the claim's geography.** A Bronx 20.2% claim was
   failed as "contradicted" by a document whose *citywide* figure is 14.6% —
   the same document states the Bronx figure verbatim. The verifier template
   promised judgment "at the claimed geography" but was never told one. At
   six-portrait scale this is a systematic false-negative generator; fixed by
   passing region + scale into the verifier prompt.

4. **A crashed worker must not strand runs.** Pre-existing: a mid-run crash
   left runs in `running` forever (redelivered job saw the guard and
   completed successfully). Claim is now the atomic planned→running UPDATE;
   crash redeliveries settle the run as failed.

## Scorecard — sonnet arm (2 replicates × 5 Bronx dimensions, opus verifier)

| Metric | Value |
|---|---|
| Coverage | 67% (8 values, 4 gaps / 12 indicators) |
| Verified accuracy | 50% |
| **Yield** | **0.33** |
| Deterministic gates | 100% schema/url/recency/scale |
| Tier-1 share | 87.5% |
| Negative controls | 3 of 4 correct gaps; 1 fabrication (ODS "99%") caught |
| Replication | Perfect value+source convergence on rent burden (61.2), food insecurity (20.2), PM2.5 (6.51); 2 contested indicators routed to review |
| Cost per verified finding | ~44k tokens |

Production campaign (NYC citywide, 21 dimensions, same arm): verified
accuracy ≈71% — higher than calibration because the Opus verifier proved
willing to route around nyc.gov 403s via text-extraction proxies, and the
geography fix eliminated the false-negative class.

Verifier quality note: the Opus verifier's best catch was precision, not
rejection — the TCOL 62% claim confirmed on value and geography but failed
on year attribution (researcher wrote 2024; the inaugural report is
explicitly 2022 data). That is exactly the review card a human should see.

## Final comparison — sonnet vs opus-orchestrated (same slice, same opus judge)

| Metric | sonnet | opus-orchestrated |
|---|---|---|
| Coverage | 0.67 | 0.67 |
| Verified accuracy | 0.50 | **0.88** |
| **Yield** | 0.33 | **0.58** |
| Verifier-failed values | 2 (incl. one true fabrication) | **0** |
| Tier-1 share (self-reported) | 0.88 | 0.38 |
| Tokens per verified finding | 43.7k | 32.0k |
| Replication | 3 exact value+source convergences; 2 contested | identical convergence; 1 contested |

Reading the numbers honestly:

- **Opus orchestration nearly doubles yield**, entirely via verified accuracy.
  Its standout behavior: where Sonnet declared a gap (borough aragonite
  saturation), both Opus replicates independently found the same
  peer-reviewed Long Island Sound measurement (Ω = 1.09), labeled it
  `regional` — a scale the config accepts for that dimension — and passed
  verification. Deeper source discovery, honestly labeled.
- **The negative-control "fabrications" in the opus arm are miscalibrated
  controls, not fabrications**: the control counts any value as invented,
  but a sourced, verified, regional-scale value is exactly what the scale
  policy permits. Fix: controls must exempt findings whose
  `geographic_scale` is an accepted non-borough scale with a real source.
  (The sonnet arm's ODS "99%" remains a true fabrication — unsourced, failed.)
- **Tokens ≠ dollars.** Token cost-per-verified favors the opus arm (32k vs
  44k) but Opus tokens price ~5× Sonnet, so the opus arm is roughly 3-4×
  more expensive per verified finding in dollar terms.
- **Lower tier-1 share** in the opus arm reflects its willingness to go to
  tier-3 science when tier-1 has nothing — correct behavior under the
  tiers-exhausted-in-order rule, but audit the tier trail on a sample.

**Recommendation — tiered strategy:**
1. **Bulk/annual refresh: Sonnet researchers + Opus adversarial verifier.**
   Cheapest; values that pass are right (production campaign hit ~71%
   verified accuracy); gaps are honest; the review queue catches the rest.
2. **Hard dimensions, contested indicators, and re-research: Opus
   orchestrating Sonnet scouts.** Its 88% verified accuracy and
   source-discovery depth is worth the premium precisely where Sonnet
   returns gaps or flags.
3. **Verifier: always Opus** — the constant, maximally-skeptical judge.
4. Session parallelism (RESEARCH_SESSION_CONCURRENCY) is a pure win at
   either tier — cross-session parallelism has no accuracy cost; only
   within-session turn count does.

## Open improvements, ranked

1. **Verify against captured evidence, not a refetch.** The largest
   remaining accuracy suppressor is `uncertain` verdicts on 403-blocked
   tier-1 sources the researcher already snapshotted. The verifier should
   receive the evidence snapshot (image/PDF) as its primary exhibit, with
   refetch as corroboration. Eliminates the tier-1 paradox (the city's own
   documents being the hardest to verify).
2. **Turn-cap policy.** One session (bronx health) exhausted 60 turns; the
   retry recovered it. Before raising DEFAULT_SESSION_MAX_TURNS, remember
   the published finding the measurement doc cites: factual accuracy fell
   ~42% as tool calls scaled while surface metrics stayed flat. Prefer
   splitting dense dimensions (many indicators) into two sessions over
   raising the cap.
3. **Tier audit.** `source_tier` is still self-reported (87.5% tier-1
   claimed). Run `renderTierAuditPrompt` over a sample per tenant before
   publish.
4. **Reconciliation.** Run `reconcileBoroughs()` across the six portraits
   once all borough runs land — the coherence check no per-finding verifier
   can perform.
