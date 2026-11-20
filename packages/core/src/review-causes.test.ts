import { describe, expect, it } from 'vitest';
import {
  APPROVAL_CAUSE,
  auditCausesNeeded,
  CAUSE_MISSING,
  checkReviewCause,
  OTHER_NEEDS_WORDS,
  REVIEW_CAUSES,
  REVIEW_LABEL_CAUSES,
  REVIEW_NOTE_MAX,
  reviewCauseLabel,
  reviewLabelRows,
  type ReviewLabelInput,
} from './review-causes.js';

describe('the list of review causes', () => {
  it('holds the eleven causes, in the order a reviewer sees them, each with plain words', () => {
    expect(REVIEW_CAUSES.map((c) => c.id)).toEqual([
      'wrong_geography',
      'wrong_year',
      'value_not_on_page',
      'home_page_link',
      'wrong_measure',
      'out_of_date',
      'source_unreadable',
      'better_source',
      'unsupported',
      'placeholder',
      'other',
    ]);
    for (const cause of REVIEW_CAUSES) {
      expect(cause.label.length).toBeGreaterThan(0);
      expect(cause.label.length).toBeLessThanOrEqual(30);
      expect(cause.label).not.toMatch(/_/);
    }
    expect(new Set(REVIEW_CAUSES.map((c) => c.label)).size).toBe(REVIEW_CAUSES.length);
  });

  it('records approvals as correct as cited, a cause no reviewer picks', () => {
    expect(REVIEW_LABEL_CAUSES[0]).toBe(APPROVAL_CAUSE);
    expect(REVIEW_LABEL_CAUSES).toHaveLength(12);
    expect(reviewCauseLabel(APPROVAL_CAUSE)).toBe('Correct as cited');
    expect(checkReviewCause(APPROVAL_CAUSE)).toEqual({ ok: false, problem: CAUSE_MISSING });
  });
});

describe('checkReviewCause', () => {
  it('refuses no cause, or one not on the list', () => {
    for (const cause of [undefined, null, '', 'WRONG_YEAR', 'wrong year', 7, {}]) {
      expect(checkReviewCause(cause)).toEqual({ ok: false, problem: CAUSE_MISSING });
    }
  });

  it('accepts each cause on the list', () => {
    for (const { id } of REVIEW_CAUSES.filter((c) => c.id !== 'other')) {
      expect(checkReviewCause(id)).toEqual({ ok: true, cause: id });
    }
  });

  it('needs words of the reviewer’s own for "Something else"', () => {
    expect(checkReviewCause('other')).toEqual({ ok: false, problem: OTHER_NEEDS_WORDS });
    expect(checkReviewCause('other', '   ')).toEqual({ ok: false, problem: OTHER_NEEDS_WORDS });
    expect(checkReviewCause('other', 'Counts visits, not people.')).toEqual({ ok: true, cause: 'other' });
  });
});

describe('auditCausesNeeded', () => {
  it('asks about every edit and rejection, never an approval', () => {
    expect(auditCausesNeeded([
      { findingId: 'a', disposition: 'approve' },
      { findingId: 'b', disposition: 'edit' },
      { findingId: 'c', disposition: 'reject' },
    ])).toEqual(['b', 'c']);
    expect(auditCausesNeeded([{ findingId: 'a', disposition: 'approve' }])).toEqual([]);
    expect(auditCausesNeeded([])).toEqual([]);
  });

  it('asks only about the findings sent back when any is sent back to research', () => {
    expect(auditCausesNeeded([
      { findingId: 'a', disposition: 'edit' },
      { findingId: 'b', disposition: 're_research' },
      { findingId: 'c', disposition: 'reject' },
    ])).toEqual(['b']);
  });
});

describe('reviewLabelRows', () => {
  const run: ReviewLabelInput['run'] = {
    id: 'run-1',
    plan: {
      strategy: 'standard',
      strategy_version: 1,
      models: { session_model: 'model-a', subagent_model: null, verifier_model: 'model-b', page_reader_model: 'model-c' },
    },
    execution: { provider: 'anthropic' },
  };
  const base = { tenantId: 't', dimensionId: 'd', run, reviewerId: 'u' };

  it('writes one row per finding approved, each correct as cited, naming the strategy, version, models and provider', () => {
    const rows = reviewLabelRows({ ...base, findingIds: ['f1', 'f2', 'f3'], decision: 'approve', cause: 'wrong_year', note: 'ignored' });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.findingId)).toEqual(['f1', 'f2', 'f3']);
    for (const row of rows) {
      expect(row).toEqual({
        tenantId: 't', findingId: row.findingId, runId: 'run-1', dimensionId: 'd', decision: 'approve', cause: 'correct_as_cited',
        note: null, strategy: 'standard', strategyVersion: 1, models: run.plan.models, provider: 'anthropic', reviewerId: 'u',
      });
    }
  });

  it('keeps the cause and a trimmed note for any other decision', () => {
    const [row] = reviewLabelRows({ ...base, findingIds: ['f1'], decision: 're_research', cause: 'wrong_year', note: '  2019, not 2023.  ' });
    expect(row).toMatchObject({ decision: 're_research', cause: 'wrong_year', note: '2019, not 2023.' });
    const [long] = reviewLabelRows({ ...base, findingIds: ['f1'], decision: 'edit', cause: 'other', note: 'x'.repeat(REVIEW_NOTE_MAX + 50) });
    expect(long!.note).toHaveLength(REVIEW_NOTE_MAX);
  });

  it('records one row with no finding for a dimension that had none in the run', () => {
    const rows = reviewLabelRows({ ...base, findingIds: [], decision: 'reject', cause: 'placeholder' });
    expect(rows).toEqual([expect.objectContaining({ findingId: null, decision: 'reject', cause: 'placeholder' })]);
  });

  it('names no strategy for an older plan, and the default provider for a run that recorded none', () => {
    const [row] = reviewLabelRows({ ...base, run: { id: 'old', plan: {}, execution: null }, findingIds: ['f1'], decision: 'approve' });
    expect(row).toMatchObject({ strategy: null, strategyVersion: null, models: null, provider: 'anthropic' });
  });

  it('refuses to write a non-approval without a complete cause, or a provider the table does not allow', () => {
    expect(() => reviewLabelRows({ ...base, findingIds: ['f1'], decision: 'edit' })).toThrow();
    expect(() => reviewLabelRows({ ...base, findingIds: ['f1'], decision: 'reject', cause: 'other', note: ' ' })).toThrow();
    expect(() => reviewLabelRows({ ...base, run: { ...run, execution: { provider: 'elsewhere' } }, findingIds: ['f1'], decision: 'approve' })).toThrow();
  });

  it('writes a finding once even if it is named twice', () => {
    expect(reviewLabelRows({ ...base, findingIds: ['f1', 'f1'], decision: 'approve' })).toHaveLength(1);
  });
});
