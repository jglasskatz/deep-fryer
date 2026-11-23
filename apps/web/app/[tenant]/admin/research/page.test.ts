import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedReviewLabel } from '@deep-fryer/db';

/**
 * The research page: each run in the history shows its estimated dollars,
 * and the page shows the portrait's total: every run that was applied or
 * recorded usage, so the total agrees with the list. A planned run that
 * neither was applied nor recorded usage spent nothing and does not count; a
 * run worked without being applied (a staff measurement run) still counts;
 * a run with a session that left no record shows only what is known.
 *
 * When recorded review_labels exist for the portrait, the page also renders
 * the compact Review calibration summary (confirmed precision, verifier
 * false-pass rate, and top rejection/edit causes).
 */
vi.stubGlobal('React', React);

const sonnet = { input_tokens: 1, output_tokens: 1, by_model: { 'claude-sonnet-5': { input_tokens: 1_000_000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0 } } };
const applied = new Date('2026-11-01T10:00:00Z');
const runs = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', status: 'complete', appliedAt: applied, createdAt: applied, plan: { sessions: [{}] }, tokenUsage: { s1: sonnet } },
  { id: 'bbbbbbbb-0000-4000-8000-000000000002', status: 'complete', appliedAt: applied, createdAt: applied, plan: { sessions: [{}, {}] }, tokenUsage: { s2: sonnet } },
  { id: 'cccccccc-0000-4000-8000-000000000003', status: 'planned', appliedAt: null, createdAt: applied, plan: { sessions: [{}] }, tokenUsage: null },
  { id: 'dddddddd-0000-4000-8000-000000000004', status: 'complete', appliedAt: null, createdAt: applied, plan: { sessions: [{}] }, tokenUsage: { m1: sonnet } },
];

let mockReviewLabels: LoadedReviewLabel[] = [];

vi.mock('@/components/site-header/SiteHeader', () => ({ SiteHeader: () => null }));
vi.mock('@/components/admin/NewRunForm', () => ({ NewRunForm: () => null }));
vi.mock('@/components/admin/AutoRefresh', () => ({ AutoRefresh: () => null }));
vi.mock('@/components/billing/UsageMeter', () => ({ UsageMeter: () => null }));
vi.mock('@/lib/page-meta', () => ({ adminPageMetadata: vi.fn() }));
vi.mock('@/lib/admin-guard', () => ({ requireAdminPage: async () => ({ tenant: { id: 't1', slug: 'ithaca', name: 'Ithaca', organizationId: 'o1' } }) }));
vi.mock('@/lib/billing', () => ({
  billingSummary: async () => ({ limits: null, blockedMessage: 'No plan', apiKey: null, usage: { researchSessions: 0 } }),
  keyFundedSessionsNote: () => '',
}));
vi.mock('@/lib/admin-data', () => ({
  tenantRuns: async () => runs,
  tenantDimensions: async () => [],
  // The second run has a session that left no usage record.
  tenantRunSessionIds: async () => new Map([[runs[0]!.id, ['s1']], [runs[1]!.id, ['s2', 's3']], [runs[3]!.id, ['m1']]]),
  tenantReviewLabels: async () => mockReviewLabels,
}));

function makeLabel(over: Partial<LoadedReviewLabel> = {}): LoadedReviewLabel {
  return {
    id: 'lbl-1',
    tenantId: 't1',
    findingId: 'f-1',
    runId: runs[0]!.id,
    dimensionId: 'd1',
    dimensionSlug: 'housing',
    indicatorSlug: 'cost-burdened-renters',
    decision: 'approve',
    cause: 'correct_as_cited',
    note: null,
    strategy: 'standard',
    strategyVersion: 1,
    models: { session_model: 'claude-sonnet-5', subagent_model: null, verifier_model: 'claude-opus-5' },
    provider: 'anthropic',
    reviewerId: 'u1',
    createdAt: applied,
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

describe('research page costs and review calibration', () => {
  beforeEach(() => {
    mockReviewLabels = [];
  });

  it('shows each run’s dollars and the portrait’s total, omitting calibration when no labels exist', async () => {
    const { default: ResearchPage } = await import('./page');
    const html = renderToStaticMarkup(await ResearchPage({ params: Promise.resolve({ tenant: 'ithaca' }) }));
    expect(html).toContain('Estimated cost');
    const row = (id: string) => html.split('<tr').find((r) => r.includes(id.slice(0, 8))) ?? '';
    expect(row(runs[0]!.id)).toContain('$2.00');
    expect(row(runs[1]!.id)).toContain('$2.00');
    expect(row(runs[1]!.id)).toContain('known so far');
    expect(row(runs[2]!.id)).toContain('—');
    expect(row(runs[3]!.id)).toContain('$2.00');
    expect(html).toContain('Estimated research cost for this portrait so far:');
    expect(html).toContain('$6.00</span> known so far across 3 runs');
    expect(html).toContain('1 run has usage that is missing or not fully priced');
    expect(html).not.toContain('Review calibration');
  });

  it('renders the Review calibration panel with confirmed precision, verifier false-pass rate, and top causes when review_labels exist', async () => {
    mockReviewLabels = [
      makeLabel({ id: 'l1', decision: 'approve', cause: 'correct_as_cited' }),
      makeLabel({ id: 'l2', decision: 'approve', cause: 'correct_as_cited' }),
      makeLabel({ id: 'l3', decision: 'approve', cause: 'correct_as_cited' }),
      makeLabel({
        id: 'l4',
        decision: 'reject',
        cause: 'wrong_geography',
        note: 'County figure instead of city',
      }),
      makeLabel({
        id: 'l5',
        decision: 'edit',
        cause: 'wrong_measure',
        note: 'Denominator mismatch',
        findingVerification: {
          schema_ok: true,
          url_ok: true,
          recency_ok: true,
          scale_ok: true,
          content_supported: 'fail',
        },
      }),
    ];

    const { default: ResearchPage } = await import('./page');
    const html = renderToStaticMarkup(await ResearchPage({ params: Promise.resolve({ tenant: 'ithaca' }) }));
    expect(html).toContain('Review calibration');
    expect(html).toContain('5 labeled decisions');
    expect(html).toContain('60%');
    expect(html).toContain('3 of 5 approved as cited');
    expect(html).toContain('Verifier false-pass rate');
    expect(html).toContain('25%');
    expect(html).toContain('1 of 4 passed findings corrected');
    expect(html).toContain('Wrong place or area (1)');
    expect(html).toContain('Wrong measure or total (1)');
  });
});
