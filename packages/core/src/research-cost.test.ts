import { describe, expect, it } from 'vitest';
import { SESSIONS_PER_FULL_REFRESH } from './plans.js';
import {
  FULL_PORTRAIT_COST_USD,
  RESEARCH_SESSION_COST_USD,
  estimateRunCost,
  formatCostRange,
} from './research-cost.js';

/** The numbers docs/research-cost.md states; this file and the document must agree. */
describe('estimateRunCost', () => {
  it('prices a full portrait (22 sessions) at the documented $20–80, typically $40', () => {
    expect(SESSIONS_PER_FULL_REFRESH).toBe(22);
    expect(estimateRunCost(SESSIONS_PER_FULL_REFRESH)).toEqual({ sessions: 22, lowUsd: 20, typicalUsd: 40, highUsd: 80 });
    expect(FULL_PORTRAIT_COST_USD).toEqual({ low: 20, typical: 40, high: 80 });
  });

  it('works out to the documented ~$1.80 per session', () => {
    expect(RESEARCH_SESSION_COST_USD.typical).toBeCloseTo(1.8, 1);
    expect(estimateRunCost(1)).toEqual({ sessions: 1, lowUsd: 0.91, typicalUsd: 1.82, highUsd: 3.64 });
    // The document's plan arithmetic: City's 200 sessions ≈ $360 a year.
    expect(Math.round(estimateRunCost(200).typicalUsd / 10) * 10).toBe(360);
  });

  it('is zero for nothing and refuses partial or negative session counts', () => {
    expect(estimateRunCost(0)).toEqual({ sessions: 0, lowUsd: 0, typicalUsd: 0, highUsd: 0 });
    expect(() => estimateRunCost(-1)).toThrow(RangeError);
    expect(() => estimateRunCost(1.5)).toThrow(RangeError);
  });
});

describe('formatCostRange', () => {
  it('quotes whole dollars, rounded outward, never below $1', () => {
    expect(formatCostRange(estimateRunCost(22))).toBe('$20–80');
    expect(formatCostRange(estimateRunCost(1))).toBe('$1–4');
    expect(formatCostRange(estimateRunCost(132))).toBe('$120–480');
  });
});
