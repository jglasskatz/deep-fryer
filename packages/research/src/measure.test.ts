import { describe, expect, it } from 'vitest';
import { framework } from '@deep-fryer/contract';
import {
  DENOMINATORS,
  NEGATIVE_CONTROLS,
  reconcileBoroughs,
  replicationAgreement,
  scoreNegativeControls,
  scoreStrategy,
  sessionSpend,
  type ScoredFinding,
} from './measure.js';

const frameworkSlugs = framework.dimensions.flatMap((d) => d.indicators.map((i) => i.slug));

function indicatorFinding(
  overrides: Partial<{
    indicatorSlug: string;
    tenantSlug: string;
    value: number | string;
    tier: number;
    verdict: 'pass' | 'fail' | 'uncertain';
    url: string;
  }> = {},
): ScoredFinding {
  const {
    indicatorSlug = 'pm25-annual',
    tenantSlug = 'nyc',
    value = 7.2,
    tier = 1,
    verdict = 'pass',
    url = 'https://example.gov/a',
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
      geographic_scale: 'city',
    },
    verification: {
      schema_ok: true,
      url_ok: true,
      recency_ok: true,
      scale_ok: true,
      content_supported: verdict,
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
    const card = scoreStrategy([
      indicatorFinding({ verdict: 'pass' }),
      indicatorFinding({ indicatorSlug: 'b', verdict: 'pass' }),
      indicatorFinding({ indicatorSlug: 'c', verdict: 'fail' }),
      gapFinding('d'),
    ]);
    expect(card.coverage).toBeCloseTo(0.75);
    expect(card.verifiedAccuracy).toBeCloseTo(2 / 3);
    expect(card.yield).toBeCloseTo(0.5);
    expect(card.fabricationRate).toBeCloseTo(1 / 3);
  });

  it('gives the all-gap strategy zero yield despite clean deterministic gates', () => {
    const card = scoreStrategy([gapFinding('a'), gapFinding('b'), gapFinding('c')]);
    // Gaps pass url/recency/scale vacuously, so surface metrics look perfect.
    expect(card.schemaOk).toBe(1);
    expect(card.urlOk).toBe(1);
    // ...and yield correctly reports that nothing was produced.
    expect(card.coverage).toBe(0);
    expect(card.yield).toBe(0);
  });

  it('gives the reckless strategy zero yield at full coverage', () => {
    const card = scoreStrategy([
      indicatorFinding({ indicatorSlug: 'a', verdict: 'fail' }),
      indicatorFinding({ indicatorSlug: 'b', verdict: 'fail' }),
    ]);
    expect(card.coverage).toBe(1);
    expect(card.verifiedAccuracy).toBe(0);
    expect(card.yield).toBe(0);
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

    const card = scoreStrategy([indicatorFinding({ verdict: 'pass' })], usage);
    expect(card.costPerVerifiedFinding).toBe(2000);
  });

  it('reports no cost per finding when nothing verified', () => {
    const card = scoreStrategy([indicatorFinding({ verdict: 'fail' })], {
      input_tokens: 10,
      output_tokens: 5,
    });
    expect(card.costPerVerifiedFinding).toBeNull();
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
    expect(results.find((r) => r.tenantSlug === 'queens')!.correct).toBe(true);
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
    for (const slug of Object.keys(DENOMINATORS)) {
      expect(frameworkSlugs).toContain(slug);
    }
  });

  it('leaves per-capita indicators on the population default', () => {
    expect(DENOMINATORS['pm25-annual']).toBeUndefined();
    expect(DENOMINATORS['ghg-per-capita']).toBeUndefined();
  });
});
