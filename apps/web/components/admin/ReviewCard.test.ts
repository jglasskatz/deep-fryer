import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { FindingPayload, IndicatorEvidence } from '@deep-fryer/core';
import type { RunExecution } from '@deep-fryer/db';
import { FindingRow, ReviewCard, type ReviewFinding } from './ReviewCard';

vi.stubGlobal('React', React);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
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

const BASE = '/files/tenant-anytown';

function capturedFinding(evidence: IndicatorEvidence, narrativeEvidence?: IndicatorEvidence): ReviewFinding {
  const payload: FindingPayload = {
    kind: 'indicator',
    indicator_slug: 'rent-burden',
    name: 'Rent burden',
    value: 42.7,
    unit: '% of households',
    year: 2023,
    target: 30,
    level_pct: 42,
    scoring: { threshold_ref: 'housing.rent', function: 'lower_is_better', inputs: {}, worked_math: '' },
    source: 'Anytown Housing Report',
    source_url: 'https://anytown.example.gov/housing/report',
    source_tier: 1,
    evidence,
    confidence: 'high',
    geographic_scale: 'city',
    ...(narrativeEvidence
      ? {
          narrative_draft: {
            context: 'Rents rose faster than wages.',
            actions: [{ text: 'Apply for rental help', source_url: 'https://anytown.example.gov/help', evidence: narrativeEvidence }],
          },
        }
      : {}),
  };
  return {
    id: 'f1',
    indicatorSlug: 'rent-burden',
    payload,
    verification: { url_ok: true, schema_ok: true, recency_ok: true, scale_ok: true, content_supported: 'pass' },
    audits: [],
  };
}

function renderCard(f: ReviewFinding): string {
  return renderToStaticMarkup(
    createElement(ReviewCard, {
      tenantSlug: 'anytown',
      runId: 'r1',
      dimensionId: 'd1',
      dimensionName: 'Housing',
      ring: 'social',
      findings: [f],
      approvedVersionNum: null,
      sessionId: null,
      canReadTranscript: false,
      evidenceBase: BASE,
    }),
  );
}

const CAPTURED = '2026-11-20T10:00:00.000Z';

describe('the review card and the text research read', () => {
  it('links the stored text of a captured page beside its snapshot and PDF', () => {
    const html = renderCard(
      capturedFinding({
        snapshot_path: 'evidence/abc123.png',
        pdf_path: 'evidence/abc123.pdf',
        text_path: 'evidence/abc123.txt',
        captured_at: CAPTURED,
      }),
    );
    expect(html).toContain(`href="${BASE}/evidence/abc123.txt"`);
    expect(html).toContain('>text research read</a>');
    expect(html).toContain(`href="${BASE}/evidence/abc123.pdf"`);
    expect(html).not.toContain('No readable text');
  });

  it('says so when a capture found no readable text, as with a scanned PDF', () => {
    const html = renderCard(
      capturedFinding({
        snapshot_path: 'evidence/scan01.png',
        pdf_path: 'evidence/scan01.pdf',
        no_readable_text: true,
        captured_at: CAPTURED,
      }),
    );
    expect(html).toContain('No readable text: research could not read any words on this page or document.');
    expect(html).not.toContain('text research read');
    expect(html).not.toContain('.txt');
  });

  it('shows an older finding, captured before text was kept, with no text link and no note', () => {
    const html = renderCard(capturedFinding({ snapshot_path: 'evidence/old001.png', captured_at: '2026-10-23T00:00:00Z' }));
    expect(html).toContain(`src="${BASE}/evidence/old001.png"`);
    expect(html).toContain('captured 2026-10-23');
    expect(html).not.toContain('text research read');
    expect(html).not.toContain('No readable text');
    expect(html).not.toContain('.txt');
    expect(html).not.toContain('undefined');
  });

  it('links the text of a proposed action source too', () => {
    const html = renderCard(
      capturedFinding(
        { snapshot_path: 'evidence/abc123.png', captured_at: CAPTURED },
        { snapshot_path: 'evidence/help01.png', text_path: 'evidence/help01.txt', captured_at: CAPTURED },
      ),
    );
    expect(html).toContain(`href="${BASE}/evidence/help01.txt"`);
    expect(html).toContain('Archived evidence');
  });
});
