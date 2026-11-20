import { describe, expect, it } from 'vitest';
import { computeScoring, deriveVizLevel, pctToVizLevel, resolveThreshold } from './scoring.js';
import type { DimensionData, Indicator } from './types.js';

const baseIndicator: Omit<Indicator, 'level_pct'> = {
  name: 'x',
  value: 1,
  unit: 'u',
  year: 2025,
  target: 1,
  source: 's',
  source_url: 'https://example.gov',
  confidence: 'high',
  geographic_scale: 'city',
};

const dim = (levels: Array<number | undefined>): DimensionData => ({
  name: 'd',
  icon: 'i',
  description: '',
  context: '',
  indicators: levels.map((level_pct) => ({ ...baseIndicator, level_pct })),
  actions: [],
});

describe('computeScoring', () => {
  it('scores lower_is_better overshoot with worked math', () => {
    const r = computeScoring(12.4, 'food.food-insecurity-rate', {
      target: 5,
      function: 'lower_is_better',
      rationale: '',
    });
    expect(r.level_pct).toBe(148);
    expect(r.scoring.worked_math).toContain('(12.4 − 5) ⁄ 5 × 100');
    expect(r.scoring.inputs).toEqual({ value: 12.4, target: 5, scale: 5 });
  });

  it('scores higher_is_better shortfall, negative inside the safe zone', () => {
    const short = computeScoring(87, 'education.hs-attainment', {
      target: 95,
      function: 'higher_is_better',
      rationale: '',
    });
    expect(short.level_pct).toBeCloseTo(8.4, 5);

    const good = computeScoring(98, 'education.hs-attainment', {
      target: 95,
      function: 'higher_is_better',
      rationale: '',
    });
    expect(good.level_pct).toBeLessThan(0);
  });

  it('uses explicit scale over |target| and requires it at target = 0', () => {
    const r = computeScoring(25, 'housing.homelessness-rate', {
      target: 10,
      scale: 10,
      function: 'lower_is_better',
      rationale: '',
    });
    expect(r.level_pct).toBe(150);

    expect(() =>
      computeScoring(3, 'x', { target: 0, function: 'lower_is_better', rationale: '' }),
    ).toThrow(/scale is required/);
  });

  it('scores band: outside above, outside below, inside negative', () => {
    const t = { target: 0, low: 10, high: 20, function: 'band' as const, rationale: '' };
    expect(computeScoring(25, 'x', t).level_pct).toBe(50);
    expect(computeScoring(5, 'x', t).level_pct).toBe(50);
    expect(computeScoring(14, 'x', t).level_pct).toBe(-40);
  });
});

describe('resolveThreshold', () => {
  it('merges a tenant override over the framework default without mutating it', () => {
    const base = resolveThreshold('climate-change.ghg-per-capita');
    expect(base?.target).toBe(2.5);

    const merged = resolveThreshold('climate-change.ghg-per-capita', {
      'climate-change.ghg-per-capita': { target: 3.2, rationale: 'adopted CAP trajectory' },
    });
    expect(merged?.target).toBe(3.2);
    expect(merged?.function).toBe('lower_is_better');

    expect(resolveThreshold('climate-change.ghg-per-capita')?.target).toBe(2.5);
  });

  it('returns undefined for an unknown ref with no override', () => {
    expect(resolveThreshold('nope.nothing')).toBeUndefined();
  });
});

describe('deriveVizLevel', () => {
  it('worst_of takes the max level_pct', () => {
    expect(deriveVizLevel(dim([10, 60]))).toBe(pctToVizLevel(60));
  });

  it('average averages', () => {
    expect(deriveVizLevel(dim([0, 100]), 'average')).toBe(pctToVizLevel(50));
  });

  it('ignores indicators without level_pct; null when none scored', () => {
    expect(deriveVizLevel(dim([undefined, 30]))).toBe(pctToVizLevel(30));
    expect(deriveVizLevel(dim([undefined]))).toBeNull();
  });
});

describe('pctToVizLevel', () => {
  it('maps the -100..150 curve', () => {
    expect(pctToVizLevel(-80)).toBe(-100);
    expect(pctToVizLevel(-25)).toBe(-50);
    expect(pctToVizLevel(0)).toBe(0);
    expect(pctToVizLevel(25)).toBe(50);
    expect(pctToVizLevel(50)).toBe(100);
    expect(pctToVizLevel(75)).toBe(125);
    expect(pctToVizLevel(200)).toBe(150);
  });
});

describe('config helpers', () => {
  const recency = { default_max_age_years: 5, per_dimension: { housing: 2 } };
  const scales = { default_accepted: ['city', 'county'] as const, per_dimension: { 'ozone-depletion': ['global'] as const } };

  it('resolves per-dimension recency and scale overrides identically everywhere', async () => {
    const { maxDataAgeYears, acceptedScales } = await import('./config.js');
    expect(maxDataAgeYears(recency, 'housing')).toBe(2);
    expect(maxDataAgeYears(recency, 'food')).toBe(5);
    expect(acceptedScales(scales as never, 'ozone-depletion')).toEqual(['global']);
    expect(acceptedScales(scales as never, 'food')).toEqual(['city', 'county']);
  });

  it('isFlagged flags any failed check or non-pass verdict', async () => {
    const { isFlagged } = await import('./config.js');
    const ok = { url_ok: true, schema_ok: true, recency_ok: true, scale_ok: true, content_supported: 'pass' as const };
    expect(isFlagged(ok)).toBe(false);
    expect(isFlagged({ ...ok, url_ok: false })).toBe(true);
    expect(isFlagged({ ...ok, content_supported: 'uncertain' })).toBe(true);
  });

  it('tenantBucketName is the single naming convention', async () => {
    const { tenantBucketName } = await import('./config.js');
    expect(tenantBucketName('nyc')).toBe('tenant-nyc');
  });
});

describe('config defaults ↔ schema key list', () => {
  it('defaultTenantConfig produces exactly the keys tenantConfigSchemas validates', async () => {
    const { defaultTenantConfig } = await import('./config-defaults.js');
    const { tenantConfigSchemas } = await import('./validators.js');
    const defaults = defaultTenantConfig('X', 'X');
    expect(Object.keys(defaults).sort()).toEqual(Object.keys(tenantConfigSchemas).sort());
    for (const [key, schema] of Object.entries(tenantConfigSchemas)) {
      expect(schema.safeParse(defaults[key as keyof typeof defaults]).success, key).toBe(true);
    }
  });
});

describe('research mode setting', () => {
  it('accepts the two modes and refuses anything else', async () => {
    const { tenantConfigSchemas } = await import('./validators.js');
    expect(tenantConfigSchemas.research_mode.safeParse('right_first').success).toBe(true);
    expect(tenantConfigSchemas.research_mode.safeParse('right_first_then_fill').success).toBe(true);
    for (const bad of ['fill', 'Right first', '', null, true, { mode: 'right_first' }]) {
      expect(tenantConfigSchemas.research_mode.safeParse(bad).success, String(bad)).toBe(false);
    }
  });

  it('gives a new portrait stand-ins for its gaps, and leaves a portrait without the setting as it was', async () => {
    const { defaultTenantConfig } = await import('./config-defaults.js');
    const { researchModeOf, RESEARCH_MODE_WHEN_UNSET } = await import('./validators.js');
    expect(defaultTenantConfig('X', 'X').research_mode).toBe('right_first_then_fill');
    expect(RESEARCH_MODE_WHEN_UNSET).toBe('right_first');
    expect(researchModeOf(null)).toBe('right_first');
    expect(researchModeOf(undefined)).toBe('right_first');
    // A damaged row never starts a stand-in pass.
    expect(researchModeOf('fill')).toBe('right_first');
    expect(researchModeOf('right_first_then_fill')).toBe('right_first_then_fill');
    expect(researchModeOf('right_first')).toBe('right_first');
  });
});

describe('finding payload validators', () => {
  it('accepts a gap and rejects an indicator missing evidence', async () => {
    const { findingPayloadSchema } = await import('./validators.js');
    expect(
      findingPayloadSchema.safeParse({
        kind: 'gap',
        indicator_slug: 'x-y',
        reason: 'none exists',
        scales_tried: ['city'],
        searched_at: new Date().toISOString(),
      }).success,
    ).toBe(true);
    expect(
      findingPayloadSchema.safeParse({
        kind: 'indicator',
        indicator_slug: 'x-y',
        name: 'X',
        value: 1,
        unit: 'u',
        year: 2025,
        target: 2,
        level_pct: -50,
        scoring: { threshold_ref: 'a.b', function: 'lower_is_better', inputs: {}, worked_math: 'x' },
        source: 's',
        source_url: 'https://example.gov',
        source_tier: 1,
        confidence: 'high',
        geographic_scale: 'city',
      }).success,
    ).toBe(false);
  });

  it('stores a stand-in, which research sessions may not return', async () => {
    const { findingPayloadSchema, storedFindingPayloadSchema } = await import('./validators.js');
    const standIn = {
      kind: 'proxy',
      indicator_slug: 'county-x',
      proxy_for: 'x-y',
      rationale: 'The county figure covers the same people.',
      name: 'X (county)',
      value: 1,
      unit: 'u',
      year: 2025,
      target: 2,
      level_pct: -50,
      scoring: { threshold_ref: 'a.b', function: 'lower_is_better', inputs: {}, worked_math: 'x' },
      source: 's',
      source_url: 'https://example.gov',
      source_tier: 1,
      evidence: { snapshot_path: 'evidence/x.png', captured_at: '2026-09-01T00:00:00Z' },
      confidence: 'low',
      geographic_scale: 'county',
    };
    expect(storedFindingPayloadSchema.safeParse(standIn).success).toBe(true);
    // The indicator-or-gap schema (research sessions, the public preview build) never takes one.
    expect(findingPayloadSchema.safeParse(standIn).success).toBe(false);
    expect(storedFindingPayloadSchema.safeParse({ ...standIn, confidence: 'medium' }).success).toBe(false);
    expect(storedFindingPayloadSchema.safeParse({ ...standIn, rationale: '' }).success).toBe(false);
    expect(storedFindingPayloadSchema.safeParse({ ...standIn, proxy_for: 'Not A Slug' }).success).toBe(false);
    // It stands in for another indicator, never for itself.
    expect(storedFindingPayloadSchema.safeParse({ ...standIn, proxy_for: standIn.indicator_slug }).success).toBe(false);
    // A stand-in carries no narrative draft.
    const parsed = storedFindingPayloadSchema.parse({ ...standIn, narrative_draft: { context: 'c', actions: [] } });
    expect(parsed).not.toHaveProperty('narrative_draft');
  });
});
