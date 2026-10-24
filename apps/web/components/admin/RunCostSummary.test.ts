import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { summarizeRunCosts } from '@deep-fryer/core';
import { RunCostSummary } from './RunCostSummary';
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
});
