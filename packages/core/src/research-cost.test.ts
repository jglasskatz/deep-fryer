import { describe, expect, it } from 'vitest';
import { SESSIONS_PER_FULL_REFRESH } from './plans.js';
import { POLICY_ANALYSIS_SESSIONS } from './policy.js';
import {
  FULL_PORTRAIT_AUDIT_COST_USD,
  FULL_PORTRAIT_COST_USD,
  RESEARCH_SESSION_COST_USD,
  estimateAuditCost,
  estimateRunCost,
  estimateTotalRunCost,
  formatCostRange,
  formatTypicalCost,
  researchRunSessions,
  dimensionResearchSessions,
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
    // The document's plan table: City's 200 sessions ≈ $364 a year, Metro's 600 ≈ $1,091.
    expect(estimateRunCost(200).typicalUsd).toBe(363.64);
    expect(formatTypicalCost(estimateRunCost(600))).toBe('$1,091');
  });

  it('prices a one-dimension re-run as the two sessions it charges, not one', () => {
    // The region-context session always runs first, and the gate charges both.
    expect(researchRunSessions(1)).toBe(2);
    expect(estimateRunCost(researchRunSessions(1))).toEqual({ sessions: 2, lowUsd: 1.82, typicalUsd: 3.64, highUsd: 7.27 });
    // Every dimension is the full portrait the plans are sized in.
    expect(researchRunSessions(21)).toBe(SESSIONS_PER_FULL_REFRESH);
    // A policy analysis stays one session.
    expect(estimateRunCost(POLICY_ANALYSIS_SESSIONS).sessions).toBe(1);
  });

  it('refuses a run of no or partial dimensions', () => {
    expect(() => researchRunSessions(0)).toThrow(RangeError);
    expect(() => researchRunSessions(1.5)).toThrow(RangeError);
  });

  it('uses bounded sessions for dense custom dimensions', () => {
    expect([0, 1, 3, 4, 6, 7].map(dimensionResearchSessions)).toEqual([1, 1, 1, 2, 2, 3]);
    for (const count of [-1, 0.5, NaN, Infinity]) expect(() => dimensionResearchSessions(count)).toThrow(RangeError);
  });

  it('prices the NYC family (six portraits, 132 sessions) at about $240', () => {
    expect(estimateRunCost(6 * SESSIONS_PER_FULL_REFRESH)).toEqual({ sessions: 132, lowUsd: 120, typicalUsd: 240, highUsd: 480 });
  });

  it('is zero for nothing and refuses partial or negative session counts', () => {
    expect(estimateRunCost(0)).toEqual({ sessions: 0, lowUsd: 0, typicalUsd: 0, highUsd: 0 });
    expect(() => estimateRunCost(-1)).toThrow(RangeError);
    expect(() => estimateRunCost(1.5)).toThrow(RangeError);
  });

  it('scales estimates by strategy: standard baseline, hybrid selective escalation, and deep', () => {
    expect(estimateRunCost(22, 'standard')).toEqual({ sessions: 22, lowUsd: 20, typicalUsd: 40, highUsd: 80 });
    expect(estimateRunCost(22, 'operator-defaults')).toEqual({ sessions: 22, lowUsd: 20, typicalUsd: 40, highUsd: 80 });
    expect(estimateRunCost(22, 'hybrid')).toEqual({ sessions: 22, lowUsd: 22, typicalUsd: 60, highUsd: 160 });
    expect(estimateRunCost(22, 'deep')).toEqual({ sessions: 22, lowUsd: 50, typicalUsd: 120, highUsd: 280 });
    expect(formatCostRange(estimateRunCost(22, 'hybrid'))).toBe('$22–160');
    expect(formatCostRange(estimateRunCost(22, 'deep'))).toBe('$50–280');
  });
});

describe('formatCostRange', () => {
  it('quotes whole dollars, rounded outward, never below $1', () => {
    expect(formatCostRange(estimateRunCost(22))).toBe('$20–80');
    expect(formatCostRange(estimateRunCost(1))).toBe('$1–4');
    expect(formatCostRange(estimateRunCost(2))).toBe('$1–8');
    expect(formatCostRange(estimateRunCost(132))).toBe('$120–480');
  });
});

describe('formatTypicalCost', () => {
  it('quotes whole dollars from $10, ten cents below', () => {
    expect(formatTypicalCost(estimateRunCost(22))).toBe('$40');
    expect(formatTypicalCost(estimateRunCost(132))).toBe('$240');
    // A re-run ($3.64) is "about $3.60", neither "$4" nor a false-precise "$3.64".
    expect(formatTypicalCost(estimateRunCost(2))).toBe('$3.60');
    expect(formatTypicalCost(estimateRunCost(1))).toBe('$1.80');
    // Rounding up into $10 switches to whole dollars rather than printing "$10.00".
    expect(formatTypicalCost({ sessions: 0, lowUsd: 0, typicalUsd: 9.96, highUsd: 0 })).toBe('$10');
  });
});

describe('estimateAuditCost & estimateTotalRunCost', () => {
  it('models post-run audit spend for a full portrait and scales down for Opus-assisted strategies', () => {
    expect(estimateAuditCost(21, 'standard')).toEqual({
      lowUsd: FULL_PORTRAIT_AUDIT_COST_USD.low,
      typicalUsd: FULL_PORTRAIT_AUDIT_COST_USD.typical,
      highUsd: FULL_PORTRAIT_AUDIT_COST_USD.high,
    });
    expect(estimateAuditCost(21, 'hybrid').typicalUsd).toBe(7.5);
    expect(estimateAuditCost(21, 'deep').typicalUsd).toBe(6);
    expect(estimateAuditCost(0)).toEqual({ lowUsd: 0, typicalUsd: 0, highUsd: 0 });
    expect(() => estimateAuditCost(-1)).toThrow(RangeError);
  });

  it('combines research and post-run audit estimates without adding audit cost to 1-session policy analyses', () => {
    const full = estimateTotalRunCost(22, 'standard');
    expect(full).toMatchObject({
      sessions: 22,
      lowUsd: 20,
      typicalUsd: 40,
      highUsd: 80,
      auditLowUsd: 4,
      auditTypicalUsd: 10,
      auditHighUsd: 20,
      totalLowUsd: 24,
      totalTypicalUsd: 50,
      totalHighUsd: 100,
    });
    const policy = estimateTotalRunCost(1, 'standard');
    expect(policy.auditTypicalUsd).toBe(0);
    expect(policy.totalTypicalUsd).toBe(policy.typicalUsd);
  });
});
