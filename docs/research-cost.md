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
  override `ANTHROPIC_MODEL`), `claude-opus-5` for verifiers (`VERIFIER_MODEL`),
  and `claude-haiku-4-5-20251001` as the page reader behind WebFetch
  (`ANTHROPIC_SMALL_FAST_MODEL`, pinned in docker-compose.yml; docs/deploy.md
  "Models").

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
the tokens it adds. Claude Code's WebFetch summarizes each page with the page
reader (Claude Haiku 4.5, $1 input / $5 output per million tokens according to
the bundled CLI's catalog, not yet confirmed) before returning it; that adds
roughly $1–7 per portrait.

Per-portrait arithmetic (typical, current models): research cache reads
50 M × $0.20 = $10.00; cache writes 2.3 M × $2.50 = $5.75; uncached input
0.3 M × $2 = $0.60; output 1.0 M × $10 = $10.00; verifiers ≈ $4.60; web
search 330 × $0.01 = $3.30; WebFetch summaries $1–7 → **≈ $35–41**.

## Recommendations

1. **Move to the current models, but not on today's SDK without a live
   test.** Sonnet 5.5 costs the same per token as Sonnet 5 but halves cache
   reads ($0.10 vs $0.20), and Opus 5.5 is cheaper than Opus 5 on every line.
   The bundled Agent SDK (0.3.220) does not know either id: its CLI matches
   `claude-sonnet-5-5` and `claude-opus-5-5` by substring and treats them as
   Sonnet 5 and Opus 5, for request rules as well as price. So in a Sonnet 5.5
   session the CLI's WebSearch side query, which runs on the session's own
   model, would ask for thinking "disabled" — a likely 400, because thinking
   cannot be disabled on Sonnet 5.5 — and research would lose its searches.
   The move therefore needs one of two things first (docs/haiku-5-5.md §8
   Q3): a deliberate SDK bump to a release that knows the 5.5 ids (0.3.301
   knows all three), or a live smoke test on 0.3.220 — one dimension with
   `ANTHROPIC_MODEL=claude-sonnet-5-5` and `VERIFIER_MODEL=claude-opus-5-5`,
   checking that no request is rejected and that `by_model` shows web-search
   requests. Either way, read its cost from deep-fryer's own meter (below),
   never from the SDK's dollar figures.
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

## Claude Haiku 5.5

Not used anywhere yet; [docs/haiku-5-5.md](haiku-5-5.md) is the full
assessment. Its price has two cards, chosen per API call by the size of the
prompt (input + cache read + cache write), per million tokens:

| Prompt | Input | 5-min cache write | Cache read | Output |
|---|---|---|---|---|
| ≤ 100 k tokens | $0.10 | $0.125 | $0.01 | $0.50 |
| > 100 k tokens | $0.50 | $0.625 | $0.05 | $2.50 |

Its tokenizer counts the same text as about 1.3× the tokens, so compare it
with other models in dollars, never in tokens. In short (modelled, not
measured):

- The recommended uses — the page reader, plus a few cheap staff-plane checks
  that only flag or annotate — are roughly cost-neutral: against Sonnet 5.5 /
  Opus 5.5 (about $29–35 a portrait) they land between about $4.50 cheaper
  and $2.80 dearer, because the cheaper page reader pays for the new checks.
  Optional Haiku scouts move a portrait by about ±$7, depending on whether
  they shorten the researcher's sessions.
- The large saving, about $14–19 a portrait against Sonnet 5.5, comes only
  from making Haiku the dimension researcher itself. The measured evidence
  argues against that — accuracy and yield follow the synthesizing model
  (docs/strategy-findings.md) — so it is an optional bake-off arm, not a plan.
- Nothing switches before per-model metering and a live smoke test: SDK
  0.3.220 does not know `claude-haiku-5-5`.

## How spend is metered

The worker records every session's usage: research runs in
`research_runs.token_usage` (`RunTokenUsage`, keyed by session, with each
dimension's verifier sessions folded under `verifier:<session id>`), policy
analyses in their own `token_usage`. A record (`SessionTokenUsage`,
packages/core/src/types.ts) holds:

- the main loop's input, output, cache-read and cache-write tokens, as it
  always has;
- `model`, the session's main model;
- `by_model`: input, output, cache-read and cache-write tokens and web-search
  requests for every model the session used, from the Agent SDK result's
  `modelUsage`. Unlike the main-loop figures it covers subagents (scouts) and
  the CLI's side calls — the WebSearch side query and the page reader behind
  WebFetch. That the page reader really appears there is the first thing the
  live acceptance run in docs/haiku-5-5.md §3.1 checks;
- for each model, the `long_prompt` share: calls whose prompt exceeded
  100,000 tokens, split per call as the session streams, because a two-card
  model bills those calls at its higher rate and a total cannot be split
  afterwards. The split covers the calls that stream (the main loop, and
  subagents as a lower bound); the CLI's own side calls (page reader, search
  side query) are in the per-model totals but never split;
- `num_turns` and how the session ended (result subtype, `terminal_reason`,
  `stop_reason`);
- `refusals`, and `refusal_fallbacks` for refusals the CLI answered on
  another model — a finding or verdict from a model nobody configured;
- `partial: true` when an attempt threw before its result: the record holds
  what had streamed, and that attempt's side-call spend is lost.

Both attempts of a retried session, and a dimension's verifier sessions, are
folded with `mergeUsage`, which sums every field, `by_model` included. Rows
written before this still read; they hold main-loop tokens only.

Dollars are computed when spend is scored, never stored. `priceSessionUsage`
(packages/core/src/model-pricing.ts) prices each `by_model` entry from
deep-fryer's own rate table — the prices above, cache writes at 1.25× input
(the 5-minute rate), a Haiku 5.5 call over 100 k tokens on its long card —
and adds $0.01 per web-search request. A model id matches only exactly,
optionally with a release date (`claude-haiku-4-5-20251001`), so
`claude-sonnet-5-5` is never priced as Sonnet 5. An id the table does not
price is reported as unpriced, never guessed, and the dollar figure is then a
lower bound with no cost per verified finding. The SDK's own `costUSD` and
`total_cost_usd` are never used: CLI 0.3.220 prices `claude-haiku-5-5` at
$5/$25 and Sonnet 5 at $3/$15.

Claude Haiku 4.5, today's page reader, is deliberately unpriced until the
operator confirms its rate (docs/haiku-5-5.md §8 Q10). Until a row is added
for it, a run whose page reader shows up in `by_model` reports its dollars as
a lower bound. The admin pages still show main-loop input and output tokens
only; dollars come from the measurement script.

## Measuring it

After the first real run:

```bash
DATABASE_URL=… node_modules/.bin/tsx scripts/measure-strategies.ts score --label first-run --runs <run-id>
```

reports, for the run: dollars (and any models it could not price), tokens
per model, cost per verified finding, coverage against the indicators the
plan asked for, the models seen, completed and failed sessions, refusals and
refusal fallbacks, and records left partial. Replace the "Assumed" table above
with the measured per-session averages.
