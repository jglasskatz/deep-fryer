import { describe, expect, it } from 'vitest';
import {
  currentDispositions,
  partitionForApproval,
  renderAnnotationsForRerun,
  type CurrentDisposition,
  type ReviewNoteRow,
} from './review.js';
import { reviewAnnotationSchema } from './validators.js';
import type { FindingPayload, FindingVerification } from './types.js';

const passVerification: FindingVerification = {
  url_ok: true,
  schema_ok: true,
  recency_ok: true,
  scale_ok: true,
  content_supported: 'pass',
};

const failVerification: FindingVerification = {
  ...passVerification,
  content_supported: 'fail',
  verifier_note: 'contradicted',
};

function indicatorPayload(slug: string): FindingPayload {
  return {
    kind: 'indicator',
    indicator_slug: slug,
    name: slug,
    value: 1,
    unit: '%',
    year: 2024,
    target: 2,
    level_pct: -50,
    scoring: {
      threshold_ref: `t.${slug}`,
      function: 'lower_is_better',
      inputs: { value: 1, target: 2, scale: 2 },
      worked_math: 'x',
    },
    source: 's',
    source_url: 'https://example.gov',
    source_tier: 1,
    evidence: { snapshot_path: 'evidence/x.png', captured_at: '2026-01-01T00:00:00Z' },
    confidence: 'high',
    geographic_scale: 'city',
  };
}

const gapPayload: FindingPayload = {
  kind: 'gap',
  indicator_slug: 'missing',
  reason: 'nothing published',
  scales_tried: ['city'],
  searched_at: '2026-01-01T00:00:00Z',
};

function note(overrides: Partial<ReviewNoteRow>): ReviewNoteRow {
  return {
    findingId: null,
    disposition: null,
    annotation: null,
    note: null,
    reviewerLabel: 'reviewer',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

describe('currentDispositions', () => {
  it('latest disposition per finding wins; pure comments never change state', () => {
    const rows: ReviewNoteRow[] = [
      note({ findingId: 'f1', disposition: 'rejected', createdAt: new Date('2026-08-01') }),
      note({ findingId: 'f1', disposition: 'verified', createdAt: new Date('2026-08-02') }),
      note({ findingId: 'f1', note: 'a later thought', createdAt: new Date('2026-08-03') }),
      note({ findingId: 'f2', disposition: 'needs_rework', createdAt: new Date('2026-08-01') }),
    ];
    const current = currentDispositions(rows);
    expect(current).toHaveLength(2);
    expect(current.find((d) => d.findingId === 'f1')?.state).toBe('verified');
    expect(current.find((d) => d.findingId === 'f2')?.state).toBe('needs_rework');
  });
});

describe('partitionForApproval', () => {
  const findings = [
    { id: 'ok', indicatorSlug: 'ok', payload: indicatorPayload('ok'), verification: passVerification },
    { id: 'bad', indicatorSlug: 'bad', payload: indicatorPayload('bad'), verification: failVerification },
    { id: 'gap', indicatorSlug: 'missing', payload: gapPayload, verification: passVerification },
  ];
  const d = (findingId: string, state: CurrentDisposition['state']): CurrentDisposition => ({
    findingId,
    state,
    reviewerLabel: 'r',
    at: new Date(),
  });

  it('blocks flagged findings that lack an individual disposition — the silent-approval bug', () => {
    const p = partitionForApproval(findings, []);
    expect(p.undispositionedFlagged).toEqual(['bad']);
    // The clean finding and the honest gap still materialize.
    expect(p.indicators.map((i) => i.indicator_slug)).toEqual(['ok']);
    expect(p.gaps.map((g) => g.indicator_slug)).toEqual(['missing']);
  });

  it('excludes rejected findings and lets a reviewer override the verifier', () => {
    const p = partitionForApproval(findings, [d('bad', 'rejected')]);
    expect(p.rejected).toEqual(['bad']);
    expect(p.undispositionedFlagged).toEqual([]);
    expect(p.indicators.map((i) => i.indicator_slug)).toEqual(['ok']);

    // Override: the expert dispositioned the verifier-failed finding as verified.
    const o = partitionForApproval(findings, [d('bad', 'verified')]);
    expect(o.indicators.map((i) => i.indicator_slug)).toEqual(['ok', 'bad']);
  });

  it('needs_rework blocks the finding outright', () => {
    const p = partitionForApproval(findings, [d('bad', 'needs_rework')]);
    expect(p.blockedNeedsRework).toEqual(['bad']);
  });

  it('a missing verification record counts as flagged', () => {
    const p = partitionForApproval(
      [{ id: 'nv', indicatorSlug: 'nv', payload: indicatorPayload('nv'), verification: null }],
      [],
    );
    expect(p.undispositionedFlagged).toEqual(['nv']);
  });
});

describe('reviewAnnotationSchema', () => {
  it('accepts structured suggestions and rejects unknown keys and bad urls', () => {
    expect(
      reviewAnnotationSchema.safeParse({
        reason_code: 'outdated',
        suggested_source_url: 'https://data.census.gov/newer',
        suggested_year: 2025,
        tags: ['follow-up'],
      }).success,
    ).toBe(true);
    expect(reviewAnnotationSchema.safeParse({ reason_code: 'nope' }).success).toBe(false);
    expect(reviewAnnotationSchema.safeParse({ suggested_source_url: 'not a url' }).success).toBe(
      false,
    );
    expect(reviewAnnotationSchema.safeParse({ surprise: true }).success).toBe(false);
  });
});

describe('renderAnnotationsForRerun', () => {
  it('serializes dispositions, annotations, and comments as machine-readable JSON', () => {
    const block = renderAnnotationsForRerun([
      {
        indicatorSlug: 'rent-burden',
        disposition: {
          findingId: 'f1',
          state: 'rejected',
          note: 'value contradicts table B25070',
          annotation: { reason_code: 'wrong_value', suggested_source_url: 'https://example.gov' },
          reviewerLabel: 'r',
          at: new Date(),
        },
        notes: [note({ findingId: 'f1', note: 'check the 5-year series next time' })],
      },
      { indicatorSlug: 'untouched', disposition: undefined, notes: [] },
    ]);
    expect(block).toContain('verified-discoveries-seed-reruns');
    const json = JSON.parse(block.slice(block.indexOf('\n') + 1));
    expect(json).toHaveLength(1);
    expect(json[0]).toMatchObject({
      indicator_slug: 'rent-burden',
      disposition: 'rejected',
      annotation: { reason_code: 'wrong_value' },
      reviewer_note: 'value contradicts table B25070',
      comments: ['check the 5-year series next time'],
    });
  });

  it('returns an empty string when there is nothing to carry', () => {
    expect(renderAnnotationsForRerun([{ indicatorSlug: 'x', disposition: undefined, notes: [] }])).toBe('');
  });
});
