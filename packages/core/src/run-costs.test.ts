import { describe, expect, it } from 'vitest';
import { summarizeRunCosts } from './run-costs.js';
import type { SessionTokenUsage } from './types.js';

const usage: SessionTokenUsage = {
  input_tokens: 1000, output_tokens: 100,
  by_model: {
    'claude-sonnet-5': { input_tokens: 1000, output_tokens: 100, cache_read_tokens: 5000, cache_write_tokens: 200, web_search_requests: 2 },
  },
};

describe('run cost accounting', () => {
  it('keeps absent telemetry unknown, including completed sessions without a meter', () => {
    expect(summarizeRunCosts(null, ['s1'])).toMatchObject({ coverage: 'unavailable', estimated_usd: null, known_estimated_usd: null, actual_billed_usd: null, missing_sessions: ['s1'] });
  });
  it('includes cache and search charges and separates independent verification', () => {
    const result = summarizeRunCosts({ s1: usage, 'verifier:s1': usage }, ['s1']);
    expect(result.coverage).toBe('complete');
    expect(result.estimated_usd).toBeCloseTo(0.049);
    expect(result.research_estimated_usd).toBeCloseTo(0.0245);
    expect(result.verification_estimated_usd).toBeCloseTo(0.0245);
    expect(result.sessions[0]?.cache_read_tokens).toBe(5000);
  });
  it('preserves known charges when another model or session is unpriced', () => {
    const result = summarizeRunCosts({ s1: usage, s2: { input_tokens: 10, output_tokens: 5, model: 'unknown-model' } }, ['s1', 's2', 's3']);
    expect(result).toMatchObject({ coverage: 'partial', estimated_usd: null, unpriced_models: ['unknown-model'], missing_sessions: ['s3'] });
    expect(result.known_estimated_usd).toBeCloseTo(0.0245);
  });
  it('does not call a partial attempt or legacy main-loop record complete', () => {
    expect(summarizeRunCosts({ s1: { ...usage, partial: true } }).coverage).toBe('partial');
    expect(summarizeRunCosts({ s1: { input_tokens: 1000, output_tokens: 100, model: 'claude-sonnet-5' } }).coverage).toBe('partial');
  });
});
