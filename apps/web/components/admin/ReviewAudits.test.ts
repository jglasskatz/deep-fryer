import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AuditOpinions, AuditApplyPreview, CausePicker } from './ReviewAudits';
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

describe('applying recommendations asks why for each change', () => {
  const preview = (findings: Parameters<typeof AuditApplyPreview>[0]['findings']) =>
    renderToStaticMarkup(createElement(AuditApplyPreview, { tenantSlug: 'nyc', runId: 'r1', dimensionId: 'd1', findings }));
  const pickers = (html: string) => [...new Set([...html.matchAll(/name="audit-cause-([^"]+)"/g)].map((m) => m[1]))];

  it('asks why for an edit and a rejection, never for an approval, and waits until each has a cause', () => {
    const html = preview([
      { id: 'f1', indicatorSlug: 'rent', payload, audits: [audit('workflow', 'edit', { value: 45 })] },
      { id: 'f2', indicatorSlug: 'rent', payload, audits: [{ ...audit('workflow', 'reject'), findingId: 'f2' }] },
      { id: 'f3', indicatorSlug: 'rent', payload, audits: [{ ...audit('workflow', 'approve'), findingId: 'f3' }] },
    ]);
    expect(pickers(html)).toEqual(['f1', 'f2']);
    expect(html.match(/Why make this change\?/g)).toHaveLength(2);
    expect(html).toContain('Choose why for each of the 2 changes above to apply them.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Apply these recommendations<\/button>/);
  });

  it('asks only about the findings sent back when the card returns to research', () => {
    const html = preview([
      { id: 'f1', indicatorSlug: 'rent', payload, audits: [audit('workflow', 'edit', { value: 45 }), audit('tier_audit', 'reject')] },
      { id: 'f2', indicatorSlug: 'rent', payload, audits: [{ ...audit('workflow', 'reject'), findingId: 'f2' }] },
    ]);
    expect(pickers(html)).toEqual(['f1']);
    expect(html).toContain('Choose why for the change above to apply it.');
  });

  it('asks nothing when every recommendation is an approval', () => {
    const html = preview([{ id: 'f1', indicatorSlug: 'rent', payload, audits: [audit('workflow', 'approve')] }]);
    expect(pickers(html)).toEqual([]);
    expect(html).not.toContain('Choose why');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Apply these recommendations<\/button>/);
  });

  it('asks for the reviewer’s own words when "Something else" is picked', () => {
    const html = renderToStaticMarkup(createElement(CausePicker, { name: 'c', legend: 'Why make this change?', value: 'other', onChange: () => {}, other: { note: '', onNote: () => {} } }));
    expect(html).toContain('What is wrong?');
    expect(html).toMatch(/<input type="radio" name="c" checked="" value="other"/);
    const hinted = renderToStaticMarkup(createElement(CausePicker, { name: 'c', legend: 'Why?', value: 'other', onChange: () => {}, other: { hint: 'Say what is wrong in the notes below.' } }));
    expect(hinted).toContain('Say what is wrong in the notes below.');
    expect(hinted).not.toContain('What is wrong?');
  });
});
