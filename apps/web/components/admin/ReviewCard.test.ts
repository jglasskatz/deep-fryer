import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { FindingPayload } from '@deep-fryer/core';
import type { RunExecution } from '@deep-fryer/db';
import { FindingRow, ReviewCard, type ReviewFinding } from './ReviewCard';

vi.stubGlobal('React', React);
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/review-actions', () => ({ approveFindings: vi.fn(), flagGap: vi.fn(), reResearchDimension: vi.fn() }));
vi.mock('@/lib/machine-audit-actions', () => ({ applyMachineAudits: vi.fn(), applyMachineApproved: vi.fn(), publishReviewed: vi.fn() }));
vi.mock('@/lib/use-action', () => ({ useAction: () => ({ run: vi.fn(), pending: false, error: null }) }));

const execution: RunExecution = { provider: 'anthropic', endpoint_host: 'api.anthropic.com', executor: 'shared_worker', host_region: null };
const payload: FindingPayload = {
  kind: 'indicator', indicator_slug: 'rent', name: 'Rent burden', value: 42, unit: '% of households', year: 2024, target: 30,
  source: 'Official data', source_url: 'https://example.gov', source_tier: 1, confidence: 'high', geographic_scale: 'city',
  evidence: { snapshot_path: 'evidence/source.png', captured_at: '2026-10-23T00:00:00Z' },
  scoring: { threshold_ref: 'housing.rent', function: 'lower_is_better', inputs: {}, worked_math: '' }, level_pct: 40,
};
const gap: FindingPayload = { kind: 'gap', indicator_slug: 'water', reason: 'No city series.', scales_tried: ['city'], searched_at: '2026-11-01T00:00:00Z' };
const finding = (over: Partial<ReviewFinding> = {}): ReviewFinding => ({ id: 'f1', indicatorSlug: 'rent', payload, verification: null, audits: [], ...over });
const row = (f: ReviewFinding) => renderToStaticMarkup(createElement(FindingRow, { finding: f, evidenceBase: '/evidence' }));

describe('which provider and model produced a finding, in review', () => {
  it('names the model, the provider and the shared server', () => {
    const html = row(finding({ provenance: { execution, session: { model: 'claude-sonnet-5' } } }));
    expect(html).toContain('Researched with claude-sonnet-5 on Anthropic, shared server');
  });

  it('names the model that answered after a refusal', () => {
    const html = row(finding({
      provenance: {
        execution,
        session: {
          model: 'claude-sonnet-5',
          refusal_fallbacks: [{ original_model: 'claude-sonnet-5', fallback_model: 'claude-opus-5', category: 'cyber' }],
        },
      },
    }));
    expect(html).toContain('Researched with claude-sonnet-5 on Anthropic, shared server');
    expect(html).toContain('When claude-sonnet-5 declined part of the work, claude-opus-5 answered.');
  });

  it('says so on an older run that did not record its provider, and on a session with no usage', () => {
    expect(row(finding({ provenance: { execution: null, session: { model: 'claude-sonnet-5' } } })))
      .toContain('Researched with claude-sonnet-5; provider not recorded');
    expect(row(finding({ provenance: { execution, session: null } })))
      .toContain('Researched with a model that was not recorded on Anthropic, shared server');
    expect(row(finding())).toContain('provider not recorded');
  });

  it('names them on gap cards too', () => {
    const html = row(finding({ payload: gap, indicatorSlug: 'water', provenance: { execution, session: { model: 'claude-sonnet-5' } } }));
    expect(html).toContain('Data gap');
    expect(html).toContain('Researched with claude-sonnet-5 on Anthropic, shared server');
  });

  it('shows each finding’s own line on the dimension’s review card', () => {
    const html = renderToStaticMarkup(createElement(ReviewCard, {
      tenantSlug: 'nyc', runId: 'r1', dimensionId: 'd1', dimensionName: 'Housing', ring: 'social', approvedVersionNum: null,
      sessionId: 's1', canReadTranscript: false, evidenceBase: '/evidence',
      findings: [
        finding({ provenance: { execution, session: { model: 'claude-sonnet-5' } } }),
        finding({ id: 'f2', payload: gap, indicatorSlug: 'water', provenance: { execution, session: { model: 'claude-sonnet-5', refusal_fallbacks: [{ original_model: 'claude-sonnet-5', fallback_model: 'claude-opus-5', category: null }] } } }),
      ],
    }));
    expect(html.match(/Researched with claude-sonnet-5 on Anthropic, shared server/g)).toHaveLength(2);
    expect(html).toContain('claude-opus-5 answered');
  });
});
