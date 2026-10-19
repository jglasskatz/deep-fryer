import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ResearchCostEstimate } from './ResearchCostEstimate';

/**
 * What the billing page and /start tell a customer research costs. The
 * figures come from core research-cost.ts; this pins the wording that once
 * said a one-dimension re-run was "one session ≈ $1–4" while the gate
 * charged two sessions for it.
 */

// Vitest compiles JSX with the classic runtime, which expects React in scope.
vi.stubGlobal('React', React);

const text = (props: Parameters<typeof ResearchCostEstimate>[0]) =>
  renderToStaticMarkup(createElement(ResearchCostEstimate, props)).replace(/<[^>]+>/g, '');

describe('ResearchCostEstimate', () => {
  it('quotes a full portrait at 22 sessions ≈ $20–80, typically about $40', () => {
    const shown = text({ onKey: false });
    expect(shown).toContain('A full portrait is about 22 research sessions ≈ $20–80 of API usage (typically about $40)');
    expect(shown).not.toContain('on your key');
    expect(shown).not.toContain('policy analysis');
  });

  it('says who pays: the plan’s sessions cover the dollars, or the organization’s own Anthropic bill does', () => {
    // A buyer reading a bare "$20–80" beside "choose a plan" would take it for the price of building, or an extra.
    expect(text({ onKey: false })).toContain(
      '(typically about $40), covered by the plan’s research sessions — never charged on top of the plan.',
    );
    expect(text({ onKey: true })).toContain('of API usage on your key (typically about $40), billed to you by Anthropic.');
  });

  it('quotes a re-run as the two sessions it is, and a policy analysis as one', () => {
    const shown = text({ onKey: true, showSingleSession: true });
    expect(shown).toContain('of API usage on your key');
    expect(shown).toContain('A policy analysis is 1 session ≈ $1–4.');
    expect(shown).toContain('Re-running one dimension is 2 sessions ≈ $1–8 (typically about $3.60)');
    expect(shown).not.toMatch(/re-run is one session/i);
  });

  it('counts a smaller run in the singular when it is one session', () => {
    expect(text({ onKey: false, sessions: 1 })).toContain('About 1 research session ≈ $1–4');
  });
});
