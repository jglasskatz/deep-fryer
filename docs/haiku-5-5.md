# Where to use Claude Haiku 5.5 in deep-fryer

Prepared on 2026-10-16 from a read-only review of the repository: every candidate was argued for and against, judged against the code, and the result checked by a separate critic. No model was called to produce the figures.

None of the dollar figures below is measured. They are modelled from the assumptions in `docs/research-cost.md` ("Assumed"), because no real research run exists in any local database. The dev DB holds only test fixtures. The compose DB has 3 runs, and all 6 of their sessions failed with "Not logged in". Run d02c4536 is nevertheless marked `complete`: it ran on 2026-10-14 on older code, which settled a run complete even when every session failed. Current code marks such a run `failed` (`apps/worker/src/tasks/run-status.ts`).

---

## 1. The answer

**Where Haiku 5.5 goes:**
- **The CLI's small/fast model.** This model already reads almost every fetched page for the researchers and for the Opus verifier. The only exception is a preapproved domain serving markdown under 100K characters, which is passed through raw. The reader is Haiku 4.5 today, and from the CLI code its tokens appear to sit outside deep-fryer's recorded usage.
- **The opt-in `source-scout` subagent,** working under a Sonnet or Opus synthesizer.
- **A short list of new, cheap staff-plane checks.** These cover gaps the pipeline has today: a tier audit, a frame check of passages located in the captured exhibit, gap triage, a label for whether a snapshot is a real document, a newer-vintage probe, and some staff chores. Each one only flags or annotates. None of them decides anything.

**What stays where it is:**
- Researchers stay on Sonnet, moving to Sonnet 5.5 when that migration ships.
- The verifier stays pinned to Opus with no `fallbackModel`. Note that the CLI's built-in refusal fallback for Opus 5 still applies (see §3.5).
- Region context and policy analysis stay on Sonnet.

**Why nothing should switch yet:**
- The bundled Agent SDK (0.3.220) does not know `claude-haiku-5-5`. It would send effort "high", price the model at $5/$25, and may add a beta header nobody has tested.
- Today's metering does not price anything, and it does not record which model ran. The score ignores cache tokens, and the verifier drops them. A Haiku bake-off therefore could not be priced.

**What to do first:** ship per-model metering and a few configuration pins, run one live smoke test, then run the evals in §4.

**What it costs:**
- The recommended mix is roughly cost-neutral per portrait. Against the Sonnet 5.5 / Opus 5.5 baseline (about $29–35), it lands between $4.50 cheaper and $2.80 dearer. The cheaper page reader pays for the new checks.
- Haiku scouts move the bill by about ±$7 per portrait. The sign depends on whether scouts actually shorten the synthesizer's sessions.
- The large saving only appears if Haiku becomes the researcher itself. In research tokens over 40-turn sessions, that is about $14–19 per portrait against Sonnet 5.5, or $19–24 against today's Sonnet 5. The measured evidence argues against making that switch. It can be tested as an optional bake-off arm for about $20–36.

---

## 2. Every candidate at a glance

"Code now" means a deterministic stage that needs no model and can ship before the eval.

| # | Candidate | Decision | What Haiku 5.5 does | Stays on Sonnet/Opus | Cost impact | Confidence |
|---|---|---|---|---|---|---|
| 1 | per-model-metering | **Adopt now** | Nothing. It meters every model, including the page reader and scouts. | All unchanged | $0 in model spend. Prices the ~$21–27 of a ~$40 portrait that the score cannot see today; ~$5–11 of that is never stored at all. | high |
| 2 | cli-small-model-pin | After eval. Pin to Haiku 4.5 now. | Reads every WebFetch page for researchers, region, policy, scouts and the Opus verifier. | Researcher on Sonnet, verifier on Opus | −$0.85 to −$5.85 per portrait | high |
| 3 | scout-split | After eval | `source-scout` subagent: breadth searching and skimming. No capture, no conclusions. | Synthesizer (Sonnet, or Opus for the deep tier), verifier on Opus | −$7.2 to +$7.2 per portrait with a Sonnet 5.5 synthesizer. Deep tier, 21 dimension sessions: ≈$24 vs ≈$55 for the measured Opus + Sonnet-scout design. | medium |
| 4 | tier-audit-haiku | After eval. Needs prompt v2. | Per finding: the true tier of the accepted source, plus a search for a better source. Raises flags only. | Researcher and verifier unchanged. Use Sonnet 5 if Haiku fails the eval. | +$1.3–3.1 per portrait at full scope, or +$0.35–0.85 for a sample of 5 | medium |
| 5 | pre-verify-triage | After eval, in a narrowed form | Reads the year, geography and kind printed next to the claimed value in the exhibit text. Annotates flagged cards only. | The Opus verifier still runs on every indicator. Most of the "lint" moves to code. | +$0.05–0.40 typical, worst case $2.16 | medium |
| 6 | gap-review | After eval. Stage 1 is code now. | Classifies a gap's free-text reason into 5 categories, as advice to staff. | Uses Sonnet if the researcher is Haiku. The gap verdict is unchanged. | ≈ +$0.01 per portrait | medium |
| 7 | exhibit-validity-check | After eval. Stage 1 is code now. | Labels HTML snapshots that code could not classify: document, bot_block, captcha and so on. Advice only. | — | ≤ +$0.08 per portrait, plus ~$0.14 of Sonnet recapture turns | high |
| 8 | newer-vintage-probe | After eval | Staff-started check, per published indicator, for whether a newer data vintage exists. | Sonnet if Haiku fails the eval | $1.2–2.65 per portrait sweep (≈$3.9–5 on Sonnet) | high |
| 9 | any-city-preflight | After eval. Items 1–3 only; the boundary text is reference-only. | Identifies the place before the run and proposes config fields, each with a source. | region_context and all research | $0.10–0.22 per pre-flight, worst case $0.55 | medium |
| 10 | policy-quick-tier | After eval. Direction-only. | Optional quick scan that gives directions of impact, no numbers. | The full analysis | ≈$0.10 vs $0.69–1.69 per analysis | medium |
| 11 | listing-link-drift | After eval. Stage 1 is code now. | Checks "program ended or different content" on 2xx HTML pages. | — | ≈$0.12 per weekly deduplicated sweep (~$6–9 a year) | high |
| 12 | involvement-triage-draft | After eval. Phase 1 labels only. | Spam/fit label plus suggested kind and dimensions. Drafting text needs owner sign-off. | — | ≈$0.0006 per submission | medium |
| 13 | comment-prescreen | After eval. Part (a) only, gated on real need and published privacy terms. | Advisory category on first posts that are already held. | — | ≈$0.0002 per held comment | medium |
| 14 | catalog-draft-qa | After eval | First-draft translations of interface strings, for languages that pass the eval. | Checker on Opus 5.5. ht/bn/ur drafted on Sonnet 5.5. | ≈$2 per change all-in. Haiku saves ~$0.9–2.1 per change. | medium |
| 15 | region-context-haiku | Not recommended | — | Sonnet | Would save $0.6–1.0 per portrait. A brief 3–4K tokens longer erases that. | medium |
| 16 | policy-prescope | Not recommended | — | Sonnet | A few dollars a month at most | high |
| 17 | byok-spend-probe | Not recommended. Fix with SDK error classes instead. | — | — | ~$0.0001 per run, and the probe proves nothing about Sonnet/Opus access | high |
| 18 | run-digest | Not recommended. Use a code digest plus a verifier `fail_reason`. | — | Opus gains one output field | — | high |
| 19 | transcript-trail | Not recommended. Use a code-only trail. | — | — | — | high |
| 20 | schema-repair | Not recommended. Fix extractJson partial salvage instead. | — | — | Its trigger never fires on the cases it targets | high |
| 21 | emergency-curation-assist | Not recommended. Validate `nws_events` in code instead. | — | — | < $4 one-time | high |
| — | WebSearch side query (implicit, not a listed candidate) | No separate change. It follows the session's main model. | Runs on Haiku 5.5 only inside a Haiku session (scouts, tier audit, vintage probe, pre-flight, quick scan). A remote CLI flag (`tengu_plum_vx3`, default off) can route it to the small model instead. | Sonnet in research and policy sessions | Search fees ($10 per 1,000) do not change with the model | high |
| — | Dimension researcher on Haiku (not a listed candidate) | Not as default. Optional arm B in the bake-off. | — | Sonnet | −$14 to −$19 per portrait vs Sonnet 5.5 (−$19 to −$24 vs Sonnet 5), research tokens, if quality held | medium |
| — | Verifier on Haiku (not a listed candidate) | No | — | Opus 5, pinned, no `fallbackModel` | At most −$4.40 per portrait | high |

Out of scope: the dev tooling `@keel_flow/cli` would call a model only for `keel verify --spec`. CI runs `--diff` only, so CI makes no model calls.

**Suggested order:**
1. §3, all of it.
2. §4.1 and §4.2. They share infrastructure and decide the research bill.
3. §4.3–§4.6, the verification layers. §4.4 and §4.5 can piggyback on the findings that §4.1 produces.
4. §4.7–§4.10.
5. §4.11–§4.13, after the owner decisions in §8.

---

## 3. Adopt now

### 3.1 Per-model metering

This is the only adopt-now candidate, and it is a prerequisite for every eval in §4.

**What is wrong today:**
- `runSession` stores only `result.usage`, at `session.ts:345-367`. That usage includes the main loop's cache reads and writes, but not the per-model `modelUsage`, the web-search request count, or any side-model or subagent tokens.
- `runVerifier` adds only input and output tokens, at `research-apply.ts:195` and `:346-347`. It drops cache tokens.
- `measure-strategies score` sums only input and output tokens: `loadRun` at `scripts/measure-strategies.ts:156-161` and `scoreLabel` at `:165-174`. The admin pages show only input and output tokens as well.
- No row records which model ran.

**Why it matters for Haiku.** About $21–27 of a ~$40 portrait is invisible to the score and the admin pages:
- research cache reads (~$10) and cache writes (~$5.75), which `token_usage` stores but nothing reads;
- about $5–11 that is never stored at all: search (~$3.3, since no request count is kept), the page reader ($1–7), and verifier cache tokens (≥$0.5, because `runVerifier` drops them).

For a Haiku main loop, pricing the per-model total on the ≤100K card understates cost about 3×. For a 40-turn session, about $0.07–0.08 is reported against a true $0.21–0.22. That error is enough to flip the "≤50% of control $ per verified finding" rule. For example, a Haiku arm at 0.55× control yield would show 0.31 when the true figure is 0.51.

**`packages/core/src/types.ts:198-205`.** Keep `RunTokenUsage = Record<string, SessionTokenUsage>` unchanged. The admin list at `apps/web/app/[tenant]/admin/research/page.tsx:91-93` sums `u.input_tokens + u.output_tokens` over every map value, so a new top-level key would show NaN. Add only optional fields. `cache_read_tokens` and `cache_write_tokens` already exist.

```ts
export interface ModelTokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  web_search_requests: number;
  /** Tokens from API calls whose prompt (input + cache read + cache write) exceeded 100,000. */
  long_prompt?: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number };
}
export interface SessionTokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  model?: string;                       // from the system init message
  by_model?: Record<string, ModelTokenUsage>;
  num_turns?: number;
  result_subtype?: string;
  terminal_reason?: string;
  stop_reason?: string | null;
  refusals?: number;
  partial?: boolean;                    // attempt threw; side-call spend lost
}
```

**`packages/core/src/model-pricing.ts`** is a new pure module with a co-located test. Prices are $ per MTok. Input, output and cache-read rates come from the model facts. The Sonnet and Opus cache-write rates come from `docs/research-cost.md:63-68` (1.25× input).

| Model id (exact, optional `-YYYYMMDD` suffix) | Input | 5-min cache write | Cache read | Output |
|---|---|---|---|---|
| `claude-sonnet-5` | 2 | 2.50 | 0.20 | 10 |
| `claude-sonnet-5-5` | 2 | 2.50 | 0.10 | 10 |
| `claude-opus-5` | 5 | 6.25 | 0.50 | 25 |
| `claude-opus-5-5` | 4 | 5 | 0.20 | 20 |
| `claude-haiku-5-5`, prompt ≤100K | 0.10 | 0.125 | 0.01 | 0.50 |
| `claude-haiku-5-5`, prompt >100K | 0.50 | 0.625 | 0.05 | 2.50 |
| `claude-haiku-4-5` | unpriced until the operator confirms ($1/$5 per the bundled CLI catalog) | | | |
| Web search | $0.01 per request | | | |

Rules for the pricing module:
- Match with `^id(-\d{8})?$`. Never use substring or prefix matching. The CLI's substring canonicalizer is the reason it prices `claude-sonnet-5-5` as Sonnet 5.
- An unknown id returns `{ unpriced: [...] }`. It never falls back to a guess.
- `modelUsage` does not split cache writes by TTL, so price all writes at the 5-minute rate (1.25× input). Revisit if 1-hour caching is ever enabled; that rate is 2× input.

**`apps/worker/src/session.ts`:**
- **In the `for await` loop (`:345-367`):**
  - On `system` init, set `usage.model`.
  - On `assistant` messages, dedupe by `message.message.id`, because one API call emits several frames. Add the usage to a per-model streamed total. If `input + cache_read + cache_creation > 100_000`, also add it to `long_prompt`.
  - Count refusals: assistant `stop_reason: 'refusal'`, plus system subtypes `model_refusal_no_fallback` and `model_refusal_fallback`.
  - On `result`, copy the `modelUsage` token fields into `by_model`: `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens` and `webSearchRequests` (`sdk.d.ts:1265-1272`). Also copy `num_turns`, `subtype`, `terminal_reason` and `stop_reason`. Never store `costUSD`, `total_cost_usd` or `canonicalModel`.
- **On a throw:** wrap the loop so that a throw rethrows a `SessionRunError` carrying the streamed partial usage with `partial: true`.
- **`runSessionWithRetry` (`:27-59`):**
  - Export `mergeUsage(a, b)`, which sums every field, including `by_model` and `long_prompt`.
  - Use it in place of the four-field rebuild at `:48-58`. Without that change, `by_model` would be silently dropped on every retried session.
  - The catch at `:33-43` should use `err.usage` when it is present, instead of zeros.

**`apps/worker/src/tasks/research-apply.ts`:**
- The verifier accumulator (`:195`, `:321`, `:346-347`) becomes a `SessionTokenUsage` folded with `mergeUsage`, so cache tokens and `by_model` are kept.
- The catch in `runVerifier` merges `SessionRunError.usage`.

**`packages/research/src/measure.ts`:**
- `sessionSpend` (`:33-46`) merges full records.
- `scoreStrategy` adds `dollars` and `costPerVerifiedFindingUsd` from `priceSessionUsage`, or an `unpriced` flag.

**`scripts/measure-strategies.ts` score** (`loadRun` `:129-163`, `scoreLabel` `:165-179`): merge full records and report:
- dollars
- per-model tokens
- the set of models seen per run (today a run row does not record its arm's model)
- completed and failed session counts
- refusals

**Other places:**
- **Policy:** `policy-analyze.ts` already stores the session usage whole, so only the type change applies.
- **Docs:** add a "how spend is metered" section to `docs/research-cost.md`. Its line "Every session's usage is already recorded" (`:103`) is incomplete today.

**Tests (vitest):**
- assistant-frame dedupe
- the >100K split
- the retry merge
- partial usage on a throw
- Haiku two-card arithmetic
- old rows still read in `sessionSpend`

**Acceptance.** An operator does one live run on the deployment's own key:

```
DATABASE_URL=… node_modules/.bin/tsx scripts/measure-strategies.ts plan --tenant bronx --dims housing --no-custom
# start a local worker as in §4.0, then:
DATABASE_URL=… node_modules/.bin/tsx scripts/measure-strategies.ts enqueue --run <id>
```

The run costs about $1.5–3. It passes when all of these hold:
- (a) `by_model` has a `claude-haiku-4-5*` key with non-zero input whenever the transcript shows a WebFetch. This shows reader tokens are included. If it fails, document the reader as outside the meter and price it from Console usage instead.
- (b) The sum of `webSearchRequests` is at least the number of WebSearch tool_use blocks.
- (c) Streamed sums are no greater than `modelUsage` for the main model.
- (d) The `verifier:<id>` record has non-zero `cache_read_tokens`.
- (e) Dollars match an offline recompute from the transcript parser within ±5%.
- (f) Per-model totals match Console usage for that key and window within ±10%.
- (g) The admin pages render old and new rows with no NaN.

### 3.2 Configuration pins

These change no behaviour on a first-party API deployment.

**`docker-compose.yml`.** The worker environment at `:144-155` forwards only `ANTHROPIC_API_KEY` (`:146`) and `ANTHROPIC_MODEL` (`:147`) today. Add:

```yaml
      # The model that reads every fetched page, for researchers AND the verifier.
      ANTHROPIC_SMALL_FAST_MODEL: ${ANTHROPIC_SMALL_FAST_MODEL:-claude-haiku-4-5-20251001}
      VERIFIER_MODEL: ${VERIFIER_MODEL:-claude-opus-5}
      RESEARCH_SUBAGENT_MODEL: ${RESEARCH_SUBAGENT_MODEL:-}          # empty = scouts off
      RESEARCH_SESSION_CONCURRENCY: ${RESEARCH_SESSION_CONCURRENCY:-3}
```

Document all four in:
- `.env.example`, next to `ANTHROPIC_MODEL` at `:57`
- the env table in `apps/worker/README.md`
- `docs/deploy.md`

**Why pin the reader now.** `claude-haiku-4-5-20251001` is today's implicit default. In SDK 0.3.301, the `haiku` alias maps to `claude-haiku-5-5`, and `^0.3.220` allows 0.3.301. A lockfile regeneration or `pnpm update` would therefore silently swap the verifier's page reader. Frozen-lockfile installs (`apps/worker/Dockerfile:29`, `.github/workflows/ci.yml:46`) prevent spontaneous drift, but not a deliberate update.

`ANTHROPIC_SMALL_FAST_MODEL` is checked first by the CLI's resolver. It reaches every session through the `ANTHROPIC_` prefix (`session.ts:155`) and is not in `DEPLOYMENT_CREDENTIAL_KEYS` (`session.ts:170-184`), so org-key sessions get it too.

**Caveat on the pin.** The CLI sends this value verbatim (its id mapper is the identity function), and setting it skips the CLI's fallback to the main model on gateway deployments. The pin therefore assumes a first-party API deployment, which is the only kind the repo documents.
- A deployment routed through Bedrock, Vertex, Foundry or an LLM gateway must set its provider's own id.
- An empty value does not break WebFetch on CLI 0.3.220: the CLI treats `''` as unset and falls back to its built-in Haiku default, so the pin is silently lost. Compose's `:-` form supplies the default for an unset or empty variable, so the worker never receives it blank.

**`apps/worker/package.json:15`:** change `"^0.3.220"` to `"0.3.220"`, then run `pnpm install` to update the importer specifier. The resolved version does not change. Any SDK bump should be a deliberate decision (§8).

**Do not set any of these:**
- `ANTHROPIC_DEFAULT_HAIKU_MODEL`. It also redefines the `haiku` alias used by Agent-tool calls.
- `ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES`. Per the CLI code, the capability override returns early on first-party auth, so it does nothing there.
- `CLAUDE_CODE_EFFORT_LEVEL`. It overrides `Options.effort` for every model in the subprocess.

**`architecture/data.ts:305`.** The verifier's "fresh WebFetch" reason is inaccurate. The verifier sees the CLI small model's summary of the page, with quotes capped at 125 characters, not the page itself. The researcher reads through the same model. Say so, and add the reader as a dependency of the researcher and verifier nodes.

### 3.3 Region context: `orchestrate: false`

When `RESEARCH_SUBAGENT_MODEL` is set, the region session currently becomes an orchestrator, because it has WebSearch (`session.ts:311-312`). It then gets scouts and a `DELEGATION_NOTE` telling it to capture evidence, but it has no capture tool. Fix this at `research-apply.ts:131-135`:

```ts
      const result = await runSessionWithRetry({
        prompt: regionSpec.prompt,
        allowedTools: regionSpec.tool_allowlist,
        orchestrate: false,
        ...keyOption,
      });
```

Add a research-apply test that asserts the region session runs with `orchestrate: false`.

### 3.4 Let the bake-off see Haiku's failure modes

These are model-free. They are needed because Haiku's most likely failures are sessions that return nothing.

- **Coverage denominator.** `packages/research/src/measure.ts:105` computes coverage as `nonGap.length / findings returned`. A session that emits nothing writes no rows, so bad JSON, a refusal or a turn cap never lowers coverage or yield. Divide by indicators planned instead, as `docs/measurement.md:46` defines it.
- **Negative controls.** At `measure.ts:410`, any value counts as fabricated. Apply the exemption `docs/strategy-findings.md:83-88` describes: sourced, verifier-passed, regional-scale values are not fabrications.
- **Partial salvage.** `extractJson` (`session.ts:393-410`) returns the first inner value that parses when the outer array is malformed. A trailing comma in finding 2, or an unclosed fence, returns finding 1 only. The session is then marked complete and the rest is silently dropped.
  - Return `{ value, salvaged }`.
  - Prefer attaching a `partial_output` critical check to each finding from a salvaged session. Marking the session `failed` would make it free: billing counts only non-failed sessions (`packages/db/src/billing.ts:111`), while its findings would still sit in review.
  - Pass the same flag through `policy-analyze.ts:202-206`.

### 3.5 Model-free fixes the review surfaced

These are not Haiku work. Do them regardless.

| Fix | Where | Surfaced by |
|---|---|---|
| Fail fast on a dead, out-of-credit or model-restricted org key. Read `SDKAssistantMessage.error` (`sdk.d.ts:2858`, `:2901`). Do not retry `authentication_failed`, `billing_error`, `model_not_found` or `oauth_org_not_allowed`; throw `OrgKeyUnavailableError`. Today a dead key costs 44 CLI starts, and the email at `notify.ts:66` blames "the administrator". | `session.ts`, `research-apply.ts`, `policy-analyze.ts`, `org-key.ts`, `notify.ts` | byok-spend-probe |
| Check model access at key validation: zero-token `models.retrieve` for each configured id (`ANTHROPIC_MODEL`, `VERIFIER_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`, and any Haiku model adopted). | `apps/web/lib/anthropic-key.ts:96-111` | several |
| Make the verifier's built-in refusal fallback visible. CLI 0.3.220 arms one for `claude-opus-5` (catalog capability `refusal_fallback`; cyber-category refusals are retried on `claude-opus-4-8`), so a verdict can come from a different judge with no trace. Record `model_refusal_fallback` events (§3.1). Decide whether to set `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK=1` on verifier sessions, in which case such findings become "uncertain". | `session.ts`, `research-apply.ts` `runVerifier` | SDK review |
| Prompt guard: a WebFetch error, or the literal "No response from model", means "uncertain" for the verifier, and "retry or try another source" for the researcher. It never means "fail" or "gap". | `vendor/open-doughnut/plugin/agents/verifier.md`, `dimension-researcher.md` | cli-small-model-pin |
| Deterministic exhibit gate. `page.goto` discards the Response today (`evidence.ts:68`). Check status ≥400, block/captcha title regex, near-empty innerText, password field. | `apps/worker/src/evidence.ts` | exhibit-validity-check |
| Deterministic gap concerns: tier 1 not tried, an accepted scale not tried, block keywords in `reason`. | new `packages/research/src/gap-triage.ts` | gap-review |
| Deterministic link-drift stage: status, host change, soft-404 probe, parked hosts. | new `packages/research/src/link-check.ts` | listing-link-drift |
| Run digest grouped by cause in code, plus a `fail_reason` enum on the verifier. Check verifier agreement before shipping this. | `notify.ts`, `verifier.md` | run-digest |
| Code-only search trail, plus an optional researcher-written `rejected_sources`. | new `packages/research/src/trail.ts` | transcript-trail |
| Country-neutral tier-2 defaults. | `packages/contract/src/index.ts:122-128`, `region-context.md` | any-city-preflight |
| Region brief: drop lines whose links are dead, cap its length, reuse it on reruns, and warn loudly when it is missing. | `research-apply.ts:145-147`, `research-verify`, `notify.ts` | region-context-haiku |
| Validate `nws_events` against `api.weather.gov/alerts/types`. | `packages/core/src/emergency.ts`, `scripts/preflight.ts` | emergency-curation-assist |

---

## 4. Adopt after eval

### 4.0 Rules for every Haiku 5.5 call

1. **Model id.** Use the full id `claude-haiku-5-5`. Never use the alias `haiku`, which resolves to `claude-haiku-4-5` on 0.3.220.
2. **Effort.** Pass it explicitly: `low` for classification and extraction, `medium` where under-searching is the risk. On 0.3.220 an unknown id otherwise gets `high`.
3. **Forbidden parameters.** Never send `temperature`, `top_p`, `top_k`, an assistant prefill or `thinking.budget_tokens`. Leave thinking unset, which gives adaptive thinking.
4. **Output.** Use structured output wherever the result is machine-read.
5. **Failure.**
   - A refusal, `max_tokens`, a schema miss or an API error means "no result", which is stored as unknown. It never becomes pass, fail, gap, "not a document" or "not policy".
   - Never fall back to another model unless the item says so.
   - On any SDK bump, check that the CLI's own refusal fallback cannot silently run a Haiku job on another model. Use `CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK`, or record the event.
6. **Advisory only.** A Haiku call never sets `content_supported`, never disposes of a flag, never writes `published` or `link_checked_at`, and never reaches the public plane (`SPEC.md:44`, `:236`). That includes text a staff member accepts verbatim into a field the public plane renders.
7. **Coupling.** A Haiku check that judges research output never runs on the researcher's own model. If `ANTHROPIC_MODEL` is a Haiku, it runs on `claude-sonnet-5` instead.
8. **Funding.**
   - Work attached to a run uses the run's key: `sessionApiKey(db, tenantId, funding)`.
   - Deployment-funded work uses the deployment key, and only when it is a first-party key.
   - The deployment key is never used for key-funded work.
9. **Metering.** Record the model id, all four token fields and web-search requests per call. Price from the §3.1 table. Never use the SDK's dollar fields.
10. **Size.** Count Haiku's tokens as about 1.3× today's count, and keep prompts under 100K wherever possible.

**Call paths:**
- **Tool-using jobs** (scouts, tier audit, vintage probe, pre-flight, policy quick scan) go through `runSession`. Extend it with:
  - optional `effort` and `outputFormat` inputs (`sdk.d.ts:1664`, `:1726`)
  - an allowlisted `envOverrides`, limited to `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`, `CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION`, `CLAUDE_CODE_SUBAGENT_MODEL` and `ANTHROPIC_SMALL_FAST_MODEL`
  - `structured_output`, `modelUsage` and `num_turns` returned on the result

  Always pass `orchestrate: false` unless the job is a scout synthesizer.
- **Single-shot, no-tool calls** (frame reader, gap triage, exhibit label, link drift, involvement triage, comment triage): add one worker wrapper, for example `apps/worker/src/messages.ts`, on `@anthropic-ai/sdk` pinned to `0.135.0`.
  - Version 0.135.0 is already in the lockfile through `apps/web/package.json:15`. Its types list `claude-haiku-5-5`, `output_config.effort` and `output_config.format`, and `stop_reason: 'refusal'`.
  - The wrapper pins `baseURL: 'https://api.anthropic.com'` and `authToken: null`, takes `apiKey` explicitly, and sets `maxRetries: 1` and a timeout. It maps refusal, `max_tokens` and invalid output to `null`, and returns usage plus the model.
  - This avoids the 0.3.220 unknown-id problems and the ~10K-token CLI harness.
  - The pre-verify and gap-review verdicts specified `runSession` instead; either works.
  - The wrapper is a second model entry point, so add a node or connection for it in `architecture/data.ts`.
- **Translation drafting** is an operator script on the operator's own key (§4.13).

**Stage 0 smoke tests (~$3–7 in total).** An operator runs these on the deployment key:
- **Agent SDK path.** Run one Bronx housing run with `RESEARCH_SUBAGENT_MODEL=claude-haiku-5-5`, plus one standalone `runSession` with `model: 'claude-haiku-5-5'`, `effort`, `outputFormat` and WebSearch/WebFetch. Pass requires all of:
  - no 400 (watch for the `mid-conversation-system-2026-04-07` beta header, thinking and effort)
  - the init message names `claude-haiku-5-5`
  - effort is honoured
  - `modelUsage['claude-haiku-5-5'].webSearchRequests > 0`, and every WebSearch result has non-empty Links
  - `structured_output` is present
  - 0 refusals
  - the largest per-call prompt is under 100K
- **Messages path.** Make 5 calls with `output_config {effort:'low', format: json_schema}`, including one refusal-prone sample. Pass requires a 200 response, `response.model` = `claude-haiku-5-5`, and a clean "no result" on refusal.
- **Reader.** Run one Bronx housing run with `ANTHROPIC_SMALL_FAST_MODEL=claude-haiku-5-5`. Pass requires zero WebFetch errors, zero "No response from model" results, and `modelUsage` listing `claude-haiku-5-5`.
- **If the Agent SDK path fails,** stop. Bump deliberately to 0.3.301, which knows all three 5.5 ids and has two-card Haiku pricing, with `ANTHROPIC_SMALL_FAST_MODEL` still pinned. Then repeat.

**Shared bake-off commands.** Use a dedicated eval database, or filter by run id; test suites write fixtures into `deep_fryer_dev`. Keep a ledger of run id to arm.

```bash
# Plan (free; each run is single-use). S1 calibration and S2 hard slices:
DATABASE_URL=… node_modules/.bin/tsx scripts/measure-strategies.ts plan --tenant bronx --dims housing,air-pollution,food,ocean-acidification,ozone-depletion --no-custom
DATABASE_URL=… node_modules/.bin/tsx scripts/measure-strategies.ts plan --tenant nyc --dims climate-change,chemical-pollution,water-sanitation,health

# Run ONE arm at a time with a local worker (the model is process-wide; compose forwards too little today):
DATABASE_URL=… ANTHROPIC_API_KEY=<deployment key> ANTHROPIC_MODEL=… VERIFIER_MODEL=claude-opus-5 \
  ANTHROPIC_SMALL_FAST_MODEL=claude-haiku-4-5-20251001 [RESEARCH_SUBAGENT_MODEL=…] <storage env> \
  pnpm --filter @deep-fryer/worker start
DATABASE_URL=… node_modules/.bin/tsx scripts/measure-strategies.ts enqueue --run <id>
DATABASE_URL=… node_modules/.bin/tsx scripts/measure-strategies.ts status

# Score, gate, and recover per-call detail from transcripts:
DATABASE_URL=… node_modules/.bin/tsx scripts/measure-strategies.ts score --label sonnet --runs <A ids> --label2 haiku --runs2 <B ids>
pnpm research-verify --tenant <slug> --run <id>
psql "$DATABASE_URL" -At -c "select s.id||'|'||translate(encode(s.transcript,'base64'),E'\n','') from research_sessions s where s.run_id in ('<ids>')" \
  | node scripts/transcript-usage.mjs
```

The transcript parser and the per-session cost model currently live outside the repo, in this review's scratchpad. Before the eval, copy `turns.mjs` to `scripts/transcript-usage.mjs` and `cost.mjs` to `scripts/session-cost.mjs`:
- `/tmp/claude-0/-home-user/101690c1-c7e3-5783-970a-301ff03dad68/scratchpad/model/turns.mjs`
- `/tmp/claude-0/-home-user/101690c1-c7e3-5783-970a-301ff03dad68/scratchpad/model/cost.mjs`

`measure-strategies enqueue` keeps funding at `plan` and never applies the run (`measure-strategies.ts:192-204`).

### 4.1 Research bake-off: Haiku scouts (scout-split), plus an optional Haiku researcher arm

**What Haiku does.** It is the `source-scout` subagent only, doing breadth search and skimming. Scouts have no `capture_evidence` and no output contract. The synthesizer must fetch and capture evidence itself before citing anything (single-synthesizer is a critical principle, `packages/pack-research/src/index.ts:37-43`).

**Code changes before the eval:**
- `packages/research/src/plan.ts`, next to `:35-37`: export `SCOUT_MAX_TURNS = 8`, `SCOUT_EFFORT = 'low'`, `MAX_SCOUT_DISPATCHES_PER_SESSION = 8` and `MAX_WEB_SEARCH_CALLS_PER_SESSION = 40`. This declares the budget (research-budget-declared).
- `session.ts`, `SCOUT_AGENT` (`:72-81`): add `effort: SCOUT_EFFORT, maxTurns: SCOUT_MAX_TURNS`.
- `runSession`, after `sessionEnv(...)`:
  - When the session is orchestrated, set `env.CLAUDE_CODE_SUBAGENT_MODEL = scoutModel` and `env.CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION = '8'`. Otherwise delete `CLAUDE_CODE_SUBAGENT_MODEL`. This is the hard pin: the Agent tool's own `model` argument otherwise overrides the definition (`sdk-tools.d.ts:498-500`).
  - For every session with WebSearch, set `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION = '40'`. The cap counts calls, and each call can bill up to 8 searches. It also applies in production once merged. Apply it in every arm, and check against arm A that it rarely binds; today's default is 200.
- `DELEGATION_NOTE` (`:83-87`): state the dispatch cap and add two lines:
  - "A scout report that is a refusal, an error or empty is a dead end for that query, not evidence that no source exists. Search it yourself before declaring a gap."
  - "Scout quotes are leads; read the value from your own fetch and captured evidence."
- Tests in `session.test.ts`:
  - the scout definition carries `effort: 'low'` and `maxTurns: 8`
  - `CLAUDE_CODE_SUBAGENT_MODEL` equals `RESEARCH_SUBAGENT_MODEL`
  - non-orchestrated sessions do not have it
- Prerequisites: §3.1–3.4.

**Arms.** Every arm uses `VERIFIER_MODEL=claude-opus-5`, `ANTHROPIC_SMALL_FAST_MODEL=claude-haiku-4-5-20251001` and the same caps. Each runs 3 replicates of S1 and S2.

| Arm | Researcher | Scouts | Budget |
|---|---|---|---|
| A, control | production researcher (Sonnet 5, or Sonnet 5.5 if that ships first) | none | ≈$60 |
| C | same as A | `claude-haiku-5-5` | ≈$45–70 |
| B (optional) | `claude-haiku-5-5` | none | ≈$20–36 |
| D (optional, deep tier) | Opus 5.5 | `claude-haiku-5-5` | ≈$70 |

Audits cost about $25–40 on top: the snapshot-citation audit, plus a tier audit of 5 findings per arm and tenant. Stage 1 (A + B + C + audits) comes to about $150–270, with a **hard cap of $300**. D adds about $70.

**Scout stage-0 additions:**
- every subagent message (those with `parent_tool_use_id`) reports `claude-haiku-5-5`
- the scout request carried effort low
- the caps bind
- the region session has no Agent tool

**Arm B under-search gate.** A Haiku main loop also runs its own WebSearch side queries on Haiku 5.5, where forced tool use is demoted to auto (§7). Apply Stage 0 check `webSearchRequests > 0` to arm B, and track the share of arm-B sessions with zero billed searches.

**No-ship rules for any arm.** Any one of these stops the arm:
- any unsourced, verifier-fail or uncertain value on a negative control
- session completion below 95%, counting empty or unparseable output, refusals and turn-cap hits as failures
- schema validity below 100%
- any accepted value without an evidence snapshot
- the snapshot audit missing the value on more than 5% of passed findings
- verifier fail rate, or staff-confirmed error rate, more than 5 points above A

**Arm C passes only if all of these hold:**

| Measure | Threshold |
|---|---|
| Yield | ≥ A's yield |
| Verified accuracy | ≥ A − 0.05 |
| Gap rate | ≤ A + 5 points |
| Gaps where a scout failed and the synthesizer never searched | none |
| Verifier fail rate | ≤ A + 2 points |
| Accepted values resting only on a scout quote | 0 |
| Tier-1/2 share | ≥ A − 5 points |
| Tier-audit pass | ≥ 80% |
| All-in $ per verified finding, from `modelUsage` | ≤ 85% of A |
| Median synthesizer `num_turns` | ≥ 6 lower than A (the cost break-even) |
| Billed searches per session | ≤ 1.5× A |
| Scout calls that ran on `claude-haiku-5-5` | 100% |

**Arm B is eligible for bulk refresh only if all of these hold:**
- yield ≥ A − 0.10
- gap rate within ±10 points of A
- contested indicators ≤ A + 1
- tier-1/2 share ≥ 50%, and tier-audit pass ≥ 80%
- all-in $ per verified finding ≤ 50% of A

With about 42 indicator attempts per arm, the standard error of yield is about 0.08. Stage 1 can therefore reject a bad arm but cannot prove equivalence, which is what stage 2 is for. The prior is poor: in `docs/strategy-findings.md:40-73`, Sonnet alone had accuracy 0.50 and yield 0.33, while Opus orchestrating Sonnet scouts had accuracy 0.88 and yield 0.58. The synthesizer drove the accuracy.

**Do not combine arm B with a Haiku 5.5 page reader (§4.2)** without re-running the §4.2 judge A/B with both in place. The verifier would then see every page through the researcher's own model, which weakens verifier-independent-and-grounded (critical).

**Stage 2** runs only for an arm that passes. Run one full Bronx portrait on the winner twice and the control once, with normal staff review (≈$70–130). Pass requires at least 70% of red flags approved as-is (baseline 71%) and re-research plus reject at most 10% (baseline 8.5%). Only then:
- set `RESEARCH_SUBAGENT_MODEL=claude-haiku-5-5` in production
- update `docs/research-cost.md` and `packages/core/src/research-cost.ts` with the measured numbers

### 4.2 Page reader on Haiku 5.5 (cli-small-model-pin)

**What it is.** A single env value, `ANTHROPIC_SMALL_FAST_MODEL`, with no application code. The reader changes what both the researcher and the Opus judge "see", so it is evaluated on its own, separately from §4.1. Hold everything else fixed: `ANTHROPIC_MODEL=claude-sonnet-5` and `VERIFIER_MODEL=claude-opus-5`.

**Two cautions:**
- If the CLI's remote flag `tengu_plum_vx3` (default off) is ever on, WebSearch side queries also run on this model. In that case the switch changes search summaries in every session too. Check `modelUsage` for side-query tokens under the reader's key.
- Do not ship this together with a Haiku 5.5 researcher (§4.1 arm B) unless the judge A/B below is repeated with that researcher.

**Guardrails before the flip:** the `verifier.md` and `dimension-researcher.md` lines and the `models.retrieve` check from §3.5.

**Stage 1: isolated reader A/B on the judge.**
- Needs a new script that re-runs `runVerifier` over stored findings.
- Use at least 40 indicator findings that have snapshots, from S1 and S2, including every staff-confirmed error: ODS "99%", ghg-per-capita, landfill-reduction, safe-drinking-water and life-expectancy.
- Readers: Haiku 4.5 and Haiku 5.5, 2 replicates each, so 160 Opus sessions at about $0.26 each ≈ $42.
- Pass requires all of:

| Measure | Threshold |
|---|---|
| Passes on findings staff confirmed wrong | not above the 4.5 arm (hard gate) |
| Verdict agreement with the 4.5 arm | ≥ 90% |
| Pass recall on staff-approved findings | ≥ the 4.5 arm − 5 points |
| Uncertain rate | ≤ the 4.5 arm + 5 points |
| Fetch errors or "No response from model" | ≤ 1% of fetches |

**Stage 2: effect on researchers.**
- Run one S1 run with the Haiku 5.5 reader, and reuse §4.1 arm A as the 4.5 baseline. Cost ≈$20–40.
- Pass requires all of:
  - yield ≥ baseline − 0.10
  - gap rate within ±10 points
  - tier-1/2 share ≥ 50%
  - no critical `research-verify` violation
  - no fabricated negative-control value

**Cost gate.** The summarizer's spend, priced from `modelUsage` with thinking tokens included, must be at most 30% of the 4.5 arm.

**Budget:** about $65–100, capped at $150.

**On pass:** change the compose default to `${ANTHROPIC_SMALL_FAST_MODEL:-claude-haiku-5-5}`. Rollback is one env value.

### 4.3 Tier audit on Haiku 5.5 (tier-audit-haiku)

**Prompt v2 is a precondition.** `renderTierAuditPrompt` (`packages/research/src/measure.ts:437-487`) asks for "a source in any tier below ${claimed_tier}". For a tier-1 claim that set is empty, and all 5 tier failures in the NYC campaign were inflated tier-1 claims. As written, the audit would catch 0 of 5. Version 2 asks two questions:
- (a) Who actually produced the accepted number? What is that source's true tier?
- (b) Is there a better source: a higher tier, or the same tier at a finer scale or newer release?

The output schema has no value field.

**Run settings:**
- A new graphile task `apps/worker/src/tasks/tier-audit.ts`, enqueued after a dimension's verifiers settle.
- One audit per indicator finding with `schema_ok && url_ok`, about 18 per portrait.
- Call: `runSession` with `TIER_AUDIT_TOOLS`, `model: process.env.TIER_AUDIT_MODEL ?? 'claude-haiku-5-5'`, `maxTurns: 8`, `effort: 'medium'`, `outputFormat`, `orchestrate: false` and the run's funding key. No fallback.
- Coupling (§4.0 rule 7): if the researcher is a Haiku, run the audit on Sonnet 5.

**Flag rules,** in code, in `packages/research/src/tier-audit.ts`:
- If the true tier is above the claimed tier, raise "tier label may be overstated".
- If `better_source.exists`, the URL passes `assertPublicHttpsUrl` and it differs from `source_url`, raise "possible better source".
  - 401/403 is still flagged, labelled "bot-blocked, open manually".
  - 404 and DNS failures are stored but not flagged.
- Otherwise store "not found by audit", never "compliant".
- A refusal or error is stored as "audit did not run".
- A `found_url` becomes a rerun note only after staff confirm it.

**Storage:** `finding_audits` (migration 0014 or later, with RLS like `findings`), plus a staff-only chip on `ReviewCard`.

**Eval:**
- Replay 30 campaign tier-audit claims through a new `scripts/tier-audit-eval.ts`. The review briefs contain no URLs, so the inputs must be reconstructed from the campaign database or re-entered by staff.
- Labelled positives:
  - 5 tier-label failures: bronx homelessness-rate and cost-burdened-renters; manhattan food-insecurity and protected-land-share; staten-island poverty-rate.
  - About 6 better-source cases, such as the class-size borough workbooks and the DOHMH Staten Island PM2.5.
- Arms: Haiku 5.5 vs Sonnet 5, 2 replicates each.
- **Budget ≈$35, cap $50.**

**Haiku passes only if all of these hold:**
- tier-label recall ≥ 4/5, with at most 3 false flags across 25 negatives
- better-source recall ≥ 3/6, with precision ≥ 80%
- 0 HTTP 400s and 0 schema failures
- audits that did not run ≤ 1 of 60
- audits with zero `webSearchRequests` ≤ 10%
- replicate agreement ≥ 80%
- every metric within 10 points of Sonnet, or within 1 item on the 5-positive set
- ≤ $0.20 per audit

If Haiku fails but Sonnet passes, ship it on Sonnet 5 for about +$4 per portrait. If neither passes, the prompt is the problem, not the model.

**Shadow stage:** keep the audit on only if at least 60% of the first 50 flags lead to a relabel or a confirmed better source. Otherwise drop to the SPEC-v3 W3.5 sample of 5 per run.

### 4.4 Exhibit frame reader (pre-verify-triage, narrowed)

**Drop the Opus skip.** `scripts/publish-reviewed.ts:89` publishes any indicator with `verdict === 'pass' || allow.has(slug)`. Skipping Opus would let an `--allow`'d finding publish with no content verdict at all.

**Code does the lint:**
- a notes year that differs from `year` (skip FY, ranges and "5-year")
- unit `%` with 0 < value ≤ 1
- target/goal/projected/"by 20xx" keywords near the value; not the bare word "estimate", which matches every ACS figure
- the `level_pct` arithmetic
- locating the claimed number's formatting variants in the exhibit text, with about 300 characters of context

**Haiku's one job:** for each located passage, report the year, geography and kind (measured, target, projection or estimate) that the page prints for the value.

**Settings:**
- the §4.0 wrapper, effort `low`, structured output `{passages:[{quote, printed_year, printed_geography, printed_kind}], frame_notes ≤400 chars}`
- windows of at most 160K characters (≤80K Haiku tokens), at most 4 windows per finding
- input is the claim fields plus the window only; never the researcher's notes or reasoning
- coupling (§4.0 rule 7): if the researcher is a Haiku, run it on Sonnet 5

**Prerequisite:** `evidence.ts` must also store `innerText` as a new immutable object (`evidence/<hash>.txt`). PDFs need a new text-layer dependency, or are excluded in v1.

**Placement and display:**
- Run it next to `runVerifier` with `Promise.all`. It never enters the verifier prompt or `isFlagged`.
- Store it as `verification.precheck`.
- Show it on `ReviewCard` only for findings that are already flagged. "Not found" renders as neutral, because derived values are not expected to appear verbatim.
- Keep quotes only when they are exact substrings of the exhibit text.

**Eval:** shadow mode on every S1/S2 indicator finding from §4.1 (≈250 findings, ≈$1.25–12.50). Ground truth comes from the snapshot-citation audit. Seeded cases:
- TCOL 62%: printed for 2022, claimed 2024
- park-access 84.4%: an 85% target is printed next to it
- ghg-per-capita 5.3: the cited deck shows ~6.2
- food-insecurity 16.8%
- violent crime 5.51: derived, not printed

**Pass requires all of these:**

| Measure | Threshold |
|---|---|
| Indicator findings with exhibit text available | ≥ 60% (otherwise stop) |
| Raw hallucinated quotes, before the substring filter | ≤ 5% |
| Locate recall on values printed verbatim | ≥ 90% |
| Frame (year, geography, kind) correct on located passages | ≥ 95% |
| False frame-mismatch notes | ≤ 10% |
| Audit-identified frame errors caught | ≥ 2/3, and all seeded cases |
| Derived values left neutral | ≥ 90% |
| Unavailable or refused | ≤ 5% |
| Mean cost per portrait | ≤ $1 |
| Calls over 100K tokens | 0 |

**Stage 2:** a staff A/B on one portrait's flagged cards. If stage 1 or 2 fails, ship the code lint and number search alone.

### 4.5 Gap triage (gap-review)

**Stage 1** (code, §3.5) ships now.

**Stage 2 settings:**
- the §4.0 wrapper with `GAP_TRIAGE_MODEL`; unset means the model stage is off
- effort `low`
- input: the gap's `reason` and `nearest_data`, plus the dimension's accepted scales, recency rule and tier ladder
- output: `{category: no_data_at_scale | data_too_old | source_blocked | definition_mismatch | search_incomplete, concerns ≤3 × ≤200 chars}`, with no value field
- coupling guard: if `ANTHROPIC_MODEL` is a Haiku, run the triage on `claude-sonnet-5` instead

**What it must not change:**
- the gap verdict (`uncertain`, set at `research-apply.ts:202-206`)
- its note
- the review flag (`ReviewCard.tsx:61-63`)

**Eval:**
- Run offline through `scripts/triage-gaps.ts`, which writes a ledger and no DB rows.
- Input: every gap from the §4.1 arms, about 100–200. Haiku runs 3 times on each; Sonnet runs once as a reference.
- Ground truth:
  - the borough negative controls (aragonite saturation, ODS)
  - "found elsewhere": another replicate or arm got a verifier-passed value
  - 40 staff labels
- **Budget under $2.**

**Pass requires all of these:**
- 100% schema-valid output, 0 refusals, at most 2% failures
- at most 1 false concern across the controls, and 0 `search_incomplete` on a control
- at most 10% false concerns on honest gaps
- at least 1/3 of the found-elsewhere gaps newly caught that stage 1 missed (otherwise close the Haiku part)
- category accuracy ≥ 80%, stability ≥ 90%, agreement with Sonnet ≥ 80%
- at most $0.002 per gap

### 4.6 Exhibit validity label (exhibit-validity-check)

**Stage 1** (code, §3.5) ships now.

**Stage 2 settings:**
- the §4.0 wrapper with `EXHIBIT_CHECK_MODEL`; unset means off
- only HTML pages that code could not classify; not PDFs, and not overlay or consent-wall pages
- input: status, final URL, title, and `innerText` of at most 24,000 characters, fenced
- output: an enum `{is_document, kind, note ≤200}`; refusal or a timeout gives `unknown`

**Where the label goes:**
- It is written by the worker to `evidence/<hash>.check.json` and `FindingVerification.exhibit_kind`.
- It must never go into the researcher-copied `indicatorEvidenceSchema` (`validators.ts:21-25`), which flows to the public drilldown (`apps/web/app/[tenant]/dim/[slug]/page.tsx:141-153`).
- The advisory text to the researcher says: keep the source and its tier; recapture only with a direct `pdf_url`.

**Eval set:** at least 150 items, at least 30 of them non-documents. Every campaign evidence PNG is recaptured once to record status and text. Adversarial additions:
- about 20 URLs that block generic fetchers
- about 10 consent walls
- about 10 pages with injected instructions
- about 10 PDF landing pages

**Budget:** about $0.33, plus an optional in-session check for about $40.

**Pass requires all of these:**
- Haiku catches at least 25%, and at least 3, of the non-documents stage 1 missed (otherwise ship stage 1 only)
- false "not a document" ≤ 2%, with a Wilson 95% upper bound ≤ 5%
- 100% schema-valid output, 0 HTTP 400s, refusals ≤ 2%
- miss rate on injection items no worse than on clean block pages
- p95 latency ≤ 3 s, and ≤ $0.002 per call

**In-session check passes if all hold:**
- tier-1/2 share within 5 points of control
- yield ≥ control − 0.05
- gap rate within ±5 points
- zero tier-1 swaps after a `bot_block` advisory
- at most 5 recaptures per portrait

### 4.7 Newer-vintage probe (newer-vintage-probe)

**Settings:**
- staff-started only, never scheduled (`SPEC.md` §13)
- `runSession` with `model: VINTAGE_PROBE_MODEL = 'claude-haiku-5-5'` (a code constant), `effort: 'low'`, `maxTurns: 6`, `orchestrate: false`, no retry
- `envOverrides: {CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION: '2'}`
- `outputFormat {status: newer|none|unknown, data_year, release_date, geography_covered, url, quote ≤200}`

**Deterministic post-checks.** Any failure downgrades the result to `unknown`:
- `data_year` is greater than the published year
- the URL's registrable domain equals the source's
- the URL appears as a WebFetch input in the transcript
- the geography is within the accepted scales

**Display:**
- a separate `newerAvailable` field per row in `stalenessOverview` (`apps/web/lib/admin-data.ts:150`)
- reviewer notes are pre-filled with the URL only, labelled as an unverified lead; never the quote

**Eval:** about 50 staff-labelled items (20 positive, 20 negative, 10 traps). Arms: Haiku at effort low vs Sonnet 5. **Budget $8–40, cap $50.**

**Pass requires all of these:**
- precision of "newer" ≥ 90%, and no more than 5 points below Sonnet
- false "newer" ≤ 5% on negatives, and ≤ 1 of 10 traps
- recall ≥ 60% (misses are no worse than today, because the age flag stays)
- "unknown" ≤ 30%
- 100% schema-valid output
- 0 badges without an in-session fetch
- median ≤ $0.10 and p95 ≤ $0.30 per indicator

If Haiku fails but Sonnet passes, ship on Sonnet for about $4–5 per portrait sweep.

### 4.8 Any-city pre-flight (any-city-preflight, items 1–3 only)

**Drop item 4, gap prediction:**
- `scale_policy` already accepts regional and global scales for ocean-acidification (`packages/contract/src/index.ts:150`).
- `buildDoughnut` takes only `tenantSlug` (`research-actions.ts:56`).
- A predicted gap would replace a sourced result with a guess.

**Do the model-free fix first:** country-neutral tier-2 defaults (§3.5).

**Settings:**
- its own graphile runner; the research runner runs at concurrency 1 (`apps/worker/src/index.ts:18`)
- `runSession` with `model: PREFLIGHT_MODEL ?? 'claude-haiku-5-5'`, `effort: 'low'`, `maxTurns: 12`, `orchestrate: false`
- `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION=6` for this session only
- structured output

**Rules for proposals:**
- Every proposed field must cite a URL that was WebFetched in this session; unsourced fields are dropped.
- Staff accept fields one at a time; there is no "accept all".
- Each acceptance writes an audit row with `via: 'preflight'`.
- **The boundary text is reference-only.**
  - `config.region.definition` renders on the public methodology page (`apps/web/app/[tenant]/methodology/page.tsx:57`), so the proposed `boundary_definition` is shown to the owner with its source and is never copied into that field.
  - The owner writes the definition. Accepting it verbatim would put AI-drafted text on the public plane and needs the §8 Q5 decision.
  - Structured facts (official name, parent jurisdictions, portal URLs) and tier examples are different. Tier examples go only into prompts (`packages/research/src/plan.ts:44`), so these may be accepted field by field.

**Eval:** a gold set of 40 places:
- 15 ambiguous US places, including consolidated governments
- 15 places outside the US
- 10 thin-web small towns
- 3 seeded injections

Arms: Haiku vs Sonnet 5, 2 replicates each. **Hard cap $100.**

**Pass requires all of these:**
- correct jurisdiction and government form ≥ 95%, and no more than 3 points below Sonnet
- 0 confident wrong identities
- ambiguity flagged on ≥ 90% of ambiguous inputs
- ≥ 90% of portals on an official domain that resolves
- correct-country tier-2 examples ≥ 95%, with 0 US agencies proposed abroad
- ≤ 20% of fields dropped for missing sources
- 0 injected instructions in proposals
- schema-valid ≥ 98%
- p90 latency ≤ 120 s
- mean ≤ $0.25 and p95 ≤ $0.60

### 4.9 Policy quick scan (policy-quick-tier, direction-only)

**Only after the owner decides the billing unit** (§8). If a quick scan counts as a full session, do not build it.

**Settings:**
- `model: 'claude-haiku-5-5'` on the existing `runSessionWithRetry` call (`policy-analyze.ts:191-196`)
- `effort: 'medium'`, `maxTurns: 20`, no fallback
- an `outputFormat` quick schema without `indicator`, `projected_value` or `projected_year`; the worker also strips those fields before `projectDimensions`, so no wedge changes size
- refusal detection: no retry, and a specific message
- a "Quick scan: directions only, drafted by a fast model, sources not checked" banner, and a "Run full analysis" action that re-runs on Sonnet

**Eval:** 12 briefs (6 real, 3 sensitive, 2 injection, 1 with no web content). A runs Sonnet once; B runs Haiku twice. **Budget under $30.**

**Pass requires all of these:**
- completion ≥ 95% on non-sensitive briefs
- 0 injected instructions followed
- B flags ≥ 85% of the dimensions A rates moderate or large
- direction agreement with A ≥ 80%, and 0 opposite-sign disagreements where A is high-confidence
- replicate agreement ≥ 85%
- staff usefulness ≥ 4/5 on ≥ 75% of outputs
- ≤ $0.25 per scan and ≤ 30% of A's cost

### 4.10 Listing link drift (listing-link-drift)

**Stage 1** (code, §3.5) ships first.

**Stage 2 settings:**
- the §4.0 wrapper, only on 2xx HTML pages with at least 500 characters of visible text
- `max_tokens: 2000`; adaptive thinking counts against it, so 400 would truncate
- effort `low`
- verdict enum `{matches, program_ended, different_content, cannot_tell}` plus an `evidence_quote` that is shown only if it appears verbatim in the page
- deployment key only
- the job never writes `link_checked_at` or `published`. Today `link_checked_at` is written only by `markLinkChecked` (`involvement-admin-actions.ts:224-250`) and by the ops script `scripts/nyc-involvement.ts --apply` (`:385`; see §8 Q11).

**Eval:** about 115 cases × 3 replicates, under $1. Then 2 shadow sweeps, keeping the feature only if ≥ 80% of shadow flags are real. **Pass requires all of these:**
- Haiku false-flag rate ≤ 5% on the 85 current NYC URLs
- recall ≥ 90% on ended programs
- 100% of JavaScript shells and challenge pages end as "unknown"
- ≤ 1 of 10 injection cases suppressed to "matches"
- quotes verbatim on 100% of displayed flags
- replicate agreement ≥ 95%
- ≤ $0.003 per call

### 4.11 Involvement triage (involvement-triage-draft, phase 1)

**Settings:**
- a worker sweep job; `submitInvolvement` inserts without `RETURNING` (`involvement-actions.ts:169-172`)
- the §4.0 wrapper, effort `low`, `max_tokens: 2000`
- output: `{likely, suggested_kind, suggested_dimensions ≤3, concerns ≤3}`
- never selects `contact_name`, `email`, `phone` or `ip_hash`; scrubs email- and phone-shaped text from the pitch
- deployment key only, capped at 200 per portrait per day
- an advisory line on the staff page only; it never sorts or filters the queue

**Eval:** about 300 labelled cases, under $15.

| Measure | Threshold |
|---|---|
| False spam on genuine submissions | ≤ 2% |
| Spam recall | ≥ 90% |
| Injection cases still caught | ≥ 90% |
| Kind agreement | ≥ 70%, and ≥ 20 points above today's default |
| Refusals on genuine submissions | ≤ 1% |
| Contact strings in the outgoing request | 0 |

**Phase 2 (drafting listing text)** needs owner sign-off under SPEC-mobile §1.2. Drafts would be English-locale only, and at least 98% of drafts must add no claim absent from the input.

### 4.12 Comment pre-screen (comment-prescreen, part a only)

**Gates before any build:**
- **Need:** 4 weeks of queue data showing more than 20 held comments a day, the queue hitting `HELD_QUEUE_LIMIT`, or a median time-to-decision over 24 hours.
- **Privacy:** `/privacy` and `/terms` published (SPEC-mobile H17).

**Settings:**
- the §4.0 wrapper, enqueued only from `postComment`'s pending-approval branch (`discussion-actions.ts:140-149`)
- an enum category stored in a staff-only `comment_triage` table
- a badge on `/{tenant}/admin/discussion` only, never in `Thread.tsx`
- the queue order stays oldest-first

**Never build part (b) as designed.** Holding an already-published comment hides the replies under it, and makes a later decline replay as "never public" (`discussion.ts:100`, `:105-109`, `:455`).

**Shadow eval:** at least 300 held comments in at least 3 languages, about $0.10.
- decline recall ≥ 90%
- non-"ok" labels on approved comments ≤ 10%
- per-language recall ≥ 80%
- adversarial set: ≥ 18 of 20 still non-"ok"

### 4.13 Translation drafts (catalog-draft-qa)

**What it is:** an operator script, `scripts/draft-translations.ts`, with root devDependency `@anthropic-ai/sdk ^0.135.0`, run on the operator's own key. It does not touch the worker or the web runtime.

**Context:** the shipped catalogs are already machine-assisted drafts awaiting certified review (`docs/language-access.md:55-58`). This item changes the drafting tool, not the policy. Certified review remains the gate before an agency relies on the strings, and interface strings carry no AI chrome or model names (`SPEC.md:236`).

**Models:**
- Haiku drafts es, fr, pl, ru, ko, zh-Hans and zh-Hant at effort medium, and ar at effort high.
- ht, bn and ur are drafted on `claude-sonnet-5-5`.
- The checker (blind back-translation, then compare) runs on `claude-opus-5-5`.
- A guard refuses to run when `CHECK_MODEL === DRAFT_MODEL`.
- `DRAFT_MODEL` defaults to `claude-sonnet-5-5` until the eval passes.

**Harden tests in the same change:**
- the English pass-through check in `catalogs.test.ts:79-83`. Measured on 2026-10-16, `en.ts` has 414 string leaves and each catalog has 3–15 already identical to English, so roughly 29–43 untranslated new keys would still pass.
- `sw-offline.test.ts`: non-English text must differ from English

**Eval:** about 160 held-out keys with documented corrections (v5 and v6 worksheets). Haiku vs Sonnet 5.5, 3 replicates, graded blind by Opus 5.5. **About $30, cap $50.**

Pass requires all of these:
- 100% mechanical pass
- Haiku reproduces at most Sonnet's count + 1 of the 28 documented errors, and 0 of the emergency ones
- per-language error rate ≤ Sonnet + 2 points
- the checker finds ≥ 90% of documented errors

**Before building:** the translation files were being edited during this review. `en.ts` was modified at 08:34 and added `portrait.moreListings`, and all 12 catalogs were updated at 08:37 with that key. `translation-review-v6.md` also changed after 08:30. Re-check before building.

---

## 5. Not recommended

- **Region context on Haiku.** The saving is about $0.6–1.0 per portrait. Every extra 1K tokens of brief costs about $0.22 per portrait, because 21 Sonnet sessions re-read it on every turn. Nothing verifies the brief, and its failure is almost silent: a placeholder brief, and the run still completes. Do the §3.3 and §3.5 fixes instead. Reconsider only inside a broader Haiku arm, with a brief-level test.
- **Policy pre-scope.** The web plane has no model key; only the worker gets `ANTHROPIC_API_KEY` (`docker-compose.yml:146`). The check would run before any funding decision. A "likely affected" hint can anchor Sonnet away from second-order dimensions in an analysis that has no verifier. Break-even is about a 0.27% junk-paste rate, and no usage data exists.
- **BYOK spend probe on Haiku.** A Haiku pass proves nothing about Sonnet or Opus access. The CLI already classifies `billing_error` and `model_not_found`. Fix it with §3.5 at zero cost.
- **Run digest by Haiku.** Almost every bucket can be computed in code. The cause of a verifier fail belongs to the verifier, which read the page. Haiku would be labelling Opus's note about a Haiku 4.5 summary.
- **Transcript trail by Haiku.** The researcher is told "Return ONLY a JSON array", so stated reasons are mostly absent, and Haiku would invent them. Extract the trail in code, and add `rejected_sources` to the researcher's contract. The trail must never feed the auditors.
- **Schema repair.** `extractJson` already "succeeds" on a fragment of malformed JSON, so the repair trigger never fires on the cases it targets. The cases that do throw (empty output, refusal, prose only) cannot be repaired without inventing required fields. Fix partial salvage (§3.4).
- **Emergency curation.** Plan summaries render on the public emergency view (`apps/web/lib/emergency.ts:224`), and `docs/SPEC-v5.md:20-23` says that view contains no AI output. `nws_events` is a closed vocabulary, so validate it in code (§3.5).
- **Dimension researcher by default.** Accuracy and yield track the synthesizer's model (0.50 vs 0.88 accuracy). It can run as arm B in §4.1.
- **Verifier on Haiku.** verifier-independent-and-grounded is a critical principle, and `docs/strategy-findings.md:104` says "Verifier: always Opus". The saving would be at most $4.40 per portrait.

---

## 6. Cost

### Rates and assumptions

**Haiku 5.5** (from the model facts):

| Prompt length | Input | Output | Cache read | 5-min cache write | 1-hour cache write |
|---|---|---|---|---|---|
| ≤ 100K tokens | $0.10 | $0.50 | $0.01 | $0.125 | $0.20 |
| > 100K tokens | $0.50 | $2.50 | $0.05 | $0.625 | $1.00 |

**Tokenizer:** Haiku 5.5 counts the same text as about 1.3× the tokens. Every Haiku figure below applies ×1.3 to token counts estimated on today's tokenizer. On that basis, a research session's per-turn prompt crosses 100K at about turn 27, against about turn 36–37 today.

**Other models.** Input, output and cache read come from the model facts. The 5-minute cache-write column comes from `docs/research-cost.md:63-68` (1.25× input) and is not in the facts.

| Model | Input | Output | Cache read | 5-min cache write |
|---|---|---|---|---|
| Sonnet 5 | $2 | $10 | $0.20 | $2.50 |
| Sonnet 5.5 | $2 | $10 | $0.10 | $2.50 |
| Opus 5 | $5 | $25 | $0.50 | $6.25 |
| Opus 5.5 | $4 | $20 | $0.20 | $5 |

**Other charges:**
- Haiku 4.5 (today's reader) is $1/$5 per the CLI catalog. That figure is not in the model facts used here; confirm it.
- Web search is $10 per 1,000 searches on any model.

**Portrait assumptions** (`docs/research-cost.md:45-59`):
- 22 research sessions × 40 turns, with 10K fixed context, 2.5K added per turn and 1K output per turn
- about 18 verifier sessions
- about 330 searches

### Per portrait and NYC family

| Line (per portrait) | A. Today: Sonnet 5 + Opus 5 | B. Sonnet 5.5 + Opus 5.5 | C. Recommended: B + Haiku reader + Haiku checks | D. C + Haiku scouts | E. Reference: Haiku researcher |
|---|---|---|---|---|---|
| Research + region tokens | $26.35 | $21.35 | $21.35 | $21.35, then the scout delta below | $2–7 (40 turns) |
| Verifier (~18 sessions) | $4.60 | ≈$3.45 | ≈$3.45 | ≈$3.45 | ≈$3.45 |
| Web search (330) | $3.30 | $3.30 | $3.30 | $3.30 | $3.30 |
| WebFetch page reader | $1–7 | $1–7 | $0.15–1.15 | $0.15–1.15 | $0.15–1.15 |
| Haiku checks (tier audit, frame reader, gap triage, exhibit label) | — | — | $1.4–3.6 | $1.4–3.6 | — |
| Scout delta | — | — | — | −$7.2 (optimistic) to +$7.2 (pessimistic) | — |
| **Total per portrait** | **$35.3–41.3** (doc ≈$40) | **$29.1–35.1** (doc ≈$33) | **$29.7–32.9** | **$22.5–25.7** optimistic, or **$36.9–40.1** pessimistic | **$8.9–14.9** at 40 turns ($12.9–22.9 at 60) |
| **NYC family (×6)** | **$212–248** (doc ≈$200, `docs/research-cost.md:23`) | **$175–211** | **$178–197** | **$135–154** or **$221–240** | **$53–89** at 40 turns |

### Arithmetic

**Research tokens, A** (`docs/research-cost.md:75-78`):

| Item | Calculation | Cost |
|---|---|---|
| Cache reads | 50M × $0.20 | $10.00 |
| Cache writes | 2.3M × $2.50 | $5.75 |
| Uncached input | 0.3M × $2 | $0.60 |
| Output | 1.0M × $10 | $10.00 |
| **Total** | | **$26.35** |

**Research tokens, B:** cache reads become 50M × $0.10 = $5.00. Total: $5.00 + $5.75 + $0.60 + $10.00 = **$21.35**.

**Verifier on Opus 5.5** (my estimate). Model one ~6-turn session as about 25K cache writes, 90K cache reads and 6K output:

| Item | Opus 5 | Opus 5.5 |
|---|---|---|
| Cache writes (25K) | $0.156 | $0.125 |
| Cache reads (90K) | $0.045 | $0.018 |
| Output (6K) | $0.15 | $0.12 |
| **Session total** | **$0.351** | **$0.263** |

The ratio is 0.75, so $4.60 × 0.75 ≈ $3.45. Only the ratio is used. This modelled session (~$0.35 on Opus 5) is above the ~$0.26 per session implied by `docs/research-cost.md`'s $4.60 for 18 sessions.

**Page reader, per fetch:**

| Page | Haiku 4.5 | Haiku 5.5 | Ratio |
|---|---|---|---|
| Full page, 25K tokens | 25K × $1 + 1K × $5 = $0.030 | 32.5K × $0.10 + (1.3K + ~1K thinking at effort "high") × $0.50 = $0.0044 | ~6.8× |
| Typical page, 10K tokens | $0.0125 | $0.0021 | ~6× |

So $1–7 per portrait becomes about $0.15–1.15. WebFetch input is truncated at 100,000 characters, about 33K Haiku tokens, so every fetch stays on the ≤100K card.

**Haiku checks per portrait:**

| Check | Calculation | Cost |
|---|---|---|
| Tier audit | 18 × $0.07–0.17 (searches are $0.05–0.10 of that; the low end assumes the Haiku 5.5 reader, the high end the Haiku 4.5 reader) | $1.3–3.1 |
| Frame reader | typical | $0.05–0.40 |
| Gap triage | 20 × $0.0006 | ≈$0.01 |
| Exhibit label | ≤75 × $0.0011 | ≤$0.08 |
| **Total** | | **$1.4–3.6** |

With the Haiku 5.5 reader that column C assumes, the tier audit is nearer $1.3–2.2, so $1.4–3.6 is conservative. The net of C against B is the reader saving ($0.85–5.85) minus the checks ($1.4–3.6). That lands between $4.45 cheaper and $2.75 dearer.

**Scout delta, per session, Sonnet 5.5 synthesizer.** One 8-turn scout dispatch costs about $0.012 on Haiku 5.5: 29K writes × $0.125 + 114K reads × $0.01 + 8K output × $0.50, plus about $0.003 of WebSearch side queries. Its peak prompt is about 29K tokens.

| Case | Calculation | Per session |
|---|---|---|
| Control | $0.91 tokens + $0.15 search | $1.06 |
| Optimistic | synthesizer turns fall 40 → 20 ($0.42) + 6 dispatches ($0.07) + 3 extra synthesizer fetches ($0.075) + $0.15 search | $0.715, which is −$0.345 |
| Pessimistic | turns stay at 40 ($0.91) + $0.07 + $0.075 + $0.35 search (20 extra billed searches) | $1.405, which is +$0.345 |

Over 21 dimension sessions that is ±$7.2 per portrait. To break even, the synthesizer must shed about 6 turns per session.

**Deep tier, 21 dimension sessions only** (region, verifiers and search are extra):
- Opus 5.5 synthesizer at 20 turns with Haiku scouts: about $1.13 per session, so about $24.
- The measured design (Opus 5 + Sonnet 5 scouts): about $2.63 per session, so about $55.

**Haiku researcher (E), per 40-turn session.** The prompt is 13K + 3.25K per turn.

| Turns | Prompt card | Calculation | Cost |
|---|---|---|---|
| 1–26 | ≤100K | 1.405M reads × $0.01 + 74K uncached × $0.10–0.125 + 33.8K output × $0.50 | ≈$0.039 |
| 27–40 | >100K (54% of input) | 1.621M reads × $0.05 + 85K × $0.50–0.625 + 18.2K output × $2.50 | ≈$0.17–0.18 |
| **Session** | | | **≈$0.21–0.22** |

Over 22 sessions that is about $4.7. The measurement range of $2–7 allows for the tokenizer and for unfiltered search results entering context. Against B's $21.35 that saves about $14–19 per portrait; against A's $26.35, about $19–24.

**Off-portrait Haiku spend:**

| Job | Haiku 5.5 | Comparison |
|---|---|---|
| Vintage probe | $1.2–2.65 per portrait sweep | Sonnet 5: $3.9–5 |
| Pre-flight | $0.10–0.22 per new place, worst case $0.55 | Sonnet 5: $0.48–0.60 |
| Policy quick scan | ≈$0.10 | Sonnet full analysis: $0.69–1.69 |
| Link drift | ≈$0.12 per weekly sweep | |
| Involvement triage | ≈$0.0006 per submission | |
| Comment triage | ≈$0.0002 per held comment | |
| Translation drafts | ≈$2 per interface-string change, including the Opus 5.5 check | |

All of these figures are modelled. Price real runs from `modelUsage` with the §3.1 table. Never use `total_cost_usd`: on 0.3.220 it prices `claude-haiku-5-5` at $5/$25 and Sonnet 5 at $3/$15.

---

## 7. Haiku 5.5 constraints the code must respect

The short answer: current code sends none of the forbidden parameters. On SDK 0.3.220 it would still hit four things: effort "high", the unverified beta header, wrong cost reporting, and unhandled refusals. It would also hit the forced-search demotion inside WebSearch.

| Haiku 5.5 rule | deep-fryer today | What the code must do |
|---|---|---|
| Non-default `temperature`, `top_p` or `top_k` returns 400 | No call sets them. The CLI sends none for an unknown model id. | The new Messages wrapper must never send them. |
| Assistant prefill returns 400 | None on any path. Side calls are a single user message. | Keep it that way. |
| Adaptive thinking only; `budget_tokens` returns 400 | No `thinking` or `maxThinkingTokens` is set. The CLI sends `{type:'adaptive'}` for an unknown first-party id, and drops the "disabled" setting on WebFetch/WebSearch side calls. | Never pass thinking options. Size `max_tokens` to include thinking (≥1–2K even for classifications). |
| Effort defaults to medium | CLI 0.3.220 sends "high" for an unknown id. `CLAUDE_CODE_EFFORT_LEVEL` overrides `Options.effort`. | Pass effort explicitly (`Options.effort`, `AgentDefinition.effort`, `output_config.effort`). Never set `CLAUDE_CODE_EFFORT_LEVEL` worker-wide. Accept "high" on the page reader. |
| Forced tool use with thinking | The WebSearch side query forces the `web_search` tool. With adaptive thinking, the CLI demotes this to auto ("tool_choice … demoted to auto: extended thinking is active"). | A Haiku main loop or scout may answer a search from memory. Gate on `webSearchRequests > 0`, and require in-session fetched URLs for any claim. |
| Refusals: `stop_reason: 'refusal'`, no server-side fallback | 0.3.220 has no refusal fallback for this id. `session.ts` ignores `model_refusal_*` messages, so a refusal becomes a failed session after one paid retry. A reader refusal can come back as the literal "No response from model" in a successful tool result. | Detect refusals, do not retry, and map to unknown. Add the §3.5 prompt guard. A refusal must never read as fail, gap or "not found". |
| Tokenizer ~1.3× | Not accounted for anywhere. Token-based scores compare models wrongly. | Size windows and caps on Haiku's count. Compare arms in dollars. |
| Two rate cards at 100K | The CLI assumes a 200K context, so it autocompacts near 200K, and compaction summarizes with the main model. A long Haiku main loop sits on the >100K card from about turn 27. | Keep Haiku sessions short (`maxTurns` 6–12), or cap with `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (floor 100K). Meter per call (§3.1). |
| Web tools: no dynamic filtering (`web_search_20260209`, `web_fetch_20260209`) | Claude Code's WebSearch and WebFetch are client-side tools. The side query always uses `web_search_20250305` with `max_uses: 8`, on every model. WebFetch fetches locally and summarizes. | Nothing is lost compared with today. Search fees become the main cost of a Haiku session. Cap `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`, which counts calls; each call can bill up to 8 searches. |
| Structured outputs supported | Unused. Findings, verdicts and policy JSON are parsed out of prose by `extractJson`. | Use `outputFormat` (`sdk.d.ts:1726`, `result.structured_output`) or `output_config.format` for every new Haiku call. |
| Model id | 0.3.220 contains no 5.5 id (`grep haiku-5` finds 0). The alias `haiku` resolves to `claude-haiku-4-5`. In 0.3.301 it resolves to `claude-haiku-5-5`. | Always use the full id. Pin the SDK exactly and `ANTHROPIC_SMALL_FAST_MODEL` explicitly (§3.2). |
| Unknown-id side effects in 0.3.220 | Adds the `mid-conversation-system-2026-04-07` beta header (unverified 400 risk). Prices the id at $5/$25. Matches `claude-sonnet-5-5` and `claude-opus-5-5` by substring and treats them as Sonnet 5 / Opus 5 for capabilities and price. That last point also affects `docs/research-cost.md` recommendation 1 (see §8 Q3). | Run the Stage 0 smoke test (§4.0), or bump deliberately to 0.3.301. Price from your own table. |
| `fallbackModel` | Not set anywhere. It triggers on 404/403 naming the model, 5xx, 529 three times, and `model_blocked`. It does not trigger on 400, 429 or a refusal. Separately, the CLI's own refusal fallback is armed for `claude-opus-5` (cyber-category refusals are retried on `claude-opus-4-8`). | Never set `fallbackModel` on the verifier. It does not rescue an unknown-id 400 or a refusal. Record or disable the built-in refusal fallback (§3.5). |
| Org-key model access | Key validation calls only `models.list` (`apps/web/lib/anthropic-key.ts:96-111`). | Add `models.retrieve` for each configured id (§3.5). |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES` | — | Per the CLI code, it is ignored on the first-party API. Do not set it. |
| Subagent model | The Agent tool's `model` argument overrides `AgentDefinition.model`. | Set `CLAUDE_CODE_SUBAGENT_MODEL` per orchestrated session (§4.1). |

---

## 8. Open questions for the owner

1. **Funding for Haiku work outside a run.** `research_funding` has only `plan` and `organization_key` (migration 0012). Who pays for these: pre-flight, link drift, involvement and comment triage, the vintage probe, and the exhibit label on plan-funded runs? Options are deployment-absorbed with caps, or charged to the org.
2. **SDK version.** Bump deliberately to 0.3.301, which knows all three 5.5 ids, has two-card Haiku pricing and Haiku 5.5 prompt guidance? Or stay on 0.3.220 and rely on smoke tests? Either way, pin the version exactly.
3. **Order relative to the Sonnet 5.5 / Opus 5.5 move** (`docs/research-cost.md:82-88`). Bake-off arm A should be the production researcher.
   - On 0.3.220, the 5.5 ids are treated as Sonnet 5 / Opus 5.
   - Because of that, the CLI's WebSearch side query in a Sonnet 5.5 session would ask for thinking "disabled". That is a likely 400 if Sonnet 5.5 rejects disabled thinking, as `docs/research-cost.md:86-87` states.
   - That move therefore needs its own smoke test or the SDK bump.
4. **The verifier's eyes.** The "independent" Opus verifier reads every page through the same small model as the researcher. Do you accept that and document it, or fund a raw-text or archived-exhibit path that takes the reader out of the verdict (verify-against-the-archived-exhibit)?
5. **AI-drafted text that staff edit.** SPEC-mobile §1.2 bars "any AI-written text" from the app. SPEC-v5 §5 leaves "AI-suggested (staff plane only)" emergency content open. A decision is needed for:
   - involvement listing drafts
   - translation drafts of app strings (H14)
   - emergency summaries
   - a pre-flight-proposed region definition, which would render on the public methodology page
6. **Policy quick scan billing.** Does it count as a full session (then don't build it), or as a fractional unit? A fractional unit needs a migration, and `estimateRunCost` rejects fractions (`packages/core/src/research-cost.ts:56-58`).
7. **Privacy.** Sending resident comments and involvement pitches to a model processor needs `/privacy` and `/terms` (SPEC-mobile H17), plus a change to the "Your contact details go only to staff" copy (`apps/web/lib/i18n/messages/en.ts:334`).
8. **Tier audit scope.** Audit every indicator finding (about 18 per portrait, $1.3–3.1, and each flag is a staff disposition), or the SPEC-v3 W3.5 sample of 5 per run ($0.35–0.85)?
9. **Eval budget and operator.** Approve about $150–270 for the research bake-off (hard cap $300; arm D adds about $70), about $65–100 for the reader A/B (cap $150), and up to about $100 each for the smaller evals. All of it runs on the deployment key by an operator.
10. **Haiku 4.5 price for the rate table.** The CLI catalog says $1/$5. Confirm this, so today's reader is priced rather than reported as unpriced.
11. **Separate from Haiku.** `scripts/nyc-involvement.ts --apply` stamps `link_checked_at` on a bare 2xx response (`:27-33`, `:385`). Residents read that date as "Checked by staff on …". Should the script keep doing this?

---
