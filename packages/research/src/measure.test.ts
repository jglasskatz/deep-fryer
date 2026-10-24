import { describe, expect, it } from 'vitest';
import { defaultPortraitConfig, framework } from '@deep-fryer/contract';
import { emptyUsage, mergeUsage } from '@deep-fryer/core';
import {
  CUSTOM_INDICATOR_SLUGS,
  DENOMINATORS,
  NEGATIVE_CONTROLS,
  plannedIndicators,
  reconcileBoroughs,
  replicationAgreement,
  scoreNegativeControls,
  scoreStrategy,
  sessionSpend,
  renderTierAuditPrompt,
  type ScoredFinding,
} from './measure.js';
import { renderPlan } from './plan.js';

const frameworkSlugs = framework.dimensions.flatMap((d) => d.indicators.map((i) => i.slug));

function indicatorFinding(
  overrides: Partial<{
    indicatorSlug: string;
    tenantSlug: string;
    value: number | string;
    tier: number;
    verdict: 'pass' | 'fail' | 'uncertain';
    url: string;
    scale: 'city' | 'county' | 'regional' | 'state' | 'national' | 'global';
    scaleOk: boolean;
    partialOutput: boolean;
  }> = {},
): ScoredFinding {
  const {
    indicatorSlug = 'pm25-annual',
    tenantSlug = 'nyc',
    value = 7.2,
    tier = 1,
    verdict = 'pass',
    url = 'https://example.gov/a',
    scale = 'city',
    scaleOk = true,
    partialOutput = false,
  } = overrides;
  return {
    indicatorSlug,
    dimensionSlug: 'air-pollution',
    tenantSlug,
    payload: {
      kind: 'indicator',
      indicator_slug: indicatorSlug,
      name: 'PM2.5',
      value,
      unit: 'µg/m³',
      year: 2024,
      target: 5,
      level_pct: 44,
      scoring: {
        threshold_ref: 'air-pollution.pm25-annual',
        function: 'lower_is_better',
        inputs: { value: 7.2, target: 5 },
        worked_math: 'level_pct = (7.2 − 5) ⁄ 5 × 100 = +44.0',
      },
      source: 'DOHMH',
      source_url: url,
      source_tier: tier,
      evidence: { snapshot_path: 'p.png', captured_at: '2026-08-04T00:00:00Z' },
      confidence: 'high',
      geographic_scale: scale,
    },
    verification: {
      schema_ok: true,
      url_ok: true,
      recency_ok: true,
      scale_ok: scaleOk,
      content_supported: verdict,
      ...(partialOutput ? { partial_output: true } : {}),
    },
  } as ScoredFinding;
}

function gapFinding(indicatorSlug: string, tenantSlug = 'nyc'): ScoredFinding {
  return {
    indicatorSlug,
    dimensionSlug: 'ocean-acidification',
    tenantSlug,
    payload: {
      kind: 'gap',
      indicator_slug: indicatorSlug,
      reason: 'no borough decomposition exists',
      scales_tried: ['city', 'county'],
      searched_at: '2026-08-04T00:00:00Z',
    },
    verification: {
      schema_ok: true,
      url_ok: true,
      recency_ok: true,
      scale_ok: true,
      content_supported: 'uncertain',
    },
  } as ScoredFinding;
}

describe('scoreStrategy', () => {
  it('scores yield as coverage times verified accuracy', () => {
    const card = scoreStrategy(
      [
        indicatorFinding({ verdict: 'pass' }),
        indicatorFinding({ indicatorSlug: 'b', verdict: 'pass' }),
        indicatorFinding({ indicatorSlug: 'c', verdict: 'fail' }),
        gapFinding('d'),
      ],
      { indicatorsPlanned: 4 },
    );
    expect(card.coverage).toBeCloseTo(0.75);
    expect(card.verifiedAccuracy).toBeCloseTo(2 / 3);
    expect(card.yield).toBeCloseTo(0.5);
    expect(card.fabricationRate).toBeCloseTo(1 / 3);
  });

  it('divides coverage by the indicators planned, so a silent session costs yield', () => {
    // Eight indicators planned; one session returned its two, the other
    // returned nothing at all (malformed output, a refusal, the turn cap).
    const card = scoreStrategy([indicatorFinding({ verdict: 'pass' }), indicatorFinding({ indicatorSlug: 'b', verdict: 'pass' })], {
      indicatorsPlanned: 8,
    });
    expect(card.indicators).toBe(8);
    expect(card.returned).toBe(2);
    expect(card.missing).toBe(6);
    expect(card.verifiedAccuracy).toBe(1);
    expect(card.coverage).toBeCloseTo(0.25);
    expect(card.yield).toBeCloseTo(0.25);
  });

  it('gives the all-gap strategy zero yield despite clean deterministic gates', () => {
    const card = scoreStrategy([gapFinding('a'), gapFinding('b'), gapFinding('c')], { indicatorsPlanned: 3 });
    // Gaps pass url/recency/scale vacuously, so surface metrics look perfect.
    expect(card.schemaOk).toBe(1);
    expect(card.urlOk).toBe(1);
    // ...and yield correctly reports that nothing was produced.
    expect(card.coverage).toBe(0);
    expect(card.yield).toBe(0);
  });

  it('gives the reckless strategy zero yield at full coverage', () => {
    const card = scoreStrategy(
      [indicatorFinding({ indicatorSlug: 'a', verdict: 'fail' }), indicatorFinding({ indicatorSlug: 'b', verdict: 'fail' })],
      { indicatorsPlanned: 2 },
    );
    expect(card.coverage).toBe(1);
    expect(card.verifiedAccuracy).toBe(0);
    expect(card.yield).toBe(0);
  });

  it('reports the share of findings salvaged from malformed output', () => {
    const card = scoreStrategy([indicatorFinding({ partialOutput: true }), indicatorFinding({ indicatorSlug: 'b' })], {
      indicatorsPlanned: 2,
    });
    expect(card.partialOutput).toBeCloseTo(0.5);
  });

  it('charges verifier spend to the strategy and reports cost per verified finding', () => {
    const usage = sessionSpend(
      {
        s1: { input_tokens: 1000, output_tokens: 200 },
        'verifier:s1': { input_tokens: 700, output_tokens: 100 },
        s2: { input_tokens: 9999, output_tokens: 9999 },
      },
      's1',
    );
    expect(usage).toEqual({ input_tokens: 1700, output_tokens: 300 });

    const card = scoreStrategy([indicatorFinding({ verdict: 'pass' })], { indicatorsPlanned: 1, tokens: usage });
    expect(card.costPerVerifiedFinding).toBe(2000);
    // Old rows never said which model ran: their spend is unpriced, not $0.
    expect(card.unpriced).toEqual(['(model not recorded)']);
    expect(card.costPerVerifiedFindingUsd).toBeNull();
  });

  it('merges whole records — cache tokens and per-model usage — and prices them', () => {
    const usage = sessionSpend(
      {
        s1: {
          input_tokens: 1_000_000,
          output_tokens: 100_000,
          cache_read_tokens: 2_000_000,
          model: 'claude-sonnet-5',
          by_model: {
            'claude-sonnet-5': { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_tokens: 2_000_000, cache_write_tokens: 0, web_search_requests: 30 },
          },
        },
        'verifier:s1': {
          input_tokens: 200_000,
          output_tokens: 20_000,
          cache_read_tokens: 400_000,
          cache_write_tokens: 40_000,
          model: 'claude-opus-5',
          by_model: {
            'claude-opus-5': { input_tokens: 200_000, output_tokens: 20_000, cache_read_tokens: 400_000, cache_write_tokens: 40_000, web_search_requests: 0 },
          },
        },
      },
      's1',
    );
    expect(usage.cache_read_tokens).toBe(2_400_000);
    expect(Object.keys(usage.by_model!).sort()).toEqual(['claude-opus-5', 'claude-sonnet-5']);

    const card = scoreStrategy([indicatorFinding({ verdict: 'pass' }), indicatorFinding({ indicatorSlug: 'b', verdict: 'pass' })], {
      indicatorsPlanned: 2,
      tokens: usage,
    });
    // Sonnet 5: 2 + 1 + 0.40 cache read + 0.30 search; Opus 5: 1 + 0.50 + 0.20 cache read + 0.25 cache write.
    expect(card.dollars).toBeCloseTo(3.7 + 1.95, 10);
    expect(card.unpriced).toEqual([]);
    expect(card.costPerVerifiedFindingUsd).toBeCloseTo((3.7 + 1.95) / 2, 10);
  });

  it('keeps an old run’s spend unpriced when a scorecard folds it with a metered run', () => {
    // As measure-strategies folds --runs that mix a run from before per-model metering with a new one.
    const oldRun = sessionSpend({ s1: { input_tokens: 2_000_000, output_tokens: 300_000 } }, 's1');
    const newRun = sessionSpend(
      {
        s2: {
          input_tokens: 1000,
          output_tokens: 100,
          model: 'claude-sonnet-5',
          by_model: { 'claude-sonnet-5': { input_tokens: 1000, output_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 } },
        },
      },
      's2',
    );
    const card = scoreStrategy([indicatorFinding({ verdict: 'pass' })], { indicatorsPlanned: 1, tokens: [oldRun, newRun].reduce(mergeUsage, emptyUsage()) });
    expect(card.unpriced).toEqual(['(model not recorded)']);
    expect(card.costPerVerifiedFindingUsd).toBeNull();
    // The dollars cover the metered run only, and say so through `unpriced`.
    expect(card.dollars).toBeCloseTo((1000 * 2 + 100 * 10) / 1_000_000, 12);
  });

  it('withholds dollars per finding while a model is unpriced', () => {
    // A model id core's price table does not know (it once used the page reader's, Haiku 4.5, which is priced now).
    const card = scoreStrategy([indicatorFinding({ verdict: 'pass' })], {
      indicatorsPlanned: 1,
      tokens: {
        input_tokens: 0,
        output_tokens: 0,
        by_model: {
          'claude-opus-5': { input_tokens: 1_000_000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 },
          'claude-test-0': { input_tokens: 50_000, output_tokens: 2_000, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 },
        },
      },
    });
    expect(card.dollars).toBeCloseTo(5, 10);
    expect(card.unpriced).toEqual(['claude-test-0']);
    expect(card.costPerVerifiedFindingUsd).toBeNull();
  });

  it('prices the page reader, Haiku 4.5, at $1 in and $5 out per million tokens', () => {
    const card = scoreStrategy([indicatorFinding({ verdict: 'pass' })], {
      indicatorsPlanned: 1,
      tokens: {
        input_tokens: 0,
        output_tokens: 0,
        by_model: {
          'claude-haiku-4-5-20251001': { input_tokens: 50_000, output_tokens: 2_000, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 },
        },
      },
    });
    // 50k × $1/M + 2k × $5/M
    expect(card.dollars).toBeCloseTo(0.06, 10);
    expect(card.unpriced).toEqual([]);
    expect(card.costPerVerifiedFindingUsd).toBeCloseTo(0.06, 10);
  });

  it('reports no cost per finding when nothing verified', () => {
    const card = scoreStrategy([indicatorFinding({ verdict: 'fail' })], {
      indicatorsPlanned: 1,
      tokens: { input_tokens: 10, output_tokens: 5 },
    });
    expect(card.costPerVerifiedFinding).toBeNull();
    expect(card.costPerVerifiedFindingUsd).toBeNull();
  });
});

describe('plannedIndicators', () => {
  it('reads back every indicator a rendered plan asked for, per dimension', () => {
    const dims = ['housing', 'energy'].map((slug) => framework.dimensions.find((d) => d.slug === slug)!);
    const plan = renderPlan({
      config: defaultPortraitConfig('City of Santa Cruz', 'City of Santa Cruz municipal boundary'),
      dimensions: dims.map((d) => ({ dimensionId: d.slug, slug: d.slug, ring: d.ring, name: d.name, indicators: d.indicators })),
    });
    expect(plannedIndicators(plan).sort()).toEqual(
      dims.flatMap((d) => d.indicators.map((i) => `${d.slug}/${i.slug}`)).sort(),
    );
  });
});

describe('replicationAgreement', () => {
  it('flags a contested indicator when runs disagree on the value', () => {
    const rows = replicationAgreement([
      [indicatorFinding({ value: 7.2 })],
      [indicatorFinding({ value: 7.3 })],
      [indicatorFinding({ value: 11.9 })],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.contested).toBe(true);
    expect(rows[0]!.relativeSpread).toBeGreaterThan(0.5);
  });

  it('does not flag agreeing runs, and reports source agreement', () => {
    const rows = replicationAgreement([
      [indicatorFinding({ value: 7.2, url: 'https://a.gov' })],
      [indicatorFinding({ value: 7.2, url: 'https://a.gov' })],
      [indicatorFinding({ value: 7.2, url: 'https://b.gov' })],
    ]);
    expect(rows[0]!.contested).toBe(false);
    expect(rows[0]!.sourceAgreement).toBeCloseTo(2 / 3);
  });

  it('treats a gap against values as disagreement worth review', () => {
    const rows = replicationAgreement([
      [indicatorFinding({ indicatorSlug: 'x', value: 3 })],
      [gapFinding('x')],
    ]);
    expect(rows[0]!.gapDisagreement).toBe(1);
    expect(rows[0]!.contested).toBe(true);
  });
});

describe('reconcileBoroughs', () => {
  const boroughs = (values: number[]) =>
    [
      { tenantSlug: 'manhattan', population: 1694251 },
      { tenantSlug: 'brooklyn', population: 2736074 },
      { tenantSlug: 'queens', population: 2405464 },
      { tenantSlug: 'bronx', population: 1472654 },
      { tenantSlug: 'staten-island', population: 495747 },
    ].map((b, i) => ({
      ...b,
      findings: [indicatorFinding({ tenantSlug: b.tenantSlug, value: values[i]! })],
    }));

  it('passes when the population-weighted mean matches the city figure', () => {
    const rows = reconcileBoroughs({
      city: [indicatorFinding({ value: 7.2 })],
      boroughs: boroughs([7.2, 7.2, 7.2, 7.2, 7.2]),
    });
    expect(rows[0]!.impliedValue).toBeCloseTo(7.2);
    expect(rows[0]!.exceedsTolerance).toBe(false);
  });

  it('catches boroughs that cannot reconcile to the city value', () => {
    const rows = reconcileBoroughs({
      city: [indicatorFinding({ value: 7.2 })],
      boroughs: boroughs([14, 15, 13, 16, 12]),
    });
    expect(rows[0]!.exceedsTolerance).toBe(true);
    expect(rows[0]!.divergencePct).toBeGreaterThan(80);
  });

  const countFamily = (values = [39, 63, 57, 33, 13], cityValue = 205) => ({
    city: [indicatorFinding({ indicatorSlug: 'traffic-deaths', value: cityValue })],
    boroughs: boroughs(values).map((borough, index) => ({
      ...borough,
      findings: [indicatorFinding({ indicatorSlug: 'traffic-deaths', tenantSlug: borough.tenantSlug, value: values[index]! })],
    })),
  });

  it('reconciles absolute counts by their sum rather than a population-weighted mean', () => {
    const rows = reconcileBoroughs(countFamily());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ impliedValue: 205, cityValue: 205, denominator: 'sum', n: 5, approximate: false, divergencePct: 0, exceedsTolerance: false });
    expect(reconcileBoroughs(countFamily([39, 63, 57, 33, 100]))[0]!.exceedsTolerance).toBe(true);
  });

  it('never reports an incomplete or incomparable borough sum as a city total', () => {
    const missing = countFamily();
    missing.boroughs[0]!.findings = [];
    expect(reconcileBoroughs(missing)).toEqual([]);
    const mismatched = countFamily();
    const payload = mismatched.boroughs[0]!.findings[0]!.payload;
    if (payload.kind !== 'indicator') throw new Error('test finding');
    for (const change of [{ year: payload.year - 1 }, { unit: 'deaths per 100,000' }, { geographic_scale: 'regional' as const }]) {
      const input = countFamily();
      input.boroughs[0]!.findings[0]!.payload = { ...payload, ...change };
      expect(reconcileBoroughs(input)).toEqual([]);
    }
  });

  it('flags a nonzero borough total against a zero city count', () => {
    expect(reconcileBoroughs(countFamily([0, 0, 0, 0, 1], 0))[0]).toMatchObject({ exceedsTolerance: true, divergencePct: Infinity });
    expect(reconcileBoroughs(countFamily([0, 0, 0, 0, 0], 0))[0]).toMatchObject({ exceedsTolerance: false, divergencePct: 0 });
  });

  it('skips non-additive indicators rather than inventing a decomposition', () => {
    const rows = reconcileBoroughs({
      city: [indicatorFinding({ indicatorSlug: 'aragonite-saturation', value: 2.9 })],
      boroughs: boroughs([2.9, 2.9, 2.9, 2.9, 2.9]).map((b) => ({
        ...b,
        findings: [
          indicatorFinding({
            indicatorSlug: 'aragonite-saturation',
            tenantSlug: b.tenantSlug,
            value: 2.9,
          }),
        ],
      })),
    });
    expect(rows).toHaveLength(0);
  });

  it('widens tolerance when the weighting denominator is a proxy', () => {
    const rows = reconcileBoroughs({
      city: [indicatorFinding({ indicatorSlug: 'unemployment-rate', value: 5 })],
      boroughs: boroughs([5.4, 5.4, 5.4, 5.4, 5.4]).map((b) => ({
        ...b,
        findings: [
          indicatorFinding({
            indicatorSlug: 'unemployment-rate',
            tenantSlug: b.tenantSlug,
            value: 5.4,
          }),
        ],
      })),
    });
    expect(rows[0]!.approximate).toBe(true);
    // 8% divergence: over the exact tolerance, under the approximate one.
    expect(rows[0]!.exceedsTolerance).toBe(false);
  });
});

describe('scoreNegativeControls', () => {
  it('counts a confident value on a no-data indicator as fabrication', () => {
    const { results, fabricationRate } = scoreNegativeControls([
      indicatorFinding({ indicatorSlug: 'aragonite-saturation', tenantSlug: 'bronx', value: 2.7 }),
      gapFinding('ods-phaseout-compliance', 'queens'),
    ]);
    expect(fabricationRate).toBeCloseTo(0.5);
    expect(results.find((r) => r.tenantSlug === 'bronx')!.correct).toBe(false);
    expect(results.find((r) => r.tenantSlug === 'bronx')!.fabricatedValue).toBe(2.7);
    expect(results.find((r) => r.tenantSlug === 'queens')!.correct).toBe(true);
  });

  it('exempts a sourced, verified value at an accepted scale wider than the municipality', () => {
    // The Opus arm's Long Island Sound measurement, labelled regional (docs/strategy-findings.md).
    const honest = indicatorFinding({ indicatorSlug: 'aragonite-saturation', tenantSlug: 'bronx', value: 1.09, scale: 'regional' });
    const { results, fabricationRate } = scoreNegativeControls([honest]);
    expect(fabricationRate).toBe(0);
    expect(results[0]).toMatchObject({ correct: true, observed: 'value', exempt: true });
    expect(results[0]!.fabricatedValue).toBeUndefined();

    // Unverified, at a scale the portrait does not accept, or at the borough's own scale: still fabricated.
    for (const f of [
      indicatorFinding({ indicatorSlug: 'aragonite-saturation', scale: 'regional', verdict: 'fail' }),
      indicatorFinding({ indicatorSlug: 'aragonite-saturation', scale: 'regional', verdict: 'uncertain' }),
      indicatorFinding({ indicatorSlug: 'aragonite-saturation', scale: 'national', scaleOk: false }),
      indicatorFinding({ indicatorSlug: 'ods-phaseout-compliance', scale: 'county', value: '99%' }),
    ]) {
      expect(scoreNegativeControls([f]).fabricationRate).toBe(1);
    }
  });

  it('ignores findings outside the control set', () => {
    const { results } = scoreNegativeControls([indicatorFinding({ indicatorSlug: 'pm25-annual' })]);
    expect(results).toHaveLength(0);
  });

  it('ships controls that exist in the framework', () => {
    expect(NEGATIVE_CONTROLS.length).toBeGreaterThan(0);
    for (const c of NEGATIVE_CONTROLS) {
      expect(frameworkSlugs).toContain(c.indicatorSlug);
    }
  });
});

describe('slug maps track the framework', () => {
  // Both maps are keyed by indicator slug. A framework rename would silently
  // disable the reconciliation rule or the control, so fail loudly instead.
  it('only classifies denominators for indicators that exist', () => {
    const known = [...frameworkSlugs, ...CUSTOM_INDICATOR_SLUGS];
    for (const slug of Object.keys(DENOMINATORS)) {
      expect(known).toContain(slug);
    }
  });

  it('leaves per-capita indicators on the population default', () => {
    expect(DENOMINATORS['pm25-annual']).toBeUndefined();
    expect(DENOMINATORS['ghg-per-capita']).toBeUndefined();
  });
});

describe('tier audit prompts', () => {
  const input = { indicator_name: 'Rent burden', claimed_value: '42', unit: '%', year: '2025', source_name: 'City office', source_url: 'https://city.example/statistics', tiers_block: '1: local primary; 2: state', region_name: 'City' };
  it('audits tier-1 authority and construct without inventing an impossible higher tier', () => {
    const prompt = renderTierAuditPrompt({ ...input, claimed_tier: 1 });
    expect(prompt).toContain('There is no higher tier than tier 1');
    expect(prompt).toContain('construct/denominator');
    expect(prompt).toContain('claimed_tier_supported');
    expect(prompt).not.toContain('Search for a source in any tier numbered below 1');
  });
  it('still searches higher-priority sources for lower-tier findings', () => {
    expect(renderTierAuditPrompt({ ...input, claimed_tier: 3 })).toContain('Search for a source in any tier numbered below 3');
  });
});
