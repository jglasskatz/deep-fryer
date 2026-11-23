import { describe, expect, it } from 'vitest';
import { defaultPortraitConfig } from '@deep-fryer/contract';
import type { IndicatorFindingPayload, GapFindingPayload } from '@deep-fryer/core';
import {
  correctionReasons,
  needsPreVerifierCorrection,
  planPreVerifierCorrection,
  shouldAcceptCorrection,
  type DeterministicGateChecks,
} from './self-correct.js';
import { DEFAULT_CORRECTION_MAX_TURNS } from './plan.js';

const config = defaultPortraitConfig('City of Santa Cruz', 'City of Santa Cruz municipal boundary');

const indicator = (overrides: Partial<IndicatorFindingPayload> = {}): IndicatorFindingPayload => ({
  kind: 'indicator',
  indicator_slug: 'cost-burdened-renters',
  name: 'Cost-burdened renters',
  value: 54.2,
  unit: '%',
  year: 2024,
  target: 30,
  level_pct: 80.7,
  scoring: {
    threshold_ref: 'housing.cost-burdened-renters',
    function: 'lower_is_better',
    inputs: { value: 54.2, target: 30 },
    worked_math: '(54.2 - 30) / 30 * 100 = 80.7',
  },
  source: 'Santa Cruz Housing Office',
  source_url: 'https://www.cityofsantacruz.com/housing',
  source_tier: 1,
  evidence: {
    snapshot_path: 'evidence/housing.png',
    text_path: 'evidence/housing.txt',
    captured_at: '2026-10-01T00:00:00Z',
  },
  confidence: 'high',
  geographic_scale: 'city',
  ...overrides,
});

const gap = (): GapFindingPayload => ({
  kind: 'gap',
  indicator_slug: 'cost-burdened-renters',
  reason: 'No compliant table found',
  scales_tried: ['city', 'county'],
  searched_at: '2026-10-01T00:00:00Z',
});

const baseChecks = (overrides: Partial<DeterministicGateChecks> = {}): DeterministicGateChecks => ({
  schema_ok: true,
  url_ok: true,
  recency_ok: true,
  scale_ok: true,
  value_on_page: 'found',
  home_page_link: false,
  ...overrides,
});

describe('pre-verifier deterministic self-correction planner', () => {
  it('triggers only for indicator findings with value_on_page === not_found or home_page_link === true', () => {
    expect(correctionReasons(indicator(), baseChecks())).toEqual([]);
    expect(needsPreVerifierCorrection(indicator(), baseChecks())).toBe(false);

    // Scanned PDF (no_text) does not trigger by itself.
    expect(needsPreVerifierCorrection(indicator(), baseChecks({ value_on_page: 'no_text' }))).toBe(false);

    // Gaps and schema-invalid payloads never trigger.
    expect(needsPreVerifierCorrection(gap(), baseChecks({ value_on_page: 'not_found', home_page_link: true }))).toBe(false);
    expect(needsPreVerifierCorrection(null, baseChecks({ value_on_page: 'not_found', home_page_link: true }))).toBe(false);

    expect(correctionReasons(indicator(), baseChecks({ value_on_page: 'not_found' }))).toEqual(['value_not_found']);
    expect(correctionReasons(indicator(), baseChecks({ home_page_link: true }))).toEqual(['home_page_link']);
    expect(correctionReasons(indicator(), baseChecks({ url_ok: false }))).toEqual(['url_failed']);
    expect(correctionReasons(indicator(), baseChecks({ recency_ok: false }))).toEqual(['recency_failed']);
    expect(correctionReasons(indicator(), baseChecks({ scale_ok: false }))).toEqual(['scale_failed']);
    expect(
      correctionReasons(indicator(), baseChecks({ value_on_page: 'not_found', home_page_link: true, url_ok: false, recency_ok: false, scale_ok: false })),
    ).toEqual(['value_not_found', 'home_page_link', 'url_failed', 'recency_failed', 'scale_failed']);
  });

  it('plans self-correction for missing planned indicators and failed url/recency/scale gates', () => {
    const plan = planPreVerifierCorrection({
      config,
      dimensionSlug: 'housing',
      dimensionName: 'Housing',
      regionBrief: 'Coastal city in California.',
      flagged: [
        {
          payload: indicator({ year: 2010, geographic_scale: 'national' }),
          checks: baseChecks({ url_ok: false, recency_ok: false, scale_ok: false }),
          reasons: ['url_failed', 'recency_failed', 'scale_failed'],
        },
      ],
      missing: [{ slug: 'eviction-rate', name: 'Eviction filings', unit: 'per 1,000' }],
    });
    expect(plan).not.toBeNull();
    expect(plan!.flaggedSlugs).toEqual(['cost-burdened-renters', 'eviction-rate']);
    expect(plan!.prompt).toContain('URL DID NOT RESOLVE');
    expect(plan!.prompt).toContain('RECENCY POLICY FAILED');
    expect(plan!.prompt).toContain('GEOGRAPHIC SCALE POLICY FAILED');
    expect(plan!.prompt).toContain('MISSING PLANNED INDICATOR');
    expect(plan!.prompt).toContain('eviction-rate');
  });

  it('returns null when nothing is flagged and renders a targeted diagnostic prompt otherwise', () => {
    expect(
      planPreVerifierCorrection({
        config,
        dimensionSlug: 'housing',
        dimensionName: 'Housing',
        regionBrief: 'Coastal city in California.',
        flagged: [],
      }),
    ).toBeNull();

    const plan = planPreVerifierCorrection({
      config,
      dimensionSlug: 'housing',
      dimensionName: 'Housing',
      regionBrief: 'Coastal city in California.',
      flagged: [
        {
          payload: indicator(),
          checks: baseChecks({ value_on_page: 'not_found', home_page_link: true }),
          reasons: ['value_not_found', 'home_page_link'],
        },
      ],
      sessionMaxTurns: 60,
    });

    expect(plan).not.toBeNull();
    expect(plan!.flaggedSlugs).toEqual(['cost-burdened-renters']);
    expect(plan!.maxTurns).toBe(DEFAULT_CORRECTION_MAX_TURNS);
    expect(plan!.prompt).toContain('VALUE NOT FOUND ON CAPTURED PAGE');
    expect(plan!.prompt).toContain('54.2');
    expect(plan!.prompt).toContain('HOME OR SECTION PAGE LINK');
    expect(plan!.prompt).toContain('https://www.cityofsantacruz.com/housing');
    expect(plan!.prompt).toContain('capture_evidence');
    expect(plan!.prompt).toContain('kind: "gap"');
  });

  it('respects a lower sessionMaxTurns cap', () => {
    const plan = planPreVerifierCorrection({
      config,
      dimensionSlug: 'housing',
      dimensionName: 'Housing',
      regionBrief: 'Brief.',
      flagged: [
        {
          payload: indicator(),
          checks: baseChecks({ home_page_link: true }),
          reasons: ['home_page_link'],
        },
      ],
      sessionMaxTurns: 8,
    });
    expect(plan!.maxTurns).toBe(8);
  });

  it('accepts valid corrections and honest gaps, while rejecting schema-invalid or regressed outputs', () => {
    const orig = { payload: indicator(), checks: baseChecks({ value_on_page: 'not_found', home_page_link: true }) };
    expect(shouldAcceptCorrection(orig, { payload: null, checks: baseChecks({ schema_ok: false }) })).toBe(false);
    expect(shouldAcceptCorrection(orig, { payload: gap(), checks: baseChecks() })).toBe(true);
    expect(
      shouldAcceptCorrection(orig, {
        payload: indicator({ source_url: 'https://www.cityofsantacruz.com/housing/report-2024.pdf' }),
        checks: baseChecks({ value_on_page: 'found', home_page_link: false }),
      }),
    ).toBe(true);
    // Regressing ANY gate (even while fixing home_page_link or value_on_page) is rejected!
    expect(
      shouldAcceptCorrection(orig, {
        payload: indicator(),
        checks: baseChecks({ url_ok: false, value_on_page: 'found', home_page_link: false }),
      }),
    ).toBe(false);
    expect(
      shouldAcceptCorrection(orig, {
        payload: indicator(),
        checks: baseChecks({ recency_ok: false, value_on_page: 'found', home_page_link: false }),
      }),
    ).toBe(false);
    expect(
      shouldAcceptCorrection(orig, {
        payload: indicator(),
        checks: baseChecks({ scale_ok: false, value_on_page: 'found', home_page_link: false }),
      }),
    ).toBe(false);

    // Turning value_on_page from 'not_found' into 'no_text' does NOT resolve value_not_found.
    const valOnlyOrig = { payload: indicator(), checks: baseChecks({ value_on_page: 'not_found', home_page_link: false }) };
    expect(
      shouldAcceptCorrection(valOnlyOrig, {
        payload: indicator(),
        checks: baseChecks({ value_on_page: 'no_text', home_page_link: false }),
      }),
    ).toBe(false);
    // Newly introducing home_page_link is rejected even if value_on_page is fixed.
    expect(
      shouldAcceptCorrection(valOnlyOrig, {
        payload: indicator(),
        checks: baseChecks({ value_on_page: 'found', home_page_link: true }),
      }),
    ).toBe(false);
    // No-op (resolves nothing) is rejected.
    expect(
      shouldAcceptCorrection(valOnlyOrig, {
        payload: indicator(),
        checks: baseChecks({ value_on_page: 'not_found', home_page_link: false }),
      }),
    ).toBe(false);
    // Fixing url_ok / recency_ok / scale_ok without regressions is accepted.
    expect(
      shouldAcceptCorrection(
        { payload: indicator(), checks: baseChecks({ recency_ok: false }) },
        { payload: indicator(), checks: baseChecks({ recency_ok: true }) },
      ),
    ).toBe(true);
  });
});
