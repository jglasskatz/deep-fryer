import { describe, expect, it } from 'vitest';
import { extractValuePassages } from './passages.js';
import { renderTriagePrompt } from './prompt.js';
import {
  TRIAGE_REASON_MAX_CHARS,
  triageAssessmentSchema,
  triageExpandsFlagged,
  triageFlags,
  triageSeverity,
  type TriageAssessment,
} from './schema.js';

const CLEAN: TriageAssessment = {
  construct_match: 'match',
  epistemic_type: 'measured',
  geography_match: 'match',
  is_primary_source: 'primary',
  reason: 'Direct Census ACS table reporting Bronx renter cost burden for 2024.',
};

describe('triageAssessmentSchema', () => {
  it('accepts a valid TriageAssessment', () => {
    const parsed = triageAssessmentSchema.safeParse(CLEAN);
    expect(parsed.success).toBe(true);
  });

  it('rejects invalid enums, unknown keys, empty reason, and overlong reason', () => {
    expect(triageAssessmentSchema.safeParse({ ...CLEAN, construct_match: 'exact' }).success).toBe(false);
    expect(triageAssessmentSchema.safeParse({ ...CLEAN, extra: true }).success).toBe(false);
    expect(triageAssessmentSchema.safeParse({ ...CLEAN, reason: '   ' }).success).toBe(false);
    expect(
      triageAssessmentSchema.safeParse({ ...CLEAN, reason: 'a'.repeat(TRIAGE_REASON_MAX_CHARS + 1) }).success,
    ).toBe(false);
  });
});

describe('triageSeverity, triageFlags, and strictly flag-expanding invariant', () => {
  it('scores clean findings as severity none with zero flags', () => {
    expect(triageSeverity(CLEAN)).toBe('none');
    expect(triageFlags(CLEAN)).toEqual([]);
  });

  it('flags construct mismatch, projection/goal, and geography mismatch as high severity', () => {
    const mismatch: TriageAssessment = { ...CLEAN, construct_match: 'mismatch' };
    expect(triageSeverity(mismatch)).toBe('high');
    expect(triageFlags(mismatch)).toContain('wrong_construct');

    const projection: TriageAssessment = { ...CLEAN, epistemic_type: 'projection_or_goal' };
    expect(triageSeverity(projection)).toBe('high');
    expect(triageFlags(projection)).toContain('not_a_measurement');

    const wrongGeo: TriageAssessment = { ...CLEAN, geography_match: 'mismatch' };
    expect(triageSeverity(wrongGeo)).toBe('high');
    expect(triageFlags(wrongGeo)).toContain('wrong_geography');
  });

  it('distinguishes tier-1 secondary republisher (medium) from non-tier-1 republisher (low)', () => {
    const republisher: TriageAssessment = { ...CLEAN, is_primary_source: 'secondary_republisher' };
    expect(triageSeverity(republisher, { claimedSourceTier: 1 })).toBe('medium');
    expect(triageFlags(republisher, { claimedSourceTier: 1 })).toContain('tier_overclaimed');

    expect(triageSeverity(republisher, { claimedSourceTier: 3 })).toBe('low');
    expect(triageFlags(republisher, { claimedSourceTier: 3 })).toContain('secondary_republisher');
  });

  it('applies SPEC-JEV broader-scale carve-out when finding honestly declares a broader scale', () => {
    const broader: TriageAssessment = { ...CLEAN, geography_match: 'broader_proxy' };
    // Unlabeled (claimed county for county portrait, but source is broader): medium flag
    expect(triageSeverity(broader, { claimedScale: 'county', portraitScale: 'county' })).toBe('medium');
    expect(triageFlags(broader, { claimedScale: 'county', portraitScale: 'county' })).toContain(
      'broader_geography_proxy',
    );

    // Honestly labeled city/regional for a county portrait: downgraded to low, no geography defect flag
    expect(triageSeverity(broader, { claimedScale: 'regional', portraitScale: 'county' })).toBe('low');
    expect(triageFlags(broader, { claimedScale: 'regional', portraitScale: 'county' })).not.toContain(
      'broader_geography_proxy',
    );
  });

  it('treats multiple unclear checks as medium severity and single unclear as low', () => {
    const oneUnclear: TriageAssessment = { ...CLEAN, is_primary_source: 'unclear' };
    expect(triageSeverity(oneUnclear)).toBe('low');

    const twoUnclear: TriageAssessment = {
      ...CLEAN,
      construct_match: 'unclear',
      geography_match: 'unclear',
    };
    expect(triageSeverity(twoUnclear)).toBe('medium');
    expect(triageFlags(twoUnclear)).toContain('unclear_evidence');
  });

  it('never suppresses an existing verifier/deterministic flag (strictly flag-expanding)', () => {
    expect(triageExpandsFlagged(true, CLEAN)).toBe(true);
    expect(triageExpandsFlagged(true, null)).toBe(true);
    expect(triageExpandsFlagged(false, CLEAN)).toBe(false);
    expect(triageExpandsFlagged(false, { ...CLEAN, epistemic_type: 'modeled_estimate' })).toBe(false);
    expect(triageExpandsFlagged(false, { ...CLEAN, construct_match: 'partial' })).toBe(true);
    expect(triageExpandsFlagged(false, { ...CLEAN, geography_match: 'mismatch' })).toBe(true);
  });
});

describe('renderTriagePrompt', () => {
  it('renders claim frame, passages, and prompt-injection defense', () => {
    const extracted = extractValuePassages({
      sourceText: 'Bronx ACS 2024: 61.2% of renter households are cost-burdened.',
      value: 61.2,
    });
    const rendered = renderTriagePrompt({
      finding: {
        indicator_slug: 'cost-burdened-renters',
        name: 'Cost-burdened renter households',
        value: 61.2,
        unit: '% of renter households',
        year: 2024,
        source: 'US Census Bureau ACS',
        source_url: 'https://data.census.gov/table/B25070',
        source_tier: 1,
        geographic_scale: 'county',
      },
      regionName: 'The Bronx',
      regionDefinition: 'Bronx County, NY',
      extracted,
    });

    expect(rendered.system).toContain('untrusted third-party');
    expect(rendered.system).toContain('construct_match');
    expect(rendered.system).toContain('epistemic_type');
    expect(rendered.user).toContain('"indicator_slug": "cost-burdened-renters"');
    expect(rendered.user).toContain('61.2%');
  });
});
