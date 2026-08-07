# @keel_flow/pack-research

Keel principles for trustworthy agent research: how research work is
orchestrated, sourced, claimed, verified, and approved. Synthesized from
published evidence on AI research agents and from the human disciplines that
already solved these problems (newsroom fact-checking, systematic review,
audit sampling, records regulation).

The prose principles are ambient — keel injects them into agent prompts via
the principle digest. `approval-binds-to-content` also ships a deterministic
`keel verify` check. Run-level enforcement against a research run's actual
findings (pass-rates, tier distribution, review completeness, hash-bound
approval) belongs to the consuming system's research-verify gate — deep-fryer
implements it as `scripts/research-verify.ts`.

## The principles and their evidence

**Orchestration**

- `research-budget-declared` *(warning)* — declare complexity tier and
  agent/tool budgets before searching. Anthropic's multi-agent research
  system found unbudgeted orchestrators spawn excessive subagents, and token
  spend explains ~80% of performance variance.
- `delegation-carries-contract` *(warning)* — objective, output format, tool
  guidance, boundaries on every delegation; the documented fix for
  duplicated work and coverage gaps.
- `single-synthesizer` *(critical)* — parallel agents gather; one agent
  writes. Reconciles Anthropic's fan-out gains with Cognition's finding that
  split decision-making produces conflicting conclusions.

**Sourcing**

- `source-tiers-exhausted-in-order` *(critical)* — ordered source tiers are
  binding; record the tier that satisfied each finding (ICD 203 source
  discipline).
- `lateral-reading-gate` *(warning)* — investigate the source before
  trusting it; lateral readers beat credentialed close-readers at source
  judgment (Wineburg & McGrew; SIFT).
- `primary-source-for-statistics` *(critical)* — cite the data table, not
  the press release (Full Fact methodology).
- `provenance-independent-triangulation` *(warning)* — two sources sharing
  one upstream are one source (circular reporting / citogenesis).
- `search-trail-reproducible` *(warning)* — PRISMA-S-style logged queries
  and include/exclude decisions make research auditable and re-runnable.

**Claims**

- `atomic-claims-independently-verified` *(critical)* — claim-level checking
  (FActScore/SAFE) is automatable and near-human-reliable.
- `citations-are-load-bearing` *(warning)* — citation volume correlates
  inversely with accuracy; bound search depth ("Cited but Not Verified").
- `numbers-carry-epistemic-type` *(critical)* — measured vs estimate vs
  projection vs goal, with unit and as-of date.
- `evidence-archived-at-access` *(critical)* — snapshot at retrieval; link
  rot makes unarchived research unverifiable (Perma studies).

**Verification**

- `verifier-independent-and-grounded` *(critical)* — the strongest converged
  finding across every literature surveyed: verification is a separate,
  tool-grounded pass by an agent that did not produce the work. Same-model
  self-verification couples errors (57x); draft-only self-review degrades
  accuracy (Huang et al.); factored verification that hides the draft from
  the verifier works (Chain-of-Verification).
- `verification-staged-cheap-first` *(warning)* — deterministic → heuristic
  → model → human; humans never review mechanically detectable failures.

**Honesty & the review gate**

- `gaps-outrank-guesses` *(critical)* — abstention must outscore a wrong
  value or the system learns to paper over gaps (Kalai et al., "Why Language
  Models Hallucinate").
- `review-disposes-each-flag` *(critical)* — every flag individually
  dispositioned plus a random sample of auto-passed items (ISA 530); no bulk
  approve over open flags.
- `approval-binds-to-content` *(critical, checked)* — approval carries a
  content hash; changed findings void it (GitHub stale-approval semantics;
  21 CFR Part 11 signature binding).

## Field-verified additions (2026-08)

Four principles were added from measured incidents in this repo's own NYC
campaign rather than external literature — each is traceable to a specific
measured failure and its fix in `docs/strategy-findings.md`:

- **contract-travels-in-context** — schema referenced by name: 0% gate
  conformance; schema inlined: 100%. Largest single quality lever measured.
- **verifier-receives-claim-frame** — geography-blind verification rejected a
  correct borough claim against the same document's citywide figure.
- **verified-discoveries-seed-reruns** — audit-corrections-as-notes resolved
  all four rejected findings in one rerun pass.
- **verify-against-the-archived-exhibit** — refetch-only verification marked
  bot-blocked tier-1 sources 'uncertain' that auditors reading the captured
  snapshots adjudicated decisively.

## Key sources

Anthropic, "How we built our multi-agent research system" ·
Cognition, "Don't Build Multi-Agents" · Dhuliawala et al., Chain-of-Verification
(arXiv 2309.11495) · Huang et al. (arXiv 2310.01798) · Gou et al., CRITIC
(arXiv 2305.11738) · Min et al., FActScore (arXiv 2305.14251) · Wei et al.,
SAFE/LongFact (arXiv 2403.18802) · "Cited but Not Verified" (arXiv 2605.06635) ·
DeepTRACE (arXiv 2509.04499) · Tow Center/CJR AI citation study · Kalai et al.
(arXiv 2509.04664) · Wineburg & McGrew lateral reading · SIFT (Caulfield) ·
PRISMA-S (PMC9014944) · ISA 530 audit sampling · ICD 203 analytic standards ·
Zittrain/Albert/Lessig, Perma · 21 CFR Part 11 · "Show Me the Work" (CHI '25,
arXiv 2502.09083) · MIT Sloan on rubber-stamping · EU AI Act Article 14.
