# What it costs to build a doughnut

**Status:** estimate, 2026-10-16. No real research run has been recorded yet
(every run in the development and stack databases used synthetic demo
values), so the numbers below are a model built from the code's actual
limits and measured prompt sizes. Replace them with measurements after the
first real run — see [Measuring it](#measuring-it).

## Short answer

One full portrait (all 21 dimensions) is **22 research sessions** plus **up
to 24 verifier sessions** (one per indicator with a value). Expected usage
per portrait:

| | Typical | Range |
|---|---|---|
| Input tokens processed | ~55 M (≈ 95 % prompt-cache reads) | 25–110 M |
| Output tokens (incl. thinking) | ~1 M | 0.5–2 M |
| Web searches | ~330 | 150–600 |
| **API cost, current code** (Sonnet 5 researchers, Opus 5 verifiers) | **≈ $40** | **$20–80** |
| API cost after moving to Sonnet 5.5 / Opus 5.5 | ≈ $33 | $17–70 |

The NYC family (city + five boroughs) is six portraits: about **$200**
($120–480). A targeted re-run of one dimension is about $1.50–3.

Without prompt caching the same run would cost about three times as much;
the Claude Agent SDK caches automatically, which is why cache-read pricing
dominates the bill.

## How the estimate is built

Measured from this repository:

- `renderPlan` (packages/research/src/plan.ts) produces 22 sessions: one
  region-context session and 21 dimension sessions (`SESSIONS_PER_FULL_REFRESH`).
- A dimension session's prompt averages 12,251 characters ≈ 3,400 tokens
  (methodology skills, tiers, thresholds, and the finding schema); the
  region-context prompt is ≈ 400 tokens.
- Dimension sessions may take up to 60 turns (`DEFAULT_SESSION_MAX_TURNS`);
  verifiers up to 12 (`VERIFIER_MAX_TURNS`) with WebFetch only.
- The framework has 24 indicators, so at most 24 verifier sessions per
  portrait (gaps are not verified).
- Models: `claude-sonnet-5` for researchers (`DEFAULT_SESSION_MODEL`,
  override `ANTHROPIC_MODEL`), `claude-opus-5` for verifiers (`VERIFIER_MODEL`).

Assumed (to be replaced by measurement):

| Assumption | Value |
|---|---|
| Fixed context per research session (harness system prompt + tools + plan prompt) | ~10 k tokens |
| Turns per dimension session | ~40 (25–60) |
| Context added per turn (model output incl. thinking + a WebSearch/WebFetch result) | ~2.5 k tokens |
| Output per turn | ~1 k tokens |
| Web searches per dimension session | ~15 |
| Verifier sessions per portrait | ~18, ~6 turns each |

Each turn re-reads the whole conversation, so a 40-turn session processes
about 40 × 10 k + 2.5 k × (1 + 2 + … + 40) ≈ 2.45 M input tokens, of which
almost all are cache reads and about 0.1 M are new (cache writes).

Prices used (Anthropic first-party API, per million tokens, 2026-10):

| Model | Input | 5-min cache write | Cache read | Output |
|---|---|---|---|---|
| Claude Sonnet 5 (current researcher) | $2 | $2.50 | $0.20 | $10 |
| Claude Sonnet 5.5 | $2 | $2.50 | $0.10 | $10 |
| Claude Opus 5 (current verifier) | $5 | $6.25 | $0.50 | $25 |
| Claude Opus 5.5 | $4 | $5 | $0.20 | $20 |

Web search is $10 per 1,000 searches; web fetch has no extra charge beyond
the tokens it adds. Claude Code's WebFetch summarizes each page with a small
model before returning it; that adds roughly $1–7 per portrait depending on
which small model the bundled CLI uses.

Per-portrait arithmetic (typical, current models): research cache reads
50 M × $0.20 = $10.00; cache writes 2.3 M × $2.50 = $5.75; uncached input
0.3 M × $2 = $0.60; output 1.0 M × $10 = $10.00; verifiers ≈ $4.60; web
search 330 × $0.01 = $3.30; WebFetch summaries $1–7 → **≈ $35–41**.

## Recommendations

1. **Move to the current models after one live check.** Sonnet 5.5 costs the
   same per token as Sonnet 5 but halves cache reads ($0.10 vs $0.20), and
   Opus 5.5 is cheaper than Opus 5 on every line. Set `ANTHROPIC_MODEL=claude-sonnet-5-5`
   and `VERIFIER_MODEL=claude-opus-5-5` on the worker and run one dimension
   first: the bundled Agent SDK must handle these models' request rules
   (thinking cannot be disabled on either), which this sandbox could not
   test without a key.
2. **Show the estimate before a run starts** (self-serve, SPEC-v7 §4): "about
   22 sessions ≈ $20–80 of API usage" for a full portrait on the customer's
   own key, and debit plan sessions for hosted runs.
3. **Price plans from this.** At ~$1.80 per session, the plan allowances
   cost roughly: Community (66 sessions/yr) ≈ $120, City (200) ≈ $360, Metro
   (600) ≈ $1,100, Enterprise (1,500) ≈ $2,700 per year in API usage, before
   hosting and support.
4. **Keep the turn caps.** `DEFAULT_SESSION_MAX_TURNS = 60` is the main cost
   bound (a 60-turn session costs about 2.2× a 40-turn one, because context
   is re-read every turn). Lowering it trades coverage for cost; measure
   yield first (docs/measurement.md).

## Measuring it

Every session's usage is already recorded: the worker writes
`research_runs.token_usage` (`RunTokenUsage`, keyed by session), and policy
analyses keep `token_usage` per analysis. After the first real run:

```bash
DATABASE_URL=… node_modules/.bin/tsx scripts/measure-strategies.ts score --label first-run --runs <run-id>
```

reports input/output tokens for the run (and cost per verified finding).
Replace the "Assumed" table above with the measured per-session averages.
