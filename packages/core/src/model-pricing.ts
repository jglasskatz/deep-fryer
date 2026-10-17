import type { ModelTokenUsage, SessionTokenUsage } from './types.js';

/**
 * Metering arithmetic (docs/haiku-5-5.md §3.1): how a session's recorded
 * usage is folded (mergeUsage) and turned into dollars (priceSessionUsage).
 * One pure module, because the worker (retries, the verifier accumulator),
 * the strategy scorecard (packages/research measure.ts) and the operator's
 * measurement script must all fold and price the same way — a second copy
 * of either is how a bake-off ends up comparing two different meters.
 *
 * Prices are our own table, never the SDK's: the Agent SDK's `costUSD` and
 * `total_cost_usd` come from the bundled CLI's catalog, which matches model
 * ids by substring (0.3.220 prices `claude-sonnet-5-5` as Sonnet 5) and does
 * not know the 5.5 models at all. So this module matches ids exactly and
 * reports any id it does not know as unpriced — it never guesses a price.
 */

/** US dollars per million tokens. */
export interface ModelRates {
  input: number;
  output: number;
  cacheRead: number;
}

/**
 * A model's rate card. `longPrompt`, when present, applies to every token
 * of an API call whose prompt exceeded LONG_PROMPT_THRESHOLD_TOKENS — the
 * call's output included — and `standard` to the rest. Models without it
 * have one card.
 */
export interface ModelPricing {
  standard: ModelRates;
  longPrompt?: ModelRates;
}

/**
 * The prompt size above which a two-card model bills the whole call on its
 * long-prompt card. Prompt = input + cache read + cache write, per API call
 * (which is why the worker splits usage per call as it streams, into
 * ModelTokenUsage.long_prompt: a per-model total cannot be split after the fact).
 */
export const LONG_PROMPT_THRESHOLD_TOKENS = 100_000;

/**
 * Cache writes cost 1.25× the input rate: the 5-minute write price, the
 * only TTL the CLI uses for these sessions. The SDK's `modelUsage` does not
 * split writes by TTL, so every write is priced at this rate; if 1-hour
 * caching is ever enabled, its writes cost 2× input and this undercounts.
 */
export const CACHE_WRITE_MULTIPLIER = 1.25;

/** Server-side web search: $10 per 1,000 requests, on every model. */
export const WEB_SEARCH_USD_PER_REQUEST = 0.01;

/**
 * Rates by exact model id (docs/haiku-5-5.md §3.1). Input, output and
 * cache-read rates are the published model rates; cache writes are derived
 * (CACHE_WRITE_MULTIPLIER), which reproduces the published 5-minute write
 * rates and the Sonnet and Opus write rates in docs/research-cost.md.
 *
 * `claude-haiku-4-5` is today's page reader (ANTHROPIC_SMALL_FAST_MODEL,
 * pinned to `claude-haiku-4-5-20251001`, which the release-date rule below
 * matches). Its row is the published first-party rate — $1 input, $1.25
 * 5-minute cache write, $0.10 cache read, $5 output per million tokens, at
 * any prompt length — checked against Anthropic's pricing page on
 * 2026-10-17 rather than taken from the bundled CLI's catalog. Before it
 * was added, every run that fetched a page reported its dollars as a lower
 * bound. A model not in this table is unpriced (modelPricing), never
 * guessed.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPricing>> = {
  'claude-sonnet-5': { standard: { input: 2, output: 10, cacheRead: 0.2 } },
  'claude-sonnet-5-5': { standard: { input: 2, output: 10, cacheRead: 0.1 } },
  'claude-opus-5': { standard: { input: 5, output: 25, cacheRead: 0.5 } },
  'claude-opus-5-5': { standard: { input: 4, output: 20, cacheRead: 0.2 } },
  'claude-haiku-5-5': {
    standard: { input: 0.1, output: 0.5, cacheRead: 0.01 },
    longPrompt: { input: 0.5, output: 2.5, cacheRead: 0.05 },
  },
  'claude-haiku-4-5': { standard: { input: 1, output: 5, cacheRead: 0.1 } },
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The table entry for `modelId`, or null when the table does not price
 * it. A model id matches a table id only as `^id(-\d{8})?$` — the id
 * itself or the id with a release-date suffix (`claude-haiku-4-5-20251001`).
 * Never by prefix or substring: `claude-sonnet-5-5` must not match
 * `claude-sonnet-5`, and an id we have not seen (`claude-opus-5[1m]`, a
 * provider-specific id) is unpriced rather than priced as its neighbour.
 */
export function modelPricing(modelId: string): ModelPricing | null {
  for (const [id, pricing] of Object.entries(MODEL_PRICES)) {
    if (new RegExp(`^${escapeRegExp(id)}(-\\d{8})?$`).test(modelId)) return pricing;
  }
  return null;
}

/**
 * Pure: `modelId` without a trailing `-YYYYMMDD` release date — the same
 * equivalence modelPricing uses, for matching a dated id the API returned
 * on a message against the undated id the CLI keys `modelUsage` by.
 */
export function baseModelId(modelId: string): string {
  return modelId.replace(/-\d{8}$/, '');
}

type TokenFields = { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number };

function priceTokens(t: TokenFields, r: ModelRates): number {
  return (
    (t.input_tokens * r.input +
      t.output_tokens * r.output +
      t.cache_read_tokens * r.cacheRead +
      t.cache_write_tokens * r.input * CACHE_WRITE_MULTIPLIER) /
    1_000_000
  );
}

/**
 * Dollars for one model's tokens (not its web searches, which are priced
 * per request whatever the model), or null when the model is unpriced.
 * A two-card model prices its `long_prompt` share on the long card and the
 * remainder on the standard card. The remainder is clamped at zero: the
 * split comes from the streamed frames and the totals from the SDK's
 * result, and a long-prompt figure larger than its total must not turn
 * into a credit.
 */
export function priceModelTokens(modelId: string, usage: ModelTokenUsage): number | null {
  const pricing = modelPricing(modelId);
  if (!pricing) return null;
  const long = pricing.longPrompt ? usage.long_prompt : undefined;
  if (!long || !pricing.longPrompt) return priceTokens(usage, pricing.standard);
  const rest: TokenFields = {
    input_tokens: Math.max(0, usage.input_tokens - long.input_tokens),
    output_tokens: Math.max(0, usage.output_tokens - long.output_tokens),
    cache_read_tokens: Math.max(0, usage.cache_read_tokens - long.cache_read_tokens),
    cache_write_tokens: Math.max(0, usage.cache_write_tokens - long.cache_write_tokens),
  };
  return priceTokens(rest, pricing.standard) + priceTokens(long, pricing.longPrompt);
}

/**
 * Stands in for the model of a record that never said which model ran (rows
 * from before per-model metering): in priceSessionUsage's `unpriced`, and as
 * a `by_model` key when mergeUsage folds such a row with a per-model one.
 * It matches no MODEL_PRICES row, so its tokens always read as unpriced.
 */
export const UNRECORDED_MODEL = '(model not recorded)';

/**
 * What a session's usage cost, in US dollars, and which models it could
 * not price. `dollars` covers every priced model's tokens plus every web
 * search; while `unpriced` is non-empty it is a lower bound, and a caller
 * comparing strategies must treat the total as unknown rather than compare
 * a partial figure.
 *
 * Pricing reads `by_model`, which covers everything the session spent
 * (main loop, subagents, the CLI's side calls). A record without it — a
 * row from before per-model metering — is priced from its main-loop fields
 * on its `model` when that is recorded; with no model either, its tokens
 * are reported as unpriced under UNRECORDED_MODEL, never assigned a model.
 */
export function priceSessionUsage(usage: SessionTokenUsage): { dollars: number; unpriced: string[] } {
  const unpriced: string[] = [];
  let dollars = 0;
  if (usage.by_model) {
    for (const [modelId, u] of Object.entries(usage.by_model)) {
      dollars += u.web_search_requests * WEB_SEARCH_USD_PER_REQUEST;
      const tokens = priceModelTokens(modelId, u);
      if (tokens === null) {
        if (u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens > 0) unpriced.push(modelId);
      } else {
        dollars += tokens;
      }
    }
    return { dollars, unpriced: [...new Set(unpriced)].sort() };
  }
  const mainLoop = mainLoopUsage(usage);
  const total = mainLoop.input_tokens + mainLoop.output_tokens + mainLoop.cache_read_tokens + mainLoop.cache_write_tokens;
  if (total === 0) return { dollars: 0, unpriced: [] };
  const tokens = usage.model ? priceModelTokens(usage.model, mainLoop) : null;
  if (tokens === null) return { dollars: 0, unpriced: [usage.model ?? UNRECORDED_MODEL] };
  return { dollars: tokens, unpriced: [] };
}

/** A usage record with nothing in it, the identity for mergeUsage. */
export function emptyUsage(): SessionTokenUsage {
  return { input_tokens: 0, output_tokens: 0 };
}

const add = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);

function mergeModelUsage(a: ModelTokenUsage | undefined, b: ModelTokenUsage | undefined): ModelTokenUsage {
  const zero = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };
  const x = a ?? { ...zero, web_search_requests: 0 };
  const y = b ?? { ...zero, web_search_requests: 0 };
  const merged: ModelTokenUsage = {
    input_tokens: x.input_tokens + y.input_tokens,
    output_tokens: x.output_tokens + y.output_tokens,
    cache_read_tokens: x.cache_read_tokens + y.cache_read_tokens,
    cache_write_tokens: x.cache_write_tokens + y.cache_write_tokens,
    web_search_requests: x.web_search_requests + y.web_search_requests,
  };
  if (x.long_prompt || y.long_prompt) {
    const lx = x.long_prompt ?? zero;
    const ly = y.long_prompt ?? zero;
    merged.long_prompt = {
      input_tokens: lx.input_tokens + ly.input_tokens,
      output_tokens: lx.output_tokens + ly.output_tokens,
      cache_read_tokens: lx.cache_read_tokens + ly.cache_read_tokens,
      cache_write_tokens: lx.cache_write_tokens + ly.cache_write_tokens,
    };
  }
  return merged;
}

/** A record's main-loop token fields, as one model's usage (no web searches: only `by_model` counts those). */
function mainLoopUsage(u: SessionTokenUsage): ModelTokenUsage {
  return {
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_read_tokens: u.cache_read_tokens ?? 0,
    cache_write_tokens: u.cache_write_tokens ?? 0,
    web_search_requests: 0,
  };
}

/**
 * A record whose tokens only its `model` field attributes: it has tokens but
 * no `by_model` — a row from before per-model metering, with or without a
 * model. Such a record's tokens are priced on its own `model` or reported as
 * UNRECORDED_MODEL (priceSessionUsage), so a fold must keep that attribution
 * with the tokens instead of letting another record's `model` or `by_model`
 * stand in for it.
 */
function isLoose(u: SessionTokenUsage): boolean {
  if (u.by_model) return false;
  const t = mainLoopUsage(u);
  return t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_write_tokens > 0;
}

/** Whom a loose record's tokens belong to: its model, or UNRECORDED_MODEL when it never said. */
const attributedTo = (u: SessionTokenUsage): string => u.model ?? UNRECORDED_MODEL;

/**
 * A record's tokens model by model: its own `by_model`; for a loose record,
 * its main-loop tokens under attributedTo; for a record with no tokens and
 * no `by_model`, nothing.
 */
function byModelOf(u: SessionTokenUsage): Record<string, ModelTokenUsage> {
  if (u.by_model) return u.by_model;
  return isLoose(u) ? { [attributedTo(u)]: mainLoopUsage(u) } : {};
}

/**
 * Pure: two usage records folded into one — both attempts of a retried
 * session, a dimension's verifier sessions, a run's records. Every count
 * is summed, `by_model` model by model (its long-prompt share included),
 * so nothing the second record lacks is dropped from the first. Fields
 * absent from both stay absent, so folding old rows gives an old-shaped row.
 *
 * Attribution survives the fold, so the folded record prices exactly as
 * its parts would (priceSessionUsage reads `by_model` whenever it exists,
 * and the main-loop fields on `model` only when it does not):
 * - A loose record (tokens, no `by_model` — a row from before per-model
 *   metering) folded with a record that has `by_model` joins it as a
 *   `by_model` entry under its own model, or UNRECORDED_MODEL when it has
 *   none. Otherwise its tokens would sit only in the main-loop fields, which
 *   pricing then ignores: a scorecard mixing old and new runs would read a
 *   partial dollar figure as complete.
 * - Two loose records attributed to different models (or one to none) are
 *   folded into a `by_model` for the same reason.
 * - Loose records that agree keep the old shape; the result's `model` is
 *   theirs, never that of a record with no tokens in the fold — a model
 *   only one side named must not end up pricing the other side's tokens.
 *
 * The descriptive fields cannot be summed:
 * - `model` is otherwise kept when the records agree (or only one has it)
 *   and left out when they disagree — `by_model` still names every model
 *   that ran.
 * - `result_subtype`, `terminal_reason` and `stop_reason` describe how a
 *   session ended, so `b`'s (the later attempt's) win when it has them.
 * - `partial` is true if either record is partial: some side-call spend in
 *   the fold went unrecorded.
 */
export function mergeUsage(a: SessionTokenUsage, b: SessionTokenUsage): SessionTokenUsage {
  const out: SessionTokenUsage = {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
  };
  const cacheRead = add(a.cache_read_tokens, b.cache_read_tokens);
  if (cacheRead !== undefined) out.cache_read_tokens = cacheRead;
  const cacheWrite = add(a.cache_write_tokens, b.cache_write_tokens);
  if (cacheWrite !== undefined) out.cache_write_tokens = cacheWrite;

  const looseOwners = new Set([a, b].filter(isLoose).map(attributedTo));
  if (a.by_model || b.by_model || looseOwners.size > 1) {
    const x = byModelOf(a);
    const y = byModelOf(b);
    const byModel: Record<string, ModelTokenUsage> = {};
    for (const id of new Set([...Object.keys(x), ...Object.keys(y)])) byModel[id] = mergeModelUsage(x[id], y[id]);
    out.by_model = byModel;
  }

  if (!out.by_model && looseOwners.size === 1) {
    // Every token in the fold belongs to this one owner (the other record
    // has none), so the old-shaped result is attributed to it alone.
    const [owner] = looseOwners;
    if (owner !== UNRECORDED_MODEL) out.model = owner;
  } else if (a.model && b.model) {
    if (a.model === b.model) out.model = a.model;
  } else if (a.model ?? b.model) {
    out.model = a.model ?? b.model;
  }

  const turns = add(a.num_turns, b.num_turns);
  if (turns !== undefined) out.num_turns = turns;
  const subtype = b.result_subtype ?? a.result_subtype;
  if (subtype !== undefined) out.result_subtype = subtype;
  const terminal = b.terminal_reason ?? a.terminal_reason;
  if (terminal !== undefined) out.terminal_reason = terminal;
  const stop = b.stop_reason !== undefined ? b.stop_reason : a.stop_reason;
  if (stop !== undefined) out.stop_reason = stop;
  const refusals = add(a.refusals, b.refusals);
  if (refusals !== undefined) out.refusals = refusals;
  if (a.refusal_fallbacks || b.refusal_fallbacks) {
    out.refusal_fallbacks = [...(a.refusal_fallbacks ?? []), ...(b.refusal_fallbacks ?? [])];
  }
  if (a.partial || b.partial) out.partial = true;
  return out;
}

/**
 * Pure: every model a usage record says ran — its main model and each
 * `by_model` key — deduplicated and sorted. A run row does not record its
 * strategy's models, so the measurement script reports this per run.
 */
export function modelsInUsage(usage: SessionTokenUsage): string[] {
  const models = new Set(Object.keys(usage.by_model ?? {}));
  if (usage.model) models.add(usage.model);
  return [...models].sort();
}
