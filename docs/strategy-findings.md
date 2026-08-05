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

**Opus-orchestrated arm: pending** (runs planned, execute after the borough
campaign drains the queue). Judgment deferred until its scorecard exists.

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
