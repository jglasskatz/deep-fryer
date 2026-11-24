import { describe, expect, it, vi } from 'vitest';
import type { DbExecutor } from './client.js';
import {
  loadStrategyReviewSummary,
  loadTenantReviewLabels,
  type LoadedReviewLabel,
} from './review-labels-eval.js';

function makeMockDb(rows: LoadedReviewLabel[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const leftJoin = vi.fn().mockReturnValue({ where, orderBy });
  const innerJoin = vi.fn().mockReturnValue({ leftJoin });
  const from = vi.fn().mockReturnValue({ innerJoin });
  const select = vi.fn().mockReturnValue({ from });
  return {
    db: { select } as unknown as DbExecutor,
    spies: { select, from, innerJoin, leftJoin, where, orderBy, limit },
  };
}

function sampleLabel(over: Partial<LoadedReviewLabel> = {}): LoadedReviewLabel {
  return {
    id: 'lbl-1',
    tenantId: 't-1',
    findingId: 'f-1',
    runId: 'r-1',
    dimensionId: 'd-1',
    dimensionSlug: 'housing',
    indicatorSlug: 'cost-burdened-renters',
    decision: 'approve',
    cause: 'correct_as_cited',
    note: null,
    strategy: 'standard',
    strategyVersion: 1,
    models: {
      session_model: 'claude-sonnet-5',
      subagent_model: null,
      verifier_model: 'claude-opus-5',
    },
    provider: 'anthropic',
    reviewerId: 'u-1',
    createdAt: new Date('2026-11-01T12:00:00Z'),
    findingPayload: null,
    findingVerification: {
      schema_ok: true,
      url_ok: true,
      recency_ok: true,
      scale_ok: true,
      content_supported: 'pass',
    },
    ...over,
  };
}

describe('review-labels-eval DB helpers', () => {
  it('loads tenant review labels in a single query on the provided DbExecutor', async () => {
    const rows = [sampleLabel()];
    const { db, spies } = makeMockDb(rows);

    const loaded = await loadTenantReviewLabels(db, 't-1', {
      dimensionSlug: 'housing',
      limit: 50,
    });

    expect(loaded).toEqual(rows);
    expect(spies.select).toHaveBeenCalledTimes(1);
    expect(spies.where).toHaveBeenCalledTimes(1);
    expect(spies.limit).toHaveBeenCalledWith(50);
  });

  it('short-circuits empty runIds or decisions without querying', async () => {
    const { db, spies } = makeMockDb([]);
    expect(await loadTenantReviewLabels(db, 't-1', { runIds: [] })).toEqual([]);
    expect(await loadTenantReviewLabels(db, 't-1', { decisions: [] })).toEqual([]);
    expect(spies.select).not.toHaveBeenCalled();
  });

  it('computes precision, verifier false-pass rate, and strategy rollups in loadStrategyReviewSummary', async () => {
    const rows = [
      sampleLabel({ id: 'l1', decision: 'approve', cause: 'correct_as_cited', strategy: 'standard', strategyVersion: 1 }),
      sampleLabel({
        id: 'l2',
        decision: 'reject',
        cause: 'wrong_geography',
        note: 'Citywide instead of borough',
        strategy: 'standard',
        strategyVersion: 1,
      }),
      sampleLabel({
        id: 'l3',
        decision: 'edit',
        cause: 'wrong_measure',
        note: 'Wrong denominator',
        strategy: 'deep',
        strategyVersion: 1,
        findingVerification: {
          schema_ok: true,
          url_ok: true,
          recency_ok: true,
          scale_ok: true,
          content_supported: 'fail',
        },
      }),
    ];
    const { db, spies } = makeMockDb(rows);

    const summary = await loadStrategyReviewSummary(db, { tenantId: 't-1' });
    expect(spies.select).toHaveBeenCalledTimes(1);
    expect(summary.total).toBe(3);
    expect(summary.approved).toBe(1);
    expect(summary.nonApproved).toBe(2);
    expect(summary.confirmedPrecision).toBeCloseTo(1 / 3);
    expect(summary.verifierPassedTotal).toBe(2);
    expect(summary.verifierFalsePasses).toBe(1);
    expect(summary.verifierFalsePassRate).toBeCloseTo(0.5);
    expect(summary.topDefectCauses.map((c) => c.cause)).toEqual(['wrong_geography', 'wrong_measure']);
    expect(summary.byStrategy).toHaveLength(2);
    expect(summary.byStrategy[0]).toMatchObject({
      strategy: 'standard',
      strategyVersion: 1,
      total: 2,
      approved: 1,
      verifierFalsePasses: 1,
    });
  });

  it('returns an empty summary when runIds is empty', async () => {
    const { db, spies } = makeMockDb([]);
    const summary = await loadStrategyReviewSummary(db, { runIds: [] });
    expect(summary.total).toBe(0);
    expect(summary.confirmedPrecision).toBeNull();
    expect(summary.verifierFalsePassRate).toBeNull();
    expect(spies.select).not.toHaveBeenCalled();
  });
});
