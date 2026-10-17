# What it costs to build a doughnut

**Status:** estimate, made 2026-10-16 and corrected 2026-10-17. Nothing in it
has been measured on this code: every run in the development and stack
databases used synthetic demo values or failed before reaching the model
(their token counters are all zero). So the numbers below are a model built
from the code's actual limits, measured prompt sizes and list prices. Real
research runs did happen, in August 2026 on older code (the NYC calibration
slice and a citywide 21-dimension campaign, docs/strategy-findings.md); their
recorded usage, if it still exists, could calibrate this model sooner than a
new run. Replace the figures with measurements — see
[Measuring it](#measuring-it).

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
| API cost after moving to Sonnet 5.5 / Opus 5.5 | ≈ $33 | $17–60 |

The NYC family (city + five boroughs) is six portraits: about **$240**
($120–480), or about $200 after the move to Sonnet 5.5 / Opus 5.5.

A targeted re-run of one dimension is **two sessions**, not one: the
region-context session always runs first, because its brief goes into the
dimension's prompt, and both are paid for (on a plan, both count against its
allowance). The
app quotes it from the per-session figures as **$1–8, typically about
$3.60**; modelled bottom-up (the two sessions plus the dimension's one or two
verifiers) it comes to about $3.10–4.00. A policy analysis is one session,
$1–4.

Without prompt caching the same portrait would cost about 3.2–3.6 times as
much; the Claude Agent SDK caches automatically, which is why cache-read
pricing dominates the bill.

These are model-usage costs only, and every one of them is paid for: there
are no free trials (the owner's decision: "No free trials for making donuts,
but free to view"). A research session runs on an organization's plan or
contract, whose price has to cover it, or on the organization's own
Anthropic key; [What a plan's sessions cost](#what-a-plans-sessions-cost)
prices the allowances. Several real costs are
[not yet modelled](#not-yet-modelled), and each of them pushes the figures up.

## How the estimate is built

Measured from this repository:

- `renderPlan` (packages/research/src/plan.ts) produces 22 sessions for a
  full portrait: one region-context session and 21 dimension sessions
  (`SESSIONS_PER_FULL_REFRESH`, packages/core/src/plans.ts). For any subset
  of dimensions it is still the region-context session plus one per
  dimension, so a one-dimension re-run is two (`researchRunSessions`,
  packages/core/src/research-cost.ts; packages/research/src/plan-cost.test.ts
  holds the two together). The spend gate charges every planned session
  (apps/web/lib/research.ts `applyRun`).
- A dimension session's prompt averages 12,767 characters ≈ 3,500 tokens
  (12,634–13,186 across the 21 dimensions: methodology skills, tiers,
  thresholds, and the finding schema) before the region brief is inserted;
  the region-context prompt is 1,420 characters ≈ 400 tokens. Re-rendered on
  2026-10-17.
- Dimension sessions may take up to 60 turns (`DEFAULT_SESSION_MAX_TURNS`);
  verifiers up to 12 (`VERIFIER_MAX_TURNS`) with WebFetch only. A failed
  research session is retried once; a verifier session is not.
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
| Verifier sessions per portrait | ~18, ~6 turns each, on the same per-turn figures |

Each turn re-reads the whole conversation, so a 40-turn session processes
about 40 × 10 k + 2.5 k × (1 + 2 + … + 40) ≈ 2.45 M input tokens, of which
almost all are cache reads and about 0.1 M are new (cache writes). A 6-turn
verifier session on the same figures processes about 112 k: 25 k cache
writes, 87.5 k cache reads, and 6 k of output.

Prices used (Anthropic first-party API, per million tokens, checked against
Anthropic's pricing page on 2026-10-17):

| Model | Input | 5-min cache write | Cache read | Output |
|---|---|---|---|---|
| Claude Sonnet 5 (current researcher) | $2 | $2.50 | $0.20 | $10 |
| Claude Sonnet 5.5 | $2 | $2.50 | $0.10 | $10 |
| Claude Opus 5 (current verifier) | $5 | $6.25 | $0.50 | $25 |
| Claude Opus 5.5 | $4 | $5 | $0.20 | $20 |
| Claude Haiku 4.5 (current page reader) | $1 | $1.25 | $0.10 | $5 |

Web search is $10 per 1,000 searches; web fetch has no extra charge beyond
the tokens it adds. Claude Code's WebFetch summarizes each page with the page
reader before returning it. At about $0.01 a page (8 k tokens in, 300 out),
the $1–7 per portrait used below is roughly 100–700 pages: a guess at how
much the sessions read, not a model of it.

Per-portrait arithmetic (typical, current models):

| Line | Arithmetic | Cost |
|---|---|---|
| Research cache reads | 50 M × $0.20 | $10.00 |
| Research cache writes | 2.3 M × $2.50 | $5.75 |
| Research uncached input | 0.3 M × $2 | $0.60 |
| Research output | 1.0 M × $10 | $10.00 |
| Verifiers | 18 × ≈ $0.35 (25 k writes × $6.25 + 87.5 k reads × $0.50 + 6 k output × $25) | $6.30 |
| Web search | 330 × $0.01 | $3.30 |
| WebFetch page reader | guessed | $1–7 |
| **Portrait** | | **≈ $37–43** |

After the move to Sonnet 5.5 / Opus 5.5 the research lines come to $21.35
(cache reads 50 M × $0.10 = $5.00) and the verifiers to 18 × ≈ $0.26 = $4.73;
the rest is unchanged, so a portrait is ≈ $30–36.

The range ends are the same arithmetic at light and heavy usage. 25-turn
sessions, 0.5 M output, 12 verifiers, 150 searches and $1 of page reading
come to about $21 ($17 after the move); 60-turn sessions, 2 M output, 24
verifiers, 600 searches and $7 of page reading come to about $73 ($60). The
quoted ranges round these outward.

What moves the estimate most, besides turns per session (which the range
ends cover):

| Assumption, low → high | Effect, current models |
|---|---|
| Context added per turn, 1.5 k → 5 k tokens | research tokens $20 → $40 |
| Output per turn, 0.5 k → 2 k tokens | output line $4.40 → $17.60 |
| Fixed context, 6 k → 20 k tokens | research tokens $25 → $28 (minor) |

Corrected on 2026-10-17: the verifier line was $4.60, below what this
document's own per-turn figures give ($6.30); the NYC family was "about
$200", not its own $40 × 6; a re-run was priced as one session; and a 60-turn
session was "about 2.2×" a 40-turn one, which is its token ratio, not its
dollar ratio (below). The ≈ $40 per portrait holds.

## Not yet modelled

Each of these adds cost that the figures above leave out. None is measured.

- **The WebSearch side query.** Claude Code's WebSearch tool answers each
  search request with a separate model call on the session's own model
  (Sonnet 5 today), with prompt caching off and up to 8 searches per call,
  and the search results it reads bill as input tokens. The estimate counts
  only the $0.01 search fee. A rough guess, 330 calls of 6–30 k input tokens,
  adds about $6–35 per portrait; the magnitude is unverified. Per-model
  metering records it (`by_model`), so the first measured run settles it.
- **How much the page reader reads.** Its rate is confirmed and priced, but
  the $1–7 per portrait is a guess at the number and length of pages, not a
  model of either.
- **Retries.** A failed research session is retried once, and both attempts
  are paid for, but the session counts at most once against a plan. A
  session that hits the 60-turn cap and is retried costs about $4 on
  Sonnet 5, 3.5 times a typical 40-turn session.
- **Failed sessions.** A session that fails is not counted against the
  customer's plan (packages/db/src/billing.ts counts only sessions that did
  not fail), but its tokens were spent: the operator pays for them.

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
2. **Keep quoting the estimate before a run starts.** /start and the billing
   page show it from packages/core/src/research-cost.ts, which computes every
   quoted figure from the per-session constants: a full portrait (22
   sessions), a policy analysis (one) and a one-dimension re-run (two). A
   change to this document's estimate is a change there.
3. **Price plans from the table below**, with the high column and the
   unmodelled costs in mind, and replace both with measured figures after
   the first real run.
4. **Keep the turn caps.** `DEFAULT_SESSION_MAX_TURNS = 60` is the main cost
   bound. A 60-turn session costs about 1.7× a 40-turn one in dollars ($2.03
   vs $1.17 on Sonnet 5): it processes 2.1× the input tokens, because context
   is re-read every turn, but most of the extra is cheap cache reads.
   Lowering the cap trades coverage for cost; measure yield first
   (docs/measurement.md).

## What a plan's sessions cost

At $0.91 / $1.82 / $3.64 per session (the portrait's $20 / $40 / $80 spread
over its 22 sessions, verifiers included), each plan's research allowance
costs this much a year in API usage, before hosting, review and support:

| Plan | Sessions a year | Low | Typical | High |
|---|---|---|---|---|
| Community, annual | 66 | $60 | $120 | $240 |
| Community, monthly (no longer sold; existing subscriptions only) | 72 (6 a month) | $65 | $131 | $262 |
| City | 200 | $182 | $364 | $727 |
| Metro | 600 | $545 | $1,091 | $2,182 |
| Enterprise (by contract) | 1,500 | $1,364 | $2,727 | $5,455 |

There is no free allowance and no trial. The retired trial plan remains only
as an id on rows that started one before; nothing creates it, and such a row
has no standing, so it researches nothing. A plan is sold only by an
interval whose period's allowance pays for a whole doughnut (core
`sellsInterval`): Community by the month would give 6 sessions a month
against the 22 a first build takes, and with no trial to pay for that build
a monthly subscriber could never make the doughnut they bought the plan for,
so it is sold annually only. A plan billed by invoice researches once its
first invoice is paid. An
organization's own Anthropic key pays the model usage of its sessions and
spares the allowance, but it still needs a plan in good standing (SPEC-v7):
the key pays for tokens, the plan for hosting, review and support.

The typical column is the least a plan's price must cover for API usage
alone. Plan prices are still placeholders (docs/billing/prices.example.json
is all $0), so no margin can be judged yet. Because failed sessions and
retried attempts are not counted against a plan
([Not yet modelled](#not-yet-modelled)), the operator's real cost for an
allowance is somewhat above these figures.

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
  Opus 5.5 (about $30–36 a portrait; docs/haiku-5-5.md says $29–35 because it
  used the earlier verifier line) they land between about $4.50 cheaper and
  $2.80 dearer, because the cheaper page reader pays for the new checks.
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

Claude Haiku 4.5, today's page reader, is in the table at its published rate
($1 input, $1.25 5-minute cache write, $0.10 cache read, $5 output), confirmed
on 2026-10-17 (docs/haiku-5-5.md §8 Q10). Before that, a run whose page
reader showed up in `by_model` reported its dollars as a lower bound. The
admin pages still show main-loop input and output tokens only; dollars come
from the measurement script.

## Measuring it

After the first real run:

```bash
DATABASE_URL=… node_modules/.bin/tsx scripts/measure-strategies.ts score --label first-run --runs <run-id>
```

reports, for the run: dollars (and any models it could not price), tokens
per model, cost per verified finding, coverage against the indicators the
plan asked for, the models seen, completed and failed sessions, refusals and
refusal fallbacks, and records left partial. Replace the "Assumed" table above
with the measured per-session averages, and the constants in
packages/core/src/research-cost.ts with the measured cost per portrait.

The August 2026 runs (docs/strategy-findings.md) may give measured figures
sooner. The worker at the time already recorded cache reads and writes per
session; if those rows still exist (probably in the database the app used
before this one; unverified), they hold real per-session token counts, from
older prompts and code. Their "tokens per verified finding" (43.7 k and
32.0 k) count only uncached input plus output, not cache reads or writes, so
they cannot be compared with the figures here directly.
