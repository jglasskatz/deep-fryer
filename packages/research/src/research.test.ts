import { describe, expect, it } from 'vitest';
import { defaultPortraitConfig, framework } from '@deep-fryer/contract';
import { renderPlan, REGION_BRIEF_PLACEHOLDER } from './plan.js';
import { deterministicChecks, isFlagged, mergeVerification } from './verify.js';

const config = defaultPortraitConfig('City of Santa Cruz', 'City of Santa Cruz municipal boundary');

const housing = framework.dimensions.find((d) => d.slug === 'housing')!;

describe('renderPlan', () => {
  const plan = renderPlan({
    config,
    dimensions: [
      {
        dimensionId: 'x',
        slug: housing.slug,
        ring: housing.ring,
        name: housing.name,
        indicators: housing.indicators,
        reviewerNotes: 'County PIT count was updated in January — use the new one.',
      },
    ],
  });

  it('renders phase-0 region context plus one session per dimension', () => {
    expect(plan.sessions).toHaveLength(2);
    expect(plan.sessions[0]?.kind).toBe('region_context');
    expect(plan.sessions[1]?.kind).toBe('dimension');
    expect(plan.sessions[1]?.dimension_slug).toBe('housing');
  });

  it('injects config into prompts and keeps the region-brief placeholder', () => {
    const prompt = plan.sessions[1]!.prompt;
    expect(prompt).toContain('Tier 1 — Official local government');
    expect(prompt).toContain('last 5 years');
    expect(prompt).toContain('housing.cost-burdened-renters');
    expect(prompt).toContain(REGION_BRIEF_PLACEHOLDER);
    expect(prompt).toContain('County PIT count was updated in January');
  });

  it('applies threshold overrides to the thresholds block', () => {
    const overridden = renderPlan({
      config: {
        ...config,
        threshold_overrides: {
          'housing.cost-burdened-renters': { target: 25, rationale: 'adopted housing element goal' },
        },
      },
      dimensions: [
        {
          dimensionId: 'x',
          slug: housing.slug,
          ring: housing.ring,
          name: housing.name,
          indicators: housing.indicators,
        },
      ],
    });
    expect(overridden.sessions[1]!.prompt).toContain('target 25');
    expect(overridden.sessions[1]!.prompt).toContain('adopted housing element goal');
    expect(overridden.config_hash).not.toBe(plan.config_hash);
  });
});

describe('deterministicChecks', () => {
  const goodFinding = {
    kind: 'indicator',
    indicator_slug: 'cost-burdened-renters',
    name: 'Renter households paying over 30% of income on housing',
    value: 58.4,
    unit: '% of renter households',
    year: new Date().getFullYear() - 1,
    target: 30,
    level_pct: 94.7,
    scoring: {
      threshold_ref: 'housing.cost-burdened-renters',
      function: 'lower_is_better',
      inputs: { value: 58.4, target: 30, scale: 30 },
      worked_math: 'level_pct = (58.4 − 30) ⁄ 30 × 100 = +94.7',
    },
    source: 'ACS',
    source_url: 'https://data.census.gov/table/x',
    source_tier: 2,
    evidence: { snapshot_path: 'evidence/x.png', captured_at: new Date().toISOString() },
    confidence: 'high',
    geographic_scale: 'city',
  };

  it('passes a compliant finding', async () => {
    const { payload, checks } = await deterministicChecks(goodFinding, config, 'housing', async () => true);
    expect(payload?.kind).toBe('indicator');
    expect(checks).toEqual({ schema_ok: true, url_ok: true, recency_ok: true, scale_ok: true });
  });

  it('flags stale years and disallowed scales', async () => {
    const { checks } = await deterministicChecks(
      { ...goodFinding, year: 2005, geographic_scale: 'national' },
      config,
      'housing',
      async () => true,
    );
    expect(checks.recency_ok).toBe(false);
    expect(checks.scale_ok).toBe(false);
  });

  it('rejects malformed payloads at the schema gate', async () => {
    const { payload, checks } = await deterministicChecks({ kind: 'indicator' }, config, 'housing');
    expect(payload).toBeNull();
    expect(checks.schema_ok).toBe(false);
  });

  it('gap findings pass vacuously and still get flagged for review', async () => {
    const gap = {
      kind: 'gap',
      indicator_slug: 'aragonite-saturation',
      reason: 'no city-scale monitoring exists; MBARI series is regional',
      scales_tried: ['city', 'county'],
      searched_at: new Date().toISOString(),
    };
    const { payload, checks } = await deterministicChecks(gap, config, 'ocean-acidification');
    expect(payload?.kind).toBe('gap');
    const verification = mergeVerification(checks, { content_supported: 'uncertain', verifier_note: 'gap' });
    expect(isFlagged(verification)).toBe(true);
  });
});
