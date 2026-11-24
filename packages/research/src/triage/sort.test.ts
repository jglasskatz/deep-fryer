import { describe, expect, it } from 'vitest';
import type { FindingVerification } from '@deep-fryer/core';
import type { TriageAssessment } from './schema.js';
import { sortReviewCardsWorstFirst, type ReviewCardSortable } from './sort.js';

const PASS: FindingVerification = {
  schema_ok: true,
  url_ok: true,
  recency_ok: true,
  scale_ok: true,
  content_supported: 'pass',
  value_on_page: 'found',
  home_page_link: false,
};

const VERIFIER_FAIL: FindingVerification = {
  ...PASS,
  content_supported: 'fail',
};

const CLEAN_TRIAGE: TriageAssessment = {
  construct_match: 'match',
  epistemic_type: 'measured',
  geography_match: 'match',
  is_primary_source: 'primary',
  reason: 'Matches claim frame.',
};

const HIGH_TRIAGE: TriageAssessment = {
  ...CLEAN_TRIAGE,
  epistemic_type: 'projection_or_goal',
  reason: 'Figure is a 2030 target, not a measured observation.',
};

const MEDIUM_TRIAGE: TriageAssessment = {
  ...CLEAN_TRIAGE,
  construct_match: 'partial',
  reason: 'Includes owner-occupied units in denominator.',
};

const LOW_TRIAGE: TriageAssessment = {
  ...CLEAN_TRIAGE,
  epistemic_type: 'modeled_estimate',
  reason: 'Modeled estimate.',
};

interface TestCard extends ReviewCardSortable {
  id: string;
}

describe('sortReviewCardsWorstFirst', () => {
  it('orders high-severity and flagged cards first, then medium, low, and clean, without mutating input', () => {
    const cards: TestCard[] = [
      {
        id: 'clean',
        dimension: { displayOrder: 1, slug: 'water' },
        findings: [{ verification: PASS, triage: CLEAN_TRIAGE }],
      },
      {
        id: 'low',
        dimension: { displayOrder: 2, slug: 'energy' },
        findings: [{ verification: PASS, triage: LOW_TRIAGE }],
      },
      {
        id: 'medium',
        dimension: { displayOrder: 3, slug: 'housing' },
        findings: [{ verification: PASS, triage: MEDIUM_TRIAGE }],
      },
      {
        id: 'high',
        dimension: { displayOrder: 4, slug: 'climate' },
        findings: [{ verification: PASS, triage: HIGH_TRIAGE }],
      },
    ];
    const snapshot = cards.map((c) => c.id);

    const sorted = sortReviewCardsWorstFirst(cards);
    expect(cards.map((c) => c.id)).toEqual(snapshot);
    expect(sorted.map((c) => c.id)).toEqual(['high', 'medium', 'low', 'clean']);
  });

  it('never demotes a verifier-flagged card below an unflagged card even when triage says none', () => {
    const cards: TestCard[] = [
      {
        id: 'unflagged-low',
        dimension: { displayOrder: 1, slug: 'energy' },
        findings: [{ verification: PASS, triage: LOW_TRIAGE }],
      },
      {
        id: 'verifier-flagged-clean-triage',
        dimension: { displayOrder: 5, slug: 'food' },
        findings: [{ verification: VERIFIER_FAIL, triage: CLEAN_TRIAGE }],
      },
      {
        id: 'unflagged-clean',
        dimension: { displayOrder: 2, slug: 'water' },
        findings: [{ verification: PASS, triage: CLEAN_TRIAGE }],
      },
    ];

    const sorted = sortReviewCardsWorstFirst(cards);
    expect(sorted.map((c) => c.id)).toEqual([
      'verifier-flagged-clean-triage',
      'unflagged-low',
      'unflagged-clean',
    ]);
  });

  it('uses displayOrder as a stable tie-breaker among equally ranked cards', () => {
    const cards: TestCard[] = [
      {
        id: 'dim-b',
        dimension: { displayOrder: 10, slug: 'housing' },
        findings: [{ verification: PASS, triage: CLEAN_TRIAGE }],
      },
      {
        id: 'dim-a',
        dimension: { displayOrder: 2, slug: 'water' },
        findings: [{ verification: PASS, triage: CLEAN_TRIAGE }],
      },
    ];

    const sorted = sortReviewCardsWorstFirst(cards);
    expect(sorted.map((c) => c.id)).toEqual(['dim-a', 'dim-b']);
  });
});
