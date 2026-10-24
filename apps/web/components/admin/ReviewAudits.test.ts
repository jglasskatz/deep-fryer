import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AuditOpinions, AuditApplyPreview } from './ReviewAudits';
import { PublishReviewed } from './PublishReviewed';
import type { FindingPayload, ReviewAudit } from '@deep-fryer/core';
vi.stubGlobal('React', React);
vi.mock('@/lib/machine-audit-actions', () => ({ applyMachineAudits: vi.fn(), applyMachineApproved: vi.fn(), publishReviewed: vi.fn() }));
vi.mock('@/lib/use-action', () => ({ useAction: () => ({ run: vi.fn(), pending: false, error: null }) }));
const audit = (source: ReviewAudit['source'], disposition: ReviewAudit['disposition'], correction: ReviewAudit['correction'] = null): ReviewAudit => ({ id: source, findingId: 'f1', source, disposition, reason: `${source} source check`, correction, appliedAt: null, appliedVersionId: null, appliedRunId: null });
const payload: FindingPayload = { kind: 'indicator', indicator_slug: 'test', name: 'Rent burden', value: 42, unit: '% of households', year: 2024, target: 30, source: 'Official data', source_url: 'https://example.gov', source_tier: 1, confidence: 'high', geographic_scale: 'city', evidence: { snapshot_path: 'evidence/source.png', captured_at: '2026-10-23T00:00:00Z' }, scoring: { threshold_ref: 'housing.rent', function: 'lower_is_better', inputs: {}, worked_math: '' }, level_pct: 40 };
describe('reviewing machine recommendations', () => {
  it('keeps both independent opinions visible', () => {
    const html = renderToStaticMarkup(createElement(AuditOpinions, { audits: [audit('workflow', 'approve'), audit('tier_audit', 'reject')] }));
    expect(html).toContain('Workflow audit');
    expect(html).toContain('Source-tier audit');
    expect(html).toContain('Approve as draft');
    expect(html).toContain('Replace with a data gap');
  });
  it('previews exact before/after values and preserves narrative by default', () => {
    const html = renderToStaticMarkup(createElement(AuditApplyPreview, { tenantSlug: 'nyc', runId: 'r1', dimensionId: 'd1', findings: [{ id: 'f1', indicatorSlug: 'rent', payload, audits: [audit('workflow', 'edit', { value: 45 })] }] }));
    expect(html).toContain('Current: 42% of households');
    expect(html).toContain('Proposed: 45% of households');
    expect(html).toContain('Existing context and actions are retained');
    expect(html).toContain('Apply these recommendations');
  });
  it('turns conflicting recommendations into an unapplied research plan preview', () => {
    const html = renderToStaticMarkup(createElement(AuditApplyPreview, { tenantSlug: 'nyc', runId: 'r1', dimensionId: 'd1', findings: [{ id: 'f1', indicatorSlug: 'rent', payload, audits: [audit('workflow', 'edit', { value: 45 }), audit('tier_audit', 'reject')] }] }));
    expect(html).toContain('Plan re-research');
    expect(html).toContain('This does not start a research session');
  });
  it('requires an explicit exact-version selection before publishing', () => {
    const html = renderToStaticMarkup(createElement(PublishReviewed, { tenantSlug: 'nyc', drafts: [{ id: 'v7', dimensionId: 'd1', name: 'Housing', versionNum: 7 }] }));
    expect(html).toContain('Housing · version 7');
    expect(html).toContain('/nyc/admin/dim/d1');
    expect(html).toContain('Publish selected versions (0)');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('checked=""');
  });
});
