import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { summarizeRunCosts } from '@deep-fryer/core';
import { PortraitCostTotal, RunCostCell, RunCostSummary } from './RunCostSummary';
vi.stubGlobal('React', React);
const render = (summary: ReturnType<typeof summarizeRunCosts>) => renderToStaticMarkup(createElement(RunCostSummary, { summary, runId: 'run-123' }));

describe('research run costs', () => {
  it('keeps absent usage unknown rather than showing a zero total', () => {
    const html = render(summarizeRunCosts(null, ['missing']));
    expect(html).toContain('Usage unavailable');
    expect(html).toContain('Its cost is unknown');
    expect(html).not.toContain('$0');
    expect(html).toContain('/api/research/runs/run-123/costs?format=csv');
  });
  it('labels partial usage as a known subtotal and explains missing models and sessions', () => {
    const html = render(summarizeRunCosts({ s1: { input_tokens: 100, output_tokens: 20, model: 'unknown-model' } }, ['s1', 'missing']));
    expect(html).toContain('Partial usage — total unavailable');
    expect(html).toContain('No priced usage available');
    expect(html).not.toContain('$0.00');
    expect(html).toContain('unknown-model');
    expect(html).toContain('1 session has no recorded usage');
    expect(html).toContain('Legacy main-loop accounting');
    expect(html).not.toContain('estimated USD</span>');
  });
  it('renders all-model tokens, caches and verification with explicit estimate language', () => {
    const usage = { input_tokens: 2, output_tokens: 1, by_model: { 'claude-sonnet-5': { input_tokens: 1234, output_tokens: 50, cache_read_tokens: 9876, cache_write_tokens: 100, web_search_requests: 0 } } };
    const html = render(summarizeRunCosts({ s1: usage, 'verifier:s1': usage }, ['s1']));
    expect(html).toContain('Recorded usage priced');
    expect(html).toContain('Independent verification');
    expect(html).toContain('1,234');
    expect(html).toContain('9,876');
    expect(html).toContain('estimate, not a billed amount');
    expect(html).toContain('scope="row"');
  });

  describe('breakdown by stage, dimension and verified finding', () => {
    const sonnet = { input_tokens: 1000, output_tokens: 100, by_model: { 'claude-sonnet-5': { input_tokens: 1000, output_tokens: 100, cache_read_tokens: 5000, cache_write_tokens: 200, web_search_requests: 2 } } };
    const context = {
      sessions: [
        { id: 'r', kind: 'region_context', dimensionId: null },
        { id: 'a', kind: 'dimension', dimensionId: 'dim-a' },
        { id: 'b', kind: 'dimension', dimensionId: 'dim-b' },
      ],
      findings: [
        { id: 'fa', dimensionId: 'dim-a', payload: { kind: 'indicator' }, verification: { content_supported: 'pass' as const } },
        { id: 'fb', dimensionId: 'dim-b', payload: { kind: 'indicator' }, verification: { content_supported: 'fail' as const } },
      ],
    };
    const names = { 'dim-a': 'Food', 'dim-b': 'Housing' };
    const renderWith = (usage: Parameters<typeof summarizeRunCosts>[0]) =>
      renderToStaticMarkup(createElement(RunCostSummary, { summary: summarizeRunCosts(usage, context), runId: 'run-123', dimensionNames: names }));
    const row = (html: string, label: string) => html.split('<tr').find((r) => r.includes(`>${label}</th>`)) ?? '';

    it('shows dollars per stage and per dimension, and a dimension with no passes says so', () => {
      const html = renderWith({ r: sonnet, a: sonnet, 'verifier:a': sonnet, b: sonnet, 'audit:workflow:fb': sonnet });
      for (const label of ['Region context', 'Research', 'Independent verification', 'Machine audits', 'Cost per verified finding', 'Cost by dimension']) {
        expect(html).toContain(label);
      }
      expect(html).toContain('$0.1225');
      expect(row(html, 'Food')).toContain('$0.049');
      expect(row(html, 'Food')).toMatch(/<td[^>]*>1<\/td>/);
      expect(row(html, 'Housing')).toMatch(/no verified findings/i);
      expect(row(html, 'Housing')).toContain('$0.049');
      expect(row(html, 'Region context (shared by every dimension)')).toContain('$0.0245');
      expect(html).toContain('1 finding passed independent verification');
    });

    it('with an unpriced model shows a known subtotal and no cost per verified finding', () => {
      const unknown = { input_tokens: 10, output_tokens: 5, by_model: { 'unknown-model': { input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 } } };
      const html = renderWith({ r: sonnet, a: unknown, 'verifier:a': sonnet, b: sonnet });
      expect(html).toContain('Partial usage — total unavailable');
      expect(html).toContain('known priced subtotal');
      expect(html).toContain('$0.0735');
      expect(row(html, 'Food')).toContain('Not known: part of the cost is missing');
      expect(row(html, 'Food')).toContain('Known portion');
      expect(html).toContain('unknown-model');
      expect(html.match(/Not known: part of the cost is missing/g)?.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows each run’s dollars in the run list, labelling a partial figure', () => {
    const cell = (summary: ReturnType<typeof summarizeRunCosts>) => renderToStaticMarkup(createElement(RunCostCell, { summary }));
    const usage = { input_tokens: 1, output_tokens: 1, by_model: { 'claude-sonnet-5': { input_tokens: 1_000_000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 } } };
    expect(cell(summarizeRunCosts({ s1: usage }, ['s1']))).toBe('$2.00');
    expect(cell(summarizeRunCosts({ s1: usage }, ['s1', 's2']))).toContain('known so far');
    expect(cell(summarizeRunCosts(null))).toBe('—');
  });

  it('shows the portrait’s total and says when part of it is unknown', () => {
    const total = (t: Parameters<typeof PortraitCostTotal>[0]['total']) => renderToStaticMarkup(createElement(PortraitCostTotal, { total: t }));
    expect(total({ runs_counted: 2, runs_incomplete: 0, known_estimated_usd: 3.5, estimated_usd: 3.5 })).toContain('$3.50</span> across 2 runs');
    const partial = total({ runs_counted: 3, runs_incomplete: 1, known_estimated_usd: 1.25, estimated_usd: null });
    expect(partial).toContain('$1.25</span> known so far across 3 runs');
    expect(partial).toContain('1 run has usage that is missing or not fully priced');
    expect(total({ runs_counted: 0, runs_incomplete: 0, known_estimated_usd: 0, estimated_usd: 0 })).toContain('nothing has been spent');
  });
});
