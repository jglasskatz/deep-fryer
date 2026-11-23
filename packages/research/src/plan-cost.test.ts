import { describe, expect, it } from 'vitest';
import { defaultPortraitConfig, framework } from '@deep-fryer/contract';
import { SESSIONS_PER_FULL_REFRESH, estimateRunCost, researchRunSessions } from '@deep-fryer/core';
import { estimatePlanCost, renderPlan } from './plan.js';

/**
 * The cost estimate customers see (core research-cost.ts) counts sessions
 * with researchRunSessions; the gate charges the sessions renderPlan
 * actually emits. Both must agree, or the billing page quotes one price and
 * the plan's allowance is debited another — which is how "a one-dimension
 * re-run is one session" once reached the billing page while the gate
 * charged two.
 */
const config = defaultPortraitConfig('City of Santa Cruz', 'City of Santa Cruz municipal boundary');
const spec = (d: (typeof framework.dimensions)[number]) => ({
  dimensionId: d.slug,
  slug: d.slug,
  ring: d.ring,
  name: d.name,
  indicators: d.indicators,
});

describe('the cost estimate counts the sessions renderPlan emits', () => {
  it('a one-dimension re-run is the region-context session plus the dimension', () => {
    const plan = renderPlan({ config, dimensions: [spec(framework.dimensions[0]!)] });
    expect(plan.sessions.map((s) => s.kind)).toEqual(['region_context', 'dimension']);
    expect(plan.sessions).toHaveLength(researchRunSessions(1));
    expect(estimateRunCost(plan.sessions.length).sessions).toBe(2);
  });

  it('a full portrait over every framework dimension is SESSIONS_PER_FULL_REFRESH', () => {
    const plan = renderPlan({ config, dimensions: framework.dimensions.map(spec) });
    expect(plan.sessions).toHaveLength(researchRunSessions(framework.dimensions.length));
    expect(plan.sessions).toHaveLength(SESSIONS_PER_FULL_REFRESH);
  });

  it('quotes every session emitted by a dense custom dimension, including its split', () => {
    const dimension = spec(framework.dimensions[0]!);
    const plan = renderPlan({ config, dimensions: [{ ...dimension, indicators: Array.from({ length: 7 }, (_, i) => ({ ...dimension.indicators[0]!, slug: `indicator-${i}` })) }] });
    // The apply gate and NewRunForm both count plan.sessions.length. A dense
    // dimension is more than the two-session estimate for a sparse re-run.
    expect(plan.sessions).toHaveLength(4);
    expect(estimateRunCost(plan.sessions.length)).toEqual({ sessions: 4, lowUsd: 3.64, typicalUsd: 7.27, highUsd: 14.55 });
  });

  it('prices a rendered plan according to its chosen strategy (standard, hybrid, deep)', () => {
    const dims = framework.dimensions.map(spec);
    const standard = renderPlan({ config, dimensions: dims, strategy: 'standard' });
    const hybrid = renderPlan({ config, dimensions: dims, strategy: 'hybrid' });
    const deep = renderPlan({ config, dimensions: dims, strategy: 'deep' });
    expect(hybrid.sessions).toHaveLength(SESSIONS_PER_FULL_REFRESH);
    expect(estimatePlanCost(standard)).toEqual({ sessions: 22, lowUsd: 20, typicalUsd: 40, highUsd: 80 });
    expect(estimatePlanCost(hybrid)).toEqual({ sessions: 22, lowUsd: 22, typicalUsd: 60, highUsd: 160 });
    expect(estimatePlanCost(deep)).toEqual({ sessions: 22, lowUsd: 50, typicalUsd: 120, highUsd: 280 });
  });
});
