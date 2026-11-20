import { describe, expect, it } from 'vitest';
import { summarizePortraitCosts, summarizeRunCosts } from './run-costs.js';
import type { RunTokenUsage, SessionTokenUsage } from './types.js';

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

describe('run cost breakdown by stage and dimension', () => {
  // Two dimensions and a region session: A has one verified finding, B none.
  const context = {
    sessions: [
      { id: 'r', kind: 'region_context', dimensionId: null },
      { id: 'a', kind: 'dimension', dimensionId: 'dim-a' },
      { id: 'b', kind: 'dimension', dimensionId: 'dim-b' },
    ],
    findings: [
      { id: 'fa1', dimensionId: 'dim-a', payload: { kind: 'indicator' }, verification: { content_supported: 'pass' as const } },
      { id: 'fa2', dimensionId: 'dim-a', payload: { kind: 'indicator' }, verification: { content_supported: 'fail' as const } },
      { id: 'fb1', dimensionId: 'dim-b', payload: { kind: 'gap' }, verification: { content_supported: 'pass' as const } },
      { id: 'fb2', dimensionId: 'dim-b', payload: { kind: 'indicator' }, verification: { content_supported: 'uncertain' as const } },
    ],
  };
  const records = {
    r: usage, a: usage, 'verifier:a': usage, b: usage,
    'verifier:b': { input_tokens: 0, output_tokens: 0 },
    'audit:workflow:fb2': usage,
  };

  it('splits the run by stage and the dimensions plus region context add up to the run total', () => {
    const result = summarizeRunCosts(records, context);
    expect(result.coverage).toBe('complete');
    expect(result.estimated_usd).toBeCloseTo(0.0245 * 5);
    expect(result.region_context_estimated_usd).toBeCloseTo(0.0245);
    expect(result.research_estimated_usd).toBeCloseTo(0.049);
    expect(result.verification_estimated_usd).toBeCloseTo(0.0245);
    expect(result.audit_estimated_usd).toBeCloseTo(0.0245);
    expect(result.unattributed_estimated_usd).toBeNull();
    expect(result.dimensions.map((d) => d.dimension_id)).toEqual(['dim-a', 'dim-b']);
    const [a, b] = result.dimensions;
    expect(a).toMatchObject({ coverage: 'complete', verified_findings: 1 });
    expect(a!.known_estimated_usd).toBeCloseTo(0.049);
    expect(a!.cost_per_verified_finding_usd).toBeCloseTo(0.049);
    expect(b!.audit_estimated_usd).toBeCloseTo(0.0245);
    const sum = result.dimensions.reduce((n, d) => n + d.known_estimated_usd, 0) + result.region_context_estimated_usd!;
    expect(sum).toBeCloseTo(result.estimated_usd!, 12);
    expect(result.verified_findings).toBe(1);
    expect(result.cost_per_verified_finding_usd).toBeCloseTo(0.0245 * 5);
  });

  it('gives a dimension with nothing verified no cost per verified finding', () => {
    const b = summarizeRunCosts(records, context).dimensions[1]!;
    expect(b).toMatchObject({ dimension_id: 'dim-b', verified_findings: 0, cost_per_verified_finding_usd: null, coverage: 'complete' });
    expect(b.known_estimated_usd).toBeCloseTo(0.049);
  });

  it('two dimensions with no region session sum exactly to the run total', () => {
    const noRegion = { ...context, sessions: context.sessions.slice(1) };
    const { r: _r, ...rest } = records;
    const result = summarizeRunCosts(rest, noRegion);
    expect(result.dimensions.reduce((n, d) => n + d.known_estimated_usd, 0)).toBeCloseTo(result.estimated_usd!, 12);
  });

  it('keeps a known subtotal but no cost per verified finding when a model is unpriced', () => {
    const unpriced = { ...records, a: { input_tokens: 10, output_tokens: 5, by_model: { 'unknown-model': { input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 } } } };
    const result = summarizeRunCosts(unpriced, context);
    expect(result).toMatchObject({ coverage: 'partial', estimated_usd: null, cost_per_verified_finding_usd: null, unpriced_models: ['unknown-model'] });
    expect(result.known_estimated_usd).toBeCloseTo(0.0245 * 4);
    const a = result.dimensions[0]!;
    expect(a).toMatchObject({ coverage: 'partial', verified_findings: 1, cost_per_verified_finding_usd: null, unpriced_models: ['unknown-model'] });
    expect(a.known_estimated_usd).toBeCloseTo(0.0245);
  });

  it('marks a dimension partial when its session left no record', () => {
    const { b: _b, ...rest } = records;
    const result = summarizeRunCosts(rest, context);
    expect(result.missing_sessions).toEqual(['b']);
    expect(result.dimensions[1]).toMatchObject({ coverage: 'partial', cost_per_verified_finding_usd: null });
    expect(result.dimensions[0]).toMatchObject({ coverage: 'complete' });
  });

  it('files records it cannot match apart from every dimension', () => {
    const result = summarizeRunCosts({ ...records, stray: usage, 'audit:workflow:unknown': usage }, context);
    expect(result.unattributed_estimated_usd).toBeCloseTo(0.049);
    expect(result.sessions.find((s) => s.session === 'stray')).toMatchObject({ role: 'research', dimension_id: null });
    const sum = result.dimensions.reduce((n, d) => n + d.known_estimated_usd, 0)
      + result.region_context_estimated_usd! + result.unattributed_estimated_usd!;
    expect(sum).toBeCloseTo(result.known_estimated_usd!, 12);
  });

  it('reads an empty verifier record as nothing spent, not as legacy accounting', () => {
    const result = summarizeRunCosts({ s1: usage, 'verifier:s1': { input_tokens: 0, output_tokens: 0 } }, ['s1']);
    expect(result.coverage).toBe('complete');
  });

  it('keeps an empty main-loop record of a session partial rather than a confident zero', () => {
    const result = summarizeRunCosts({ s1: { input_tokens: 0, output_tokens: 0 } }, ['s1']);
    expect(result).toMatchObject({ coverage: 'partial', estimated_usd: null, known_estimated_usd: 0 });
    expect(result.sessions[0]?.limitations).toContain('Legacy main-loop accounting; other model calls are not fully recorded.');
  });
});

describe('portrait cost total', () => {
  it('adds applied runs, ignores plans that spent nothing, and stays unknown while any applied run is incomplete', () => {
    const applied = new Date('2026-11-01T00:00:00Z');
    const complete = summarizePortraitCosts([
      { appliedAt: applied, tokenUsage: { s1: usage }, sessionIds: ['s1'] },
      { appliedAt: applied, tokenUsage: { s2: usage } },
      { appliedAt: null, tokenUsage: null },
    ]);
    expect(complete).toMatchObject({ runs_counted: 2, runs_incomplete: 0 });
    expect(complete.estimated_usd).toBeCloseTo(0.049);
    const partial = summarizePortraitCosts([
      { appliedAt: applied, tokenUsage: { s1: usage }, sessionIds: ['s1', 's2'] },
      { appliedAt: applied, tokenUsage: null },
    ]);
    expect(partial).toMatchObject({ runs_counted: 2, runs_incomplete: 2, estimated_usd: null });
    expect(partial.known_estimated_usd).toBeCloseTo(0.0245);
  });

  it('counts a run that recorded usage without being applied, so the total matches the run list', () => {
    const applied = new Date('2026-11-01T00:00:00Z');
    const total = summarizePortraitCosts([
      { appliedAt: applied, tokenUsage: { s1: usage }, sessionIds: ['s1'] },
      { appliedAt: null, tokenUsage: { m1: usage }, sessionIds: ['m1'] },
      { appliedAt: null, tokenUsage: {} },
    ]);
    expect(total).toMatchObject({ runs_counted: 2, runs_incomplete: 0 });
    expect(total.estimated_usd).toBeCloseTo(0.049);
    const lists: RunTokenUsage[] = [{ s1: usage }, { m1: usage }];
    const listed = lists.reduce((n, u) => n + (summarizeRunCosts(u).known_estimated_usd ?? 0), 0);
    expect(total.known_estimated_usd).toBeCloseTo(listed, 12);
  });
});
