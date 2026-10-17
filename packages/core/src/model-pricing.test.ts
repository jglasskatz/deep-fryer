import { describe, expect, it } from 'vitest';
import {
  CACHE_WRITE_MULTIPLIER,
  LONG_PROMPT_THRESHOLD_TOKENS,
  UNRECORDED_MODEL,
  baseModelId,
  emptyUsage,
  mergeUsage,
  modelPricing,
  modelsInUsage,
  priceModelTokens,
  priceSessionUsage,
} from './model-pricing.js';
import type { ModelTokenUsage, SessionTokenUsage } from './types.js';

const M = 1_000_000;
const tokens = (input: number, output: number, cacheRead = 0, cacheWrite = 0, searches = 0): ModelTokenUsage => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_tokens: cacheRead,
  cache_write_tokens: cacheWrite,
  web_search_requests: searches,
});

describe('modelPricing', () => {
  it('matches an exact id or the id with a release date, nothing else', () => {
    expect(modelPricing('claude-sonnet-5')?.standard.input).toBe(2);
    expect(modelPricing('claude-sonnet-5-20260301')?.standard.input).toBe(2);
    // The 5.5 models are their own rows, never their neighbour's by prefix…
    expect(modelPricing('claude-sonnet-5-5')?.standard.cacheRead).toBe(0.1);
    expect(modelPricing('claude-opus-5-5')?.standard.input).toBe(4);
    // …and anything that is not exactly a known id is unpriced, not guessed.
    for (const id of ['claude-sonnet-5[1m]', 'claude-opus-5-latest', 'us.anthropic.claude-opus-5', 'claude-sonnet', 'claude-opus-5-2026', 'xclaude-opus-5']) {
      expect(modelPricing(id)).toBeNull();
    }
  });

  it('prices Haiku 4.5, the page reader, under its alias and its pinned dated id', () => {
    // Published rate: $1 input, $1.25 5-minute cache write, $0.10 cache read, $5 output.
    for (const id of ['claude-haiku-4-5', 'claude-haiku-4-5-20251001']) {
      expect(modelPricing(id)).toEqual({ standard: { input: 1, output: 5, cacheRead: 0.1 } });
      expect(priceModelTokens(id, tokens(M, M, M, M))).toBeCloseTo(1 + 5 + 0.1 + 1.25, 10);
    }
    // One page summary: 5,000 tokens in, 300 out ≈ $0.0065, and nothing left unpriced.
    const priced = priceSessionUsage({ ...emptyUsage(), by_model: { 'claude-haiku-4-5-20251001': tokens(5000, 300) } });
    expect(priced.unpriced).toEqual([]);
    expect(priced.dollars).toBeCloseTo((5000 * 1 + 300 * 5) / M, 12);
    // A different Haiku is still not priced as this one.
    expect(modelPricing('claude-haiku-4')).toBeNull();
    expect(modelPricing('claude-3-5-haiku-20241022')).toBeNull();
  });

  it('strips only a trailing release date', () => {
    expect(baseModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
    expect(baseModelId('claude-sonnet-5-5')).toBe('claude-sonnet-5-5');
  });
});

describe('priceModelTokens', () => {
  it('prices cache writes at 1.25× input and cache reads at their own rate', () => {
    expect(CACHE_WRITE_MULTIPLIER).toBe(1.25);
    // Opus 5: $5 in, $25 out, $0.50 cache read, $6.25 cache write per MTok.
    expect(priceModelTokens('claude-opus-5', tokens(M, M, M, M))).toBeCloseTo(5 + 25 + 0.5 + 6.25, 10);
    // Sonnet 5: $2 / $10 / $0.20 / $2.50.
    expect(priceModelTokens('claude-sonnet-5', tokens(M, M, M, M))).toBeCloseTo(2 + 10 + 0.2 + 2.5, 10);
    // Opus 5.5: $4 / $20 / $0.20 / $5.
    expect(priceModelTokens('claude-opus-5-5', tokens(M, M, M, M))).toBeCloseTo(4 + 20 + 0.2 + 5, 10);
  });

  it('splits Haiku 5.5 across its two cards on the long-prompt share', () => {
    const usage: ModelTokenUsage = {
      ...tokens(300_000, 20_000, 1_000_000, 100_000),
      long_prompt: { input_tokens: 50_000, output_tokens: 5_000, cache_read_tokens: 800_000, cache_write_tokens: 20_000 },
    };
    // ≤100K card on the remainder: 250K in × 0.10, 15K out × 0.50, 200K read × 0.01, 80K write × 0.125.
    const standard = (250_000 * 0.1 + 15_000 * 0.5 + 200_000 * 0.01 + 80_000 * 0.125) / M;
    // >100K card on the long calls, output included: 50K × 0.50, 5K × 2.50, 800K × 0.05, 20K × 0.625.
    const long = (50_000 * 0.5 + 5_000 * 2.5 + 800_000 * 0.05 + 20_000 * 0.625) / M;
    expect(priceModelTokens('claude-haiku-5-5', usage)).toBeCloseTo(standard + long, 12);
    expect(standard + long).toBeCloseTo(0.1345, 12);
    // Priced on the ≤100K card alone, the same usage would read less than half its cost.
    expect(priceModelTokens('claude-haiku-5-5', { ...usage, long_prompt: undefined })).toBeCloseTo(0.0625, 12);
    expect(LONG_PROMPT_THRESHOLD_TOKENS).toBe(100_000);
  });

  it('never credits a long-prompt share larger than its total', () => {
    const usage: ModelTokenUsage = {
      ...tokens(10, 0),
      long_prompt: { input_tokens: 200_000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
    };
    expect(priceModelTokens('claude-haiku-5-5', usage)).toBeCloseTo((200_000 * 0.5) / M, 12);
  });

  it('ignores a long-prompt share on a one-card model', () => {
    const usage: ModelTokenUsage = {
      ...tokens(M, 0),
      long_prompt: { input_tokens: M, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
    };
    expect(priceModelTokens('claude-sonnet-5', usage)).toBeCloseTo(2, 10);
  });
});

describe('priceSessionUsage', () => {
  it('prices every model a session used, plus $0.01 per web search', () => {
    const usage: SessionTokenUsage = {
      input_tokens: 1,
      output_tokens: 1,
      by_model: {
        'claude-sonnet-5': tokens(M, 100_000, 2 * M, 500_000, 12),
        'claude-haiku-4-5-20251001': tokens(400_000, 20_000),
      },
    };
    const priced = priceSessionUsage(usage);
    // Sonnet 5: $2 + $1 + $0.40 + $1.25; 12 searches $0.12; the page reader 400K × $1 + 20K × $5 = $0.50.
    expect(priced.dollars).toBeCloseTo(2 + 1 + 0.4 + 1.25 + 0.12 + 0.5, 10);
    expect(priced.unpriced).toEqual([]);
  });

  it('names a model it cannot price and leaves its tokens out of the lower bound', () => {
    const usage: SessionTokenUsage = {
      input_tokens: 1,
      output_tokens: 1,
      by_model: {
        'claude-sonnet-5': tokens(M, 0),
        'claude-sonnet-5[1m]': tokens(400_000, 20_000),
      },
    };
    expect(priceSessionUsage(usage)).toEqual({ dollars: 2, unpriced: ['claude-sonnet-5[1m]'] });
  });

  it('reads old rows: main-loop fields on a recorded model, or unpriced with none', () => {
    expect(priceSessionUsage({ input_tokens: M, output_tokens: 0, model: 'claude-opus-5' })).toEqual({ dollars: 5, unpriced: [] });
    expect(priceSessionUsage({ input_tokens: 1200, output_tokens: 340 })).toEqual({ dollars: 0, unpriced: [UNRECORDED_MODEL] });
    expect(priceSessionUsage(emptyUsage())).toEqual({ dollars: 0, unpriced: [] });
  });
});

describe('mergeUsage', () => {
  const first: SessionTokenUsage = {
    input_tokens: 100,
    output_tokens: 10,
    cache_read_tokens: 1000,
    cache_write_tokens: 50,
    model: 'claude-sonnet-5',
    by_model: {
      'claude-sonnet-5': { ...tokens(100, 10, 1000, 50, 2), long_prompt: { input_tokens: 5, output_tokens: 1, cache_read_tokens: 900, cache_write_tokens: 0 } },
    },
    num_turns: 4,
    result_subtype: 'error_max_turns',
    terminal_reason: 'max_turns',
    stop_reason: 'tool_use',
    refusals: 1,
    partial: true,
  };
  const second: SessionTokenUsage = {
    input_tokens: 200,
    output_tokens: 20,
    cache_read_tokens: 2000,
    cache_write_tokens: 60,
    model: 'claude-sonnet-5',
    by_model: {
      'claude-sonnet-5': tokens(200, 20, 2000, 60, 3),
      'claude-haiku-4-5-20251001': tokens(7, 3),
    },
    num_turns: 9,
    result_subtype: 'success',
    terminal_reason: 'completed',
    stop_reason: null,
    refusal_fallbacks: [{ original_model: 'claude-opus-5', fallback_model: 'claude-opus-4-8', category: 'cyber' }],
  };

  it('sums every count, model by model, and keeps the later attempt’s outcome', () => {
    expect(mergeUsage(first, second)).toEqual({
      input_tokens: 300,
      output_tokens: 30,
      cache_read_tokens: 3000,
      cache_write_tokens: 110,
      model: 'claude-sonnet-5',
      by_model: {
        'claude-sonnet-5': { ...tokens(300, 30, 3000, 110, 5), long_prompt: { input_tokens: 5, output_tokens: 1, cache_read_tokens: 900, cache_write_tokens: 0 } },
        'claude-haiku-4-5-20251001': tokens(7, 3),
      },
      num_turns: 13,
      result_subtype: 'success',
      terminal_reason: 'completed',
      stop_reason: null,
      refusals: 1,
      refusal_fallbacks: [{ original_model: 'claude-opus-5', fallback_model: 'claude-opus-4-8', category: 'cyber' }],
      partial: true,
    });
  });

  it('folds old rows into an old-shaped row, and is an identity with emptyUsage', () => {
    expect(mergeUsage({ input_tokens: 1, output_tokens: 2 }, { input_tokens: 3, output_tokens: 4 })).toEqual({ input_tokens: 4, output_tokens: 6 });
    expect(mergeUsage(emptyUsage(), second)).toEqual(second);
  });

  it('keeps an old row’s tokens priced as unpriced when it is folded with a per-model row', () => {
    const old: SessionTokenUsage = { input_tokens: 2 * M, output_tokens: 300_000 };
    const fresh: SessionTokenUsage = {
      input_tokens: 1000,
      output_tokens: 100,
      model: 'claude-sonnet-5',
      by_model: { 'claude-sonnet-5': tokens(1000, 100) },
    };
    const sonnetOnly = (1000 * 2 + 100 * 10) / M;
    for (const merged of [[old, fresh].reduce(mergeUsage, emptyUsage()), mergeUsage(fresh, old)]) {
      expect(merged.input_tokens).toBe(2_001_000);
      // The old tokens join by_model under the stand-in, so they are not silently left out of the price.
      expect(merged.by_model).toEqual({ 'claude-sonnet-5': tokens(1000, 100), [UNRECORDED_MODEL]: tokens(2 * M, 300_000) });
      const priced = priceSessionUsage(merged);
      expect(priced.unpriced).toEqual([UNRECORDED_MODEL]);
      expect(priced.dollars).toBeCloseTo(sonnetOnly, 12);
    }
    // An old row that did name its model is priced on it, as it would be alone.
    const oldOpus: SessionTokenUsage = { input_tokens: M, output_tokens: 0, model: 'claude-opus-5' };
    expect(priceSessionUsage(mergeUsage(oldOpus, fresh))).toEqual({ dollars: 5 + sonnetOnly, unpriced: [] });
  });

  it('never lets one record’s model price another record’s unattributed tokens', () => {
    const old: SessionTokenUsage = { input_tokens: 1200, output_tokens: 340 };
    // A record with a model but no tokens (a session refused before any call) is not the old row's model.
    const refused: SessionTokenUsage = { input_tokens: 0, output_tokens: 0, model: 'claude-opus-5' };
    for (const merged of [mergeUsage(old, refused), mergeUsage(refused, old)]) {
      expect(merged).toEqual({ input_tokens: 1200, output_tokens: 340 });
      expect(priceSessionUsage(merged)).toEqual({ dollars: 0, unpriced: [UNRECORDED_MODEL] });
    }
    // Two old rows on different models are priced each on its own.
    const merged = mergeUsage({ input_tokens: M, output_tokens: 0, model: 'claude-opus-5' }, { input_tokens: M, output_tokens: 0, model: 'claude-sonnet-5' });
    expect(merged.by_model).toEqual({ 'claude-opus-5': tokens(M, 0), 'claude-sonnet-5': tokens(M, 0) });
    expect(priceSessionUsage(merged)).toEqual({ dollars: 7, unpriced: [] });
    // Old rows that agree keep the old shape and their model.
    expect(mergeUsage({ input_tokens: M, output_tokens: 0, model: 'claude-opus-5' }, { input_tokens: M, output_tokens: 0, model: 'claude-opus-5' })).toEqual({
      input_tokens: 2 * M,
      output_tokens: 0,
      model: 'claude-opus-5',
    });
  });

  it('drops the main model when the records disagree; by_model still names both', () => {
    const merged = mergeUsage(
      { ...emptyUsage(), model: 'claude-sonnet-5', by_model: { 'claude-sonnet-5': tokens(1, 1) } },
      { ...emptyUsage(), model: 'claude-opus-5', by_model: { 'claude-opus-5': tokens(1, 1) } },
    );
    expect(merged.model).toBeUndefined();
    expect(modelsInUsage(merged)).toEqual(['claude-opus-5', 'claude-sonnet-5']);
  });
});
